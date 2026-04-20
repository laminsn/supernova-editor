// Vercel serverless — POST /api/send-campaign
// Sends a marketing email campaign to a list of recipients via Resend.
// Logs sends + opens via List-Unsubscribe header so users can one-click out.
//
// Request: {
//   campaign_id?: 'uuid',           // existing draft (preferred) — pulls subject/html
//   subject, html, text?,           // OR inline content
//   recipients: [{email, name?}, ...],
//   from_name?, reply_to?, workspace_id?, supabase_url?, supabase_key?
// }

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
    campaign_id = null,
    subject: subjectIn, html: htmlIn, text: textIn = null,
    recipients = [], from_name = 'Supernova Editor', reply_to = null,
    workspace_id = null, supabase_url = null, supabase_key = null,
  } = req.body || {};

  let subject = subjectIn, html = htmlIn, text = textIn;

  // If a campaign_id was passed, hydrate from the table.
  if (campaign_id && supabase_url && supabase_key) {
    const r = await fetch(`${supabase_url}/rest/v1/email_campaigns?id=eq.${campaign_id}&select=*`, {
      headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
    });
    const camp = (await r.json())[0];
    if (camp) { subject = camp.subject; html = camp.html_body; text = camp.text_body; }
  }

  if (!subject || !html) return res.status(400).json({error: 'Missing subject or html'});
  if (!Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({error: 'Recipients required'});

  // Send in batches of 50 (Resend allows up to 100 to-fields per request)
  const ok = [];
  const failed = [];
  const from = from_name ? `${from_name} <${fromAddress.match(/<([^>]+)>/)?.[1] || fromAddress}>` : fromAddress;

  for (const r of recipients.slice(0, 5000)) {
    if (!r.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) { failed.push({email: r.email, reason: 'invalid'}); continue; }
    const personalizedHtml = html.replace(/\{\{name\}\}/g, escape(r.name || r.email.split('@')[0]));
    try {
      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          from, to: [r.email], subject, html: personalizedHtml, text: text || undefined,
          reply_to: reply_to || undefined,
          headers: {
            'List-Unsubscribe': `<https://supernova-editor.vercel.app/?unsubscribe=${encodeURIComponent(r.email)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });
      const d = await send.json();
      if (!send.ok) failed.push({email: r.email, reason: d?.message || 'http_'+send.status});
      else ok.push({email: r.email, id: d.id});
    } catch (e) {
      failed.push({email: r.email, reason: e.message});
    }
  }

  // Log to campaign_recipients if we have a campaign + supabase
  if (campaign_id && supabase_url && supabase_key) {
    fetch(`${supabase_url}/rest/v1/campaign_recipients`, {
      method: 'POST',
      headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal'},
      body: JSON.stringify([
        ...ok.map(r => ({campaign_id, recipient: r.email, status: 'sent', resend_id: r.id, sent_at: new Date().toISOString()})),
        ...failed.map(r => ({campaign_id, recipient: r.email, status: 'failed', error: r.reason, sent_at: new Date().toISOString()})),
      ]),
    }).catch(() => {});

    fetch(`${supabase_url}/rest/v1/email_campaigns?id=eq.${campaign_id}`, {
      method: 'PATCH',
      headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({status: 'sent', sent_at: new Date().toISOString(), sent_count: ok.length, failed_count: failed.length}),
    }).catch(() => {});
  }

  return res.status(200).json({ok: true, sent: ok.length, failed: failed.length, failed_details: failed.slice(0, 20)});
}

function escape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
