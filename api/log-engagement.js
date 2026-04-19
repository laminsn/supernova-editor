// Vercel serverless — POST /api/log-engagement
// Logs actual post engagement metrics. Becomes training data for the brain score model.
// Sources: collaborator self-report, manual entry, IG/YT/TikTok APIs (when OAuth done), UTM click tracking

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    content_id, prediction_id, collaborator_id, package_id, workspace_id,
    platform, post_url, posted_at,
    views = 0, likes = 0, saves = 0, shares = 0, comments = 0,
    reach = 0, impressions = 0, watch_time_seconds = null,
    completion_rate = null, click_through_rate = null,
    source = 'manual', raw_data = null,
    supabase_url, supabase_key,
  } = req.body || {};

  if (!platform) return res.status(400).json({error: 'Missing platform'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  try {
    const r = await fetch(`${supabase_url}/rest/v1/engagement_data`, {
      method: 'POST',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        workspace_id, content_id, prediction_id, collaborator_id, package_id,
        platform, post_url, posted_at,
        views, likes, saves, shares, comments,
        reach, impressions, watch_time_seconds,
        completion_rate, click_through_rate,
        source, raw_data,
      })
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({error: 'Supabase write failed', details: err});
    }
    const data = await r.json();
    return res.status(200).json({ok: true, id: data?.[0]?.id, is_viral: data?.[0]?.is_viral});
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
