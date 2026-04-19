// Vercel serverless — POST /api/publish-blog
// Publishes a blog post to WordPress (REST API + App Password), Ghost (Admin API + JWT),
// or a generic webhook. Updates published_to[] on the blog_posts row when supabase creds present.

import crypto from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    target,
    post_id,
    title,
    html,
    markdown,
    meta = {},
    connection = {},
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  if (!target) return res.status(400).json({error: 'Missing target (wordpress|ghost|webhook)'});
  if (!title || !html) return res.status(400).json({error: 'Missing title or html'});

  let publishedUrl = null;
  let externalId = null;

  try {
    if (target === 'wordpress') {
      ({publishedUrl, externalId} = await publishWordpress({title, html, meta, connection}));
    } else if (target === 'ghost') {
      ({publishedUrl, externalId} = await publishGhost({title, html, meta, connection}));
    } else if (target === 'webhook') {
      ({publishedUrl} = await publishWebhook({title, html, markdown, meta, connection}));
    } else {
      return res.status(400).json({error: 'Unknown target: ' + target});
    }
  } catch (e) {
    return res.status(500).json({error: `${target} publish failed: ${e.message}`});
  }

  // Patch blog_posts.published_to
  if (post_id && supabase_url && supabase_key) {
    try {
      const get = await fetch(`${supabase_url}/rest/v1/blog_posts?id=eq.${post_id}&select=published_to`, {
        headers: {'apikey': supabase_key, 'Authorization': `Bearer ${supabase_key}`}
      });
      const rows = get.ok ? await get.json() : [];
      const existing = Array.isArray(rows?.[0]?.published_to) ? rows[0].published_to : [];
      const updated = [...existing.filter(p => p.target !== target), {
        target, url: publishedUrl, external_id: externalId, published_at: new Date().toISOString()
      }];
      await fetch(`${supabase_url}/rest/v1/blog_posts?id=eq.${post_id}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabase_key,
          'Authorization': `Bearer ${supabase_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({published_to: updated, updated_at: new Date().toISOString()})
      });
    } catch (e) {
      console.warn('blog_posts patch failed:', e.message);
    }
  }

  return res.status(200).json({ok: true, target, url: publishedUrl, external_id: externalId});
}

// ============================================================
// WordPress (REST API + Application Password)
// Docs: https://developer.wordpress.org/rest-api/reference/posts/
// ============================================================
async function publishWordpress({title, html, meta, connection}) {
  const {site_url, username, app_password} = connection || {};
  if (!site_url || !username || !app_password) {
    throw new Error('WordPress connection requires site_url, username, app_password');
  }
  const base = site_url.replace(/\/+$/, '');
  const auth = Buffer.from(`${username}:${app_password}`).toString('base64');

  const r = await fetch(`${base}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      content: html,
      status: 'publish',
      slug: meta.slug,
      excerpt: meta.description,
    })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 240)}`);
  }
  const data = await r.json();
  return {publishedUrl: data?.link || null, externalId: data?.id ? String(data.id) : null};
}

// ============================================================
// Ghost (Admin API + JWT signed with HS256)
// Docs: https://ghost.org/docs/admin-api/#token-authentication
// ============================================================
async function publishGhost({title, html, meta, connection}) {
  const {admin_api_url, admin_api_key} = connection || {};
  if (!admin_api_url || !admin_api_key) {
    throw new Error('Ghost connection requires admin_api_url and admin_api_key (id:secret)');
  }
  const base = admin_api_url.replace(/\/+$/, '');
  const [keyId, secretHex] = String(admin_api_key).split(':');
  if (!keyId || !secretHex) throw new Error('admin_api_key must be in id:secret hex format');
  const secret = Buffer.from(secretHex, 'hex');

  const header = {alg: 'HS256', typ: 'JWT', kid: keyId};
  const now = Math.floor(Date.now() / 1000);
  const payload = {iat: now, exp: now + 5 * 60, aud: '/admin/'};
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  const jwt = `${signingInput}.${signature}`;

  const r = await fetch(`${base}/ghost/api/admin/posts/?source=html`, {
    method: 'POST',
    headers: {
      'Authorization': `Ghost ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      posts: [{
        title,
        html,
        status: 'published',
        slug: meta.slug,
        custom_excerpt: meta.description ? String(meta.description).slice(0, 300) : undefined,
      }]
    })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 240)}`);
  }
  const data = await r.json();
  const post = data?.posts?.[0] || {};
  return {publishedUrl: post.url || null, externalId: post.id || null};
}

// ============================================================
// Generic webhook (Zapier / n8n / Make / custom)
// ============================================================
async function publishWebhook({title, html, markdown, meta, connection}) {
  const {webhook_url} = connection || {};
  if (!webhook_url) throw new Error('Webhook connection requires webhook_url');
  const r = await fetch(webhook_url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      source: 'supernova-editor',
      title, html, markdown, meta,
      sent_at: new Date().toISOString(),
    })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status}: ${txt.slice(0, 240)}`);
  }
  return {publishedUrl: webhook_url};
}
