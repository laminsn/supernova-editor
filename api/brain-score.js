// Vercel serverless — POST /api/brain-score
// SUPERNOVA Brain Score v0 (heuristic) — predicts viral potential from text + metadata
// Returns 0-100 scores per dimension + per-brain-region activation
// Future: replace heuristics with trained model on engagement_data

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    topic = '',
    caption = '',
    hook = '',
    script = '',
    platform = 'ig',
    duration_seconds = 60,
    hashtag_count = 0,
    save = false,
    workspace_id = null,
    content_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  const fullText = [topic, hook, script, caption].filter(Boolean).join('\n\n');
  if (!fullText.trim()) return res.status(400).json({error: 'Need at least one of: topic, hook, script, caption'});

  // ============================================================
  // FEATURE EXTRACTION — what predicts virality
  // ============================================================
  const features = extractFeatures({topic, caption, hook, script, platform, duration_seconds, hashtag_count});

  // ============================================================
  // SCORING DIMENSIONS — Content Unit Test framework
  // ============================================================
  const hookScore = scoreHook(features, hook || topic);
  const retentionScore = scoreRetention(features, script);
  const rewardScore = scoreReward(features, fullText);
  const algorithmFitScore = scoreAlgorithmFit(features, platform, duration_seconds, hashtag_count);

  const overall = Math.round((hookScore * 0.35 + retentionScore * 0.25 + rewardScore * 0.25 + algorithmFitScore * 0.15));

  // ============================================================
  // BRAIN REGION ACTIVATION (heuristic mapping)
  // ============================================================
  const brainRegions = {
    prefrontal: clamp(50 + features.specificity * 8 + features.contrarian * 12 + (features.numbers > 0 ? 10 : 0)),
    amygdala: clamp(45 + features.emotional_charge * 10 + features.curiosity_words * 6 + features.urgency * 8),
    hippocampus: clamp(50 + features.story_markers * 10 + features.named_entities * 4 + features.specificity * 5),
    temporal: clamp(40 + features.word_variety * 0.5 + features.readability * 12 + (features.has_dialogue ? 8 : 0)),
    occipital: clamp(40 + features.visual_words * 7 + features.sensory_words * 5),
    motor: clamp(35 + features.cta_strength * 12 + features.action_verbs * 4),
  };

  // ============================================================
  // RATIONALE — explainability
  // ============================================================
  const rationale = {
    strengths: [],
    weaknesses: [],
    suggestions: [],
    features,
  };

  if (hookScore >= 75) rationale.strengths.push(`Strong hook: ${hook ? '"'+hook.substring(0,80)+'"' : 'opening'} hits the 5-second curiosity gap`);
  if (hookScore < 50) rationale.weaknesses.push('Hook lacks pattern interrupt or specificity. Add a number, a contrarian claim, or a named person.');
  if (features.contrarian >= 1) rationale.strengths.push('Contrarian angle detected — high lean-in factor');
  if (features.numbers >= 2) rationale.strengths.push('Specific numbers/data points create credibility');
  if (features.curiosity_words === 0) rationale.weaknesses.push('No curiosity-gap words ("why", "how", "secret", "nobody"). Open the loop harder.');
  if (retentionScore < 50) rationale.suggestions.push('Add a rehook or open loop around the 50% mark to combat drop-off');
  if (rewardScore < 50) rationale.suggestions.push('Land the plane harder — your reframe / aha moment needs to feel earned');
  if (algorithmFitScore < 60) {
    if (platform === 'ig' && hashtag_count < 15) rationale.suggestions.push(`Instagram favors ~30 hashtags in first comment (you have ${hashtag_count})`);
    if (platform === 'ig' && duration_seconds > 90) rationale.suggestions.push('Instagram Reels peak engagement at 60-90s, you are over');
    if (platform === 'tt' && duration_seconds < 15) rationale.suggestions.push('TikTok needs 15s+ for the algorithm to learn the audience');
    if (platform === 'yt' && duration_seconds > 60 && duration_seconds < 480) rationale.suggestions.push('YouTube Shorts optimal under 60s; long-form starts working at 8min+');
  }

  // ============================================================
  // PERSIST PREDICTION
  // ============================================================
  let predictionId = null;
  if (save && supabase_url && supabase_key) {
    try {
      const r = await fetch(`${supabase_url}/rest/v1/brain_predictions`, {
        method: 'POST',
        headers: {
          'apikey': supabase_key,
          'Authorization': `Bearer ${supabase_key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          workspace_id, content_id,
          topic, caption, hook, script, platform, duration_seconds, hashtag_count,
          overall_score: overall,
          hook_score: hookScore,
          retention_score: retentionScore,
          reward_score: rewardScore,
          algorithm_fit_score: algorithmFitScore,
          prefrontal_score: brainRegions.prefrontal,
          amygdala_score: brainRegions.amygdala,
          hippocampus_score: brainRegions.hippocampus,
          temporal_score: brainRegions.temporal,
          occipital_score: brainRegions.occipital,
          motor_score: brainRegions.motor,
          rationale,
          model_version: 'v0-heuristic-2026.04',
        })
      });
      if (r.ok) {
        const data = await r.json();
        predictionId = data?.[0]?.id;
      } else {
        const err = await r.text();
        console.warn('Persist failed:', r.status, err);
      }
    } catch (e) {
      console.warn('Persist error:', e.message);
    }
  }

  return res.status(200).json({
    ok: true,
    prediction_id: predictionId,
    overall_score: overall,
    scores: {
      hook: hookScore,
      retention: retentionScore,
      reward: rewardScore,
      algorithm_fit: algorithmFitScore,
    },
    brain_regions: brainRegions,
    rationale,
    model_version: 'v0-heuristic-2026.04',
  });
}

// ============================================================
// HELPERS
// ============================================================

function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, Math.round(n))); }

function extractFeatures({topic, caption, hook, script, platform, duration_seconds, hashtag_count}) {
  const text = [topic, hook, script, caption].filter(Boolean).join(' ').toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const uniqueWords = new Set(words).size;

  const curiosityRegex = /\b(why|how|secret|nobody|nothing|never|nobody|hidden|truth|actually|surprise|reveal|expose|behind|before|gap|missing|unknown)\b/gi;
  const contrarianRegex = /\b(everyone says|most people think|you'?re wrong|the truth is|actually|but|however|except|unless|opposite|flip)\b/gi;
  const visualRegex = /\b(see|look|watch|show|picture|imagine|visualize|color|red|blue|bright|dark|glowing|massive|tiny)\b/gi;
  const sensoryRegex = /\b(feel|touch|hear|smell|taste|warm|cold|loud|quiet|sharp|smooth)\b/gi;
  const emotionRegex = /\b(love|hate|fear|angry|excited|terrified|amazed|shocked|disgusted|euphoric|broken|destroyed|won|lost|saved|killed)\b/gi;
  const urgencyRegex = /\b(now|today|immediately|urgent|stop|wait|don'?t|never|always|every|right now)\b/gi;
  const storyRegex = /\b(when|then|suddenly|next|finally|after|before|so|and then|i was|i had|told me|happened)\b/gi;
  const ctaRegex = /\b(comment|dm|share|tag|save|subscribe|follow|like|click|swipe|link|sign up|join|reply|drop)\b/gi;
  const actionRegex = /\b(do|make|build|create|launch|start|stop|grow|fix|solve|change|transform|use|try)\b/gi;
  const dialogueRegex = /["'"][^"'"]+["'"]/g;
  const numberRegex = /\b\d+(?:[.,]\d+)?(?:%|k|m|x)?\b/g;

  const matches = (regex) => (text.match(regex) || []).length;

  // Named entities (proper-cased multi-words in original — approximated)
  const original = [topic, hook, script, caption].filter(Boolean).join(' ');
  const properNouns = (original.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || []).filter(s => s.length > 2);

  // Specificity = numbers + named entities + concrete sensory words
  const specificity = matches(numberRegex) + properNouns.length + matches(visualRegex);

  // Readability (Flesch-Kincaid simplified): shorter sentences, common words = higher score
  const avgSentenceLen = sentences.length ? words.length / sentences.length : 20;
  const readability = clamp(100 - (avgSentenceLen - 8) * 4, 0, 100) / 100;

  return {
    word_count: words.length,
    sentence_count: sentences.length,
    word_variety: uniqueWords,
    avg_sentence_len: Math.round(avgSentenceLen * 10) / 10,
    readability,
    curiosity_words: matches(curiosityRegex),
    contrarian: matches(contrarianRegex),
    visual_words: matches(visualRegex),
    sensory_words: matches(sensoryRegex),
    emotional_charge: matches(emotionRegex),
    urgency: matches(urgencyRegex),
    story_markers: matches(storyRegex),
    cta_strength: matches(ctaRegex),
    action_verbs: matches(actionRegex),
    has_dialogue: dialogueRegex.test(original),
    numbers: matches(numberRegex),
    named_entities: properNouns.length,
    specificity,
  };
}

function scoreHook(f, hookText) {
  let s = 40; // baseline
  if (f.curiosity_words >= 1) s += 12;
  if (f.curiosity_words >= 3) s += 6;
  if (f.contrarian >= 1) s += 14;
  if (f.numbers >= 1) s += 8;
  if (f.named_entities >= 1) s += 6;
  if (f.emotional_charge >= 1) s += 6;
  if (f.urgency >= 1) s += 4;
  // Penalize generic openers
  const generic = /^(hey guys|what'?s up|today i|in this video|let me tell you)/i;
  if (hookText && generic.test(hookText)) s -= 18;
  // Length sweet spot for spoken hook (5-15 words)
  const hookWords = hookText ? hookText.split(/\s+/).length : 0;
  if (hookWords > 0 && hookWords < 5) s -= 8;
  if (hookWords > 25) s -= 6;
  return clamp(s);
}

function scoreRetention(f, script) {
  let s = 45;
  if (f.story_markers >= 2) s += 12;
  if (f.story_markers >= 5) s += 8;
  if (f.has_dialogue) s += 6;
  if (f.action_verbs >= 3) s += 6;
  if (f.readability >= 0.6) s += 8;
  // Multi-beat structure (script with multiple sentences)
  if (f.sentence_count >= 5) s += 6;
  if (f.sentence_count >= 10) s += 4;
  // Long monologue without breaks penalized
  if (f.avg_sentence_len > 25) s -= 10;
  return clamp(s);
}

function scoreReward(f, full) {
  let s = 45;
  // Reframe / aha markers
  if (/\b(actually|truth is|here'?s why|the real|what nobody|reframe|insight|realize|aha)\b/i.test(full)) s += 14;
  if (f.contrarian >= 1) s += 8;
  if (f.cta_strength >= 1) s += 10;
  if (f.cta_strength >= 3) s += 6;
  // Save-bait keywords
  if (/\b(save this|bookmark|reference|cheat sheet|framework|step|formula|template)\b/i.test(full)) s += 10;
  if (f.specificity >= 5) s += 6;
  return clamp(s);
}

function scoreAlgorithmFit(f, platform, duration, hashtagCount) {
  let s = 50;
  // Platform x duration
  if (platform === 'ig' || platform === 'tt') {
    if (duration >= 30 && duration <= 90) s += 18;
    else if (duration >= 15 && duration <= 120) s += 8;
    else s -= 8;
  } else if (platform === 'yt') {
    if (duration <= 60) s += 16; // shorts
    else if (duration >= 480) s += 12; // long-form sweet spot
    else s -= 4;
  } else if (platform === 'li') {
    if (duration >= 30 && duration <= 180) s += 14;
  }
  // Hashtag fit
  if (platform === 'ig' && hashtagCount >= 15 && hashtagCount <= 30) s += 10;
  else if (platform === 'tt' && hashtagCount >= 3 && hashtagCount <= 8) s += 8;
  else if (platform === 'yt' && hashtagCount >= 3 && hashtagCount <= 12) s += 6;
  else if (platform === 'li' && hashtagCount >= 3 && hashtagCount <= 5) s += 6;
  // CTA presence
  if (f.cta_strength >= 1) s += 6;
  return clamp(s);
}
