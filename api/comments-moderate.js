// Vercel serverless — POST /api/comments-moderate
// Hide / delete / reply to a comment on its native platform using the
// connected OAuth token. Patches comments.action_taken on success.
//
// Request: { comment_id, action: 'hide'|'delete'|'reply'|'flag', reply_text?,
//            supabase_url?, supabase_key? }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {comment_id, action, reply_text, supabase_url = SUPABASE_URL, supabase_key = SUPABASE_KEY} = req.body || {};
  if (!comment_id) return res.status(400).json({error: 'Missing comment_id'});
  if (!['hide','delete','reply','flag'].includes(action)) return res.status(400).json({error: 'Invalid action'});
  if (action === 'reply' && !reply_text) return res.status(400).json({error: 'reply_text required for reply action'});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  // Load the comment + connection
  const cRes = await fetch(`${supabase_url}/rest/v1/comments?id=eq.${comment_id}&select=*`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  const comment = (await cRes.json())[0];
  if (!comment) return res.status(404).json({error: 'Comment not found'});

  if (action === 'flag') {
    // Local-only flag — no platform call needed
    await patchComment(supabase_url, supabase_key, comment_id, {action_taken: 'flagged'});
    return res.status(200).json({ok: true, action: 'flagged'});
  }

  const connRes = await fetch(`${supabase_url}/rest/v1/social_connections?user_id=eq.${comment.user_id}&platform=eq.${comment.platform}&select=*&limit=1`, {
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
  });
  const conn = (await connRes.json())[0];
  if (!conn) return res.status(400).json({error: `No connected ${comment.platform} account for this user`});

  let externalId = null;
  try {
    switch (comment.platform) {
      case 'facebook':
      case 'instagram':
        externalId = await actMeta(conn, comment, action, reply_text);
        break;
      case 'youtube':
        externalId = await actYouTube(conn, comment, action, reply_text);
        break;
      case 'linkedin':
        externalId = await actLinkedIn(conn, comment, action, reply_text);
        break;
      default:
        return res.status(400).json({error: 'Unsupported platform: ' + comment.platform});
    }
  } catch (e) {
    return res.status(500).json({error: `${comment.platform} ${action} failed: ${e.message}`});
  }

  await patchComment(supabase_url, supabase_key, comment_id, {
    action_taken: action === 'reply' ? 'replied' : action === 'hide' ? 'hidden' : 'deleted',
    action_external_id: externalId,
  });

  return res.status(200).json({ok: true, action, external_id: externalId});
}

async function patchComment(url, key, id, patch) {
  await fetch(`${url}/rest/v1/comments?id=eq.${id}`, {
    method: 'PATCH',
    headers: {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(patch),
  });
}

// ============================================================
// Per-platform handlers (FB + IG share the Meta Graph endpoint shape)
// ============================================================
async function actMeta(conn, comment, action, replyText) {
  const token = conn.metadata?.page_access_token || conn.access_token;
  const id = comment.external_id;
  if (action === 'hide') {
    const r = await fetch(`https://graph.facebook.com/v18.0/${id}?is_hidden=true&access_token=${token}`, {method: 'POST'});
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    return id;
  }
  if (action === 'delete') {
    const r = await fetch(`https://graph.facebook.com/v18.0/${id}?access_token=${token}`, {method: 'DELETE'});
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    return id;
  }
  if (action === 'reply') {
    const params = new URLSearchParams({message: replyText, access_token: token});
    const r = await fetch(`https://graph.facebook.com/v18.0/${id}/comments?${params}`, {method: 'POST'});
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    return d.id;
  }
}

async function actYouTube(conn, comment, action, replyText) {
  const id = comment.external_id;
  const headers = {Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json'};
  if (action === 'hide') {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/comments/setModerationStatus?id=${id}&moderationStatus=heldForReview`, {method: 'POST', headers});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return id;
  }
  if (action === 'delete') {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/comments?id=${id}`, {method: 'DELETE', headers});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return id;
  }
  if (action === 'reply') {
    const r = await fetch('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
      method: 'POST', headers,
      body: JSON.stringify({snippet: {parentId: id, textOriginal: replyText}}),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    return d.id;
  }
}

async function actLinkedIn(conn, comment, action, replyText) {
  const headers = {Authorization: `Bearer ${conn.access_token}`, 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json'};
  if (action === 'delete') {
    const r = await fetch(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(comment.post_external_id)}/comments/${encodeURIComponent(comment.external_id)}`, {method: 'DELETE', headers});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return comment.external_id;
  }
  if (action === 'reply') {
    const sub = conn.metadata?.sub || conn.metadata?.id;
    const r = await fetch(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(comment.post_external_id)}/comments`, {
      method: 'POST', headers,
      body: JSON.stringify({actor: `urn:li:person:${sub}`, message: {text: replyText}}),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
    return d.id || d['$URN'];
  }
  // LinkedIn doesn't support comment hiding via API
  if (action === 'hide') throw new Error('LinkedIn does not support comment hiding via API');
}
