// Vercel serverless — POST /api/synthesize
// ElevenLabs text-to-speech voiceover generator.
// Returns base64 MP3 (small clips) or — if supabase creds + workspace_id —
// uploads to Storage and returns a public URL.
//
// Request: { text, voice_id?, model_id?, language?, return='base64'|'url',
//            workspace_id?, related_id?, supabase_url, supabase_key }

const VOICES = {
  // Sample selection of ElevenLabs voices — full list at /v1/voices
  rachel:     '21m00Tcm4TlvDq8ikWAM', // warm female English
  drew:       '29vD33N1CtxCmqQRPOHJ', // confident male English
  clyde:      '2EiwWnXFnvU5JabPnv8n', // warm narrator
  bella:      'EXAVITQu4vr4xnSDxMaL', // soft female
  domi:       'AZnzlk1XvdvUeBnXmlld', // strong female
  antoni:     'ErXwobaYiN019PkySvjV', // young male
  thomas:     'GBv7mTt0atIp3Br8iCZE', // calm male
  glinda:     'z9fAnlkpzviPz146aGWa', // witch-like fun
  rachel_es:  '21m00Tcm4TlvDq8ikWAM', // (multilingual model)
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'ELEVENLABS_API_KEY not configured'});

  const {
    text, voice_id, voice_name = 'rachel', language,
    model_id = 'eleven_multilingual_v2',
    stability = 0.5, similarity_boost = 0.75, style = 0.2, use_speaker_boost = true,
    return: returnMode = 'base64',
    workspace_id = null, related_id = null,
    supabase_url = null, supabase_key = null,
  } = req.body || {};

  if (!text || !String(text).trim()) return res.status(400).json({error: 'Missing text'});
  if (text.length > 5000) return res.status(400).json({error: 'Text too long — split into <=5000 char chunks'});

  const vid = voice_id || VOICES[voice_name] || VOICES.rachel;

  let audioBuf;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text, model_id,
        voice_settings: {stability, similarity_boost, style, use_speaker_boost},
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({error: 'ElevenLabs failed', details: txt.slice(0, 240)});
    }
    audioBuf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    return res.status(500).json({error: 'TTS request error: ' + e.message});
  }

  const seconds = Math.round((text.split(/\s+/).filter(Boolean).length / 2.6));
  const filename = `${Date.now()}-vo-${voice_name}.mp3`;

  // If supabase creds provided, upload to Storage and return a public URL
  if (returnMode === 'url' && supabase_url && supabase_key && workspace_id) {
    const path = `${workspace_id}/voiceover/${filename}`;
    try {
      const r = await fetch(`${supabase_url}/storage/v1/object/assets/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabase_key}`,
          'apikey': supabase_key,
          'Content-Type': 'audio/mpeg',
          'x-upsert': 'true',
        },
        body: audioBuf,
      });
      if (!r.ok) throw new Error('Upload failed: ' + r.status);
      const publicUrl = `${supabase_url}/storage/v1/object/public/assets/${path}`;
      return res.status(200).json({
        ok: true,
        url: publicUrl,
        voice: voice_name,
        model: model_id,
        char_count: text.length,
        estimated_duration_seconds: seconds,
      });
    } catch (e) {
      // Fall through to base64
    }
  }

  return res.status(200).json({
    ok: true,
    audio_base64: audioBuf.toString('base64'),
    mime: 'audio/mpeg',
    voice: voice_name,
    model: model_id,
    char_count: text.length,
    estimated_duration_seconds: seconds,
  });
}

export {VOICES};
