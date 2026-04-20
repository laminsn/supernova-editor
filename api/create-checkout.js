// Vercel serverless — POST /api/create-checkout
// Creates a Stripe Checkout session for plan upgrades.
// Scaffolded for STRIPE_SECRET_KEY + price IDs in env. Returns a friendly
// "stripe-not-configured" status until those are set, so the front-end can
// route gracefully (e.g., show "Coming soon" or fall back to free trial).
//
// Request: { plan: 'creator'|'pro', interval: 'month'|'year', email, profile_id, success_url?, cancel_url? }

const PRICE_MAP_KEY = (plan, interval) => `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(200).json({
      ok: false,
      configured: false,
      message: 'Stripe billing not yet enabled. You have full free-trial access. Upgrade flow goes live as soon as STRIPE_SECRET_KEY is added to Vercel env.',
    });
  }

  const {
    plan = 'creator',
    interval = 'month',
    email,
    profile_id,
    success_url = 'https://supernova-editor.vercel.app/?upgraded=1',
    cancel_url  = 'https://supernova-editor.vercel.app/?canceled=1',
  } = req.body || {};

  if (!['creator', 'pro'].includes(plan)) return res.status(400).json({error: 'Invalid plan'});
  if (!['month', 'year'].includes(interval)) return res.status(400).json({error: 'Invalid interval'});
  if (!email) return res.status(400).json({error: 'Missing email'});

  const priceId = process.env[PRICE_MAP_KEY(plan, interval)];
  if (!priceId) {
    return res.status(500).json({
      error: `Price ID env var ${PRICE_MAP_KEY(plan, interval)} not configured. Create products in Stripe Dashboard, then add the price IDs to Vercel.`,
    });
  }

  // Stripe Checkout Sessions API — form-encoded.
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('payment_method_types[]', 'card');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('customer_email', email);
  params.set('success_url', success_url);
  params.set('cancel_url', cancel_url);
  params.set('allow_promotion_codes', 'true');
  params.set('subscription_data[trial_period_days]', '14');
  params.set('metadata[profile_id]', profile_id || '');
  params.set('metadata[plan]', plan);
  params.set('metadata[interval]', interval);

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({error: data?.error?.message || 'Stripe error', details: data});
    return res.status(200).json({ok: true, configured: true, url: data.url, session_id: data.id});
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
