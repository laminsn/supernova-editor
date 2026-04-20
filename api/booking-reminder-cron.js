// Vercel serverless — GET /api/booking-reminder-cron
// Triggered by Vercel Cron every 15 minutes. Scans confirmed bookings for
// the 24h and 1h reminder windows, fires email + SMS (if consented), marks
// reminder_*_sent_at so we don't double-send.
//
// Window math:
//   24h reminder: starts_at between (now + 23h45m) and (now + 24h15m), and
//                 reminder_24h_sent_at IS NULL
//   1h reminder:  starts_at between (now + 50m) and (now + 70m), and
//                 reminder_1h_sent_at IS NULL
//
// Idempotent: even if the cron fires twice in a window, we only send once.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const RESEND_FROM  = process.env.RESEND_FROM || 'Supernova Editor <onboarding@resend.dev>';
const PUBLIC_URL   = process.env.PUBLIC_URL || 'https://supernova-editor.vercel.app';

export default async function handler(req, res) {
  // Vercel Cron sends a Bearer token; allow either auth or open in dev.
  const auth = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    // Allow GETs from anywhere if no secret is set (so manual debug works);
    // when CRON_SECRET is set, require it.
    return res.status(401).json({error: 'Unauthorized'});
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({error: 'Supabase service creds not configured'});
  }

  const now = Date.now();
  const window24From = new Date(now + 23 * 3600000 + 45 * 60000).toISOString();
  const window24To   = new Date(now + 24 * 3600000 + 15 * 60000).toISOString();
  const window1From  = new Date(now + 50 * 60000).toISOString();
  const window1To    = new Date(now + 70 * 60000).toISOString();

  // Fetch due bookings + parent calendars in two queries
  const [due24Res, due1Res] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/bookings?status=eq.confirmed&reminder_24h_sent_at=is.null&starts_at=gte.${window24From}&starts_at=lte.${window24To}&select=*,calendar:calendars(*)`,
      {headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`}}),
    fetch(`${SUPABASE_URL}/rest/v1/bookings?status=eq.confirmed&reminder_1h_sent_at=is.null&starts_at=gte.${window1From}&starts_at=lte.${window1To}&select=*,calendar:calendars(*)`,
      {headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`}}),
  ]);
  const due24 = (await due24Res.json()) || [];
  const due1  = (await due1Res.json())  || [];

  const results = [];
  for (const b of due24) {
    if (b.calendar?.send_reminder_24h === false) continue;
    results.push(await sendReminder(b, '24h'));
  }
  for (const b of due1) {
    if (b.calendar?.send_reminder_1h === false) continue;
    results.push(await sendReminder(b, '1h'));
  }

  return res.status(200).json({
    ok: true, ran_at: new Date().toISOString(),
    due_24h: due24.length, due_1h: due1.length,
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    details: results,
  });
}

async function sendReminder(booking, kind) {
  const cal = booking.calendar || {};
  const result = {booking_id: booking.id, kind, email: false, sms: false, errors: []};

  // ----- Email -----
  if (RESEND_KEY) {
    try {
      const subject = renderVars(
        kind === '24h' ? (cal.email_24h_subject || 'Reminder: {{calendar}} tomorrow at {{time}}')
                       : (cal.email_1h_subject  || 'Starting in 1 hour: {{calendar}}'),
        booking, cal
      );
      const customHtml = kind === '24h' ? cal.email_24h_html : cal.email_1h_html;
      const html = customHtml
        ? renderVars(customHtml, booking, cal)
        : defaultReminderHtml({booking, cal, kind});
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({from: RESEND_FROM, to: [booking.attendee_email], subject, html}),
      });
      if (!r.ok) {
        const txt = await r.text();
        result.errors.push('email:' + txt.slice(0, 120));
      } else {
        result.email = true;
      }
    } catch (e) {
      result.errors.push('email:' + e.message);
    }
  }

  // ----- SMS -----
  if (booking.attendee_phone && booking.sms_consent && cal.sms_enabled) {
    try {
      const r = await fetch(`${PUBLIC_URL}/api/booking-sms`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({booking_id: booking.id, kind}),
      });
      const d = await r.json();
      if (d.ok) result.sms = true;
      else result.errors.push('sms:' + (d.error || ''));
    } catch (e) {
      result.errors.push('sms:' + e.message);
    }
  }

  // ----- Mark sent -----
  const patch = kind === '24h'
    ? {reminder_24h_sent_at: new Date().toISOString()}
    : {reminder_1h_sent_at:  new Date().toISOString()};
  await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${booking.id}`, {
    method: 'PATCH',
    headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(patch),
  }).catch(() => {});

  result.ok = result.errors.length === 0 || result.email || result.sms;
  return result;
}

// ============================================================
// Variable interpolation — must mirror /api/booking-sms renderVars
// ============================================================
function renderVars(template, booking, calendar) {
  const startDate = new Date(booking.starts_at);
  const tz = booking.timezone || calendar?.timezone || 'America/New_York';
  const fmt = (opts) => startDate.toLocaleString('en-US', {timeZone: tz, ...opts});
  const vars = {
    '{{name}}':           booking.attendee_name || 'there',
    '{{first_name}}':     (booking.attendee_name || '').split(' ')[0] || 'there',
    '{{calendar}}':       calendar?.name || 'your meeting',
    '{{date}}':           fmt({weekday:'short', month:'short', day:'numeric'}),
    '{{time}}':           fmt({hour:'numeric', minute:'2-digit'}),
    '{{datetime}}':       fmt({dateStyle:'full', timeStyle:'short'}),
    '{{tz}}':             tz,
    '{{duration}}':       booking.duration_minutes + ' min',
    '{{meeting_link}}':   booking.meeting_link || '',
    '{{cancel_url}}':     `${PUBLIC_URL}/?cancel_booking=${booking.cancellation_token}`,
    '{{reschedule_url}}': `${PUBLIC_URL}/?reschedule_booking=${booking.reschedule_token}`,
  };
  let out = String(template);
  for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
  return out;
}

function defaultReminderHtml({booking, cal, kind}) {
  const escape = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const startsLocal = new Date(booking.starts_at).toLocaleString('en-US', {timeZone: booking.timezone || cal.timezone, dateStyle:'full', timeStyle:'short'});
  const headline = kind === '24h' ? 'See you tomorrow' : 'Starting in 1 hour';
  const cancelUrl = `${PUBLIC_URL}/?cancel_booking=${booking.cancellation_token}`;
  const rescheduleUrl = `${PUBLIC_URL}/?reschedule_booking=${booking.reschedule_token}`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;background:#f5f5f5;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
  <tr><td style="background:linear-gradient(135deg,#FFD60A,#FF8C00);padding:24px;color:#0A0A14;">
    <div style="font-weight:900;font-size:20px;">${escape(headline)}</div>
    <div style="font-size:11px;margin-top:4px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;opacity:.85;">${escape(cal.name || 'Reminder')}</div>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 12px;font-size:16px;color:#222;">Hi ${escape(booking.attendee_name)},</p>
    <p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.6;">Quick heads-up: <strong>${escape(cal.name)}</strong> is ${kind === '24h' ? 'tomorrow' : 'in 1 hour'}.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#FFF8E1;border:1px solid #FFD60A;border-radius:10px;padding:16px;margin-bottom:18px;">
      <tr><td style="padding:6px 0;font-size:14px;color:#666;width:120px;">When:</td><td style="padding:6px 0;font-size:14px;font-weight:600;">${escape(startsLocal)}</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;color:#666;">Duration:</td><td style="padding:6px 0;font-size:14px;">${booking.duration_minutes} minutes</td></tr>
      ${booking.meeting_link ? `<tr><td style="padding:6px 0;font-size:14px;color:#666;">Link:</td><td style="padding:6px 0;font-size:14px;"><a href="${escape(booking.meeting_link)}" style="color:#FF8C00;font-weight:700;">${escape(booking.meeting_link)}</a></td></tr>` : ''}
    </table>
    <p style="margin:0;font-size:13px;color:#666;"><a href="${escape(rescheduleUrl)}" style="color:#FF8C00;">Reschedule</a> &nbsp;·&nbsp; <a href="${escape(cancelUrl)}" style="color:#FF8C00;">Cancel</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
}
