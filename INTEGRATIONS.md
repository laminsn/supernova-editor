# SUPERNOVA EDITOR — Integration Philosophy

> **Why almost nothing requires user setup.**

## The 30-second version

Most content tools force you to wire up 12 different APIs before you can do anything. Supernova flips it: **the platform absorbs the integrations**. You get one bill, one login, and a working creator stack on day one.

The only things you *might* connect are **communication channels you already use** (custom email domain, Slack, Telegram, WhatsApp). Everything else — AI, image generation, stock libraries, transcription — runs on the master account.

---

## What we handle for you (zero setup)

| Capability | Provider | Why it's bundled |
|---|---|---|
| Strategy + script + blog generation | Anthropic Claude Sonnet 4.5 | Provider keys would just be friction |
| Image generation (thumbnails, blog hero, carousel) | Ideogram V3 | One model, consistent style |
| Stock photos + stock video | Pexels (+ Unsplash fallback) | Free, commercial OK, no attribution |
| Royalty-free music | Pixabay Music + curated Mixkit | Free, commercial OK |
| Sound effects | Freesound (+ Pixabay SFX fallback) | Creative Commons |
| GIFs | GIPHY (+ Tenor fallback) | The standard pair |
| Email delivery (default) | Resend | One-click works out of the box |
| Auto-captions | Deepgram | (when you upload a recording) |
| AI voiceover for translations | ElevenLabs | (multi-language assets) |
| Brain Score model | Custom (heuristic v0 → trained v1+) | Self-improving on your data |
| Workflow orchestration | Built-in via `/api/run-workflow` | No need for Zapier |

You will see all of these as **● Live** badges in Settings → Integrations once the keys are in the Vercel environment.

---

## What you might want to connect (optional)

These aren't required — they make Supernova fit into the channels **you already live in**.

### 📧 Custom Email Sender
Default: emails go from a Supernova-branded address (still 100% deliverable + compliant).
Connect: your verified domain via Resend so emails come *from you*. Looks more professional for client work.

### 💬 Slack
Pipe content alerts (new strategy generated, brain score below threshold, collaborator posted) into a Slack channel. One incoming-webhook URL, done.

### ✈️ Telegram
Approve content from your phone. Get topic ideas pushed to a Telegram bot. Works great if you're already an active Telegram user.

### 🟢 WhatsApp Business
If your audience or collaborators live on WhatsApp, you can send packages and receive responses through WhatsApp Business. Optional Twilio backend.

**That's the entire user-facing integration list.** Four channels. None required.

---

## What we deliberately *don't* ask you to set up

| | Why not |
|---|---|
| Anthropic / OpenAI API key | We pay for the AI — included in subscription |
| Ideogram API key | Same reason — bundled |
| Pexels / Pixabay / Freesound / GIPHY keys | Bundled. You shouldn't have to sign up for 5 stock libraries to make a video |
| Stripe (for payments *to* us) | We bill you directly |
| Any analytics or error monitoring | We monitor reliability, you watch results |

---

## The exceptions: when *you* are the merchant

If you use Supernova to **sell to your own customers** (not just create content), then yes — you'll connect:
- **Stripe** (Pro+ plans, when we add the in-app store feature) — to take their payments into *your* account
- **Your own SMTP / SendGrid** (Enterprise) — when you want full sender-reputation control
- **YouTube / Instagram / TikTok / LinkedIn / Facebook OAuth** — required for auto-posting

These are revenue or distribution gates, not basic-feature gates. You won't hit them on day one.

---

## Asset library deep-dive

Inside the app, hit **Asset Library** in the sidebar. You'll see five tabs:

- **🖼️ Stock Photos** — Pexels first, Unsplash fallback. Filter by orientation. Free for commercial use, no attribution required (Pexels) or appreciated (Unsplash).
- **🎬 Stock Video** — Pexels Video first, Pixabay fallback. HD downloads with duration + author info.
- **🎵 Music** — Pixabay Music + a curated Mixkit shortlist that always works even with no API key. Search by genre, tag, mood.
- **🔊 Sound Effects** — Freesound (Creative Commons) + Pixabay SFX. For transitions, impacts, notifications, risers.
- **✨ GIFs** — GIPHY first, Tenor fallback. Reactions, celebrations, accents.

You can also pop the library inside the **Editor** as a side drawer for quick drag-in.

Auto-Edit pulls from the same library: enable "Add Beat-Synced Music" in the Auto-Edit panel and we'll fetch a cinematic-uplift track and time the cuts to it. (Captions need Deepgram + a recording upload — that's the next thing on the roadmap.)

---

## Required Vercel environment variables

Set these once in the Vercel project. Users never touch them.

```
# Already live ✅
ANTHROPIC_API_KEY        # AI everywhere
RESEND_API_KEY           # email
RESEND_FROM              # default sender, e.g. "Supernova Editor <hello@yourdomain.com>"

# To unlock images + video + audio + GIFs
IDEOGRAM_API_KEY         # AI image gen (thumbnails, blog hero, carousel)
PEXELS_API_KEY           # stock photos + video (free key from pexels.com/api)
PIXABAY_API_KEY          # music + SFX + video fallback (free key from pixabay.com/api/docs)
FREESOUND_API_KEY        # SFX (free OAuth from freesound.org/apiv2/)
GIPHY_API_KEY            # GIFs (free key from developers.giphy.com)
TENOR_API_KEY            # GIF fallback (free Google Cloud key)
UNSPLASH_ACCESS_KEY      # stock photo fallback

# Future capability
DEEPGRAM_API_KEY         # auto-captions on uploaded recordings
ELEVENLABS_API_KEY       # AI voiceover for translations
STRIPE_SECRET_KEY        # billing (when revenue features go live)
TWILIO_AUTH_TOKEN        # SMS (A2P 10DLC)
SENTRY_DSN               # error monitoring
POSTHOG_API_KEY          # product analytics
```

Live status anytime: `GET /api/health` → `{integrations_ready: "11/18", ...}`

---

## Setting up Google ("Gmail") OAuth — exact steps

The "Continue with Google" button on the sign-up modal silently does nothing if any of these three pieces are missing. Do all three:

### 1. Create Google OAuth credentials
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create or select a project.
2. **APIs & Services → OAuth consent screen** → External → fill in app name, support email, logo. Add scopes: `email`, `profile`, `openid`.
3. **APIs & Services → Credentials** → Create credentials → OAuth client ID → **Web application**.
4. Authorized JavaScript origins: `https://supernova-editor.vercel.app` (and `http://localhost:3000` for dev).
5. **Authorized redirect URIs**: paste **`https://<your-project>.supabase.co/auth/v1/callback`** — this is Supabase's hosted callback, NOT our Vercel domain. You can find it in Supabase Dashboard → Authentication → Providers → Google → "Callback URL (for OAuth)".
6. Save → copy the Client ID + Client Secret.

### 2. Enable Google in Supabase
1. Supabase Dashboard → **Authentication → Providers → Google** → toggle ON.
2. Paste the Client ID + Client Secret from step 1.6 → Save.

### 3. Set Site URL + redirect allow-list
Supabase Dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://supernova-editor.vercel.app` (no trailing slash)
- **Redirect URLs** (comma-separated): `https://supernova-editor.vercel.app/, http://localhost:3000/, http://localhost:5173/`

After all three are saved, the Continue with Google button will land you on the Google consent screen → redirect back to the app signed in. If misconfigured, the app now surfaces the actual error (e.g., `provider_not_found`, `redirect_uri_mismatch`) as a toast instead of silently failing.

### Apple sign-in — same idea
1. [developer.apple.com](https://developer.apple.com) → Certificates → Sign In with Apple → create Service ID, configure return URL = Supabase callback.
2. Generate the JWT secret (10-min expiry rotation needed — Supabase has a built-in helper).
3. Supabase Dashboard → Authentication → Providers → Apple → toggle ON, paste Service ID + Team ID + Key ID + Private Key.

---

## TL;DR for the user

> "What do I need to set up before I can use Supernova?"
>
> **Nothing.** Sign up, type a topic, ship.
>
> When you want emails from your own domain or notifications in your own Slack/Telegram, take 30 seconds in Settings → Integrations.
