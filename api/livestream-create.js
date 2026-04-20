// Vercel serverless — POST /api/livestream-create
// Creates a multi-platform live stream session.
//
// Strategy: Restream.io is the reference simulcast provider. If RESTREAM_TOKEN
// is set, we hit their API to spin up the stream. If not, we return a
// scaffolded response with RTMP ingestion details so the user can wire it up
// manually or pick another provider.
//
// Request: { title, platforms: ['facebook','instagram','tiktok','youtube'],
//            aspect: '16x9'|'9x16'|'1x1'|'4x5', go_live_at? }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {title = 'Untitled live stream', platforms = [], aspect = '16x9', go_live_at = null} = req.body || {};
  if (!Array.isArray(platforms) || platforms.length === 0) return res.status(400).json({error: 'Pick at least one platform'});

  const restreamToken = process.env.RESTREAM_TOKEN;

  // No provider yet — return scaffolded session so the front-end can show
  // RTMP credentials + a manual setup walkthrough.
  if (!restreamToken) {
    return res.status(200).json({
      ok: true,
      configured: false,
      provider: 'manual',
      title, platforms, aspect,
      message: 'Live stream provider not configured. Add RESTREAM_TOKEN to Vercel env to auto-simulcast. Alternatively use the manual RTMP credentials below.',
      rtmp: {
        ingest_url: 'rtmp://your-streaming-provider.com/live',
        stream_key: 'configure-via-env-or-provider-account',
        notes: 'Plug into OBS / Streamlabs / your phone\'s RTMP app.',
      },
      recommended_providers: [
        {name: 'Restream.io', url: 'https://restream.io', notes: 'Native simulcast across 30+ platforms, free tier'},
        {name: 'Castr', url: 'https://castr.io', notes: 'Simulcast + DVR + adaptive bitrate'},
        {name: 'StreamYard', url: 'https://streamyard.com', notes: 'Browser-based studio with multi-guest'},
      ],
    });
  }

  // Restream.io API integration
  // Docs: https://developers.restream.io/reference/post_user-events
  try {
    const r = await fetch('https://api.restream.io/v2/user/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${restreamToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        scheduledFor: go_live_at,
        showInLiveUntilEnd: true,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({error: 'Restream call failed', details: txt.slice(0, 200)});
    }
    const data = await r.json();
    return res.status(200).json({
      ok: true,
      configured: true,
      provider: 'restream',
      title, platforms, aspect,
      session: data,
      rtmp: {
        ingest_url: 'rtmp://live.restream.io/live',
        stream_key: data?.streamKey || 'check-restream-dashboard',
      },
    });
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
