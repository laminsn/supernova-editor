// Vercel serverless — POST /api/booking-sms
// Sends a Twilio SMS for a booking lifecycle event (confirmation/24h/1h/custom).
// Honors A2P 10DLC compliance: requires sms_consent=true on the booking.
//
// Request: { booking_id, kind: 'confirmation'|'24h'|'1h'|'custom',
//            text?, supabase_url?, supabase_key? }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_FROM_NUMBER;
const STOP_FOOTER  = ' Reply STOP to opt out.';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return res.status(200).json({ok:false, configured:false, message:'Twilio not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER missing). Skipping SMS.'});
  }

  const {booking_id, kind = 'confirmation', text: customText,
         supabase_url = SUPABASE_URL, supabase_key = SUPABASE_KEY} = req.body || {};
  if (!booking_id) return res.status(400).json({error: 'Missing booking_id'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // Load booking + parent calendar
  const bRes = await fetch(`${supabase_url}/rest/v1/bookings?id=eq.${booking_id}&select=*`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  const booking = (await bRes.json())[0];
  if (!booking) return res.status(404).json({error: 'Booking not found'});
  if (!booking.attendee_phone) return res.status(400).json({error: 'No phone number on this booking'});
  if (!booking.sms_consent) return res.status(400).json({error: 'Attendee did not opt in to SMS (sms_consent=false)'});

  const cRes = await fetch(`${supabase_url}/rest/v1/calendars?id=eq.${booking.calendar_id}&select=*`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  const calendar = (await cRes.json())[0];

  // Pick template
  const templateMap = {
    confirmation: calendar?.sms_confirmation_text || 'Hi {{name}}, your {{calendar}} is booked for {{date}} at {{time}} ({{tz}}). {{cancel_url}}',
    '24h':         calendar?.sms_24h_text         || 'Reminder: {{calendar}} tomorrow at {{time}} ({{tz}}). {{meeting_link}}',
    '1h':          calendar?.sms_1h_text          || 'Starting in 1 hour: {{calendar}} at {{time}}. {{meeting_link}}',
  };
  let body = customText || templateMap[kind];
  if (!body) return res.status(400).json({error: 'No template defined for kind=' + kind});
  body = renderVars(body, booking, calendar);
  if (!body.includes('STOP')) body += STOP_FOOTER;
  if (body.length > 1600) body = body.slice(0, 1600);

  // Send via Twilio Messages API (form-encoded)
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const params = new URLSearchParams({To: booking.attendee_phone, From: TWILIO_FROM, Body: body});
  let twilioId = null;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: {Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded'},
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({error: data?.message || 'Twilio failed', details: data});
    twilioId = data.sid;
  } catch (e) {
    return res.status(500).json({error: e.message});
  }

  // Append to sms_log + mark reminder_*_sent_at on booking
  const logEntry = {kind, sent_at: new Date().toISOString(), twilio_sid: twilioId, body_preview: body.slice(0, 80)};
  const patch = {sms_log: [...(booking.sms_log || []), logEntry]};
  if (kind === '24h') patch.reminder_24h_sent_at = logEntry.sent_at;
  if (kind === '1h')  patch.reminder_1h_sent_at  = logEntry.sent_at;
  fetch(`${supabase_url}/rest/v1/bookings?id=eq.${booking_id}`, {
    method:'PATCH',
    headers:{apikey: supabase_key, Authorization: `Bearer ${supabase_key}`, 'Content-Type':'application/json'},
    body: JSON.stringify(patch),
  }).catch(() => {});

  return res.status(200).json({ok: true, twilio_sid: twilioId, body, length: body.length});
}

function renderVars(template, booking, calendar) {
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

export {renderVars};
