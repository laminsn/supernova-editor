// Vercel serverless — POST /api/newsletter-subscribe
// Public endpoint anyone can call to add an email to a newsletter list.
// Supports double opt-in: when list.double_opt_in=true we send a
// confirmation email and only flip status='subscribed' when they click.
//
// Request: { email, name?, list_slug?, source?, supabase_url, supabase_key }

import crypto from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {email, name = null, list_slug = 'main', source = 'website', supabase_url, supabase_key} = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({error: 'Valid email required'});
  }
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // Resolve list (or fall back to nullable)
  let list = null;
  try {
    const r = await fetch(`${supabase_url}/rest/v1/newsletter_lists?slug=eq.${encodeURIComponent(list_slug)}&select=*`, {
      headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
    });
    if (r.ok) list = (await r.json())[0] || null;
  } catch (e) {}

  const doubleOptIn = list?.double_opt_in !== false; // default to true
  const confirmationToken = crypto.randomBytes(18).toString('hex');

  const subscriberRow = {
    workspace_id: list?.workspace_id || null,
    list_id: list?.id || null,
    email, name, source,
    tags: ['newsletter', list_slug],
    status: doubleOptIn ? 'pending' : 'subscribed',
    confirmation_token: doubleOptIn ? confirmationToken : null,
    confirmed_at: doubleOptIn ? null : new Date().toISOString(),
    metadata: {ip: req.headers['x-forwarded-for'] || null, user_agent: req.headers['user-agent'] || null},
  };

  // Upsert (idempotent on workspace+email — already constrained)
  const upRes = await fetch(`${supabase_url}/rest/v1/subscribers?on_conflict=workspace_id,email`, {
    method: 'POST',
    headers: {
      apikey: supabase_key, Authorization: `Bearer ${supabase_key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(subscriberRow),
  });
  if (!upRes.ok) {
    const txt = await upRes.text();
    return res.status(500).json({error: 'Subscribe failed', details: txt.slice(0, 200)});
  }

  // Send confirmation email (or welcome email)
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'Supernova Editor <onboarding@resend.dev>';
  const baseUrl = process.env.PUBLIC_URL || 'https://supernova-editor.vercel.app';

  if (apiKey) {
    if (doubleOptIn) {
      const confirmUrl = `${baseUrl}/?confirm_subscription=${confirmationToken}`;
      sendEmail({apiKey, from: fromAddress, to: email,
        subject: `Confirm your subscription`,
        html: confirmHtml({name, listName: list?.name || 'our newsletter', confirmUrl}),
      }).catch(() => {});
    } else if (list?.welcome_email_html) {
      sendEmail({apiKey, from: fromAddress, to: email,
        subject: list.welcome_email_subject || 'Welcome',
        html: list.welcome_email_html.replace(/\{\{name\}\}/g, name || 'there'),
      }).catch(() => {});
    }
  }

  return res.status(200).json({
    ok: true,
    status: doubleOptIn ? 'pending_confirmation' : 'subscribed',
    redirect_url: list?.redirect_url || null,
  });
}

async function sendEmail({apiKey, from, to, subject, html}) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      from, to: [to], subject, html,
      headers: {
        'List-Unsubscribe': `<${process.env.PUBLIC_URL || 'https://supernova-editor.vercel.app'}/?unsubscribe=${encodeURIComponent(to)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
}

function confirmHtml({name, listName, confirmUrl}) {
  const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;background:#f5f5f5;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#FFD60A,#FF8C00);padding:24px;color:#0A0A14;">
    <div style="font-weight:900;font-size:20px;">Almost there.</div>
    <div style="font-size:11px;margin-top:4px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;opacity:.85;">Confirm your subscription</div>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#222;">Hi ${escape(name || 'there')},</p>
    <p style="margin:0 0 22px;font-size:15px;color:#444;line-height:1.65;">You asked to subscribe to <strong>${escape(listName)}</strong>. Tap below to confirm — we won't send you anything until you do.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${escape(confirmUrl)}" style="display:inline-block;background:linear-gradient(135deg,#FFD60A,#FF8C00);color:#0A0A14;font-weight:800;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;">Confirm Subscription</a>
    </div>
    <p style="margin:0 0 10px;font-size:12px;color:#888;">If you didn't request this, you can safely ignore the email.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}
