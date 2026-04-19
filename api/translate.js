// Vercel serverless — POST /api/translate
// Batch translate one piece of content into multiple languages with Claude.
// Distinct endpoint from /api/edit-script because translate calls are typically
// fan-out (one source → N languages in parallel) and we want to keep retries
// and rate-limit handling on this hot path.
//
// Request: { text, targets: ['Spanish','Portuguese',...], preserve_format=true }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {text, targets = [], preserve_format = true, max_tokens = 4000} = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({error: 'Missing text'});
  if (!Array.isArray(targets) || targets.length === 0) return res.status(400).json({error: 'Provide targets array of language names'});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'ANTHROPIC_API_KEY not configured'});

  const allowed = targets.slice(0, 10);
  const results = await Promise.allSettled(allowed.map(lang => translateOne({apiKey, text, lang, preserve_format, max_tokens})));

  const out = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out[allowed[i]] = r.value;
    else out[allowed[i]] = {error: r.reason?.message || 'unknown'};
  });

  return res.status(200).json({ok: true, source_chars: text.length, targets: allowed, translations: out});
}

async function translateOne({apiKey, text, lang, preserve_format, max_tokens}) {
  const directive = preserve_format
    ? `Translate the following text into ${lang}. Preserve all formatting (line breaks, headings, bullets, code blocks). Adapt cultural references and idioms — do not translate them literally. Output only the translated text. No commentary, no preamble.`
    : `Translate into ${lang}. Plain output, no formatting preservation. No preamble.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: Math.max(500, Math.min(8000, parseInt(max_tokens) || 4000)),
      system: 'You are a professional translator. Output only the translation.',
      messages: [{role: 'user', content: `${directive}\n\n---\n${String(text).slice(0, 12000)}`}],
    })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status}: ${txt.slice(0,180)}`);
  }
  const data = await r.json();
  return (data?.content?.[0]?.text || '').trim();
}
