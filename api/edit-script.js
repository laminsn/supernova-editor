// Vercel serverless — POST /api/edit-script
// In-app Claude rewriting: rewrite a hook punchier, shorten to fit teleprompter,
// translate a section, change tone, add CTA, etc. Used by Editor + ScreenRecord.
//
// Request: {
//   text: '...',                    // the source text to edit
//   instruction: 'rewrite ...',     // freeform OR a known preset key
//   preset?: 'punchier'|'shorter'|...
//   max_tokens?: 1500
// }

const PRESETS = {
  punchier:        'Rewrite the text to be punchier and more emotionally charged. Keep the same meaning. Cut filler. Use shorter sentences. Add one curiosity-gap word in the first 8 words.',
  shorter:         'Cut this to ~60% of the current length while preserving every important beat. Tighten without losing the hook or the CTA.',
  longer:          'Expand this with one concrete example, one named entity, and one specific number. Do not pad with filler.',
  contrarian:      'Rewrite from a contrarian angle. Lead with the unpopular truth. Earn the reframe with evidence.',
  story:           'Rewrite as a 3-beat micro-story (situation, complication, resolution). Keep the original CTA at the end.',
  hook:            'Rewrite ONLY the opening hook (first 8-15 words) to maximize 3-second retention. Output 5 alternatives, numbered.',
  cta:             'Replace the CTA with 5 high-conversion alternatives. Number them. Each under 12 words.',
  teleprompter:    'Rewrite for a teleprompter read: short sentences, plain prose, no markdown, no stage directions, natural breath breaks. Keep total length close to original.',
  ig_caption:      'Rewrite as an Instagram caption: one strong line break after the first sentence, scannable middle, ending CTA, no hashtags (those go separately).',
  tt_caption:      'Rewrite as a TikTok caption: under 200 chars, one curiosity hook, one emoji.',
  yt_description:  'Rewrite as a YouTube video description: 2-paragraph value summary, then bulleted timestamps placeholder, then CTA + links section.',
  li_post:         'Rewrite as a LinkedIn post: professional but human, first line is a hook, line breaks every 1-2 sentences, end with a question.',
  fb_post:         'Rewrite as a Facebook post: warm tone, story-led, CTA is to comment.',
  fix_grammar:     'Fix grammar and typos only. Do not change meaning, voice, or structure.',
  remove_jargon:   'Remove jargon and corporate-speak. Replace with plain words a smart 7th grader could read.',
  add_proof:       'Insert one statistic, one named example, and one short quote where they fit naturally. Do not invent fake numbers — leave [STAT] / [QUOTE] / [NAME] placeholders if you do not know.',
  brain_score_fix: 'Rewrite to maximize Brain Score: add curiosity-gap word in hook, add a specific number, add one contrarian phrase, end with a strong CTA verb.',
};

const TRANSLATE_PROMPT = (lang) =>
  `Translate the following into ${lang}. Preserve formatting. Adapt cultural references — do not translate them literally. Output only the translation.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const {
    text,
    instruction,
    preset,
    translate_to,
    voice_profile,
    max_tokens = 1500,
  } = req.body || {};

  if (!text || !String(text).trim()) {
    return res.status(400).json({error: 'Missing text to edit'});
  }
  if (!instruction && !preset && !translate_to) {
    return res.status(400).json({error: 'Provide instruction, preset, or translate_to'});
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'ANTHROPIC_API_KEY not configured'});

  let directive;
  if (translate_to) {
    directive = TRANSLATE_PROMPT(translate_to);
  } else if (preset && PRESETS[preset]) {
    directive = PRESETS[preset];
  } else {
    directive = String(instruction).slice(0, 800);
  }

  const voiceClause = voice_profile
    ? `\n\nWriter voice profile to honor (do not break this):\n${JSON.stringify(voice_profile).slice(0, 1500)}`
    : '';

  const system = `You are a senior editor for a content operating system. The user has selected a piece of text and asked for a single, surgical edit. Output ONLY the edited text. No preamble, no commentary, no markdown fences. Match the user's existing voice and casing exactly.${voiceClause}`;

  const user = `EDIT INSTRUCTION:\n${directive}\n\n--- TEXT TO EDIT ---\n${String(text).slice(0, 8000)}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: Math.max(200, Math.min(8000, parseInt(max_tokens) || 1500)),
        system,
        messages: [{role: 'user', content: user}],
      })
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({error: 'Anthropic call failed', details: txt.slice(0, 240)});
    }
    const data = await r.json();
    const result = (data?.content?.[0]?.text || '').trim();
    if (!result) return res.status(500).json({error: 'Empty response from Claude'});
    return res.status(200).json({
      ok: true,
      result,
      preset: preset || null,
      translate_to: translate_to || null,
      model: 'claude-sonnet-4-5-20250929',
      input_chars: String(text).length,
      output_chars: result.length,
    });
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}

// Export presets for the front-end to render its rewrite menu without a round-trip
export {PRESETS};
