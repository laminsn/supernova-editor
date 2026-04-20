// Vercel serverless — POST /api/send-referral
// Sends referral invite email via Resend and logs to referrals table.
//
// Request: { to, referrer_id, referrer_slug, referrer_name, message?, channel='email',
//            workspace_id?, supabase_url, supabase_key }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'Supernova Editor <onboarding@resend.dev>';
  if (!apiKey) return res.status(500).json({error: 'RESEND_API_KEY not configured'});

  const {
    to, referrer_id, referrer_slug, referrer_name = 'A friend',
    message = '',
    channel = 'email',
    workspace_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  if (!to || !referrer_slug) return res.status(400).json({error: 'Missing to or referrer_slug'});
  // Naive email validation — Resend will hard-bounce anything truly invalid.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({error: 'Invalid recipient email'});

  const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const referralUrl = `https://supernova-editor.vercel.app/?ref=${encodeURIComponent(referrer_slug)}`;
  const recipientFirst = (to.split('@')[0] || 'there').replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 30);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escape(referrer_name)} invited you to Supernova</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <tr><td style="background:linear-gradient(135deg,#FFD60A 0%,#FF8C00 50%,#FF5722 100%);padding:28px;color:#0A0A14;">
        <div style="font-weight:900;font-size:22px;letter-spacing:-0.02em;">SUPERNOVA EDITOR</div>
        <div style="font-size:12px;margin-top:6px;opacity:0.8;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">An invite from ${escape(referrer_name)}</div>
      </td></tr>

      <tr><td style="padding:32px 32px 8px;">
        <p style="margin:0 0 16px;font-size:16px;color:#222;">Hi ${escape(recipientFirst)},</p>
        <p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.65;">
          <strong>${escape(referrer_name)}</strong> uses Supernova Editor to turn one topic into 12 production-ready content assets — Reels, Carousels, Long-form video, SEO Blog posts, Thumbnails, Email sequences, Lead magnets — all powered by Claude AI.
        </p>
        ${message ? `<div style="background:#FFF8E1;border-left:3px solid #FFD60A;padding:14px 16px;margin:0 0 22px;border-radius:6px;font-style:italic;color:#444;font-size:14px;">"${escape(message)}"</div>` : ''}
        <p style="margin:0 0 22px;font-size:15px;color:#444;line-height:1.65;">
          They thought you'd like it. Use the link below to sign up — you'll get instant access to the Strategy Engine, Brain Score, Workflows, Asset Library, and Blog Builder. Free to start, cancel anytime.
        </p>

        <div style="text-align:center;margin:28px 0;">
          <a href="${escape(referralUrl)}" style="display:inline-block;background:linear-gradient(135deg,#FFD60A,#FF8C00);color:#0A0A14;font-weight:800;text-decoration:none;padding:16px 36px;border-radius:10px;font-size:16px;">Claim Your Spot →</a>
        </div>

        <div style="background:#fafafa;border:1px solid #ececec;border-radius:8px;padding:18px;margin-top:8px;">
          <div style="font-weight:800;font-size:11px;color:#666;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">What you'll get on day one</div>
          <ul style="margin:0;padding-left:20px;color:#444;font-size:14px;line-height:1.7;">
            <li>Strategy Engine + Brain Score (powered by Claude)</li>
            <li>Workflows — one topic → 16 deliverables in one click</li>
            <li>Asset Library — stock photos, video, music, SFX, GIFs (all bundled)</li>
            <li>Blog Builder with native WordPress + Ghost publish</li>
            <li>Multi-screen Recording Studio with teleprompter</li>
          </ul>
        </div>
      </td></tr>

      <tr><td style="padding:18px 32px 26px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#777;line-height:1.55;">
        <p style="margin:0 0 6px;">You're receiving this because <strong>${escape(referrer_name)}</strong> personally invited you. We don't add you to any list.</p>
        <p style="margin:0;">
          <a href="https://supernova-editor.vercel.app/?view=privacy" style="color:#777;text-decoration:underline;">Privacy</a>
          &nbsp;·&nbsp;
          <a href="https://supernova-editor.vercel.app/?view=terms" style="color:#777;text-decoration:underline;">Terms</a>
        </p>
        <p style="margin:8px 0 0;">Supernova Editor · Rara Avis Marketing · Wilmington, DE 19801, USA</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  // Send the email
  let resendId = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        reply_to: referrer_name && /@/.test(referrer_name) ? referrer_name : undefined,
        subject: `${referrer_name} invited you to Supernova Editor`,
        html,
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({error: data.message || 'Resend failed', details: data});
    resendId = data.id;
  } catch (e) {
    return res.status(500).json({error: e.message});
  }

  // Log the referral
  if (supabase_url && supabase_key) {
    try {
      await fetch(`${supabase_url}/rest/v1/referrals`, {
        method: 'POST',
        headers: {
          'apikey': supabase_key,
          'Authorization': `Bearer ${supabase_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          referrer_id, referrer_slug, referred_email: to,
          channel, status: 'sent', message,
          utm_source: 'email', utm_campaign: 'referral_invite',
          metadata: {resend_id: resendId},
        })
      });
    } catch(e) { /* non-fatal */ }
  }

  return res.status(200).json({ok: true, id: resendId, referral_url: referralUrl});
}
