// Vercel serverless — POST /api/stripe-portal
// Creates a Stripe Customer Portal session so users can manage their own
// subscription (upgrade, downgrade, cancel, update payment method).
//
// Request: { customer_id?: 'cus_...', email?: 'user@...', return_url? }
// Either customer_id or email is required (we look up via subscriptions table).

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
      message: 'Stripe not yet configured. Add STRIPE_SECRET_KEY to Vercel env to enable the Customer Portal.',
    });
  }

  const {customer_id, email, return_url = 'https://supernova-editor.vercel.app/?view=settings'} = req.body || {};
  let cid = customer_id;

  // Resolve customer_id from Supabase if only email provided
  if (!cid && email && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscriptions?profile_id=in.(select+id+from+profiles+where+email=eq.${encodeURIComponent(email)})&select=stripe_customer_id&order=updated_at.desc&limit=1`, {
        headers: {apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`}
      });
      cid = (await r.json())[0]?.stripe_customer_id;
    } catch (e) { /* non-fatal */ }
  }

  if (!cid) return res.status(400).json({error: 'No Stripe customer found for this user'});

  const params = new URLSearchParams({customer: cid, return_url});
  try {
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded'},
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({error: data?.error?.message || 'Stripe error'});
    return res.status(200).json({ok: true, url: data.url});
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
