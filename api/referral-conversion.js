// Vercel serverless — POST /api/referral-conversion
// Called when a referred user signs up or upgrades.
// Marks the referral row converted, optionally rewards the referrer, and
// sends the referrer a "your friend signed up" email via Resend.
//
// Request: { referrer_slug, referred_user_id, referred_email, event='signed_up'|'converted',
//            workspace_id?, supabase_url, supabase_key }

const REWARD_AMOUNT_CENTS = 1000; // $10 referral credit per converted signup
const REWARD_AT_EVENT = 'signed_up';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    referrer_slug, referred_user_id, referred_email,
    event = 'signed_up',
    supabase_url = null, supabase_key = null,
  } = req.body || {};

  if (!referrer_slug) return res.status(400).json({error: 'Missing referrer_slug'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // 1. Look up referrer profile
  const referrerRes = await fetch(
    `${supabase_url}/rest/v1/profiles?referral_slug=eq.${encodeURIComponent(referrer_slug)}&select=id,email,first_name,display_name`,
    {headers: {'apikey': supabase_key, 'Authorization': `Bearer ${supabase_key}`}}
  );
  if (!referrerRes.ok) return res.status(500).json({error: 'Profile lookup failed'});
  const referrer = (await referrerRes.json())[0];
  if (!referrer) return res.status(404).json({error: 'Referrer not found for slug ' + referrer_slug});

  // 2. Find or create the referral row
  const matchUrl = referred_user_id
    ? `${supabase_url}/rest/v1/referrals?referred_user_id=eq.${referred_user_id}`
    : referred_email
      ? `${supabase_url}/rest/v1/referrals?referrer_id=eq.${referrer.id}&referred_email=eq.${encodeURIComponent(referred_email)}`
      : null;

  let referralRow = null;
  if (matchUrl) {
    const r = await fetch(matchUrl + '&order=created_at.desc&limit=1', {
      headers: {'apikey': supabase_key, 'Authorization': `Bearer ${supabase_key}`}
    });
    if (r.ok) referralRow = (await r.json())[0];
  }

  const patch = {
    referrer_id: referrer.id,
    referrer_slug,
    referred_user_id: referred_user_id || null,
    referred_email: referred_email || null,
    status: event,
  };
  if (event === 'signed_up') patch.signed_up_at = new Date().toISOString();
  if (event === 'converted') patch.converted_at = new Date().toISOString();
  if (event === REWARD_AT_EVENT) {
    patch.reward_amount_cents = REWARD_AMOUNT_CENTS;
    patch.reward_status = 'pending';
  }

  if (referralRow?.id) {
    await fetch(`${supabase_url}/rest/v1/referrals?id=eq.${referralRow.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(patch)
    });
  } else {
    await fetch(`${supabase_url}/rest/v1/referrals`, {
      method: 'POST',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({...patch, channel: 'attributed'})
    });
  }

  // 3. Mark the new profile.referred_by
  if (referred_user_id) {
    await fetch(`${supabase_url}/rest/v1/profiles?id=eq.${referred_user_id}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({referred_by: referrer.id})
    }).catch(() => {});
  }

  // 4. Email the referrer that someone signed up via their link
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'Supernova Editor <onboarding@resend.dev>';
  if (resendKey && referrer.email) {
    const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const referrerFirst = referrer.first_name || referrer.display_name || 'there';
    const newUserName = (referred_email || '').split('@')[0] || 'someone new';
    const rewardLine = event === REWARD_AT_EVENT
      ? `<p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.65;"><strong>$${(REWARD_AMOUNT_CENTS/100).toFixed(2)} credit</strong> has been added to your account. We'll apply it on your next bill.</p>`
      : '';
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <tr><td style="background:linear-gradient(135deg,#FFD60A 0%,#FF8C00 50%);padding:24px;color:#0A0A14;">
    <div style="font-weight:900;font-size:20px;">SUPERNOVA EDITOR</div>
    <div style="font-size:11px;margin-top:4px;opacity:0.8;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Your referral signed up</div>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#222;">Hi ${escape(referrerFirst)},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.65;">${escape(newUserName)} just signed up for Supernova through your referral link. Nice work.</p>
    ${rewardLine}
    <p style="margin:0 0 22px;font-size:15px;color:#444;line-height:1.65;">Want to invite more? Your link is always at: <a href="https://supernova-editor.vercel.app/referrals" style="color:#FF8C00;font-weight:700;">supernova-editor.vercel.app/referrals</a></p>
    <div style="text-align:center;margin:24px 0;">
      <a href="https://supernova-editor.vercel.app/?view=dashboard" style="display:inline-block;background:linear-gradient(135deg,#FFD60A,#FF8C00);color:#0A0A14;font-weight:800;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;">View Your Referrals</a>
    </div>
  </td></tr>
  <tr><td style="padding:18px 32px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
    Supernova Editor · Rara Avis Marketing · Wilmington, DE 19801, USA
  </td></tr>
</table></td></tr></table></body></html>`;

    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        from: fromAddress, to: [referrer.email],
        subject: `🎉 ${newUserName} signed up via your link`,
        html,
      })
    }).catch(() => {});
  }

  return res.status(200).json({
    ok: true,
    referrer_id: referrer.id,
    event,
    reward_credited_cents: event === REWARD_AT_EVENT ? REWARD_AMOUNT_CENTS : 0,
  });
}
