// Vercel serverless — POST /api/calendar-availability
// Returns the bookable slots for a given calendar over a date range.
//
// Request: { slug, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', supabase_url, supabase_key }
// Response: { ok, calendar:{name,duration,timezone,...}, slots:[{date, times:['HH:MM',...]}] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {slug, from, to, supabase_url, supabase_key} = req.body || {};
  if (!slug) return res.status(400).json({error: 'Missing slug'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // 1. Load calendar
  const calRes = await fetch(`${supabase_url}/rest/v1/calendars?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=*`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  const cal = (await calRes.json())[0];
  if (!cal) return res.status(404).json({error: 'Calendar not found'});

  // 2. Default range: today → max_advance_days
  const fromDate = from ? new Date(from + 'T00:00:00Z') : new Date();
  const toDate = to ? new Date(to + 'T23:59:59Z') : new Date(Date.now() + cal.max_advance_days * 86400000);
  if (toDate < fromDate) return res.status(400).json({error: 'to must be after from'});
  // Cap to 60 days max per request
  if ((toDate - fromDate) / 86400000 > 60) toDate.setTime(fromDate.getTime() + 60 * 86400000);

  // 3. Load weekly availability + overrides + existing bookings in range
  const [availRes, overRes, bookRes] = await Promise.all([
    fetch(`${supabase_url}/rest/v1/calendar_availability?calendar_id=eq.${cal.id}&select=*`, {headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`}}),
    fetch(`${supabase_url}/rest/v1/calendar_overrides?calendar_id=eq.${cal.id}&date=gte.${ymd(fromDate)}&date=lte.${ymd(toDate)}&select=*`, {headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`}}),
    fetch(`${supabase_url}/rest/v1/bookings?calendar_id=eq.${cal.id}&starts_at=gte.${fromDate.toISOString()}&starts_at=lte.${toDate.toISOString()}&status=neq.cancelled&select=starts_at,ends_at`, {headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`}}),
  ]);
  const availability = await availRes.json();
  const overrides = await overRes.json();
  const bookings = await bookRes.json();

  // 4. Compute open slots day-by-day
  const slotsByDay = [];
  const minBookableMs = Date.now() + cal.min_notice_hours * 3600000;
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = ymd(d);
    const dayOfWeek = dayOfWeekInTz(d, cal.timezone);
    const dayOverrides = overrides.filter(o => o.date === dateStr);
    if (dayOverrides.some(o => o.type === 'block')) continue; // fully blocked

    // Build raw windows for this day from weekly rules + 'add' overrides
    const windows = [
      ...availability.filter(a => a.day_of_week === dayOfWeek).map(a => ({start: a.start_time, end: a.end_time})),
      ...dayOverrides.filter(o => o.type === 'add').map(o => ({start: o.start_time, end: o.end_time})),
    ];
    if (windows.length === 0) continue;

    const dayTimes = [];
    for (const w of windows) {
      const slots = sliceWindow(dateStr, w.start, w.end, cal.duration_minutes, cal.buffer_after_minutes, cal.timezone);
      for (const slot of slots) {
        const slotStart = slot.startUtc;
        const slotEnd = slot.startUtc + cal.duration_minutes * 60000;
        if (slotStart < minBookableMs) continue;
        // Conflict with existing booking?
        const conflict = bookings.some(b => {
          const bs = new Date(b.starts_at).getTime();
          const be = new Date(b.ends_at).getTime();
          return slotStart < be && slotEnd > bs;
        });
        if (!conflict) dayTimes.push(slot.label);
      }
    }
    if (dayTimes.length) slotsByDay.push({date: dateStr, times: dayTimes});
  }

  return res.status(200).json({
    ok: true,
    calendar: {
      name: cal.name, slug: cal.slug, description: cal.description,
      duration_minutes: cal.duration_minutes, timezone: cal.timezone,
      color: cal.color, ask_for_phone: cal.ask_for_phone,
      custom_questions: cal.custom_questions,
    },
    slots: slotsByDay,
  });
}

// ============================================================
// HELPERS
// ============================================================
function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function dayOfWeekInTz(d, tz) {
  // Returns 0-6 with 0=Sunday in the calendar's timezone
  const fmt = new Intl.DateTimeFormat('en-US', {weekday: 'short', timeZone: tz});
  const map = {Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6};
  return map[fmt.format(d)] ?? d.getUTCDay();
}

function parseTimeMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function sliceWindow(dateStr, startTime, endTime, durationMin, bufferMin, tz) {
  // Build slot list inside [startTime, endTime] in calendar tz, stepping
  // by (duration + buffer). Output each slot as {label:'HH:MM', startUtc:ms}.
  const slots = [];
  const start = parseTimeMinutes(startTime);
  const end = parseTimeMinutes(endTime);
  const step = durationMin + (bufferMin || 0);
  for (let m = start; m + durationMin <= end; m += step) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const label = `${hh}:${mm}`;
    slots.push({label, startUtc: tzDateToUtc(dateStr, label, tz).getTime()});
  }
  return slots;
}

function tzDateToUtc(dateStr, time, tz) {
  // Convert a wall-clock date+time in `tz` into a real UTC Date object.
  // Uses Intl to discover the tz offset for that date+time.
  const [hh, mm] = time.split(':').map(Number);
  // Start with assumption that the wall-clock time IS UTC, then correct for offset.
  const naive = new Date(`${dateStr}T${time}:00Z`);
  const offsetMin = tzOffsetMinutes(naive, tz);
  return new Date(naive.getTime() - offsetMin * 60000);
}

function tzOffsetMinutes(d, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
  });
  const parts = fmt.formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  const tzAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (tzAsUtc - d.getTime()) / 60000;
}
