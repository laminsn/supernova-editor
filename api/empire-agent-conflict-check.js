// Vercel serverless — POST /api/empire-agent-conflict-check
// v4.1 System D enforcement: verify a proposed CTA slug doesn't collide
// with any existing slug in this workspace's cta_pages table, and (if an
// empire_agent_map is supplied) doesn't conflict with another business's
// pipeline. Pure logic — no LLM call.
//
// Request body:
//   {
//     proposed_slug: 'craft-prompt-library',     // raw — will be slugified
//     workspace_id: '<uuid>',
//     business: 'Rara Avis Marketing',           // optional, for pipeline check
//     supabase_url: 'https://api.supernovaeditor.com',
//     supabase_key: '<anon key>',                 // RLS limits to caller's workspace
//     empire_agent_map: [                         // optional; v4.1 Field 27
//       { business: 'Rara Avis Marketing', ghl_pipeline: 'AI Army', blog_url: 'rara-avis.com/blog' },
//       ...
//     ]
//   }
//
// Response:
//   { ok: true, conflict: false, slug: 'craft-prompt-library', business: '...' }
// or
//   { ok: true, conflict: true, suggested_slug: 'craft-prompt-library-2',
//     existing: { page_slug, business, content_id, page_title }, reason: '...' }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    proposed_slug = '',
    workspace_id = null,
    business = null,
    supabase_url = null,
    supabase_key = null,
    empire_agent_map = [],
  } = req.body || {};

  if (!proposed_slug.trim()) return res.status(400).json({ error: 'proposed_slug required' });
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  if (!supabase_url || !supabase_key) {
    return res.status(400).json({ error: 'supabase_url and supabase_key required' });
  }

  const baseSlug = slugify(proposed_slug);
  if (!baseSlug) return res.status(400).json({ error: 'proposed_slug normalizes to empty' });

  // Pull every existing slug in this workspace once. Smaller payload than
  // serial existence checks; v4.1 expects modest CTA volume per workspace.
  let existing = [];
  try {
    const url = `${supabase_url}/rest/v1/cta_pages?workspace_id=eq.${encodeURIComponent(workspace_id)}&select=page_slug,business,content_id,page_title`;
    const r = await fetch(url, {
      headers: {
        apikey: supabase_key,
        Authorization: `Bearer ${supabase_key}`,
        Accept: 'application/json',
      },
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: 'cta_pages fetch failed', details: err });
    }
    existing = await r.json();
  } catch (e) {
    return res.status(500).json({ error: 'Supabase request error: ' + e.message });
  }

  const taken = new Set(existing.map((row) => row.page_slug));

  // Slug collision check.
  if (!taken.has(baseSlug)) {
    return res.status(200).json({
      ok: true,
      conflict: false,
      slug: baseSlug,
      business,
      checked_against: existing.length,
      pipeline_overlap: detectPipelineOverlap(business, empire_agent_map),
    });
  }

  // Suggest the next free slug — append -2, -3, ... up to -50.
  let suggested = null;
  for (let n = 2; n <= 50; n++) {
    const candidate = `${baseSlug}-${n}`;
    if (!taken.has(candidate)) {
      suggested = candidate;
      break;
    }
  }
  if (!suggested) {
    return res.status(200).json({
      ok: true,
      conflict: true,
      reason: 'Slug exhausted: 50 variants of this slug already exist. Pick a different base.',
      slug: baseSlug,
      existing: existing.find((r) => r.page_slug === baseSlug) || null,
    });
  }

  return res.status(200).json({
    ok: true,
    conflict: true,
    slug: baseSlug,
    suggested_slug: suggested,
    existing: existing.find((r) => r.page_slug === baseSlug) || null,
    business,
    pipeline_overlap: detectPipelineOverlap(business, empire_agent_map),
    reason: `Slug "${baseSlug}" already exists in this workspace. Suggested alternative: "${suggested}".`,
  });
}

// Lowercase, replace non-alphanumerics with hyphens, collapse runs, trim ends.
function slugify(input) {
  return String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Inform the caller if their target business shares a pipeline name with
// another listed business (a v4.1 yellow flag — the human should verify
// the audiences are actually distinct before publishing).
function detectPipelineOverlap(business, empireAgentMap) {
  if (!business || !Array.isArray(empireAgentMap) || empireAgentMap.length === 0) return null;

  const here = empireAgentMap.find(
    (entry) => String(entry?.business || '').toLowerCase() === String(business).toLowerCase()
  );
  if (!here || !here.ghl_pipeline) return null;

  const overlaps = empireAgentMap.filter(
    (entry) =>
      entry !== here &&
      String(entry?.ghl_pipeline || '').toLowerCase() ===
        String(here.ghl_pipeline).toLowerCase()
  );

  if (overlaps.length === 0) return null;

  return {
    pipeline: here.ghl_pipeline,
    shared_with: overlaps.map((e) => e.business),
    note:
      'Two or more businesses in the Empire Agent map share the same GHL pipeline name. ' +
      'Verify audience separation before publishing this CTA.',
  };
}
