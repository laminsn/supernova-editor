# SUPERNOVA EDITOR — Infrastructure Audit

**Last updated:** 2026-04-19 · After we cancelled GHL and built native calendar + newsletter primitives.

The point of this doc: **a single inventory of every cloud service Supernova depends on, what's registered, what's missing, and what Playwright can automate so you don't have to click through dashboards.**

## Status legend
- ✅ **Registered + working**
- 🟡 **Registered but needs config (env var, OAuth scope, domain verification, etc.)**
- 🔴 **Not registered yet**
- ⛔ **Cancelled / removed**

---

## Core (required for the platform to function)

| Service | Status | What you need | Playwright automate? |
|---|---|---|---|
| **GitHub** (`laminsn/supernova-editor`) | ✅ | Connected; pushes to `main` auto-deploy via Vercel | n/a |
| **Vercel** | ✅ | Project connected; latest commit `f70564b` deployed | Use `vercel link` + `vercel env add` CLI; Playwright not needed |
| **Supabase** | 🟡 | Project exists. **All migration SQLs need to be re-run** (see "Pending Migrations" below). Auth providers not yet configured. | Yes — Playwright can configure Auth providers |
| **Resend** | 🟡 | API key set; **default sender domain is still `onboarding@resend.dev`**. Need a custom domain verified | Yes — Playwright can do DNS verification flow |
| **Anthropic (Claude)** | ✅ | API key set; powers all AI features | n/a |

## Optional but enabled (already wired)

| Service | Status | Notes |
|---|---|---|
| **Stripe** | 🟡 | Code complete (`/api/create-checkout`, `/api/stripe-webhook`, `/api/stripe-portal`). Needs: products + prices created in Stripe Dashboard → env vars (`STRIPE_PRICE_CREATOR_MONTH`, etc.) → webhook endpoint registered |
| **Ideogram V3** | 🟡 | API key needed for thumbnails + blog images |
| **Pexels** | 🟡 | Free key (1 minute signup) for stock photos + video |
| **Pixabay** | 🟡 | Free key for music + SFX |
| **Freesound** | 🟡 | Free OAuth for SFX |
| **GIPHY** | 🟡 | Free key for GIFs |
| **Tenor** | 🟡 | Google Cloud free key for GIF fallback |
| **Unsplash** | 🟡 | Free key for image fallback |
| **Deepgram** | 🟡 | API key for auto-captions/transcription |
| **ElevenLabs** | 🟡 | API key for AI voiceover |
| **Restream.io** | 🟡 | API token for multi-platform live simulcast (free tier exists) |

## Social posting OAuth (per-platform developer apps)

Each requires creating a dev app on the platform's portal:

| Platform | Status | Time to set up | Playwright automate? |
|---|---|---|---|
| **Google** (YouTube + Sign-in) | 🔴 | 30 min — Google Cloud Console → OAuth client → enable YouTube Data API v3 | Yes |
| **Meta** (Facebook + Instagram) | 🔴 | 1-2 hours — Facebook Developers → app → Instagram Graph API → submit for review (~2 weeks) | Partial |
| **TikTok** | 🔴 | Submit for `video.publish` scope (~1-4 weeks) | No (manual review) |
| **LinkedIn** | 🔴 | Request `w_member_social` product (~1 week) | Partial |
| **X (Twitter)** | 🔴 | Free tier OAuth 2.0 app → enable PKCE | Yes |

## Cancelled / removed

| Service | Status | Replaced by |
|---|---|---|
| **GoHighLevel (GHL)** | ⛔ | Cancelled 2026-04-19. Replaced by native: `bookings` table + Calendar view + `newsletter_lists` + `subscribers` |
| **Calendly** | ⛔ | Replaced by `/api/calendar-availability` + `/api/calendar-book` + `CalendarBookingView` |

## Pending Migrations (run in Supabase SQL Editor, in order)

Run these once. They are idempotent (safe to re-run).

```
1. supabase-schema.sql                       # original content + workspaces
2. supabase-rls-demo.sql                     # permissive demo policies
3. supabase-strategy-type.sql                # adds 'strategy' to type enum
4. supabase-brain-score.sql                  # brain_predictions + engagement_data
5. supabase-workflows-blog.sql               # workflow_runs + blog_posts + workspace_settings
6. supabase-auth-referrals.sql               # profiles + referrals + subscriptions + plan_events
7. supabase-social-campaigns.sql             # social_connections + social_posts + email_campaigns + campaign_recipients + subscribers
8. supabase-quotas-comments.sql              # usage_metrics + comments + comment_rules
9. supabase-storage.sql                      # recordings + thumbnails + assets buckets + recordings table
10. supabase-calendar-newsletter.sql         # NEW: calendars + bookings + newsletter_lists
11. supabase-rls-strict.sql                  # OPTIONAL — switches from permissive to per-workspace RLS (for production)
```

After running all 10 (skip 11 until ready for production multi-tenant), `/api/health` should jump significantly.

## Required Env Vars (Vercel project settings)

Tier 1 — **must have** for core functionality:
```
ANTHROPIC_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM           ("Supernova <hello@yourdomain.com>" once domain verified)
PUBLIC_URL            https://supernova-editor.vercel.app
```

Tier 2 — **enable individual features**:
```
IDEOGRAM_API_KEY
PEXELS_API_KEY  PIXABAY_API_KEY  FREESOUND_API_KEY  GIPHY_API_KEY  TENOR_API_KEY  UNSPLASH_ACCESS_KEY
DEEPGRAM_API_KEY  ELEVENLABS_API_KEY
RESTREAM_TOKEN
STRIPE_SECRET_KEY  STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_CREATOR_MONTH  STRIPE_PRICE_CREATOR_YEAR  STRIPE_PRICE_PRO_MONTH  STRIPE_PRICE_PRO_YEAR
```

Tier 3 — **social posting** (set per-platform when you finish each app registration):
```
GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET
META_CLIENT_ID  META_CLIENT_SECRET
TIKTOK_CLIENT_KEY  TIKTOK_CLIENT_SECRET
LINKEDIN_CLIENT_ID  LINKEDIN_CLIENT_SECRET
TWITTER_CLIENT_ID  TWITTER_CLIENT_SECRET
SOCIAL_REDIRECT_URI=https://supernova-editor.vercel.app/api/social-callback
```

Tier 4 — **monitoring + ops**:
```
SENTRY_DSN  (or window.SUPERNOVA_SENTRY_DSN at build time)
POSTHOG_API_KEY
SUPERNOVA_SALES_CALENDAR_SLUG  (your own native calendar's slug for the enterprise sales flow)
SUPERNOVA_SALES_WEBHOOK        (n8n / Make / Zapier inbound for new enterprise leads)
```

---

## What Playwright can automate (no manual clicking)

If you want, I can spawn a Playwright agent to do these. Each one needs you to provide the credentials (email + password for the relevant service) **once** in chat or via a `.env.local` file.

| Task | Service | What Playwright does |
|---|---|---|
| Add env vars to Vercel | Vercel | Log in → project → Settings → Environment Variables → add each `KEY=value` row |
| Verify Resend domain | Resend | Add domain → grab the DNS records → (you add to your DNS host) → click verify |
| Configure Supabase Auth providers | Supabase Dashboard | Enable Google + Apple + email/password, paste OAuth client IDs |
| Add Supabase redirect URLs | Supabase Dashboard | Site URL + redirect allowlist (the missing piece that breaks Google OAuth today) |
| Create Stripe products + prices | Stripe Dashboard | Create 4 products (Creator monthly, Creator yearly, Pro monthly, Pro yearly), copy price IDs |
| Register Stripe webhook | Stripe Dashboard | Add endpoint `/api/stripe-webhook` with the 6 event types we listen for, copy signing secret |
| Sign up for Pexels / Pixabay / Freesound / GIPHY / Tenor / Unsplash | Each | Account creation → grab API key → save |
| Sign up for Deepgram | Deepgram | Account → API key → set in Vercel env |
| Sign up for ElevenLabs | ElevenLabs | Account → API key |
| Create Google Cloud OAuth credentials | Google Cloud Console | New project → enable APIs → OAuth consent screen → Web client → set redirects |
| Create Meta Developers app | developers.facebook.com | New app → Instagram Graph API → set redirect URI |
| Create TikTok Developer app | developers.tiktok.com | New app → Login Kit + Content Posting → request scopes |

What Playwright **cannot** automate: anything that requires SMS verification, Apple Developer account creation (CAPTCHA + phone), or external developer-app review queues.

---

## Cleanup checklist after GHL cancellation

Done in this commit:
- [x] Replaced Calendly iframe in `SalesContactForm` with native `CalendarBookingView`
- [x] Built `bookings`, `calendars`, `calendar_availability`, `calendar_overrides`, `newsletter_lists` tables
- [x] Built `/api/calendar-availability`, `/api/calendar-book`, `/api/calendar-cancel`, `/api/newsletter-subscribe`
- [x] Built `CalendarSettingsView` (sidebar nav: Calendar)
- [x] Built `CalendarBookingView` (rendered when `?book=<slug>` in URL)
- [x] Built `NewsletterSignupForm` (mounted on landing page above final CTA)

Still on the GHL replacement to-do list:
- [ ] Booking reminder cron (24h before + 1h before — needs Vercel Cron or QStash)
- [ ] Calendar sync to Google Calendar / Outlook (export ICS works today; live sync needs OAuth)
- [ ] Multi-host calendars (round-robin assignment for sales teams)
- [ ] Group bookings (multiple invitees per slot)
- [ ] Native SMS reminders (needs Twilio wiring — schema is ready)
