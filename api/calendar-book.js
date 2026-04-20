// Vercel serverless — POST /api/calendar-book
// Creates a booking after re-checking conflict, then emails confirmations
// to both attendee and host via Resend.
//
// Request: {
//   slug, starts_at_iso, attendee_name, attendee_email, attendee_phone?,
//   timezone?, custom_answers?, notes?, supabase_url, supabase_key
// }
// Response: { ok, booking, cancellation_url, ics }

import crypto from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    slug, starts_at_iso, attendee_name, attendee_email, attendee_phone = null,
    timezone = null, custom_answers = {}, notes = null, sms_consent = false,
    supabase_url, supabase_key,
  } = req.body || {};

  if (!slug || !starts_at_iso || !attendee_name || !attendee_email) {
    return res.status(400).json({error: 'Missing required fields'});
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee_email)) {
    return res.status(400).json({error: 'Invalid email'});
  }
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // 1. Load calendar
  const calRes = await fetch(`${supabase_url}/rest/v1/calendars?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=*`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  const cal = (await calRes.json())[0];
  if (!cal) return res.status(404).json({error: 'Calendar not found'});

  const startsAt = new Date(starts_at_iso);
  if (isNaN(startsAt.getTime())) return res.status(400).json({error: 'Invalid starts_at_iso'});
  const endsAt = new Date(startsAt.getTime() + cal.duration_minutes * 60000);

  // 2. Notice window guard
  if (startsAt.getTime() < Date.now() + cal.min_notice_hours * 3600000) {
    return res.status(400).json({error: `Bookings require at least ${cal.min_notice_hours}h notice`});
  }

  // 3. Conflict re-check
  const conflictRes = await fetch(
    `${supabase_url}/rest/v1/bookings?calendar_id=eq.${cal.id}&starts_at=lt.${endsAt.toISOString()}&ends_at=gt.${startsAt.toISOString()}&status=neq.cancelled&select=id`,
    {headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`}}
  );
  const conflicts = await conflictRes.json();
  if (conflicts.length > 0) {
    return res.status(409).json({error: 'That slot was just taken. Please pick another time.'});
  }

  // 4. Create booking
  const cancellationToken = crypto.randomBytes(18).toString('hex');
  const rescheduleToken   = crypto.randomBytes(18).toString('hex');
  const bookingPayload = {
    calendar_id: cal.id, workspace_id: cal.workspace_id,
    attendee_name, attendee_email, attendee_phone,
    starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    duration_minutes: cal.duration_minutes,
    timezone: timezone || cal.timezone,
    status: 'confirmed',
    meeting_link: cal.meeting_link || null,
    cancellation_token: cancellationToken,
    reschedule_token: rescheduleToken,
    custom_answers, notes,
    sms_consent: !!(sms_consent && attendee_phone),
  };
  const insertRes = await fetch(`${supabase_url}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      apikey: supabase_key, Authorization: `Bearer ${supabase_key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(bookingPayload),
  });
  if (!insertRes.ok) {
    const txt = await insertRes.text();
    return res.status(500).json({error: 'Could not save booking', details: txt.slice(0, 200)});
  }
  const booking = (await insertRes.json())[0];

  const baseUrl = process.env.PUBLIC_URL || 'https://supernova-editor.vercel.app';
  const cancellationUrl = `${baseUrl}/?cancel_booking=${cancellationToken}`;
  const rescheduleUrl   = `${baseUrl}/?reschedule_booking=${rescheduleToken}`;

  // 5. Build ICS file string
  const ics = buildIcs({
    uid: booking.id,
    summary: cal.name,
    description: (cal.description || '') + (notes ? `\n\nNotes: ${notes}` : ''),
    location: cal.meeting_link || cal.meeting_provider || '',
    starts: startsAt, ends: endsAt,
    organizerEmail: process.env.RESEND_FROM_ADDRESS || 'noreply@supernova-editor.vercel.app',
    attendeeEmail: attendee_email,
  });

  // 6. Send confirmation email (uses custom template if set, else default)
  if (process.env.RESEND_API_KEY) {
    const fromAddress = process.env.RESEND_FROM || 'Supernova Editor <onboarding@resend.dev>';
    sendConfirmationEmails({
      apiKey: process.env.RESEND_API_KEY, fromAddress,
      cal, booking, cancellationUrl, rescheduleUrl, ics,
    }).catch(e => console.warn('confirmation email failed:', e.message));
  }

  // 7. Fire confirmation SMS if attendee opted in + calendar has it enabled
  if (booking.sms_consent && cal.sms_enabled && process.env.TWILIO_ACCOUNT_SID) {
    fetch(`${baseUrl}/api/booking-sms`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({booking_id: booking.id, kind: 'confirmation'}),
    }).catch(e => console.warn('confirmation SMS failed:', e.message));
  }

  return res.status(200).json({
    ok: true,
    booking: {
      id: booking.id,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      meeting_link: booking.meeting_link,
    },
    cancellation_url: cancellationUrl,
    reschedule_url: rescheduleUrl,
    redirect_url: cal.redirect_url,
    ics,
  });
}

// ============================================================
// ICS file builder (RFC 5545 minimal)
// ============================================================
function buildIcs({uid, summary, description, location, starts, ends, organizerEmail, attendeeEmail}) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Supernova Editor//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}@supernova-editor.vercel.app`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(starts)}`,
    `DTEND:${fmt(ends)}`,
    `SUMMARY:${escape(summary)}`,
    `DESCRIPTION:${escape(description)}`,
    location ? `LOCATION:${escape(location)}` : '',
    `ORGANIZER:mailto:${organizerEmail}`,
    `ATTENDEE;RSVP=TRUE:mailto:${attendeeEmail}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

async function sendConfirmationEmails({apiKey, fromAddress, cal, booking, cancellationUrl, rescheduleUrl, ics}) {
  const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const startsLocal = new Date(booking.starts_at).toLocaleString('en-US', {timeZone: booking.timezone, dateStyle: 'full', timeStyle: 'short'});

  // Custom template path: use cal.email_confirmation_subject + html if present.
  let subject, html;
  if (cal.email_confirmation_subject || cal.email_confirmation_html) {
    subject = renderBookingVars(cal.email_confirmation_subject || `Confirmed: ${cal.name}`, booking, cal);
    html = cal.email_confirmation_html
      ? renderBookingVars(cal.email_confirmation_html, booking, cal)
      : defaultConfirmationHtml({cal, booking, startsLocal, cancellationUrl, rescheduleUrl, escape});
  } else {
    subject = `Confirmed: ${cal.name} on ${startsLocal}`;
    html = defaultConfirmationHtml({cal, booking, startsLocal, cancellationUrl, rescheduleUrl, escape});
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      from: fromAddress,
      to: [booking.attendee_email],
      subject,
      html,
      attachments: [{filename: 'invite.ics', content: Buffer.from(ics).toString('base64')}],
    }),
  });
}

function renderBookingVars(template, booking, calendar) {
  const startDate = new Date(booking.starts_at);
  const tz = booking.timezone || calendar?.timezone || 'America/New_York';
  const fmt = (opts) => startDate.toLocaleString('en-US', {timeZone: tz, ...opts});
  const baseUrl = process.env.PUBLIC_URL || 'https://supernova-editor.vercel.app';
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
    '{{cancel_url}}':     `${baseUrl}/?cancel_booking=${booking.cancellation_token}`,
    '{{reschedule_url}}': `${baseUrl}/?reschedule_booking=${booking.reschedule_token}`,
  };
  let out = String(template);
  for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
  return out;
}

function defaultConfirmationHtml({cal, booking, startsLocal, cancellationUrl, rescheduleUrl, escape}) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
  <tr><td style="background:linear-gradient(135deg,#FFD60A 0%,#FF8C00 100%);padding:24px;color:#0A0A14;">
    <div style="font-weight:900;font-size:20px;">SUPERNOVA EDITOR</div>
    <div style="font-size:11px;margin-top:4px;opacity:0.8;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Booking confirmed</div>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#222;">Hi ${escape(booking.attendee_name)},</p>
    <p style="margin:0 0 18px;font-size:15px;color:#444;line-height:1.65;">Your <strong>${escape(cal.name)}</strong> is booked. Here are the details:</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#FFF8E1;border:1px solid #FFD60A;border-radius:10px;padding:16px;margin-bottom:20px;">
      <tr><td style="padding:6px 0;font-size:14px;color:#666;width:120px;">When:</td><td style="padding:6px 0;font-size:14px;color:#111;font-weight:600;">${escape(startsLocal)}</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;color:#666;">Duration:</td><td style="padding:6px 0;font-size:14px;color:#111;">${booking.duration_minutes} minutes</td></tr>
      ${booking.meeting_link ? `<tr><td style="padding:6px 0;font-size:14px;color:#666;">Link:</td><td style="padding:6px 0;font-size:14px;"><a href="${escape(booking.meeting_link)}" style="color:#FF8C00;font-weight:700;">${escape(booking.meeting_link)}</a></td></tr>` : ''}
    </table>
    <p style="margin:0 0 16px;font-size:14px;color:#444;">An <strong>.ics</strong> calendar invite is attached — open it to add this to your calendar.</p>
    <p style="margin:0 0 16px;font-size:14px;color:#666;">Need to change plans?</p>
    <p style="margin:0 0 16px;font-size:14px;"><a href="${escape(rescheduleUrl)}" style="color:#FF8C00;">Reschedule</a> &nbsp;·&nbsp; <a href="${escape(cancellationUrl)}" style="color:#FF8C00;">Cancel</a></p>
  </td></tr>
  <tr><td style="padding:18px 32px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
    Supernova Editor · Powered by Claude AI
  </td></tr>
</table></td></tr></table></body></html>`;
}
