// Vercel serverless — POST /api/generate-strategy-quick
// Single-call execution of the v4.1 Master Content Prompt.
// Mirrors the user's manual workflow: send everything to Claude in one shot,
// return the full Markdown strategy. For richer parallel-generated output,
// use POST /api/generate-strategy (orchestrated 11-batch mode).
//
// Request body:
//   {
//     input: {
//       brand_name, handle, primary_color, accent_color_1, accent_color_2,
//       target_audience, industry, expertise, personal_angle,
//       short_form_topic, long_form_topic, content_language,
//       posting_platforms, audience_location, comment_keyword,
//       lead_magnet_short, lead_magnet_long, video_tone, series_context,
//       ghl_destination, series_vision,
//       blog_base_url, ghl_list_name, whatsapp_telegram,
//       linkedin_dm_strategy, new_follower_flow, empire_agent_map
//     },
//     max_tokens: 16000,           // optional override
//     save: false,                 // optional: persist to content table
//     workspace_id, content_id,    // required if save=true
//     supabase_url, supabase_key   // required if save=true
//   }
//
// Response: { ok: true, markdown, model, version, tokens }

import {
  V41_MODEL,
  V41_VERSION,
  buildFullSystem,
  buildUserMessage,
} from './_v41-prompt.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const {
    input = {},
    max_tokens = 16000,
    save = false,
    workspace_id = null,
    content_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  // Minimal validation: a topic is the floor.
  if (!input.short_form_topic && !input.long_form_topic) {
    return res.status(400).json({ error: 'input.short_form_topic or input.long_form_topic required' });
  }

  const system = buildFullSystem();
  const userMessage = buildUserMessage(input);

  let markdown = '';
  let usage = null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: V41_MODEL,
        max_tokens: Math.max(200, Math.min(64000, parseInt(max_tokens) || 16000)),
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: 'Anthropic call failed', details: err });
    }

    const data = await r.json();
    markdown = (data?.content?.[0]?.text || '').trim();
    usage = data?.usage || null;
    if (!markdown) return res.status(500).json({ error: 'Empty response from Claude' });
  } catch (e) {
    return res.status(500).json({ error: 'Anthropic request error: ' + e.message });
  }

  // Optional persist into the existing content table.
  let savedId = null;
  if (save && supabase_url && supabase_key && content_id) {
    try {
      const url = `${supabase_url}/rest/v1/content?id=eq.${encodeURIComponent(content_id)}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: {
          apikey: supabase_key,
          Authorization: `Bearer ${supabase_key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          script: markdown,
          brief: { ...input, _v41_generated_at: new Date().toISOString(), _v41_mode: 'quick' },
        }),
      });
      if (r.ok) {
        const data = await r.json();
        savedId = data?.[0]?.id || content_id;
      } else {
        console.warn('content patch failed:', r.status, await r.text());
      }
    } catch (e) {
      console.warn('content patch error:', e.message);
    }
  }

  return res.status(200).json({
    ok: true,
    markdown,
    model: V41_MODEL,
    version: V41_VERSION,
    mode: 'quick',
    tokens: usage,
    saved_content_id: savedId,
  });
}
