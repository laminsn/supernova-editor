// Vercel serverless — POST /api/transcribe
// Transcribes a recording via Deepgram and writes:
//   - recordings.transcript (plain text)
//   - recordings.captions_vtt (WebVTT for video player overlay)
//
// Request: { audio_url, recording_id?, language='en', model='nova-2',
//            supabase_url?, supabase_key? }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'DEEPGRAM_API_KEY not configured'});

  const {
    audio_url, recording_id = null,
    language = 'en', model = 'nova-2',
    detect_language = false,
    supabase_url = null, supabase_key = null,
  } = req.body || {};
  if (!audio_url) return res.status(400).json({error: 'Missing audio_url'});

  // Build Deepgram URL with options
  const params = new URLSearchParams({
    model, smart_format: 'true', punctuate: 'true', diarize: 'false', utterances: 'true',
    paragraphs: 'true', filler_words: 'false',
  });
  if (detect_language) params.set('detect_language', 'true');
  else params.set('language', language);

  let dg = null;
  try {
    const r = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({url: audio_url}),
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({error: 'Deepgram failed', details: txt.slice(0,200)});
    }
    dg = await r.json();
  } catch (e) {
    return res.status(500).json({error: 'Deepgram request error: ' + e.message});
  }

  const channel = dg?.results?.channels?.[0];
  const transcript = channel?.alternatives?.[0]?.transcript || '';
  const utterances = dg?.results?.utterances || [];
  const captionsVtt = buildVtt(utterances.length ? utterances : (channel?.alternatives?.[0]?.words || []));

  // Persist
  if (recording_id && supabase_url && supabase_key) {
    try {
      await fetch(`${supabase_url}/rest/v1/recordings?id=eq.${recording_id}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabase_key,
          'Authorization': `Bearer ${supabase_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript,
          captions_vtt: captionsVtt,
          transcript_provider: `deepgram-${model}`,
        }),
      });
    } catch (e) { /* non-fatal */ }
  }

  return res.status(200).json({
    ok: true,
    transcript,
    captions_vtt: captionsVtt,
    word_count: transcript.split(/\s+/).filter(Boolean).length,
    duration: dg?.metadata?.duration || null,
    model,
  });
}

function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

function buildVtt(items) {
  if (!items || !items.length) return 'WEBVTT\n\n';
  const lines = ['WEBVTT', ''];
  items.forEach((u, i) => {
    const start = u.start ?? u.start_time ?? 0;
    const end = u.end ?? u.end_time ?? (start + 3);
    const text = u.transcript || u.word || '';
    lines.push(String(i + 1));
    lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`);
    lines.push(text);
    lines.push('');
  });
  return lines.join('\n');
}
