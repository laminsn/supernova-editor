# SUPERNOVA EDITOR — Enterprise Readiness

What's required to take this from a single-tenant tool to a "plug in and ship" enterprise platform. Everything below is **scoped to what an enterprise customer would expect on day one** — not a wish list.

> **Integration philosophy:** users connect at most 4 personal channels (custom email, Slack, Telegram, WhatsApp). Everything else — AI, image gen, stock libraries, transcription — runs on Supernova's master account and is bundled into the subscription. See [INTEGRATIONS.md](./INTEGRATIONS.md) for the full breakdown.

## Status Legend
- ✅ **Live** — shipped, working in production
- 🟡 **Partial** — scaffolding exists, needs hardening
- 🔴 **Missing** — not yet built

---

## 1. Identity & Access

| Capability | Status | Notes |
|---|---|---|
| Email + password auth | 🟡 | Supabase Auth wrapper exists; UI flow not wired |
| Google / Apple OAuth | 🔴 | Add Supabase OAuth providers |
| Magic-link sign-in | 🔴 | `supabase.auth.signInWithOtp()` |
| SAML SSO (Okta / Azure AD) | 🔴 | Supabase Pro tier has SAML; expose in Settings → Enterprise |
| Multi-workspace per user | 🟡 | `workspaces` table exists; switcher UI missing |
| Role-based permissions | 🟡 | `ROLE_PERMISSIONS` matrix exists; not enforced server-side |
| Per-row RLS (real isolation) | 🔴 | Currently permissive demo policies — tighten before public launch |
| API keys (programmatic access) | 🔴 | Need `api_keys` table + bearer-token middleware |
| Audit log | 🔴 | `audit_log` table — log every write + admin action |

## 2. Billing & Monetization

| Capability | Status | Notes |
|---|---|---|
| Stripe subscriptions | 🔴 | `/api/stripe-checkout.js` + `/api/stripe-webhook.js` |
| Plan upgrade / downgrade | 🔴 | Customer Portal link from Settings |
| Usage metering (strategies/mo, blog posts/mo) | 🔴 | Counters per workspace; soft-throttle on free tier |
| Annual billing (20% off) | 🔴 | Stripe price IDs for monthly + annual |
| Tax handling | 🔴 | Stripe Tax automatic |
| Invoicing | 🔴 | Stripe-hosted invoices |
| Refunds / dunning | 🔴 | Stripe defaults |

## 3. AI Integrations (Live)

| Capability | Status | Endpoint | Provider |
|---|---|---|---|
| Strategy generation | ✅ | (in-app stream) | Anthropic Claude Sonnet 4.5 |
| Blog post generation | ✅ | `/api/generate-blog` | Anthropic |
| Workflow orchestration | ✅ | `/api/run-workflow` | Anthropic |
| Brain Score (heuristic v0) | ✅ | `/api/brain-score` | In-house |
| Script edit / rewrite | ✅ | `/api/edit-script` | Anthropic — 16 presets |
| Image generation | ✅ | `/api/generate-image` | Ideogram v3 |
| Translation (batch fan-out) | ✅ | `/api/translate` | Anthropic |
| Asset library (image/video/music/SFX/GIF) | ✅ | `/api/asset-library` | Pexels + Pixabay + Freesound + GIPHY + Tenor |
| Auto-captions | ✅ | `/api/transcribe` | Deepgram (Nova-2, returns text + WebVTT) |
| AI voice-over (multilingual) | 🔴 | `/api/synthesize` (planned) | ElevenLabs |
| Live stream simulcast | ✅ | `/api/livestream-create` | Restream.io (with manual RTMP fallback) |
| Brain Score v1 (trained) | 🔴 | After 500 labeled pairs | XGBoost on `training_pairs` view |
| Multi-modal Brain Score v2 | 🔴 | After 5K pairs | CLIP + Whisper embeddings |

## 4. Channel Integrations

| Channel | Outbound | Inbound | Notes |
|---|---|---|---|
| Email (transactional) | ✅ Resend | n/a | strategy, packages, welcome sequence, lead magnet |
| Email (marketing campaigns) | 🟡 | n/a | A2P checkbox + welcome sequence shipped; full campaign builder pending |
| SMS / A2P 10DLC | 🔴 | 🔴 | Twilio campaign registration, opt-in flow shipped |
| WordPress publish | ✅ | 🔴 | REST API + App Password |
| Ghost publish | ✅ | 🔴 | Admin API + JWT |
| Webhook (Zapier/n8n/Make) | ✅ | 🟡 | Outbound shipped; receive-webhook stub needed |
| Instagram Graph API | 🔴 | 🟡 | Comment Monitor scaffold; needs Meta App Review |
| TikTok Content Posting API | 🔴 | 🔴 | Apply for posting scope |
| YouTube Data API | 🔴 | 🔴 | OAuth + upload + analytics |
| LinkedIn Marketing API | 🔴 | 🔴 | Posts + analytics |
| Facebook Pages API | 🔴 | 🟡 | Comment Monitor scaffold |
| GoHighLevel CRM sync | 🔴 | 🔴 | Custom field push for lead-magnet captures |

## 5. Storage & CDN

| Capability | Status | Notes |
|---|---|---|
| Recording uploads | ✅ | `/api/upload-recording` issues signed URLs to `recordings` Storage bucket |
| Image asset library | ✅ | `generated_images` table + Asset Library |
| Asset CDN (signed URLs) | 🟡 | Storage policies in place; transform API not yet used |
| Backup / export | 🔴 | One-click ZIP export of workspace |
| Soft-delete + 30-day recovery | 🔴 | `deleted_at` columns + admin restore |

## 6. Observability

| Capability | Status | Notes |
|---|---|---|
| Health endpoint | ✅ | `/api/health` reports integration readiness |
| Error monitoring | 🔴 | Sentry (front + serverless) |
| Product analytics | 🔴 | PostHog or Segment |
| Audit log viewer | 🔴 | Admin UI on `audit_log` |
| Usage dashboard (API quota / cost) | 🔴 | Per-workspace token + image spend |
| Status page | 🔴 | StatusPage.io or self-hosted |

## 7. Compliance & Trust

| Capability | Status | Notes |
|---|---|---|
| Terms of Service | ✅ | `/legal` view, all 4 sub-tabs |
| Privacy Policy | ✅ | Includes 10DLC mobile-info disclosure verbatim |
| SMS Terms (A2P 10DLC) | ✅ | STOP/HELP/UNSTOP, frequency, no-share clause |
| Email Terms (CAN-SPAM/CASL/GDPR) | ✅ | List-Unsubscribe-Post one-click |
| Consent log | ✅ | `consent_log` table; logged on opt-in/opt-out |
| One-click unsubscribe | ✅ | `?unsubscribe=` route + RFC 8058 headers |
| Cookie banner (EU) | 🔴 | Required for EU traffic |
| DPA template | 🔴 | For B2B customers — Standard Contractual Clauses |
| SOC 2 Type II | 🔴 | Vanta or Drata; ~6 month process |
| HIPAA BAA | 🔴 | Required for healthcare customers |
| GDPR data deletion endpoint | 🔴 | `/api/data-deletion-request` per Supabase user |
| ISO 27001 | 🔴 | Future |

## 8. Multi-Tenancy & White-Label

| Capability | Status | Notes |
|---|---|---|
| Per-workspace branding (logo, colors) | 🔴 | `workspace_branding` jsonb |
| Custom domain for lead-magnets | 🔴 | Vercel custom domain API + DNS instructions |
| White-label outbound emails | 🔴 | Customer's verified domain via Resend |
| White-label landing pages | 🔴 | `?magnet=` rendered on customer domain |
| Per-tenant Brain Score model | 🔴 | Enterprise SKU — separate model artifact |

## 9. Reliability

| Capability | Status | Notes |
|---|---|---|
| Vercel auto-scale | ✅ | Built in |
| Rate limiting | 🔴 | Upstash Redis or Vercel Edge Config |
| Idempotency keys on writes | 🔴 | Especially `publish-blog` + `send-package` |
| Background job queue | 🟡 | `email_queue` exists; needs cron worker |
| Long-running workflows | 🟡 | Currently sync — push to QStash for >30s |
| Multi-region failover | 🔴 | Future — single region today |

## 10. Developer Platform

| Capability | Status | Notes |
|---|---|---|
| Public REST API | 🔴 | Versioned `/v1/*` namespace + bearer auth |
| OpenAPI spec | 🔴 | Generate from route definitions |
| Webhooks (outbound) | 🔴 | `webhooks` table + delivery worker w/ retries |
| SDKs (JS, Python) | 🔴 | After API stabilizes |
| API docs / dev portal | 🔴 | Mintlify or Scalar |
| Sandbox environment | 🔴 | Separate staging Supabase project |

---

## Prioritized 30-Day Path

Order matters — these are gating dependencies:

1. **Supabase Auth wired into UI** (sign up / log in / forgot password) — blocks billing, blocks RLS
2. **Tighten RLS** to per-workspace — required before any paid customer
3. **Stripe Checkout + Customer Portal** — unlocks revenue
4. **Sentry** — required to debug paying customers
5. **Rate limiting + idempotency** — required before opening API access
6. **Supabase Storage upload for recordings** — finishes the recording loop
7. **Audit log + viewer** — table-stakes for any team plan
8. **YouTube + Instagram OAuth posting** — completes "publish" promise
9. **Stripe usage-metered billing** — turns on the revenue engine for AI-heavy users

Everything else is post-revenue.

---

## Required Environment Variables (Vercel Project Settings)

```
# Live ✅
ANTHROPIC_API_KEY        # AI everywhere
RESEND_API_KEY           # email (default sender)
RESEND_FROM              # e.g. "Supernova Editor <hello@yourdomain.com>"

# Asset stack (set to unlock images / video / music / SFX / GIFs)
IDEOGRAM_API_KEY         # AI image generation
PEXELS_API_KEY           # stock photos + stock video
PIXABAY_API_KEY          # royalty-free music + SFX + video fallback
FREESOUND_API_KEY        # SFX (Creative Commons)
GIPHY_API_KEY            # GIF library
TENOR_API_KEY            # GIF fallback (Google)
UNSPLASH_ACCESS_KEY      # stock photo fallback

# Future capability
DEEPGRAM_API_KEY         # auto-captions on uploaded recordings
ELEVENLABS_API_KEY       # AI voiceover for translations
STRIPE_SECRET_KEY        # billing (when revenue features go live)
STRIPE_WEBHOOK_SECRET    # billing webhook
TWILIO_AUTH_TOKEN        # SMS (A2P 10DLC)
TWILIO_ACCOUNT_SID       # SMS
SENTRY_DSN               # error monitoring
POSTHOG_API_KEY          # product analytics
GHL_PIT                  # GoHighLevel CRM
N8N_WEBHOOK_BASE         # custom workflow webhooks
```

Fetch live status anytime via `GET /api/health`.
