// Vercel serverless — POST /api/generate-carousel
// Generates carousel slide images via Ideogram for v4.1 Output 19.
// Pattern adapted from /Users/laminngobeh/Documents/CLAUDE CODING/carousel/generate.mjs
// — same Ideogram REST shape, but stateless (no file I/O) and parallel.
//
// Request body:
//   {
//     prompts: [
//       { slide: 1, format: 'instagram', prompt: '...' },  // 1080x1080
//       { slide: 1, format: 'tiktok',    prompt: '...' },  // 1080x1920
//       { slide: 1, format: 'linkedin',  prompt: '...' },  // 1920x1080
//       ... 27 entries total (9 slides × 3 formats)
//     ],
//     model: 'V_2',         // optional override; V_3 needs the v3 endpoint
//     style_type: 'DESIGN'  // optional override
//   }
//
// Response:
//   {
//     ok: true,
//     count: 27,
//     images: [{ slide, format, url, aspect_ratio, error? }],
//     failed_count
//   }

// Ideogram REST API expects ASPECT_W_H constants, not "WxH" strings.
const FORMAT_TO_ASPECT = {
  instagram: 'ASPECT_1_1',  // 1080x1080
  tiktok:    'ASPECT_9_16', // 1080x1920
  linkedin:  'ASPECT_16_9', // 1920x1080
  shorts:    'ASPECT_9_16',
  story:     'ASPECT_9_16',
  reels:     'ASPECT_9_16',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'IDEOGRAM_API_KEY not configured' });

  const {
    prompts = [],
    // V_3 requires Ideogram's new /v1/ideogram-v3/generate endpoint; the
    // legacy /generate route used here only accepts V_1, V_1_TURBO, V_2,
    // V_2_TURBO. Match the local carousel/generate.mjs default (V_2).
    model = 'V_2',
    style_type = 'DESIGN',
  } = req.body || {};

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'prompts array required' });
  }
  if (prompts.length > 30) {
    return res.status(400).json({ error: 'max 30 prompts per call (v4.1 carousel = 27)' });
  }

  // Fan out — Ideogram handles parallelism per-key without rate-limit issues
  // for typical carousel volumes (27 images).
  const images = await Promise.all(
    prompts.map((entry, idx) => generateOne(entry, idx, apiKey, model, style_type))
  );

  const failed = images.filter((i) => i.error);

  return res.status(200).json({
    ok: true,
    count: images.length,
    failed_count: failed.length,
    images,
  });
}

async function generateOne(entry, idx, apiKey, model, styleType) {
  const slide = entry?.slide ?? idx + 1;
  const format = String(entry?.format || 'instagram').toLowerCase();
  const aspectRatio = FORMAT_TO_ASPECT[format] || 'ASPECT_1_1';
  const prompt = String(entry?.prompt || '').trim();

  if (!prompt) {
    return { slide, format, aspect_ratio: aspectRatio, url: null, error: 'empty prompt' };
  }

  try {
    const r = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_request: {
          prompt,
          aspect_ratio: aspectRatio,
          model,
          style_type: styleType,
        },
      }),
    });

    if (!r.ok) {
      const body = await r.text();
      return {
        slide,
        format,
        aspect_ratio: aspectRatio,
        url: null,
        error: `Ideogram ${r.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = await r.json();
    const url = data?.data?.[0]?.url || null;
    if (!url) {
      return { slide, format, aspect_ratio: aspectRatio, url: null, error: 'no url in response' };
    }
    return { slide, format, aspect_ratio: aspectRatio, url };
  } catch (e) {
    return { slide, format, aspect_ratio: aspectRatio, url: null, error: e.message };
  }
}
