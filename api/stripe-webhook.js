// Vercel serverless — POST /api/stripe-webhook
// Handles subscription lifecycle events from Stripe and syncs them to
// `subscriptions` + `profiles.plan` in Supabase.
//
// Configure: Stripe Dashboard → Developers → Webhooks → +Add endpoint
//   URL:    https://supernova-editor.vercel.app/api/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted,
//           invoice.payment_succeeded, invoice.payment_failed
//   Then add the signing secret to STRIPE_WEBHOOK_SECRET in Vercel env.

import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({error: 'STRIPE_WEBHOOK_SECRET not configured'});
  if (!sig) return res.status(400).json({error: 'Missing stripe-signature header'});

  // Read raw body for signature verification
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  // Verify signature (Stripe scheme: t=...,v1=...)
  if (!verifyStripeSignature(raw, sig, secret)) {
    return res.status(400).json({error: 'Invalid signature'});
  }

  let event;
  try { event = JSON.parse(raw); } catch (e) { return res.status(400).json({error: 'Invalid JSON'}); }

  const obj = event.data?.object || {};
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Created customer; fetch the subscription to get plan + period info
        await syncSubscription({
          stripe_subscription_id: obj.subscription,
          stripe_customer_id: obj.customer,
          profile_id: obj.metadata?.profile_id,
          plan: obj.metadata?.plan,
          interval: obj.metadata?.interval || 'month',
          status: 'active',
          email: obj.customer_email || obj.customer_details?.email,
        });
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await syncSubscription({
          stripe_subscription_id: obj.id,
          stripe_customer_id: obj.customer,
          plan: obj.metadata?.plan || readPlanFromItems(obj.items?.data),
          interval: obj.items?.data?.[0]?.price?.recurring?.interval || 'month',
          status: obj.status,
          current_period_start: obj.current_period_start ? new Date(obj.current_period_start * 1000).toISOString() : null,
          current_period_end:   obj.current_period_end   ? new Date(obj.current_period_end * 1000).toISOString()   : null,
          cancel_at_period_end: !!obj.cancel_at_period_end,
        });
        break;
      }
      case 'customer.subscription.deleted': {
        await syncSubscription({
          stripe_subscription_id: obj.id,
          stripe_customer_id: obj.customer,
          status: 'canceled',
          plan: 'free',
        });
        break;
      }
      case 'invoice.payment_failed': {
        // Mark subscription past_due; webhook usually fires for retries
        await patchSubscriptionByCustomer(obj.customer, {status: 'past_due'});
        break;
      }
      default:
        // No-op for the dozens of event types we don't care about
    }
  } catch (e) {
    console.error('Webhook handler error:', e.message);
    return res.status(500).json({error: e.message});
  }

  return res.status(200).json({received: true, type: event.type});
}

// ============================================================
// Stripe signature verification (mirrors stripe-node's algorithm)
// ============================================================
function verifyStripeSignature(payload, header, secret) {
  const parts = String(header).split(',').map(p => p.trim().split('='));
  const t = parts.find(p => p[0] === 't')?.[1];
  const sigs = parts.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || sigs.length === 0) return false;
  const signed = `${t}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  // 5 minute replay tolerance
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(t)) > 300) return false;
  return sigs.some(s => crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// ============================================================
// Supabase sync helpers (uses SERVICE_ROLE so we can bypass RLS)
// ============================================================
function readPlanFromItems(items) {
  if (!items?.length) return 'creator';
  const id = items[0]?.price?.id || '';
  if (id === process.env.STRIPE_PRICE_PRO_MONTH || id === process.env.STRIPE_PRICE_PRO_YEAR) return 'pro';
  return 'creator';
}

async function syncSubscription(payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('Supabase service creds not set — skipping subscription sync.');
    return;
  }
  // Look up profile by customer ID first; fall back to email
  let profileId = payload.profile_id;
  if (!profileId && payload.email) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(payload.email)}&select=id`, {
      headers: {apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`}
    });
    profileId = (await r.json())[0]?.id;
  }

  // Upsert into subscriptions
  const subRow = {
    profile_id: profileId,
    stripe_customer_id: payload.stripe_customer_id,
    stripe_subscription_id: payload.stripe_subscription_id,
    plan: payload.plan,
    interval: payload.interval,
    status: payload.status,
    current_period_start: payload.current_period_start || null,
    current_period_end:   payload.current_period_end   || null,
    cancel_at_period_end: payload.cancel_at_period_end || false,
    updated_at: new Date().toISOString(),
  };
  await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=stripe_subscription_id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(subRow),
  });

  // Mirror plan + status to profiles
  if (profileId) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({plan: payload.plan, plan_status: payload.status, updated_at: new Date().toISOString()})
    });

    // Plan event audit
    await fetch(`${SUPABASE_URL}/rest/v1/plan_events`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({profile_id: profileId, event: 'stripe_sync', to_plan: payload.plan, source: 'stripe-webhook'})
    });
  }
}

async function patchSubscriptionByCustomer(customerId, patch) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?stripe_customer_id=eq.${customerId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({...patch, updated_at: new Date().toISOString()})
  });
}
