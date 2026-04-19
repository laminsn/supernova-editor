// Vercel serverless function — POST /api/send-package
// Sends a collaboration package email via Resend
// Requires: RESEND_API_KEY env var in Vercel project settings

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'Supernova Editor <onboarding@resend.dev>';

  if (!apiKey) {
    return res.status(500).json({
      error: 'RESEND_API_KEY not configured',
      hint: 'Add RESEND_API_KEY to Vercel env vars: vercel env add RESEND_API_KEY'
    });
  }

  const { to, collaboratorName, campaignName, postingTime, platform, caption, hashtags, mentions, trackingUrl } = req.body || {};

  if (!to) return res.status(400).json({error: 'Missing recipient email'});

  const platformLabels = {
    ig: 'Instagram', tt: 'TikTok', yt: 'YouTube', li: 'LinkedIn', fb: 'Facebook'
  };
  const platformLabel = platformLabels[platform] || 'Social Media';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>${campaignName}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <!-- HEADER -->
      <tr><td style="background:linear-gradient(135deg,#FFD60A,#FF8C00);padding:24px;color:#0A0A14;">
        <div style="font-weight:800;font-size:18px;letter-spacing:-0.02em;">SUPERNOVA EDITOR</div>
        <div style="font-size:13px;margin-top:4px;opacity:0.7;">${campaignName}</div>
      </td></tr>

      <!-- BODY -->
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px;font-size:16px;color:#222;">Hi <strong>${(collaboratorName||'').split(' ')[0]}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">Your content package is ready. Everything you need is below — just copy, paste, and post.</p>

        <!-- POSTING TIME -->
        <div style="background:#FFF8E1;border:1px solid #FFD60A;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-weight:700;font-size:11px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Posting Time</div>
          <div style="font-size:18px;font-weight:700;color:#111;">${postingTime}</div>
          <div style="font-size:13px;color:#666;margin-top:4px;">${platformLabel}</div>
        </div>

        <!-- CAPTION -->
        <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-weight:700;font-size:11px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Ready-to-Paste Caption</div>
          <div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap;">${(caption||'').replace(/</g,'&lt;')}</div>
        </div>

        <!-- HASHTAGS -->
        <div style="background:#f0f4ff;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-weight:700;font-size:11px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Hashtag Set</div>
          <div style="font-size:13px;color:#4169E1;line-height:1.8;">${(hashtags||'').replace(/</g,'&lt;')}</div>
        </div>

        <!-- MENTIONS -->
        <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-weight:700;font-size:11px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Mentions &amp; Tags</div>
          <div style="font-size:14px;color:#333;">${(mentions||'').replace(/</g,'&lt;')}</div>
        </div>

        <!-- TRACKING -->
        ${trackingUrl ? `<div style="background:#f5fff5;border:1px solid #c8e6c9;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="font-weight:700;font-size:11px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Tracking Link (use in bio/comments)</div>
          <div style="font-size:13px;color:#1a7f3c;word-break:break-all;font-family:monospace;">${trackingUrl}</div>
        </div>` : ''}

        <!-- MARK AS POSTED CTA -->
        <div style="text-align:center;padding:24px 0;">
          <a href="${trackingUrl||'#'}" style="display:inline-block;background:linear-gradient(135deg,#FFD60A,#FF8C00);color:#0A0A14;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;">Mark as Posted</a>
          <div style="font-size:12px;color:#999;margin-top:10px;">Click after you've posted to confirm completion</div>
        </div>
      </td></tr>

      <tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center;font-size:11px;color:#999;">
        Sent via Supernova Editor &middot; Rara Avis Marketing LLC
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject: `[Action Required] Your Content Package — ${campaignName}`,
        html
      })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('Resend error:', data);
      return res.status(r.status).json({error: data.message || 'Resend failed', details: data});
    }
    return res.status(200).json({ok: true, id: data.id});
  } catch (e) {
    console.error('Send error:', e);
    return res.status(500).json({error: e.message});
  }
}
