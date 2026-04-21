#!/usr/bin/env bash
# v4.1 health check — runs as Vercel "Ignored Build Step" to gate deploys.
#
# Vercel calls this on every deploy. Exit codes (per Vercel docs):
#   1  → "yes, build" — proceed with deploy
#   0  → "no, skip"   — abort deploy without error
#
# We exit 1 (build) only if every v4.1 marker is intact. If anything is
# missing, we exit 0 to silently skip the deploy — preventing any partial
# or reverted state from reaching production.
#
# Reference commit: 6c6705b (v4.1 baseline restored 2026-04-21).

set -uo pipefail

# Resolve the repo root from wherever Vercel runs us.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

missing=()

# 1. The 5 v4.1 API files must exist and be non-empty.
v41_files=(
  "api/_v41-prompt.js"
  "api/generate-strategy.js"
  "api/generate-strategy-quick.js"
  "api/generate-carousel.js"
  "api/empire-agent-conflict-check.js"
  "supabase-v41-extensions.sql"
)
for f in "${v41_files[@]}"; do
  if [ ! -s "$ROOT/$f" ]; then
    missing+=("file missing or empty: $f")
  fi
done

# 2. index.html must contain key v4.1 markers + the login fix.
if [ -f "$ROOT/index.html" ]; then
  if ! grep -q "MASTER_V41_FULL_PRESET"   "$ROOT/index.html"; then missing+=("index.html: MASTER_V41_FULL_PRESET removed"); fi
  if ! grep -q "MASTER_V41_QUICK_PRESET"  "$ROOT/index.html"; then missing+=("index.html: MASTER_V41_QUICK_PRESET removed"); fi
  if ! grep -q "v4.1 SECTION A"           "$ROOT/index.html"; then missing+=("index.html: v4.1 Section A panel removed"); fi
  if ! grep -q "api.supernovaeditor.com"  "$ROOT/index.html"; then missing+=("index.html: DEFAULT_SB_URL no longer points at api.supernovaeditor.com (login break)"); fi
  if   grep -q "DEFAULT_SB_URL = 'https://ysjjgzxnedlrjlickuze.supabase.co'" "$ROOT/index.html"; then
    missing+=("index.html: DEFAULT_SB_URL reverted to raw Supabase hostname (login break)")
  fi
else
  missing+=("index.html missing entirely")
fi

# 3. vercel.json must keep the maxDuration block.
if [ -f "$ROOT/vercel.json" ]; then
  if ! grep -q "maxDuration" "$ROOT/vercel.json"; then
    missing+=("vercel.json: maxDuration block removed (v4.1 endpoints will hit 60s default)")
  fi
fi

if [ ${#missing[@]} -gt 0 ]; then
  echo ""
  echo "════════════════════════════════════════════════════════════════════"
  echo " ⛔  v4.1 HEALTH CHECK FAILED — Vercel deploy SKIPPED"
  echo "════════════════════════════════════════════════════════════════════"
  echo ""
  for m in "${missing[@]}"; do
    echo "   • $m"
  done
  echo ""
  echo " WHY: This deploy would ship code that's missing the v4.1 Master"
  echo "      Content Prompt system or has the Google OAuth login break."
  echo "      Aborting silently per Vercel ignored-build-step contract."
  echo ""
  echo " HOW TO RECOVER: git pull from main; the v4.1 baseline is in"
  echo " commit 6c6705b. Then re-deploy."
  echo ""
  echo "════════════════════════════════════════════════════════════════════"
  exit 0   # Vercel: skip build
fi

echo "✓ v4.1 health check passed (${#v41_files[@]} files + 5 index.html markers + vercel.json maxDuration intact)"
exit 1   # Vercel: proceed with build
