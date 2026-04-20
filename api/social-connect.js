// Vercel serverless — POST /api/social-connect
// Returns the OAuth authorization URL for the requested platform so the front
// end can redirect the user. Per-platform setup notes in /api/social-callback.
//
// Request: { platform: 'youtube'|'instagram'|'tiktok'|'linkedin'|'facebook'|'twitter',
//            redirect_to?, state? }

const REDIRECT_BASE = process.env.SOCIAL_REDIRECT_URI || 'https://supernova-editor.vercel.app/api/social-callback';

const PROVIDERS = {
  youtube: {
    auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    client_id_env: 'GOOGLE_CLIENT_ID',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube',
    extra: {access_type: 'offline', prompt: 'consent'},
  },
  instagram: {
    // Use Facebook Login → Instagram Graph API for business accounts
    auth_url: 'https://www.facebook.com/v18.0/dialog/oauth',
    client_id_env: 'META_CLIENT_ID',
    scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management',
  },
  facebook: {
    auth_url: 'https://www.facebook.com/v18.0/dialog/oauth',
    client_id_env: 'META_CLIENT_ID',
    scope: 'pages_manage_posts,pages_read_engagement,pages_show_list,publish_video',
  },
  tiktok: {
    auth_url: 'https://www.tiktok.com/v2/auth/authorize/',
    client_id_env: 'TIKTOK_CLIENT_KEY',
    scope: 'user.info.basic,video.upload,video.publish',
    client_id_param: 'client_key',
  },
  linkedin: {
    auth_url: 'https://www.linkedin.com/oauth/v2/authorization',
    client_id_env: 'LINKEDIN_CLIENT_ID',
    scope: 'r_liteprofile r_emailaddress w_member_social',
  },
  twitter: {
    auth_url: 'https://twitter.com/i/oauth2/authorize',
    client_id_env: 'TWITTER_CLIENT_ID',
    scope: 'tweet.read tweet.write users.read offline.access',
    extra: {code_challenge: 'challenge', code_challenge_method: 'plain'},
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {platform, state = '', user_id = ''} = req.body || {};
  const cfg = PROVIDERS[platform];
  if (!cfg) return res.status(400).json({error: 'Unknown platform', valid: Object.keys(PROVIDERS)});

  const clientId = process.env[cfg.client_id_env];
  if (!clientId) {
    return res.status(200).json({
      ok: false,
      configured: false,
      platform,
      message: `${platform} OAuth not configured. Add ${cfg.client_id_env} (and corresponding secret) to Vercel env.`,
      setup_steps: setupStepsFor(platform),
    });
  }

  // Encode user_id into state so callback can attribute the connection
  const stateEncoded = Buffer.from(JSON.stringify({user_id, platform, ts: Date.now(), nonce: state})).toString('base64url');

  const params = new URLSearchParams({
    [cfg.client_id_param || 'client_id']: clientId,
    redirect_uri: REDIRECT_BASE,
    response_type: 'code',
    scope: cfg.scope,
    state: stateEncoded,
    ...(cfg.extra || {}),
  });

  return res.status(200).json({
    ok: true,
    configured: true,
    platform,
    auth_url: `${cfg.auth_url}?${params.toString()}`,
  });
}

function setupStepsFor(platform) {
  const guides = {
    youtube:   'console.cloud.google.com → Create OAuth client (web) → enable YouTube Data API v3 → add redirect /api/social-callback',
    instagram: 'developers.facebook.com → Create app → Add Instagram Graph API → request advanced access to instagram_content_publish',
    facebook:  'developers.facebook.com → Create app → Add Facebook Login → request pages_manage_posts',
    tiktok:    'developers.tiktok.com → Create app → enable Login Kit + Content Posting API → request video.upload + video.publish scopes',
    linkedin:  'linkedin.com/developers → Create app → request w_member_social product',
    twitter:   'developer.twitter.com → Create v2 OAuth 2.0 app with PKCE → enable tweet.write + offline.access',
  };
  return guides[platform] || 'See platform developer docs.';
}

export {PROVIDERS};
