# Playwright Playbook — Supabase Setup

**Purpose:** drive `supabase.com/dashboard` to do everything the platform needs. The agent reads this file step-by-step, executes each, and screenshots progress. Anything that requires a CAPTCHA or 2FA pauses for a human handoff.

## Inputs the agent needs (ask the user before launching)

| Variable | Where to find it | Required for |
|---|---|---|
| `SUPABASE_EMAIL` | The email you log into supabase.com with | Sign-in step |
| `SUPABASE_PASSWORD` | (or 1Password reference) | Sign-in step |
| `SUPABASE_PROJECT_REF` | URL when viewing your project: `https://supabase.com/dashboard/project/<ref>` | Targeting the right project |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → Credentials → OAuth 2.0 Client IDs | Step 4 (Google sign-in) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same place | Step 4 |
| `APPLE_OAUTH_*` (optional) | Apple Developer → Sign In with Apple | Step 4b |
| `OWN_DOMAIN` (optional) | e.g., `app.raraavismarketing.com` if you want a custom domain on Supabase Auth | Step 5 |

If `GOOGLE_OAUTH_CLIENT_ID` isn't ready, the agent will pause at Step 4 and tell you what to create in Google Cloud Console first.

---

## Steps

### Step 1 — Sign in
1. Navigate to `https://supabase.com/dashboard/sign-in`
2. Type `SUPABASE_EMAIL`, click Continue
3. Type `SUPABASE_PASSWORD`, click Sign In
4. **If 2FA prompt appears**: pause and ask the user to type the code in the agent chat
5. Confirm landing on `https://supabase.com/dashboard/projects`

### Step 2 — Open the right project
1. Click the project named in `SUPABASE_PROJECT_REF` (or search by ref)
2. Confirm we're on `https://supabase.com/dashboard/project/<ref>`

### Step 3 — Run all migrations in SQL Editor (in order)

For each file in this list, in order:
```
supabase-schema.sql
supabase-rls-demo.sql
supabase-strategy-type.sql
supabase-brain-score.sql
supabase-workflows-blog.sql
supabase-auth-referrals.sql
supabase-social-campaigns.sql
supabase-quotas-comments.sql
supabase-storage.sql
supabase-calendar-newsletter.sql
```

For each file:
1. Read the file from local disk (`/Users/laminngobeh/Documents/CLAUDE CODING/BUSINESSES/supernova-editor/<filename>`)
2. Click **SQL Editor** in left sidebar
3. Click **+ New query**
4. Paste contents
5. Click **Run** (Cmd+Enter)
6. Screenshot result
7. Wait for "Success. No rows returned" (or row count)
8. If error: report the error to the user and stop (don't continue subsequent migrations)

**Skip** `supabase-rls-strict.sql` — that's opt-in production hardening and should only run once auth is working end-to-end.

### Step 4 — Configure Auth Providers

Click **Authentication** → **Providers** in left sidebar.

**4a. Email** (should already be enabled by default)
- Confirm "Email" provider is ON
- Confirm "Confirm email" toggle matches what you want (we recommend ON for production)

**4b. Google**
- Click "Google" → toggle ON
- Paste `GOOGLE_OAUTH_CLIENT_ID` into "Client ID"
- Paste `GOOGLE_OAUTH_CLIENT_SECRET` into "Client Secret"
- Note the **Callback URL (for OAuth)** shown at the bottom (looks like `https://<ref>.supabase.co/auth/v1/callback`) — agent saves this to memory for Step 4c
- Click Save

**4c. Tell the user the Google Cloud setup**

The agent now stops and tells the user:
> "I just enabled Google in Supabase. You need to add this exact URL to your Google Cloud OAuth client's **Authorized redirect URIs** before the button works:
> `https://<ref>.supabase.co/auth/v1/callback`
>
> Want me to launch a second Playwright tab to do that in Google Cloud Console too? (I'll need your Google login credentials.)"

**4d. Apple** (only if APPLE_* env provided)
- Same flow as Google.

### Step 5 — URL Configuration

Click **Authentication** → **URL Configuration**.

1. **Site URL**: set to `https://supernova-editor.vercel.app` (no trailing slash). If `OWN_DOMAIN` was provided, use that instead.
2. **Redirect URLs** (comma or newline separated): paste:
   ```
   https://supernova-editor.vercel.app/
   https://supernova-editor.vercel.app/?upgraded=1
   https://supernova-editor.vercel.app/?canceled=1
   http://localhost:3000/
   http://localhost:5173/
   ```
3. Click Save.

This is the missing piece that breaks "Continue with Google" today.

### Step 6 — Capture API Keys

Click **Project Settings** (gear icon) → **API**.

1. Copy **Project URL**
2. Copy **anon public** key
3. Copy **service_role** key (⚠️ secret — handle carefully)

Agent then asks the user:
> "I have the Supabase URL + anon key + service_role key. Want me to push these directly to Vercel (will need Vercel login), or output them so you can paste manually?"

If pushing to Vercel: navigate to `https://vercel.com/dashboard` → project → Settings → Environment Variables, and add:
```
SUPABASE_URL              = (Project URL)
SUPABASE_SERVICE_ROLE_KEY = (service_role key)
PUBLIC_URL                = https://supernova-editor.vercel.app
```
The anon key is set in the app via Settings → Advanced (no env var needed for client-side).

### Step 7 — Storage buckets verify

Click **Storage** in sidebar.

Confirm three buckets exist (created by `supabase-storage.sql`):
- `recordings` (private, 500MB limit)
- `thumbnails` (public, 10MB)
- `assets` (public, 25MB)

If missing, re-run `supabase-storage.sql` from Step 3.

### Step 8 — Final verification

1. Navigate to `https://supernova-editor.vercel.app/api/health` in a new tab
2. Confirm the JSON shows: `supabase_service: {ok: true}` and `anthropic: {ok: true}` minimum
3. Screenshot the response
4. Report `integrations_ready: N/M` back to the user

### Step 9 — Smoke test signup

1. Open incognito tab → `https://supernova-editor.vercel.app/`
2. Click "Launch App"
3. Click "Continue with Google"
4. Complete Google OAuth
5. Confirm landing on `/?view=pricing` step (or dashboard)
6. Screenshot success
7. Open the SQL Editor again, run `SELECT id, email, referral_slug FROM profiles ORDER BY created_at DESC LIMIT 3;`
8. Confirm the new test profile appears with auto-generated slug
9. Report success.

---

## Failure modes the agent should handle

| Error | Action |
|---|---|
| 2FA prompt | Pause, ask user for code in chat |
| CAPTCHA | Pause, ask user to solve manually |
| "Email already exists" on signup test | Skip Step 9 with a note |
| SQL error mid-migration | Stop, report exact error + which file failed, do NOT continue |
| Network timeout | Retry once with 5s wait |
| OAuth redirect mismatch | Re-check Step 5 was completed before Step 9 |

---

## How to launch the agent

Once you have `SUPABASE_EMAIL` + `SUPABASE_PASSWORD` + `SUPABASE_PROJECT_REF` (and ideally `GOOGLE_OAUTH_CLIENT_ID/SECRET`), say something like:

> "Launch the Playwright Supabase setup. Credentials are at `/tmp/supabase-creds.env` (or paste directly)."

Claude will spawn the agent with this playbook + your credentials, run the steps, and report back with screenshots + the final health-endpoint output.
