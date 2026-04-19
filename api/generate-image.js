// Vercel serverless — POST /api/generate-image
// Generates images via Ideogram v3 (primary) with optional fallback to user-provided
// nano-banana / Stability key. Persists URLs to generated_images for reuse.
//
// Request: {
//   prompt, count?, aspect?, style?, magic_prompt?, negative_prompt?,
//   model?, workspace_id?, kind?, related_id?,
//   supabase_url?, supabase_key?
// }

const VALID_ASPECTS = new Set([
  '1x1','16x9','9x16','4x3','3x4','3x2','2x3','16x10','10x16','1x3','3x1'
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    prompt,
    count = 1,
    aspect = '1x1',
    style = 'AUTO',
    magic_prompt = 'AUTO',
    negative_prompt,
    model = 'V_3',
    workspace_id = null,
    kind = 'generic',
    related_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({error: 'Missing prompt'});
  }

  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'IDEOGRAM_API_KEY not configured'});

  const num = Math.max(1, Math.min(8, parseInt(count) || 1));
  const ar = VALID_ASPECTS.has(aspect) ? `ASPECT_${aspect.replace('x','_')}` : 'ASPECT_1_1';

  const images = [];
  // Ideogram returns 1 image per request — loop for `num`.
  for (let i = 0; i < num; i++) {
    try {
      const r = await fetch('https://api.ideogram.ai/generate', {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_request: {
            prompt: String(prompt).slice(0, 1000),
            aspect_ratio: ar,
            model,
            magic_prompt_option: magic_prompt,
            style_type: style,
            ...(negative_prompt ? {negative_prompt} : {}),
          }
        })
      });
      if (!r.ok) {
        const txt = await r.text();
        images.push({error: `HTTP ${r.status}: ${txt.slice(0,180)}`});
        continue;
      }
      const data = await r.json();
      const item = data?.data?.[0] || {};
      images.push({
        url: item.url || null,
        prompt: item.prompt || prompt,
        resolution: item.resolution || null,
        seed: item.seed || null,
        is_image_safe: item.is_image_safe !== false,
        style_type: item.style_type || style,
      });
    } catch (e) {
      images.push({error: e.message});
    }
  }

  // Optional persistence
  if (supabase_url && supabase_key) {
    try {
      await fetch(`${supabase_url}/rest/v1/generated_images`, {
        method: 'POST',
        headers: {
          'apikey': supabase_key,
          'Authorization': `Bearer ${supabase_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(images.filter(i => i.url).map(i => ({
          workspace_id, kind, related_id,
          prompt: i.prompt, url: i.url, model, aspect,
          metadata: {seed: i.seed, resolution: i.resolution, style: i.style_type},
        })))
      }).catch(() => {});
    } catch(e) {}
  }

  return res.status(200).json({
    ok: true,
    count: images.filter(i => i.url).length,
    images,
    model,
    aspect,
  });
}
