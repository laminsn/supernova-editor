// Vercel serverless — POST /api/run-workflow
// Orchestrates a multi-step workflow recipe by calling Anthropic + Supabase.
// Returns the full step trace (no streaming — keeps Vercel hobby plan friendly).

const TEMPLATE_REGISTRY = {
  'multi-language-empire': {
    name: 'Topic to Multi-Language Empire',
    steps: ['strategy', 'translate', 'extract-scripts', 'platform-posts'],
  },
  'lead-magnet-funnel': {
    name: 'Strategy to Lead Magnet Funnel',
    steps: ['strategy', 'lead-magnet', 'email-sequence', 'dm-template'],
  },
  '14-day-sprint': {
    name: 'Single Post to 14-Day Sprint',
    steps: ['analyze', 'sprint-plan'],
  },
  'repurpose': {
    name: 'Repurpose Published Content',
    steps: ['extract-hooks', 'angles', 'derivatives'],
  },
  'collaborator-campaign': {
    name: 'Collaborator Campaign',
    steps: ['strategy', 'collaborator-packages'],
  },
  'voice-refinement': {
    name: 'Brand Voice Refinement',
    steps: ['analyze-voice', 'voice-profile'],
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    template_id,
    input = {},
    workspace_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  const tpl = TEMPLATE_REGISTRY[template_id];
  if (!tpl) return res.status(400).json({error: 'Unknown template_id', valid: Object.keys(TEMPLATE_REGISTRY)});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'ANTHROPIC_API_KEY not configured'});

  // Create the run row up-front so the UI can poll it
  let runId = null;
  if (supabase_url && supabase_key) {
    runId = await createRun({supabase_url, supabase_key, workspace_id, template_id, template_name: tpl.name, input});
  }

  const steps = [];
  const startedAt = Date.now();

  try {
    for (const stepId of tpl.steps) {
      const stepStart = Date.now();
      const result = await executeStep({stepId, template_id, input, prior: steps, apiKey});
      steps.push({
        id: stepId,
        status: 'done',
        elapsed_ms: Date.now() - stepStart,
        output: result,
      });
      if (runId) await patchRun({supabase_url, supabase_key, runId, steps, status: 'running'});
    }
  } catch (e) {
    steps.push({id: 'error', status: 'error', error: e.message});
    if (runId) await patchRun({supabase_url, supabase_key, runId, steps, status: 'error', error: e.message});
    return res.status(500).json({ok: false, run_id: runId, error: e.message, steps});
  }

  const output = aggregateOutput(template_id, steps);
  if (runId) await patchRun({supabase_url, supabase_key, runId, steps, status: 'done', output, completed_at: new Date().toISOString()});

  return res.status(200).json({
    ok: true,
    run_id: runId,
    template_id,
    template_name: tpl.name,
    elapsed_ms: Date.now() - startedAt,
    steps,
    output,
  });
}

// ============================================================
// STEP EXECUTORS
// ============================================================
async function executeStep({stepId, template_id, input, prior, apiKey}) {
  switch (stepId) {
    case 'strategy':
      return await callClaude(apiKey, strategyPrompt(input), 4000);
    case 'translate':
      return await translateMany(apiKey, prior[0]?.output || input.topic, input.languages || ['Spanish', 'Portuguese', 'French']);
    case 'extract-scripts':
      return await extractScripts(apiKey, prior[0]?.output || '', prior[1]?.output);
    case 'platform-posts':
      return await callClaude(apiKey, platformPostsPrompt(prior[0]?.output, input.platforms || ['ig', 'tt', 'yt', 'li']), 3000);
    case 'lead-magnet':
      return await callClaude(apiKey, leadMagnetPrompt(prior[0]?.output, input.topic), 3000);
    case 'email-sequence':
      return await callClaude(apiKey, emailSequencePrompt(prior[0]?.output, input.topic), 3500);
    case 'dm-template':
      return await callClaude(apiKey, dmTemplatePrompt(prior[0]?.output, input.topic), 1200);
    case 'analyze':
      return await callClaude(apiKey, analyzePostPrompt(input.post), 1800);
    case 'sprint-plan':
      return await callClaude(apiKey, sprintPlanPrompt(prior[0]?.output, input.post), 4500);
    case 'extract-hooks':
      return await callClaude(apiKey, extractHooksPrompt(input.post), 1500);
    case 'angles':
      return await callClaude(apiKey, anglesPrompt(prior[0]?.output, input.post), 2500);
    case 'derivatives':
      return await callClaude(apiKey, derivativesPrompt(prior[1]?.output, input.post), 3000);
    case 'collaborator-packages':
      return await callClaude(apiKey, collaboratorPackagesPrompt(prior[0]?.output, input.collaborators || 3), 4000);
    case 'analyze-voice':
      return await callClaude(apiKey, voiceAnalysisPrompt(input.posts || []), 2200);
    case 'voice-profile':
      return await callClaude(apiKey, voiceProfilePrompt(prior[0]?.output), 1500);
    default:
      throw new Error('Unknown step: ' + stepId);
  }
}

async function callClaude(apiKey, prompt, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: maxTokens,
      messages: [{role: 'user', content: prompt}],
    })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Claude HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data?.content?.[0]?.text || '').trim();
}

async function translateMany(apiKey, source, languages) {
  const out = {};
  for (const lang of languages.slice(0, 5)) {
    out[lang] = await callClaude(
      apiKey,
      `Translate the following content strategy into ${lang}. Preserve formatting (headings, bullets, line breaks). Adapt cultural references and idioms — do not translate them literally. Output only the translated text.\n\n---\n${String(source).slice(0, 6000)}`,
      4000
    );
  }
  return out;
}

async function extractScripts(apiKey, strategy, translations) {
  const all = {English: strategy, ...(translations || {})};
  const out = {};
  for (const [lang, text] of Object.entries(all)) {
    out[lang] = await callClaude(
      apiKey,
      `From the strategy below (in ${lang}), extract a 30-60 second teleprompter-ready spoken script. Plain prose, no stage directions, no markdown headings. One short paragraph per beat. Punctuation only.\n\n---\n${String(text).slice(0, 4000)}`,
      900
    );
  }
  return out;
}

// ============================================================
// PROMPT BUILDERS
// ============================================================
function strategyPrompt(input) {
  return `You are SUPERNOVA's content strategist. Build a complete ${input.contentType || 'short-form'} content strategy for the topic: "${input.topic || ''}".

Include these labeled sections (use ALL CAPS section headers):
RECOMMENDED HOOK (5s), HOOK VARIATIONS (3 alternates), CONTRARIAN TAKE (12s), 3 KEY POINTS, REFRAME LINE, CALL TO ACTION, FULL SCRIPT (60-90s spoken), HASHTAG STRATEGY, POSTING TIME.
Keep it punchy. No fluff. No preamble.`;
}
function platformPostsPrompt(strategy, platforms) {
  const platLabels = {ig: 'Instagram', tt: 'TikTok', yt: 'YouTube Shorts', li: 'LinkedIn', fb: 'Facebook'};
  const list = platforms.map(p => `- ${platLabels[p] || p}`).join('\n');
  return `From this strategy, write a platform-specific post (caption + hashtag count guidance) for each platform below. Match each platform's voice + caption length norms.\n\nPlatforms:\n${list}\n\nStrategy:\n${String(strategy).slice(0, 4000)}`;
}
function leadMagnetPrompt(strategy, topic) {
  return `Build a one-page lead magnet brief based on this strategy. Output: HEADLINE, SUBHEADLINE (one sentence), 5 BULLET BENEFITS, OPT-IN CTA, FOOTER LINE. Topic: ${topic}. Strategy:\n\n${String(strategy).slice(0, 3500)}`;
}
function emailSequencePrompt(strategy, topic) {
  return `Write 5 sequential welcome/nurture emails (Day 0, 1, 3, 5, 7) on the topic "${topic}". Each email: SUBJECT (under 55 chars), PREVIEW TEXT (under 90 chars), BODY (120-180 words, no fluff), CTA (one button text). Reference this strategy for substance:\n\n${String(strategy).slice(0, 3000)}`;
}
function dmTemplatePrompt(strategy, topic) {
  return `Write 3 short DM follow-up templates a creator can paste to subscribers who downloaded a lead magnet about "${topic}". Each under 40 words. Friendly, not salesy.`;
}
function analyzePostPrompt(post) {
  return `Analyze this published post and identify (1) why it worked, (2) the strongest 1-2 hooks within it, (3) which audiences it under-served. Be specific.\n\nPOST:\n${String(post || '').slice(0, 3000)}`;
}
function sprintPlanPrompt(analysis, post) {
  return `Build a 14-day repurposing sprint based on this post analysis. For each day, list 6 derivative pieces (1 short video, 1 long-form clip, 1 carousel, 1 email, 1 LinkedIn post, 1 X thread) with title + 1-line angle. Number the days clearly.\n\nANALYSIS:\n${String(analysis).slice(0, 2000)}\n\nPOST:\n${String(post || '').slice(0, 1500)}`;
}
function extractHooksPrompt(post) {
  return `Extract every distinct hook (curiosity gap, contrarian claim, story open, question, statistic) from this post. Number each. Note its hook type in brackets.\n\nPOST:\n${String(post || '').slice(0, 3000)}`;
}
function anglesPrompt(hooks, post) {
  return `Generate 5 fresh angles to re-tell the same core idea using different hooks/audiences. Each angle: HEADLINE, AUDIENCE, HOOK, REFRAME.\n\nHOOKS FOUND:\n${String(hooks).slice(0, 1500)}\n\nORIGINAL POST:\n${String(post || '').slice(0, 1500)}`;
}
function derivativesPrompt(angles, post) {
  return `For each of these 5 angles, produce: (a) a 9-slide carousel brief, (b) one email subject line. Number 1-5.\n\nANGLES:\n${String(angles).slice(0, 2500)}`;
}
function collaboratorPackagesPrompt(strategy, count) {
  return `From this strategy, build ${count} distinct collaborator-ready turnkey packages. Each package: COLLABORATOR ANGLE (which audience this slants toward), SUGGESTED HOOK, 30-SECOND SCRIPT, IG CAPTION, HASHTAG SET, 2 DM REPLIES.\n\nSTRATEGY:\n${String(strategy).slice(0, 4000)}`;
}
function voiceAnalysisPrompt(posts) {
  const joined = (posts || []).slice(0, 5).map((p, i) => `--- POST ${i + 1} ---\n${String(p).slice(0, 800)}`).join('\n\n');
  return `Analyze the writing voice across these 5 sample posts. Identify: TONE (3 adjectives), SENTENCE RHYTHM, RECURRING PHRASES (5), TABOOS (what voice avoids), SIGNATURE MOVES.\n\n${joined}`;
}
function voiceProfilePrompt(analysis) {
  return `Convert this voice analysis into a JSON profile that future Strategy Engine prompts can prepend. Output ONLY the JSON object with keys: tone (array), rhythm, signature_phrases (array), avoid (array), example_opener, example_close. No commentary.\n\nANALYSIS:\n${String(analysis).slice(0, 2000)}`;
}

// ============================================================
// AGGREGATE OUTPUT
// ============================================================
function aggregateOutput(template_id, steps) {
  const o = {};
  steps.forEach(s => { if (s.id !== 'error') o[s.id] = s.output; });
  return {template_id, sections: o};
}

// ============================================================
// SUPABASE PERSISTENCE
// ============================================================
async function createRun({supabase_url, supabase_key, workspace_id, template_id, template_name, input}) {
  try {
    const r = await fetch(`${supabase_url}/rest/v1/workflow_runs`, {
      method: 'POST',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({workspace_id, template_id, template_name, input, status: 'running'})
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.[0]?.id || null;
  } catch (e) {
    console.warn('createRun:', e.message);
    return null;
  }
}

async function patchRun({supabase_url, supabase_key, runId, steps, status, output, error, completed_at}) {
  try {
    const body = {steps, status};
    if (output) body.output = output;
    if (error) body.error = error;
    if (completed_at) body.completed_at = completed_at;
    await fetch(`${supabase_url}/rest/v1/workflow_runs?id=eq.${runId}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabase_key,
        'Authorization': `Bearer ${supabase_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn('patchRun:', e.message);
  }
}
