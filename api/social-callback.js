// Vercel serverless — GET /api/social-callback
// OAuth callback for social connections. Exchanges the auth code for an
// access token, persists to social_connections, and redirects back to the app.

const REDIRECT_BASE = process.env.SOCIAL_REDIRECT_URI || 'https://supernova-editor.vercel.app/api/social-callback';

const TOKEN_ENDPOINTS = {
  youtube:   {url: 'https://oauth2.googleapis.com/token',                client_id_env:'GOOGLE_CLIENT_ID',   client_secret_env:'GOOGLE_CLIENT_SECRET',   form: true},
  instagram: {url: 'https://graph.facebook.com/v18.0/oauth/access_token', client_id_env:'META_CLIENT_ID',     client_secret_env:'META_CLIENT_SECRET',     form: false, get: true},
  facebook:  {url: 'https://graph.facebook.com/v18.0/oauth/access_token', client_id_env:'META_CLIENT_ID',     client_secret_env:'META_CLIENT_SECRET',     form: false, get: true},
  tiktok:    {url: 'https://open.tiktokapis.com/v2/oauth/token/',         client_id_env:'TIKTOK_CLIENT_KEY',  client_secret_env:'TIKTOK_CLIENT_SECRET',   form: true, key_param:'client_key'},
  linkedin:  {url: 'https://www.linkedin.com/oauth/v2/accessToken',       client_id_env:'LINKEDIN_CLIENT_ID', client_secret_env:'LINKEDIN_CLIENT_SECRET', form: true},
  twitter:   {url: 'https://api.twitter.com/2/oauth2/token',              client_id_env:'TWITTER_CLIENT_ID',  client_secret_env:'TWITTER_CLIENT_SECRET',  form: true, basic_auth: true, extra: {code_verifier: 'challenge'}},
};

export default async function handler(req, res) {
  const {code, state, error} = req.query || {};

  if (error) return redirectWithStatus(res, 'error', error);
  if (!code || !state) return redirectWithStatus(res, 'error', 'missing_code');

  let parsed;
  try { parsed = JSON.parse(Buffer.from(state, 'base64url').toString()); }
  catch { return redirectWithStatus(res, 'error', 'invalid_state'); }

  const platform = parsed.platform;
  const userId = parsed.user_id;
  const cfg = TOKEN_ENDPOINTS[platform];
  if (!cfg) return redirectWithStatus(res, 'error', 'unknown_platform');

  const clientId = process.env[cfg.client_id_env];
  const clientSecret = process.env[cfg.client_secret_env];
  if (!clientId || !clientSecret) return redirectWithStatus(res, 'error', 'platform_not_configured');

  // Exchange code for tokens
  let tokens;
  try {
    const params = new URLSearchParams({
      [cfg.key_param || 'client_id']: clientId,
      client_secret: clientSecret,
      code, grant_type: 'authorization_code',
      redirect_uri: REDIRECT_BASE,
      ...(cfg.extra || {}),
    });
    const url = cfg.get ? `${cfg.url}?${params}` : cfg.url;
    const headers = {'Content-Type': 'application/x-www-form-urlencoded'};
    if (cfg.basic_auth) headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch(url, {
      method: cfg.get ? 'GET' : 'POST',
      headers,
      body: cfg.get ? undefined : params.toString(),
    });
    tokens = await r.json();
    if (!r.ok || tokens.error) {
      return redirectWithStatus(res, 'error', tokens.error_description || tokens.error || `http_${r.status}`);
    }
  } catch (e) {
    return redirectWithStatus(res, 'error', e.message);
  }

  // Persist to social_connections (service-role)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && userId) {
    try {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/social_connections?on_conflict=user_id,platform`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          platform,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
          scope: tokens.scope || null,
          metadata: tokens,
          connected_at: new Date().toISOString(),
        }),
      });
    } catch (e) { /* best-effort */ }
  }

  return redirectWithStatus(res, 'success', platform);
}

function redirectWithStatus(res, status, msg) {
  res.writeHead(302, {Location: `https://supernova-editor.vercel.app/?social_${status}=${encodeURIComponent(msg)}`});
  res.end();
}
