// Vercel serverless — POST /api/calendar-cancel
// Cancels a booking via cancellation_token (no auth required — tokens are
// long random strings emailed to the attendee).
// Also handles reschedule: pass new_starts_at_iso in addition to reschedule_token.
//
// Request: { cancellation_token? OR reschedule_token + new_starts_at_iso,
//            reason?, supabase_url, supabase_key }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {cancellation_token, reschedule_token, new_starts_at_iso, reason, supabase_url, supabase_key} = req.body || {};
  if (!cancellation_token && !reschedule_token) return res.status(400).json({error: 'Missing token'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  const tokenField = cancellation_token ? 'cancellation_token' : 'reschedule_token';
  const tokenValue = cancellation_token || reschedule_token;

  // Load booking
  const r = await fetch(`${supabase_url}/rest/v1/bookings?${tokenField}=eq.${encodeURIComponent(tokenValue)}&select=*`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  const booking = (await r.json())[0];
  if (!booking) return res.status(404).json({error: 'Booking not found or token invalid'});
  if (booking.status === 'cancelled' && cancellation_token) return res.status(400).json({error: 'Already cancelled'});

  if (cancellation_token) {
    // Cancel
    const upd = await fetch(`${supabase_url}/rest/v1/bookings?id=eq.${booking.id}`, {
      method: 'PATCH',
      headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({status: 'cancelled', cancelled_at: new Date().toISOString(), notes: (booking.notes ? booking.notes + '\n\n' : '') + 'Cancellation reason: ' + (reason || 'not provided')}),
    });
    if (!upd.ok) return res.status(500).json({error: 'Cancel failed'});
    return res.status(200).json({ok: true, action: 'cancelled', booking_id: booking.id});
  }

  // Reschedule
  if (!new_starts_at_iso) return res.status(400).json({error: 'new_starts_at_iso required for reschedule'});
  const newStart = new Date(new_starts_at_iso);
  if (isNaN(newStart.getTime())) return res.status(400).json({error: 'Invalid new_starts_at_iso'});
  const newEnd = new Date(newStart.getTime() + booking.duration_minutes * 60000);

  // Conflict re-check on new slot
  const conflictRes = await fetch(
    `${supabase_url}/rest/v1/bookings?calendar_id=eq.${booking.calendar_id}&id=neq.${booking.id}&starts_at=lt.${newEnd.toISOString()}&ends_at=gt.${newStart.toISOString()}&status=neq.cancelled&select=id`,
    {headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`}}
  );
  if ((await conflictRes.json()).length > 0) {
    return res.status(409).json({error: 'New slot conflicts with another booking'});
  }

  const upd = await fetch(`${supabase_url}/rest/v1/bookings?id=eq.${booking.id}`, {
    method: 'PATCH',
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({starts_at: newStart.toISOString(), ends_at: newEnd.toISOString(), status: 'rescheduled'}),
  });
  if (!upd.ok) return res.status(500).json({error: 'Reschedule failed'});
  return res.status(200).json({ok: true, action: 'rescheduled', booking_id: booking.id, starts_at: newStart.toISOString()});
}
