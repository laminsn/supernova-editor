// Vercel serverless — POST /api/usage-check
// Pre-flight quota check + post-success increment for AI generation calls.
//
// Request: { workspace_id, metric, plan='free', mode:'check'|'increment',
//            supabase_url, supabase_key }
//
// Response: { ok, used, limit, remaining, period, plan }
// On `mode:'check'` and exceeded → ok:false (front-end blocks the call + opens PlanPicker).
// On `mode:'increment'` → atomically bumps the row, always ok:true (caller already
// guaranteed quota by checking first).

const PLAN_LIMITS = {
  free:       {strategy:5,    blog:1,    workflow:2,   image:10,   voiceover:0,    transcribe:5},
  creator:    {strategy:9999, blog:9999, workflow:9999, image:500,  voiceover:30,   transcribe:200},
  pro:        {strategy:9999, blog:9999, workflow:9999, image:2000, voiceover:200,  transcribe:1000},
  enterprise: {strategy:99999,blog:99999,workflow:99999,image:99999,voiceover:99999,transcribe:99999},
};

const VALID_METRICS = new Set(['strategy','blog','workflow','image','voiceover','transcribe']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    workspace_id, metric, plan = 'free', mode = 'check',
    supabase_url, supabase_key,
  } = req.body || {};

  if (!workspace_id) return res.status(400).json({error: 'Missing workspace_id'});
  if (!VALID_METRICS.has(metric)) return res.status(400).json({error: 'Invalid metric', valid: [...VALID_METRICS]});
  if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Missing supabase credentials'});

  const planKey = PLAN_LIMITS[plan] ? plan : 'free';
  const limit = PLAN_LIMITS[planKey][metric];
  const period = currentPeriod();

  // Read current usage
  const usageRes = await fetch(
    `${supabase_url}/rest/v1/usage_metrics?workspace_id=eq.${workspace_id}&metric=eq.${metric}&period=eq.${period}&select=count`,
    {headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`}}
  );
  if (!usageRes.ok) {
    return res.status(500).json({error: 'Usage lookup failed', status: usageRes.status});
  }
  const rows = await usageRes.json();
  const used = rows?.[0]?.count || 0;

  if (mode === 'check') {
    const remaining = Math.max(0, limit - used);
    return res.status(200).json({
      ok: used < limit,
      used, limit, remaining, period, plan: planKey, metric,
      reason: used < limit ? null : `Free tier ${metric} limit (${limit}/mo) reached. Upgrade to continue.`,
    });
  }

  // mode === 'increment' — atomic via Postgres function
  const incRes = await fetch(`${supabase_url}/rest/v1/rpc/increment_usage`, {
    method: 'POST',
    headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({ws: workspace_id, m: metric, p: period}),
  });
  if (!incRes.ok) {
    const txt = await incRes.text();
    return res.status(500).json({error: 'Increment failed', details: txt.slice(0, 180)});
  }
  const newCount = await incRes.json();
  return res.status(200).json({
    ok: true, used: newCount, limit, remaining: Math.max(0, limit - newCount),
    period, plan: planKey, metric, incremented: true,
  });
}

function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,'0')}`;
}

export {PLAN_LIMITS};
