// Vercel serverless — POST /api/social-post
// Posts to one or more connected social platforms in parallel.
// Each platform's API quirks are isolated to a small handler below.
//
// Request: { user_id, platforms: ['youtube','instagram',...],
//            video_url?, image_url?, caption, title?, hashtags?, scheduled_for? }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {user_id, platforms = [], video_url, image_url, caption = '', title = '', hashtags = [], scheduled_for = null} = req.body || {};
  if (!user_id) return res.status(400).json({error: 'Missing user_id'});
  if (!Array.isArray(platforms) || platforms.length === 0) return res.status(400).json({error: 'Pick at least one platform'});

  // Load connections
  const conns = await loadConnections(user_id, platforms);
  if (conns.length === 0) {
    return res.status(400).json({error: 'No connected platforms found. Connect accounts in Settings → Social Connections.'});
  }

  const results = await Promise.allSettled(conns.map(c => postToPlatform({
    conn: c, video_url, image_url, caption, title, hashtags,
  })));

  const out = {};
  conns.forEach((c, i) => {
    const r = results[i];
    out[c.platform] = r.status === 'fulfilled'
      ? {ok: true, ...r.value}
      : {ok: false, error: r.reason?.message || 'unknown'};
  });

  // Log
  if (SUPABASE_URL && SUPABASE_KEY) {
    fetch(`${SUPABASE_URL}/rest/v1/social_posts`, {
      method: 'POST',
      headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal'},
      body: JSON.stringify(conns.map((c, i) => ({
        user_id, platform: c.platform, caption, title,
        media_url: video_url || image_url,
        status: results[i].status === 'fulfilled' ? 'posted' : 'failed',
        error: results[i].status === 'rejected' ? String(results[i].reason?.message || '').slice(0, 240) : null,
        external_id: results[i].value?.external_id || null,
      }))),
    }).catch(() => {});
  }

  return res.status(200).json({ok: true, results: out});
}

async function loadConnections(user_id, platforms) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const filter = platforms.map(p => `platform.eq.${p}`).join(',');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/social_connections?user_id=eq.${user_id}&or=(${filter})&select=*`, {
    headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`}
  });
  return r.ok ? await r.json() : [];
}

async function postToPlatform({conn, video_url, image_url, caption, title, hashtags}) {
  const tag = hashtags?.length ? '\n\n' + hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ') : '';
  const fullCaption = (caption + tag).slice(0, 2200);

  switch (conn.platform) {
    case 'youtube':   return await postYouTube(conn, {video_url, title, caption: fullCaption});
    case 'instagram': return await postInstagram(conn, {video_url, image_url, caption: fullCaption});
    case 'facebook':  return await postFacebook(conn, {video_url, image_url, caption: fullCaption});
    case 'tiktok':    return await postTikTok(conn, {video_url, caption: fullCaption});
    case 'linkedin':  return await postLinkedIn(conn, {caption: fullCaption});
    case 'twitter':   return await postTwitter(conn, {caption: fullCaption.slice(0, 280)});
    default: throw new Error('Unknown platform: ' + conn.platform);
  }
}

// ============================================================
// YouTube — Resumable upload via Data API v3
// ============================================================
async function postYouTube(conn, {video_url, title, caption}) {
  if (!video_url) throw new Error('YouTube needs a video_url');
  // 1. Initiate resumable upload
  const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: {title: title || caption.slice(0, 95) || 'Supernova Upload', description: caption, categoryId: '22'},
      status: {privacyStatus: 'public', selfDeclaredMadeForKids: false},
    }),
  });
  if (!initRes.ok) throw new Error('YouTube init failed: HTTP ' + initRes.status);
  const uploadUrl = initRes.headers.get('Location');

  // 2. Stream video in (we proxy through the URL — for large files we'd chunk)
  const videoBlob = await fetch(video_url).then(r => r.arrayBuffer());
  const upRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {'Content-Type': 'video/mp4'},
    body: videoBlob,
  });
  if (!upRes.ok) throw new Error('YouTube upload failed: HTTP ' + upRes.status);
  const data = await upRes.json();
  return {external_id: data.id, url: 'https://youtu.be/' + data.id};
}

// ============================================================
// Instagram — Container-based publish (Instagram Graph API)
// ============================================================
async function postInstagram(conn, {video_url, image_url, caption}) {
  const igUserId = conn.metadata?.ig_user_id || conn.metadata?.user_id;
  if (!igUserId) throw new Error('Instagram requires ig_user_id stored in connection metadata');
  // 1. Create media container
  const params = new URLSearchParams({
    caption,
    access_token: conn.access_token,
    ...(video_url ? {media_type: 'REELS', video_url} : {image_url}),
  });
  const c = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media?${params}`, {method: 'POST'});
  const cd = await c.json();
  if (!c.ok) throw new Error('IG container failed: ' + (cd.error?.message || c.status));
  // 2. Publish
  const p = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish?creation_id=${cd.id}&access_token=${conn.access_token}`, {method: 'POST'});
  const pd = await p.json();
  if (!p.ok) throw new Error('IG publish failed: ' + (pd.error?.message || p.status));
  return {external_id: pd.id, url: `https://www.instagram.com/p/${pd.id}/`};
}

// ============================================================
// Facebook Pages — Video / Photo publish
// ============================================================
async function postFacebook(conn, {video_url, image_url, caption}) {
  const pageId = conn.metadata?.page_id;
  const pageToken = conn.metadata?.page_access_token || conn.access_token;
  if (!pageId) throw new Error('Facebook requires page_id in connection metadata');
  if (video_url) {
    const params = new URLSearchParams({file_url: video_url, description: caption, access_token: pageToken});
    const r = await fetch(`https://graph.facebook.com/v18.0/${pageId}/videos?${params}`, {method: 'POST'});
    const d = await r.json();
    if (!r.ok) throw new Error('FB video failed: ' + (d.error?.message || r.status));
    return {external_id: d.id, url: `https://facebook.com/${d.id}`};
  }
  const params = new URLSearchParams({url: image_url, message: caption, access_token: pageToken});
  const r = await fetch(`https://graph.facebook.com/v18.0/${pageId}/photos?${params}`, {method: 'POST'});
  const d = await r.json();
  if (!r.ok) throw new Error('FB photo failed: ' + (d.error?.message || r.status));
  return {external_id: d.id, url: `https://facebook.com/${d.post_id || d.id}`};
}

// ============================================================
// TikTok — Direct Post API
// ============================================================
async function postTikTok(conn, {video_url, caption}) {
  if (!video_url) throw new Error('TikTok needs video_url');
  const r = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json; charset=UTF-8'},
    body: JSON.stringify({
      post_info: {title: caption.slice(0, 150), privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_comment: false, disable_stitch: false},
      source_info: {source: 'PULL_FROM_URL', video_url},
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('TikTok failed: ' + (d.error?.message || r.status));
  return {external_id: d.data?.publish_id, url: 'https://tiktok.com'};
}

// ============================================================
// LinkedIn — UGC Post (text only for now; video needs asset upload flow)
// ============================================================
async function postLinkedIn(conn, {caption}) {
  const sub = conn.metadata?.sub || conn.metadata?.id;
  if (!sub) throw new Error('LinkedIn requires user URN in connection metadata');
  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0'},
    body: JSON.stringify({
      author: `urn:li:person:${sub}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {text: caption},
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'},
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('LinkedIn failed: ' + (d.message || r.status));
  return {external_id: d.id, url: `https://linkedin.com/feed/update/${d.id}`};
}

// ============================================================
// X (Twitter) v2 — text tweet
// ============================================================
async function postTwitter(conn, {caption}) {
  const r = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({text: caption}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Twitter failed: ' + (d.detail || r.status));
  return {external_id: d.data?.id, url: `https://twitter.com/i/web/status/${d.data?.id}`};
}
