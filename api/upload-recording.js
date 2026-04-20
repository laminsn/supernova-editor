// Vercel serverless — POST /api/upload-recording
// Issues a Supabase Storage signed-upload URL for a recording, scoped to the
// user's workspace folder, then writes a row to `recordings` for tracking.
//
// Request: { workspace_id, campaign_id?, filename, mime, size_bytes,
//            duration_seconds?, supabase_url, supabase_key }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    workspace_id, campaign_id = null, filename, mime = 'video/webm', size_bytes = 0,
    duration_seconds = null, width = null, height = null,
    supabase_url, supabase_key,
  } = req.body || {};

  if (!workspace_id) return res.status(400).json({error: 'Missing workspace_id'});
  if (!filename) return res.status(400).json({error: 'Missing filename'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // 500 MB cap matches storage bucket policy
  if (size_bytes && size_bytes > 524288000) return res.status(400).json({error: 'File exceeds 500 MB limit'});

  const safe = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-180);
  const path = `${workspace_id}/${Date.now()}-${safe}`;

  // 1. Ask Supabase for a signed upload URL
  let signed = null;
  try {
    const r = await fetch(`${supabase_url}/storage/v1/object/upload/sign/recordings/${path}`, {
      method: 'POST',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({error: 'Could not create signed upload URL', details: txt.slice(0,180)});
    }
    signed = await r.json();
  } catch (e) {
    return res.status(500).json({error: 'Storage signed URL error: ' + e.message});
  }

  // 2. Pre-create the recordings row so we can patch transcript later
  let recordingId = null;
  try {
    const r = await fetch(`${supabase_url}/rest/v1/recordings`, {
      method: 'POST',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        workspace_id, campaign_id,
        storage_path: path,
        mime, size_bytes,
        duration_seconds, width, height,
      }),
    });
    if (r.ok) {
      const data = await r.json();
      recordingId = data?.[0]?.id || null;
    }
  } catch (e) {
    // non-fatal
  }

  return res.status(200).json({
    ok: true,
    recording_id: recordingId,
    storage_path: path,
    upload_url: signed?.url ? `${supabase_url}/storage/v1${signed.url}` : null,
    token: signed?.token || null,
    public_url: `${supabase_url}/storage/v1/object/recordings/${path}`,
  });
}
