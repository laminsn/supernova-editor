// Vercel serverless — POST /api/generate-strategy
// Orchestrated execution of the v4.1 Master Content Prompt across 11
// parallel Claude calls. Each batch produces a coherent subset of the
// 46+4 outputs; partial-failure tolerant (one batch failing returns its
// error block, doesn't kill the whole strategy).
//
// Why 11 batches:
//   1. A single 50-output mega-call truncates and burns tokens.
//   2. Parallel batches finish in ~30-60s wall-clock vs ~5min serial.
//   3. Per-batch retries on failure don't re-run the whole strategy.
//   4. Anthropic prompt caching (frameworks + per-batch outputs spec)
//      cuts cost ~60% after the first cache write.
//
// Request body: same as /api/generate-strategy-quick plus optional
//   { batches: ['b1','b2',...] } to run a subset of batches.
//
// Response:
//   {
//     ok: true,
//     mode: 'orchestrated',
//     model, version,
//     markdown: '<full stitched document>',
//     batches: [
//       { id, label, status: 'ok'|'failed', markdown, tokens, error }
//     ],
//     wall_clock_ms,
//     total_tokens
//   }

import {
  V41_MODEL,
  V41_VERSION,
  V41_BATCHES,
  buildBatchSystem,
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
    batches: requestedBatchIds = null,
    max_tokens_per_batch = 8000,
    save = false,
    workspace_id = null,
    content_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  if (!input.short_form_topic && !input.long_form_topic) {
    return res.status(400).json({ error: 'input.short_form_topic or input.long_form_topic required' });
  }

  // Filter to requested batches if caller specified a subset; otherwise run all.
  const batchesToRun = Array.isArray(requestedBatchIds) && requestedBatchIds.length > 0
    ? V41_BATCHES.filter((b) => requestedBatchIds.includes(b.id))
    : V41_BATCHES;

  if (batchesToRun.length === 0) {
    return res.status(400).json({ error: 'No valid batches selected' });
  }

  const startedAt = Date.now();
  const maxTokens = Math.max(200, Math.min(16000, parseInt(max_tokens_per_batch) || 8000));

  // Fan out: every batch runs in parallel.
  const results = await Promise.all(
    batchesToRun.map((batch) => runBatch(batch, input, apiKey, maxTokens))
  );

  const wallClockMs = Date.now() - startedAt;

  // Stitch successful batches into a single Markdown document, preserving
  // V41 batch order regardless of completion order.
  const stitched = results
    .filter((r) => r.status === 'ok' && r.markdown)
    .map((r) => `<!-- BATCH ${r.id}: ${r.label} -->\n\n${r.markdown.trim()}`)
    .join('\n\n---\n\n');

  // Aggregate token usage.
  const totalTokens = results.reduce(
    (acc, r) => {
      if (!r.tokens) return acc;
      return {
        input_tokens: (acc.input_tokens || 0) + (r.tokens.input_tokens || 0),
        output_tokens: (acc.output_tokens || 0) + (r.tokens.output_tokens || 0),
        cache_creation_input_tokens:
          (acc.cache_creation_input_tokens || 0) + (r.tokens.cache_creation_input_tokens || 0),
        cache_read_input_tokens:
          (acc.cache_read_input_tokens || 0) + (r.tokens.cache_read_input_tokens || 0),
      };
    },
    {}
  );

  const failedBatches = results.filter((r) => r.status === 'failed');

  // Optional persist.
  let savedId = null;
  if (save && supabase_url && supabase_key && content_id && stitched) {
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
          script: stitched,
          brief: {
            ...input,
            _v41_generated_at: new Date().toISOString(),
            _v41_mode: 'orchestrated',
            _v41_failed_batches: failedBatches.map((b) => b.id),
          },
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
    mode: 'orchestrated',
    model: V41_MODEL,
    version: V41_VERSION,
    markdown: stitched,
    batches: results,
    wall_clock_ms: wallClockMs,
    total_tokens: totalTokens,
    failed_count: failedBatches.length,
    saved_content_id: savedId,
  });
}

// Run one batch against Claude. Returns a uniform result envelope so the
// orchestrator can stitch / report partial failures cleanly.
async function runBatch(batch, input, apiKey, maxTokens) {
  const system = buildBatchSystem(batch);
  const userMessage = buildUserMessage(input, batch);
  const startedAt = Date.now();

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
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return {
        id: batch.id,
        label: batch.label,
        outputs: batch.outputs,
        status: 'failed',
        error: `HTTP ${r.status}: ${err.slice(0, 500)}`,
        ms: Date.now() - startedAt,
      };
    }

    const data = await r.json();
    const markdown = (data?.content?.[0]?.text || '').trim();
    if (!markdown) {
      return {
        id: batch.id,
        label: batch.label,
        outputs: batch.outputs,
        status: 'failed',
        error: 'Empty response from Claude',
        ms: Date.now() - startedAt,
      };
    }

    return {
      id: batch.id,
      label: batch.label,
      outputs: batch.outputs,
      status: 'ok',
      markdown,
      tokens: data?.usage || null,
      ms: Date.now() - startedAt,
    };
  } catch (e) {
    return {
      id: batch.id,
      label: batch.label,
      outputs: batch.outputs,
      status: 'failed',
      error: 'Request error: ' + e.message,
      ms: Date.now() - startedAt,
    };
  }
}
