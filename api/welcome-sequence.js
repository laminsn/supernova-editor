// Vercel serverless — POST /api/welcome-sequence
// Sends (or schedules) the 5-step welcome email sequence via Resend.
// Mode: 'send_now' fires email N immediately. 'enqueue' persists steps to email_queue
// (the cron worker, if attached, picks these up; otherwise the front-end fires
// each step itself by calling this endpoint with mode=send_now and step=N).

const SEQUENCE = [
  {
    step: 0,
    delay_days: 0,
    subject: 'Welcome to Supernova Editor — your first 3 wins',
    preview: 'A 5-minute setup gets you a Brain Score, a strategy, and a teleprompter-ready script.',
    body_md: (n) => `Hi ${n},

Welcome to **Supernova Editor**. You just signed up for the all-in-one content operating system — Strategy Engine, Brain Score, Teleprompter, Vault, Publishing, and Collaboration in one place. All of it powered by **Claude AI**.

Here's what to do in the next 5 minutes:

1. **Open the Strategy Engine.** Type any topic. We'll generate a complete content plan — hook, contrarian take, full script, hashtags, CTA.
2. **Watch the Brain Score appear.** Every output gets a 0-100 virality prediction with a 6-region brain map showing exactly what's strong and what's weak.
3. **Hit "Send to Teleprompter."** Your script auto-loads into the recording studio. Press record and you're shipping.

That's the whole loop. Topic → Strategy → Score → Record → Publish. Today.

Tomorrow I'll show you the trick most creators miss inside the Vault. See you then.

— The Supernova Team`,
    cta: {label: 'Open Supernova', url: 'https://supernova-editor.vercel.app/'},
  },
  {
    step: 1,
    delay_days: 1,
    subject: 'The Vault trick (most creators miss this)',
    preview: 'Every strategy you generate auto-saves. Search it, drill into it, reload it.',
    body_md: (n) => `Hi ${n},

Yesterday you generated a strategy. Did you notice the toast that said "Saved to Strategy Vault"?

Click the **Vault** button (top-right of Strategy Engine OR Screen Record). What you'll see:

- Every strategy you've ever generated, searchable.
- 3-level drill-down: Strategy → Sections → individual scripts (Hook, Contrarian Take, Reframe, CTA, Full Script).
- One-click "Load to Teleprompter" on any section.

Here's the move: **batch-generate 10 strategies on Sunday.** Then every weekday open the Vault, pick the day's hook, and record. You'll bank 2 weeks of content in 90 minutes.

Tomorrow: the Brain Score deep dive — what each of the 6 brain regions actually predicts.

— The Supernova Team`,
    cta: {label: 'Open the Vault', url: 'https://supernova-editor.vercel.app/'},
  },
  {
    step: 2,
    delay_days: 3,
    subject: 'Your 6-region Brain Score — decoded',
    preview: 'Prefrontal, Amygdala, Hippocampus, Temporal, Occipital, Motor. What each one means.',
    body_md: (n) => `Hi ${n},

Brain Score isn't a single number. It's a **6-region activation map** plus 4 dimension scores. Decoded:

- **Prefrontal (analysis)** — specificity, contrarian claims, numbers. Low = generic.
- **Amygdala (emotion)** — emotional charge, urgency, curiosity gap. Low = no lean-in.
- **Hippocampus (memory)** — story markers, named entities. Low = forgettable.
- **Temporal (language)** — readability, dialogue, vocabulary variety. Low = hard to follow.
- **Occipital (visual)** — visual + sensory words. Low = not cinematic.
- **Motor (action)** — CTA strength, action verbs. Low = no shareability.

Every prediction comes with **specific suggestions** — not just "make it better," but "your hook has no curiosity-gap words, add one of: why, how, secret, nobody."

Tomorrow: how to put SUPERNOVA on autopilot with Workflows.

— The Supernova Team`,
    cta: {label: 'Score My Next Post', url: 'https://supernova-editor.vercel.app/'},
  },
  {
    step: 3,
    delay_days: 5,
    subject: 'Workflows: one input → 16 deliverables',
    preview: 'Topic + 5 languages → strategy + translations + scripts + posts in one click.',
    body_md: (n) => `Hi ${n},

The fastest creators don't manually move work between tools. They chain.

**Workflows** is SUPERNOVA's automation layer. Pick a recipe, give it one input, and the engine fans it out across the entire content stack.

Six templates ship today:

1. **Topic to Multi-Language Empire** — 1 strategy + 5 translations + 5 scripts + 5 posts (16 deliverables, one click).
2. **Strategy to Lead Magnet Funnel** — strategy + landing page + 5-email sequence + DM templates.
3. **Single Post to 14-Day Sprint** — one post → 84 derivatives across 14 days.
4. **Repurpose Published Content** — pick an old post, get 5 fresh angles + carousel briefs + email subjects.
5. **Collaborator Campaign** — 3 collaborator-ready turnkey packages, each with its own angle.
6. **Brand Voice Refinement** — paste 5 of your top posts, lock in a voice profile that all future generations honor.

Tomorrow: pricing breakdown — and why most creators downgrade *to* SUPERNOVA from a $300/mo stack.

— The Supernova Team`,
    cta: {label: 'Try a Workflow', url: 'https://supernova-editor.vercel.app/'},
  },
  {
    step: 4,
    delay_days: 7,
    subject: 'Replace 6 tools with one (here\'s the math)',
    preview: 'Submagic + Riverside + Buffer + Tribescaler + HeyGen + Hootsuite ≈ $300/mo. SUPERNOVA: $19.',
    body_md: (n) => `Hi ${n},

The average serious creator pays for:

- Submagic ($30) — captions
- Riverside ($30) — recording
- Buffer/Hootsuite ($45) — scheduling
- Tribescaler ($25) — hooks
- HeyGen ($45) — talking-head AI
- A separate AI subscription ($20-200) — strategy

That's $195-375/month for tools that don't talk to each other.

SUPERNOVA does all of it for **$19/mo (Creator)** or **$49/mo (Pro)**. Strategy Engine, Brain Score, Teleprompter, Auto-captions, Multi-screen recording, Carousel generator, Vault, Hashtag Intel, Comment Monitor, Lead Magnet generator, Collaboration packages — one platform, one bill.

Most importantly: **every step's data feeds the next**. Brain Score gets smarter from your engagement data. The Vault learns what works for *your* audience. The competitive moat compounds.

7-day free trial. Cancel anytime. **One platform. Zero stitching.**

— The Supernova Team`,
    cta: {label: 'See Pricing', url: 'https://supernova-editor.vercel.app/#pricing'},
  },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'Supernova Editor <onboarding@resend.dev>';
  if (!apiKey) return res.status(500).json({error: 'RESEND_API_KEY not configured'});

  const {
    to,
    name = '',
    step,
    mode = 'send_now',
    consent = false,
    workspace_id = null,
    supabase_url = null,
    supabase_key = null,
  } = req.body || {};

  if (!to) return res.status(400).json({error: 'Missing recipient (to)'});
  if (!consent) return res.status(400).json({error: 'A2P / CAN-SPAM compliance requires explicit opt-in (consent=true)'});

  const firstName = (name || '').split(' ')[0] || 'there';

  if (mode === 'enqueue') {
    if (!supabase_url || !supabase_key) return res.status(400).json({error: 'enqueue mode requires supabase credentials'});
    const queued = [];
    for (const s of SEQUENCE) {
      const sendAt = new Date(Date.now() + s.delay_days * 24 * 60 * 60 * 1000).toISOString();
      try {
        const r = await fetch(`${supabase_url}/rest/v1/email_queue`, {
          method: 'POST',
          headers: {
            'apikey': supabase_key,
            'Authorization': `Bearer ${supabase_key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            workspace_id, recipient: to, recipient_name: name,
            sequence: 'welcome', step: s.step, send_at: sendAt, status: 'pending', consent_recorded_at: new Date().toISOString(),
          })
        });
        if (r.ok) {
          const data = await r.json();
          queued.push({step: s.step, send_at: sendAt, id: data?.[0]?.id});
        }
      } catch (e) {
        console.warn('enqueue failed:', e.message);
      }
    }
    return res.status(200).json({ok: true, enqueued: queued, total: queued.length});
  }

  // Default: send_now (fires step N immediately)
  const stepNum = Number.isInteger(step) ? step : 0;
  const item = SEQUENCE.find(s => s.step === stepNum);
  if (!item) return res.status(400).json({error: 'Invalid step', valid: SEQUENCE.map(s => s.step)});

  const html = renderEmailHtml({
    subject: item.subject,
    bodyMd: item.body_md(firstName),
    cta: item.cta,
    recipient: to,
  });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject: item.subject,
        html,
        headers: {
          'List-Unsubscribe': `<mailto:unsubscribe@supernova-editor.vercel.app?subject=unsubscribe>, <https://supernova-editor.vercel.app/?unsubscribe=${encodeURIComponent(to)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({error: data.message || 'Resend failed', details: data});
    return res.status(200).json({ok: true, id: data.id, step: stepNum, subject: item.subject});
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}

function renderEmailHtml({subject, bodyMd, cta, recipient}) {
  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bodyHtml = bodyMd
    .split(/\n{2,}/)
    .map(p => {
      if (p.match(/^\d+\.\s/)) {
        const items = p.split('\n').filter(Boolean).map(l => `<li>${escapeHtml(l.replace(/^\d+\.\s+/, '')).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</li>`).join('');
        return `<ol style="padding-left:20px;margin:14px 0;">${items}</ol>`;
      }
      if (p.match(/^-\s/)) {
        const items = p.split('\n').filter(Boolean).map(l => `<li>${escapeHtml(l.replace(/^-\s+/, '')).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</li>`).join('');
        return `<ul style="padding-left:20px;margin:14px 0;">${items}</ul>`;
      }
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#222;">${escapeHtml(p).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</p>`;
    })
    .join('\n');

  const ctaButton = cta ? `
    <div style="text-align:center;margin:28px 0 16px;">
      <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:linear-gradient(135deg,#FFD60A,#FF8C00);color:#0A0A14;font-weight:800;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;">${escapeHtml(cta.label)} →</a>
    </div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <tr><td style="background:linear-gradient(135deg,#FFD60A 0%,#FF8C00 50%,#FF5722 100%);padding:24px;color:#0A0A14;">
        <div style="font-weight:900;font-size:20px;letter-spacing:-0.02em;">SUPERNOVA EDITOR</div>
        <div style="font-size:11px;margin-top:4px;opacity:0.75;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Powered by Claude AI</div>
      </td></tr>
      <tr><td style="padding:32px 32px 8px;">${bodyHtml}${ctaButton}</td></tr>
      <tr><td style="padding:18px 32px 26px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#777;line-height:1.55;">
        <p style="margin:0 0 8px;">You're receiving this because you signed up for Supernova Editor and explicitly opted in to product communications.</p>
        <p style="margin:0;">
          <a href="https://supernova-editor.vercel.app/?unsubscribe=${encodeURIComponent(recipient)}" style="color:#777;text-decoration:underline;">Unsubscribe</a>
          &nbsp;·&nbsp;
          <a href="https://supernova-editor.vercel.app/?view=privacy" style="color:#777;text-decoration:underline;">Privacy</a>
          &nbsp;·&nbsp;
          <a href="https://supernova-editor.vercel.app/?view=terms" style="color:#777;text-decoration:underline;">Terms</a>
        </p>
        <p style="margin:8px 0 0;">Supernova Editor · Rara Avis Marketing · Wilmington, DE 19801, USA</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// Export the sequence so the front-end can render previews without a round-trip.
export {SEQUENCE};
