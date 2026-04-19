// Vercel serverless — GET /api/health
// Reports which integrations are wired (env-var presence) so the front-end
// can show a real "Integration Status" panel instead of guessing.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const env = process.env;
  const has = (k) => Boolean(env[k] && String(env[k]).trim().length > 4);

  const integrations = {
    anthropic:  {key: 'ANTHROPIC_API_KEY',  ok: has('ANTHROPIC_API_KEY'),  used_for: 'Strategy Engine, Blog, Workflows, Script Edit, Translate'},
    ideogram:   {key: 'IDEOGRAM_API_KEY',   ok: has('IDEOGRAM_API_KEY'),   used_for: 'Thumbnails, Carousel slides, Blog images'},
    resend:     {key: 'RESEND_API_KEY',     ok: has('RESEND_API_KEY'),     used_for: 'Email (strategy, packages, welcome sequence, lead-magnet)'},
    deepgram:   {key: 'DEEPGRAM_API_KEY',   ok: has('DEEPGRAM_API_KEY'),   used_for: 'Auto-captions, transcription'},
    elevenlabs: {key: 'ELEVENLABS_API_KEY', ok: has('ELEVENLABS_API_KEY'), used_for: 'AI voice-over, multilingual narration'},
    stripe:     {key: 'STRIPE_SECRET_KEY',  ok: has('STRIPE_SECRET_KEY'),  used_for: 'Subscriptions, billing, plan upgrades'},
    twilio:     {key: 'TWILIO_AUTH_TOKEN',  ok: has('TWILIO_AUTH_TOKEN'),  used_for: 'A2P 10DLC SMS campaigns'},
    sentry:     {key: 'SENTRY_DSN',         ok: has('SENTRY_DSN'),         used_for: 'Error monitoring'},
    posthog:    {key: 'POSTHOG_API_KEY',    ok: has('POSTHOG_API_KEY'),    used_for: 'Product analytics'},
    ghl:        {key: 'GHL_PIT',            ok: has('GHL_PIT'),            used_for: 'GoHighLevel CRM sync'},
    n8n:        {key: 'N8N_WEBHOOK_BASE',   ok: has('N8N_WEBHOOK_BASE'),   used_for: 'Workflow webhooks, custom automation'},
    pexels:     {key: 'PEXELS_API_KEY',     ok: has('PEXELS_API_KEY'),     used_for: 'Stock images + stock video (free, commercial OK)'},
    pixabay:    {key: 'PIXABAY_API_KEY',    ok: has('PIXABAY_API_KEY'),    used_for: 'Royalty-free music + sound effects + video fallback'},
    freesound:  {key: 'FREESOUND_API_KEY',  ok: has('FREESOUND_API_KEY'),  used_for: 'Sound effects (Creative Commons)'},
    giphy:      {key: 'GIPHY_API_KEY',      ok: has('GIPHY_API_KEY'),      used_for: 'GIF library (primary)'},
    tenor:      {key: 'TENOR_API_KEY',      ok: has('TENOR_API_KEY'),      used_for: 'GIF library (Google fallback)'},
    unsplash:   {key: 'UNSPLASH_ACCESS_KEY',ok: has('UNSPLASH_ACCESS_KEY'),used_for: 'Stock image fallback'},
  };

  const ready = Object.values(integrations).filter(i => i.ok).length;
  const total = Object.keys(integrations).length;

  return res.status(200).json({
    ok: true,
    service: 'supernova-editor',
    version: 'v1.4.0',
    region: env.VERCEL_REGION || 'unknown',
    deployment: env.VERCEL_URL || 'local',
    timestamp: new Date().toISOString(),
    integrations_ready: `${ready}/${total}`,
    integrations,
  });
}
