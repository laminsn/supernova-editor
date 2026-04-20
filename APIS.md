# SUPERNOVA EDITOR — API Inventory

**Last updated:** 2026-04-19. Every Vercel serverless function in `/api/`, what it does, what env vars it needs, and what's still planned.

## Status legend
- ✅ shipped
- 🟡 shipped but needs upstream API key in Vercel env
- 🔴 not built yet

---

## ✅ AI generation (Claude + Ideogram + ElevenLabs + Deepgram)

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/brain-score` | 18-feature heuristic virality scoring | — |
| `/api/edit-script` | Claude rewrite engine (16 presets + freeform + 10-language translate) | `ANTHROPIC_API_KEY` |
| `/api/generate-blog` | Long-form SEO blog (Claude Sonnet 4.5) | `ANTHROPIC_API_KEY` |
| `/api/generate-image` | Ideogram V3 thumbnails / blog hero / carousel | `IDEOGRAM_API_KEY` |
| `/api/run-workflow` | Orchestrates 6 chained AI workflows | `ANTHROPIC_API_KEY` |
| `/api/synthesize` | ElevenLabs TTS voiceover (8 voices, 29 languages) | `ELEVENLABS_API_KEY` |
| `/api/translate` | Parallel batch translation (Claude, up to 10 langs) | `ANTHROPIC_API_KEY` |
| `/api/transcribe` | Deepgram Nova-2 transcription → text + WebVTT | `DEEPGRAM_API_KEY` |

## ✅ Asset library (proxies hidden from users)

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/asset-library` | Unified search across Pexels / Pixabay / Freesound / GIPHY / Tenor / Unsplash | At least one of: `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `FREESOUND_API_KEY`, `GIPHY_API_KEY`, `TENOR_API_KEY`, `UNSPLASH_ACCESS_KEY` |

## ✅ Recording + media

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/upload-recording` | Issues Supabase Storage signed URL for `recordings` bucket | — |
| `/api/livestream-create` | Multi-platform simulcast session (Restream.io + manual RTMP fallback) | `RESTREAM_TOKEN` (optional) |

## ✅ Email + lifecycle

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/send-strategy` | Email a strategy draft via Resend | `RESEND_API_KEY` |
| `/api/send-package` | Send turnkey collaborator package | `RESEND_API_KEY` |
| `/api/send-referral` | Personal referral invite (with attribution slug) | `RESEND_API_KEY` |
| `/api/send-campaign` | Bulk marketing campaign (up to 5000 recipients, List-Unsubscribe headers) | `RESEND_API_KEY` |
| `/api/welcome-sequence` | 5-email onboarding drip | `RESEND_API_KEY` |
| `/api/log-engagement` | Webhook for engagement metrics → Brain Score training | — |

## ✅ Auth + billing

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/create-checkout` | Stripe Checkout session for plan upgrade | `STRIPE_SECRET_KEY` + price IDs |
| `/api/stripe-portal` | Stripe Customer Portal session (self-service billing) | `STRIPE_SECRET_KEY` |
| `/api/stripe-webhook` | Subscription lifecycle sync to `subscriptions` + `profiles.plan` | `STRIPE_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` |
| `/api/referral-conversion` | Marks referral converted, credits referrer, sends "your friend signed up" email | `RESEND_API_KEY` |

## ✅ Social posting + moderation (per-platform OAuth + Comment Monitor)

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/social-connect` | Returns OAuth authorize URL for Google/Meta/TikTok/LinkedIn/X | per-platform `_CLIENT_ID` |
| `/api/social-callback` | OAuth code → tokens → persist to `social_connections` | per-platform `_CLIENT_SECRET` |
| `/api/social-post` | Unified post to YouTube + Instagram + Facebook + TikTok + LinkedIn + X | OAuth tokens |
| `/api/comments-fetch` | Fetch real comments via OAuth tokens (FB/IG/YT/LinkedIn) | OAuth tokens |
| `/api/comments-moderate` | Hide / delete / reply on the native platform | OAuth tokens |
| `/api/comments-evaluate` | Claude sentiment + intent classifier + rule engine + auto-apply | `ANTHROPIC_API_KEY` |

## ✅ Quotas

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/usage-check` | Pre-flight quota check + atomic increment per `usage_metric` per month | — |

## ✅ Blog publishing (hybrid)

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/publish-blog` | Native publish to WordPress (REST API), Ghost (Admin API + JWT), or generic webhook | — (per-user creds) |

## ✅ Calendar + Newsletter (NEW — replaces GHL + Calendly)

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/calendar-availability` | Compute open booking slots for a calendar slug | — |
| `/api/calendar-book` | Create booking + send Resend confirmation + ICS attachment | `RESEND_API_KEY` |
| `/api/calendar-cancel` | Token-based cancel + reschedule (no auth needed by attendee) | — |
| `/api/newsletter-subscribe` | Public opt-in (with double opt-in confirmation email) | `RESEND_API_KEY` |

## ✅ Health

| Endpoint | Purpose | Env needed |
|---|---|---|
| `/api/health` | Reports `integrations_ready: N/M` — which env keys are present | — |

---

# 🔴 Planned APIs (not yet built)

## Reliability + ops
- 🔴 `/api/cron-reminders` — Vercel Cron job: query `bookings` for ones starting in 1h or 24h, send reminder emails. Also: drain `email_queue` for scheduled welcome-sequence emails.
- 🔴 `/api/cron-quota-reset` — first of each month, archive previous period's `usage_metrics` rows.
- 🔴 `/api/audit-log` — append-only writer for sensitive operations (plan changes, social-account deletions, mass-email sends).

## Calendar v2
- 🔴 `/api/calendar-google-sync` — connect a Google Calendar via OAuth so external events block availability.
- 🔴 `/api/calendar-outlook-sync` — same for Outlook/Office 365.
- 🔴 `/api/booking-host-notification` — when an attendee books, post to host's Slack/Telegram/email.

## Comment Monitor v2
- 🔴 `/api/comments-watch` — periodic background fetch (Vercel Cron) so users don't have to click Refresh.
- 🔴 `/api/comments-thread` — fetch nested replies for a parent comment (currently flat).

## Subscribers / segmentation
- 🔴 `/api/segments-build` — Claude-powered segmentation: "everyone who clicked product launch but didn't convert" → return list_id.
- 🔴 `/api/import-csv` — bulk subscriber import with double-opt-in option.

## Workspaces + teams
- 🔴 `/api/workspace-invite` — send team-member invite with role assignment.
- 🔴 `/api/workspace-switch` — change `profile.workspace_id` (multi-workspace support).

## Realtime
- 🔴 `/api/realtime-presence` — who's currently editing what (Supabase Realtime channel proxy).

## Analytics
- 🔴 `/api/analytics-snapshot` — daily roll-up of strategies + brain scores + engagement → `daily_metrics` for the Dashboard sparkline.

## Payments OUT (when you sell to your customers)
- 🔴 `/api/connect-stripe-account` — for users who want to take payments through Supernova (Stripe Connect Express).
- 🔴 `/api/payout-schedule` — affiliate / referral payout for Pro+ users who refer.

## Asset library v2
- 🔴 `/api/asset-upload` — let users upload their own brand assets to the `assets` bucket and search across both stock + own.
- 🔴 `/api/asset-tagging` — auto-tag uploaded assets with Claude (people, scene, color palette).

## Mobile
- 🔴 `/api/mobile-token-exchange` — issue JWT for the planned iOS/Android apps.
