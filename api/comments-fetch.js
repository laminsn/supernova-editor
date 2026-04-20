// Vercel serverless — POST /api/comments-fetch
// Fetches recent comments across the user's connected social platforms,
// using their OAuth tokens stored in social_connections. Upserts into the
// `comments` table (idempotent on platform+external_id) and returns the
// new + total counts.
//
// Request: { user_id, platforms?: ['facebook','instagram','youtube','linkedin'],
//            limit_per_platform?=25, supabase_url, supabase_key }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {user_id, platforms, limit_per_platform = 25, supabase_url = SUPABASE_URL, supabase_key = SUPABASE_KEY} = req.body || {};
  if (!user_id) return res.status(400).json({error: 'Missing user_id'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // Load connections
  const filter = platforms?.length ? `&platform=in.(${platforms.join(',')})` : '';
  const connRes = await fetch(`${supabase_url}/rest/v1/social_connections?user_id=eq.${user_id}${filter}&select=*`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  if (!connRes.ok) return res.status(500).json({error: 'Connection lookup failed'});
  const connections = await connRes.json();
  if (connections.length === 0) return res.status(200).json({ok: true, fetched: 0, by_platform: {}, message: 'No connected platforms.'});

  const results = await Promise.allSettled(
    connections.map(c => fetchPlatformComments(c, limit_per_platform))
  );

  const allComments = [];
  const byPlatform = {};
  results.forEach((r, i) => {
    const plat = connections[i].platform;
    if (r.status === 'fulfilled') {
      byPlatform[plat] = {fetched: r.value.length};
      allComments.push(...r.value.map(c => ({...c, user_id, platform: plat, workspace_id: connections[i].workspace_id})));
    } else {
      byPlatform[plat] = {error: r.reason?.message || 'unknown'};
    }
  });

  // Upsert (idempotent on platform+external_id)
  let inserted = 0;
  if (allComments.length) {
    const upsertRes = await fetch(`${supabase_url}/rest/v1/comments?on_conflict=platform,external_id`, {
      method: 'POST',
      headers: {
        apikey: supabase_key,
        Authorization: `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(allComments),
    });
    if (upsertRes.ok) {
      const rows = await upsertRes.json();
      inserted = rows.length;
    }
  }

  return res.status(200).json({ok: true, fetched: allComments.length, inserted, by_platform: byPlatform});
}

// ============================================================
// Per-platform fetchers — return array of normalized comment objects.
// Shape: {external_id, post_external_id, author, author_handle, text, posted_at, raw}
// ============================================================
async function fetchPlatformComments(conn, limit) {
  switch (conn.platform) {
    case 'facebook':  return fetchFacebook(conn, limit);
    case 'instagram': return fetchInstagram(conn, limit);
    case 'youtube':   return fetchYouTube(conn, limit);
    case 'linkedin':  return fetchLinkedIn(conn, limit);
    default: return [];
  }
}

async function fetchFacebook(conn, limit) {
  const pageId = conn.metadata?.page_id;
  const token = conn.metadata?.page_access_token || conn.access_token;
  if (!pageId) return [];
  const url = `https://graph.facebook.com/v18.0/${pageId}/feed?fields=id,comments.limit(${limit}){id,from,message,created_time}&limit=10&access_token=${token}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'FB fetch failed');
  const out = [];
  for (const post of data.data || []) {
    for (const c of post.comments?.data || []) {
      out.push({
        external_id: c.id, post_external_id: post.id,
        author: c.from?.name, author_handle: null,
        text: c.message || '', posted_at: c.created_time, raw: c,
      });
    }
  }
  return out;
}

async function fetchInstagram(conn, limit) {
  const igId = conn.metadata?.ig_user_id;
  const token = conn.access_token;
  if (!igId) return [];
  const mediaUrl = `https://graph.facebook.com/v18.0/${igId}/media?fields=id,comments.limit(${limit}){id,username,text,timestamp}&limit=10&access_token=${token}`;
  const r = await fetch(mediaUrl);
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'IG fetch failed');
  const out = [];
  for (const m of data.data || []) {
    for (const c of m.comments?.data || []) {
      out.push({
        external_id: c.id, post_external_id: m.id,
        author: c.username, author_handle: '@' + c.username,
        text: c.text || '', posted_at: c.timestamp, raw: c,
      });
    }
  }
  return out;
}

async function fetchYouTube(conn, limit) {
  // Uses the channel-wide threads endpoint to surface every recent comment.
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${conn.metadata?.channel_id || 'mine'}&maxResults=${limit}&order=time`;
  const r = await fetch(url, {headers: {Authorization: `Bearer ${conn.access_token}`}});
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'YT fetch failed');
  return (data.items || []).map(t => {
    const top = t.snippet?.topLevelComment?.snippet || {};
    return {
      external_id: t.snippet?.topLevelComment?.id || t.id,
      post_external_id: t.snippet?.videoId,
      author: top.authorDisplayName,
      author_handle: top.authorChannelUrl,
      text: top.textDisplay || top.textOriginal || '',
      posted_at: top.publishedAt,
      raw: t,
    };
  });
}

async function fetchLinkedIn(conn, limit) {
  // LinkedIn requires a share URN per post. For a v1 we surface the most recent
  // posts then fetch comments on each. Skipped if URNs not pre-loaded.
  const urns = conn.metadata?.recent_share_urns || [];
  if (urns.length === 0) return [];
  const out = [];
  for (const urn of urns.slice(0, 5)) {
    const r = await fetch(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(urn)}/comments?count=${limit}`, {
      headers: {Authorization: `Bearer ${conn.access_token}`, 'X-Restli-Protocol-Version': '2.0.0'},
    });
    if (!r.ok) continue;
    const data = await r.json();
    for (const c of data.elements || []) {
      out.push({
        external_id: c.id || c['$URN'],
        post_external_id: urn,
        author: c.actor || 'Unknown',
        author_handle: null,
        text: c.message?.text || '',
        posted_at: c.created?.time ? new Date(c.created.time).toISOString() : null,
        raw: c,
      });
    }
  }
  return out;
}
