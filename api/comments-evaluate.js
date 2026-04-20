// Vercel serverless — POST /api/comments-evaluate
// Runs sentiment + intent classification on a batch of comments via Claude,
// matches each against the user's comment_rules, and (optionally) auto-applies
// the matched action through /api/comments-moderate.
//
// Request: { comment_ids?, comments?: [{id, text, author}],
//            workspace_id, auto_apply?=false,
//            supabase_url?, supabase_key? }
//
// Returns: { ok, evaluations: [{comment_id, sentiment, intent, matched_rule_id, suggested_action}] }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  if (!ANTHROPIC_KEY) return res.status(500).json({error: 'ANTHROPIC_API_KEY not configured'});

  const {
    comment_ids, comments: inlineComments,
    workspace_id, auto_apply = false,
    supabase_url = SUPABASE_URL, supabase_key = SUPABASE_KEY,
  } = req.body || {};

  // Hydrate comments either from IDs (load from Supabase) or inline payload
  let comments = inlineComments || [];
  if (!comments.length && comment_ids?.length) {
    if (!supabase_url || !supabase_key) return res.status(400).json({error: 'Need supabase creds when passing comment_ids'});
    const r = await fetch(`${supabase_url}/rest/v1/comments?id=in.(${comment_ids.join(',')})&select=id,text,author,platform`, {
      headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
    });
    comments = await r.json();
  }
  if (!comments.length) return res.status(400).json({error: 'No comments to evaluate'});

  // Load rules
  let rules = [];
  if (workspace_id && supabase_url && supabase_key) {
    const r = await fetch(`${supabase_url}/rest/v1/comment_rules?workspace_id=eq.${workspace_id}&enabled=eq.true&order=priority.desc&select=*`, {
      headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`},
    });
    rules = await r.json();
  }

  // Batch through Claude (one call for the whole batch)
  const classifications = await classifyBatch(comments);

  // Match rules
  const evaluations = comments.map((c, i) => {
    const cls = classifications[i] || {sentiment: 'neutral', intent: 'other'};
    const matched = rules.find(r => ruleMatches(r, c, cls));
    return {
      comment_id: c.id,
      sentiment: cls.sentiment,
      intent: cls.intent,
      matched_rule_id: matched?.id || null,
      matched_rule_name: matched?.name || null,
      suggested_action: matched?.action || null,
      reply_template: matched?.reply_template || null,
    };
  });

  // Persist sentiment + intent + rule match back to comments table
  if (supabase_url && supabase_key) {
    for (const e of evaluations) {
      fetch(`${supabase_url}/rest/v1/comments?id=eq.${e.comment_id}`, {
        method: 'PATCH',
        headers: {apikey: supabase_key, Authorization: `Bearer ${supabase_key}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({sentiment: e.sentiment, intent: e.intent, matched_rule_id: e.matched_rule_id}),
      }).catch(() => {});
    }
  }

  // Optional auto-apply: fan out to /api/comments-moderate
  let auto_results = null;
  if (auto_apply) {
    auto_results = [];
    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://supernova-editor.vercel.app';
    for (const e of evaluations.filter(x => x.suggested_action)) {
      try {
        const r = await fetch(`${base}/api/comments-moderate`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            comment_id: e.comment_id,
            action: e.suggested_action,
            reply_text: e.reply_template,
            supabase_url, supabase_key,
          }),
        });
        const d = await r.json();
        auto_results.push({comment_id: e.comment_id, action: e.suggested_action, ok: d.ok, error: d.error});
      } catch (err) {
        auto_results.push({comment_id: e.comment_id, action: e.suggested_action, ok: false, error: err.message});
      }
    }
  }

  return res.status(200).json({ok: true, count: evaluations.length, evaluations, auto_results});
}

// ============================================================
// Claude batch classifier — single call, returns one row per input.
// ============================================================
async function classifyBatch(comments) {
  const numbered = comments.map((c, i) => `${i + 1}. "${(c.text || '').replace(/"/g, '\\"').slice(0, 400)}"`).join('\n');
  const system = `Classify each numbered comment for sentiment and intent. Output ONLY a JSON array — no preamble, no commentary. Each element MUST have shape: {"i": <number>, "sentiment": "positive|neutral|negative|spam", "intent": "question|complaint|praise|sale|spam|other"}.`;
  const user = `Classify these ${comments.length} comments:\n\n${numbered}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: Math.min(4000, 200 + comments.length * 60),
      system,
      messages: [{role: 'user', content: user}],
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Claude classify failed: ' + txt.slice(0, 200));
  }
  const data = await r.json();
  const text = (data?.content?.[0]?.text || '').trim();
  // Pull the first JSON array out of the response (Claude usually returns clean JSON, but harden for prose)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return comments.map(() => ({sentiment: 'neutral', intent: 'other'}));
  try {
    const parsed = JSON.parse(match[0]);
    return comments.map((_, i) => parsed.find(x => x.i === i + 1) || {sentiment: 'neutral', intent: 'other'});
  } catch (e) {
    return comments.map(() => ({sentiment: 'neutral', intent: 'other'}));
  }
}

// ============================================================
// Rule matcher
// ============================================================
function ruleMatches(rule, comment, cls) {
  const text = String(comment.text || '').toLowerCase();
  const value = String(rule.match_value || '').toLowerCase();
  switch (rule.match_type) {
    case 'keyword':   return text.includes(value);
    case 'regex': {
      try { return new RegExp(rule.match_value, 'i').test(comment.text || ''); }
      catch { return false; }
    }
    case 'sentiment': return cls.sentiment === value;
    case 'intent':    return cls.intent === value;
    default: return false;
  }
}
