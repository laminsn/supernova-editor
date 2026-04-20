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
| Stripe subscriptions | ✅ | `/api/create-checkout` + `/api/stripe-webhook` (sync to subscriptions/profiles/plan_events) |
| Plan upgrade / downgrade (self-service) | ✅ | `/api/stripe-portal` → Customer Portal link from user dropdown |
| Usage metering (strategies/mo, blog posts/mo) | 🔴 | Counters per workspace; soft-throttle on free tier |
| Annual billing (20% off) | ✅ | PlanPicker has month/year toggle; price ID env vars |
| Tax handling | 🟡 | Enable Stripe Tax in Dashboard — no code changes needed |
| Invoicing | ✅ | Stripe-hosted invoices via Customer Portal |
| Refunds / dunning | ✅ | Webhook handles `invoice.payment_failed` → marks past_due |

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
| AI voice-over (multilingual) | ✅ | `/api/synthesize` | ElevenLabs (8 voices, 29 languages, Storage upload) |
| Live stream simulcast | ✅ | `/api/livestream-create` | Restream.io (with manual RTMP fallback) |
| Brain Score v1 (trained) | 🔴 | After 500 labeled pairs | XGBoost on `training_pairs` view |
| Multi-modal Brain Score v2 | 🔴 | After 5K pairs | CLIP + Whisper embeddings |

## 4. Channel Integrations

| Channel | Outbound | Inbound | Notes |
|---|---|---|---|
| Email (transactional) | ✅ Resend | n/a | strategy, packages, welcome sequence, lead magnet, referral |
| Email (marketing campaigns) | ✅ | n/a | EmailCampaignsView (8 templates) + `/api/send-campaign` (List-Unsubscribe headers) + per-recipient tracking |
| SMS / A2P 10DLC | 🟡 | 🔴 | Opt-in flow + consent_log shipped; Twilio send not yet wired |
| WordPress publish | ✅ | 🔴 | REST API + App Password |
| Ghost publish | ✅ | 🔴 | Admin API + JWT |
| Webhook (Zapier/n8n/Make) | ✅ | 🟡 | Outbound shipped; receive-webhook stub needed |
| YouTube auto-post | ✅ | 🔴 | OAuth + Data API v3 resumable upload (`/api/social-post`) |
| Instagram Graph API | ✅ | 🟡 | Reels container + publish (`/api/social-post`); Comment Monitor scaffold |
| TikTok Content Posting | ✅ | 🔴 | Direct Post API + PULL_FROM_URL (approval required by TikTok) |
| Facebook Pages API | ✅ | 🟡 | Page video + photo posts; Comment Monitor scaffold |
| LinkedIn Marketing API | ✅ | 🔴 | UGC Posts (text/image; video upload coming) |
| X (Twitter) API v2 | ✅ | 🔴 | Tweets via OAuth 2.0 + write scope |
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
| Health endpoint | ✅ | `/api/health` reports integration readiness (18 providers) |
| Error monitoring | ✅ | Sentry CDN auto-loads when `window.SUPERNOVA_SENTRY_DSN` is set; replays on error |
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

# Live capability (set when ready)
DEEPGRAM_API_KEY                # auto-captions on uploaded recordings
ELEVENLABS_API_KEY              # AI voiceover (8 voices, 29 languages)
RESTREAM_TOKEN                  # multi-platform live simulcast

# Billing
STRIPE_SECRET_KEY               # plan checkout + portal
STRIPE_WEBHOOK_SECRET           # subscription event sync
STRIPE_PRICE_CREATOR_MONTH      # $19/mo
STRIPE_PRICE_CREATOR_YEAR       # ($19 × 12 × 0.8)
STRIPE_PRICE_PRO_MONTH          # $49/mo
STRIPE_PRICE_PRO_YEAR
SUPABASE_URL                    # used by stripe-webhook for service-role writes
SUPABASE_SERVICE_ROLE_KEY       # required for webhooks + OAuth callback writes

# Social posting (per-platform OAuth — each requires a developer app)
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET                # YouTube
META_CLIENT_ID, META_CLIENT_SECRET                    # Instagram + Facebook
TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET               # TikTok
LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET            # LinkedIn
TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET              # X (Twitter)
SOCIAL_REDIRECT_URI             # default: https://your-domain/api/social-callback

# SMS + monitoring + analytics + integrations
TWILIO_AUTH_TOKEN, TWILIO_ACCOUNT_SID                 # A2P 10DLC SMS
SENTRY_DSN                      # error monitoring (set window.SUPERNOVA_SENTRY_DSN at build time)
POSTHOG_API_KEY                 # product analytics
GHL_PIT                         # GoHighLevel CRM
N8N_WEBHOOK_BASE                # custom workflow webhooks
```

Fetch live status anytime via `GET /api/health`.
