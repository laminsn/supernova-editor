// /api/log-error — minimal telemetry sink for the client ErrorBoundary.
// Logs to Vercel function stdout (visible in Vercel → Project → Logs).
// Deliberately does NOT write to the database — that would require a
// public write RLS policy on a new table, which is a risk we'd rather
// not take just to collect error reports. stdout logs are adequate.

const MAX_FIELD = 4000; // hard-cap individual fields so a malicious
                         // client can't spam massive payloads into logs.

function clip(v) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) + '…' : s;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ok: false, error: 'method not allowed'});
  }

  // Cheap DoS/body-size guard. Vercel default body limit is 1MB; we
  // clip each field below and cap overall logging depth.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(_) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  const entry = {
    level: 'error',
    src: 'client-error-boundary',
    message: clip(body.message),
    stack: clip(body.stack),
    component: clip(body.component),
    url: clip(body.url),
    ua: clip(body.ua).slice(0, 400),
    at: clip(body.at).slice(0, 40),
    ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim(),
    ts: new Date().toISOString(),
  };
  // Single-line JSON keeps Vercel log search usable.
  console.error(JSON.stringify(entry));

  return res.status(204).end();
}
