# SUPERNOVA EDITOR — Deployment Guide

Get from local file to live, multi-user app in 15 minutes.

## Prerequisites

- A GitHub account
- A Supabase account (free tier works) → [supabase.com](https://supabase.com)
- A Vercel account (free tier works) → [vercel.com](https://vercel.com)

## Step 1: Push to GitHub (3 min)

From this directory, run:

```bash
cd "/Users/laminngobeh/Documents/CLAUDE CODING/BUSINESSES/empire-leadership"

# Initialize git (if not already done)
git init
git add empire-os.html supabase-schema.sql vercel.json package.json .gitignore README-DEPLOY.md
git commit -m "feat: SUPERNOVA EDITOR initial commit"

# Create the repo on GitHub via gh CLI
gh repo create supernova-editor --public --source=. --remote=origin --push

# OR manually:
# 1. Go to https://github.com/new
# 2. Name it "supernova-editor"
# 3. Run: git remote add origin https://github.com/YOUR_USERNAME/supernova-editor.git
# 4. Run: git push -u origin main
```

## Step 2: Set Up Supabase (5 min)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **"New Project"**
   - Name: `supernova-editor`
   - Database password: (generate strong, save to password manager)
   - Region: closest to you (US East for east coast, etc.)
   - Plan: Free
3. Wait ~2 min for project to provision
4. Go to **SQL Editor** (left sidebar)
5. Click **"New Query"**
6. Open `supabase-schema.sql` from this folder, copy ALL contents, paste into the SQL editor
7. Click **"Run"** (bottom right) — should show "Success. No rows returned."
8. Go to **Settings → API** (left sidebar)
9. Copy these two values (you'll paste them into the app):
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public key** (starts with `eyJ...`, safe for client-side)

## Step 3: Deploy to Vercel (5 min)

### Option A: One-Click via Vercel Dashboard

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **"Import Git Repository"**
3. Find and select your `supernova-editor` repo
4. Framework Preset: **Other** (it auto-detects vercel.json)
5. Build Command: leave empty
6. Output Directory: leave empty (root)
7. Click **"Deploy"**
8. Wait ~30 seconds — get your live URL (e.g., `supernova-editor.vercel.app`)

### Option B: Vercel CLI

```bash
npm install -g vercel
cd "/Users/laminngobeh/Documents/CLAUDE CODING/BUSINESSES/empire-leadership"
vercel --prod
```

## Step 4: Connect Frontend to Supabase (2 min)

1. Open your live app URL
2. Click **"Launch App"** → **"Settings"** → **"Integrations"** tab
3. Paste your **Supabase URL** into the "Supabase URL" field
4. Paste your **anon key** into the "Supabase Anon Key" field
5. Click **"Test All Connections"**
6. Should see: ✓ "Supabase connected! Backend is now LIVE."

The app stores credentials in localStorage and auto-connects on every visit.

## Step 5: Create Your First User Account

The app uses Supabase Auth. To enable sign-up:

1. In Supabase dashboard → **Authentication → Providers**
2. **Email** is enabled by default
3. (Optional) Disable email confirmations for faster testing: **Authentication → Settings → Email Auth → Confirm Email = OFF**
4. To add Google OAuth: **Providers → Google → Enable** (requires Google Cloud OAuth credentials)

Sign-up flow is wired to `SupabaseClient.signUp(email, password)` in the app.

## Step 6: Custom Domain (Optional)

In Vercel dashboard → your project → **Settings → Domains**:

1. Add your domain (e.g., `supernova.app`)
2. Update your DNS at your registrar:
   - Add a `CNAME` record pointing to `cname.vercel-dns.com`
3. Wait ~5 min for DNS propagation

## Architecture Overview

```
┌─────────────────────────────────┐
│   Vercel (CDN + Edge)           │
│   - empire-os.html              │
│   - vercel.json (routing)       │
└─────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│   Supabase (Backend)            │
│   - Postgres database           │
│   - Auth (Email/OAuth)          │
│   - Row Level Security (RLS)    │
│   - Storage (for media files)   │
└─────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│   Tables                        │
│   - workspaces                  │
│   - profiles (extends auth)     │
│   - content                     │
│   - collaborators               │
│   - campaigns                   │
│   - packages                    │
│   - activity_log                │
└─────────────────────────────────┘
```

## Auto-Deploy on Push

Every `git push` to `main` auto-deploys to Vercel. No manual steps needed.

```bash
# Make a change
edit empire-os.html

# Push
git add empire-os.html
git commit -m "feat: new feature"
git push

# Vercel deploys automatically. Check: https://vercel.com/dashboard
```

## What's Already Wired

✓ Supabase JS SDK loaded via CDN
✓ `SupabaseClient` wrapper with `.fetch()`, `.insert()`, `.update()`, `.signIn()`, `.signUp()`
✓ Auto-init from localStorage on page load
✓ Settings UI captures Supabase URL + anon key
✓ Schema includes RLS for multi-tenant security
✓ Auto-create profile trigger on user signup
✓ vercel.json with security headers + clean URLs

## What's Next (Optional Enhancements)

- **Storage buckets** for media uploads (Supabase Storage)
- **Edge Functions** for AI calls (Anthropic, Ideogram) to keep API keys server-side
- **Realtime subscriptions** for live collaboration
- **Stripe integration** for billing
- **Webhooks** for n8n automation triggers

## Troubleshooting

**"Supabase init failed"** → Double-check URL has `https://` and `.supabase.co`. Anon key should start with `eyJ`.

**Vercel deploy failed** → Check vercel.json is valid JSON. Try `vercel --prod --debug`.

**RLS blocks queries** → Make sure your user's profile row has the correct `workspace_id`. Check Supabase logs.

**CORS errors** → Should not happen with Supabase's built-in CORS. If it does, check Supabase project URL is exactly right.

---

Built by Lamin S. Ngobeh — Rara Avis Marketing LLC — @LaminSNgobeh
