# Supernova Editor — v4.1 Protection Layers

**Installed:** 2026-04-21 after a parallel Claude session deleted the
v4.1 Master Content Prompt work (it was untracked in git, so any
`git stash` / `git clean -fd` / branch switch wiped it silently).
Restoring took ~2 hours.

This document is the operator's reference for the 5 layers of protection
that now stand between v4.1 and accidental destruction.

---

## TL;DR — what each layer stops

| # | Layer | Stops | Where it lives |
|---|---|---|---|
| 1 | Git commit + GitHub remote | Untracked-file deletion | `git log` (commit `6c6705b` baseline) |
| 2 | Local pre-commit hook | Local commits that silently delete v4.1 | [.git/hooks/pre-commit](./.git/hooks/pre-commit) |
| 3 | Claude Code session guard | Other sessions running `rm api/_v41-*`, `git reset --hard`, `git clean -fd`, force-push, etc. | [`~/.claude/hooks/supernova-v41-guard.sh`](../../../../.claude/hooks/supernova-v41-guard.sh) wired into `~/.claude/settings.json` |
| 4 | GitHub branch protection | Force-push, deletion, non-linear history on `main` | GitHub API rule (set via `gh api`) |
| 5 | Vercel deploy-time health check | Any deploy missing v4.1 markers (CLI or git-triggered) | [`scripts/v41-health-check.sh`](./scripts/v41-health-check.sh) wired via `vercel.json` `ignoreCommand` |

---

## How the layers compose

```
                       ┌─────────────────────────┐
                       │  Edit v4.1 file locally │
                       └────────────┬────────────┘
                                    │
                                    ▼
        ┌──────────────────────────────────────────────────┐
        │ Layer 3: Claude Code session guard               │
        │   bash command pattern-match → block destructive │
        │   ops in supernova-editor (rm, reset --hard,     │
        │   clean -fd, force-push, etc.) unless            │
        │   SUPERNOVA_OVERRIDE=1 is set                    │
        └────────────────────┬─────────────────────────────┘
                             │ (allowed bash op)
                             ▼
        ┌──────────────────────────────────────────────────┐
        │ Layer 2: .git/hooks/pre-commit                   │
        │   refuses commits that delete v4.1 files OR      │
        │   strip MASTER_V41 markers from index.html OR    │
        │   revert DEFAULT_SB_URL to raw Supabase host     │
        │   (bypass: include [remove-v41] in commit msg)   │
        └────────────────────┬─────────────────────────────┘
                             │ (allowed commit)
                             ▼
        ┌──────────────────────────────────────────────────┐
        │ Layer 1: git commit + push origin main           │
        │   v4.1 work lives in remote history; future      │
        │   sessions can recover via git pull              │
        └────────────────────┬─────────────────────────────┘
                             │ (push)
                             ▼
        ┌──────────────────────────────────────────────────┐
        │ Layer 4: GitHub branch protection (main)         │
        │   • required_linear_history: true                │
        │   • allow_force_pushes:      false               │
        │   • allow_deletions:         false               │
        │   refuses force-push or branch deletion          │
        └────────────────────┬─────────────────────────────┘
                             │ (commit lands on main)
                             ▼
        ┌──────────────────────────────────────────────────┐
        │ Layer 5: Vercel ignored-build-step               │
        │   bash scripts/v41-health-check.sh runs first    │
        │   exit 1 → deploy proceeds                       │
        │   exit 0 → deploy SKIPPED, last good stays live  │
        └────────────────────┬─────────────────────────────┘
                             │ (build green)
                             ▼
                    ┌────────────────────┐
                    │  supernovaeditor   │
                    │      .com (live)   │
                    └────────────────────┘
```

Any single layer being bypassed (or temporarily disabled for legitimate
work) still leaves the others standing. To actually delete v4.1 work
you'd need to consciously disable / bypass all five.

---

## Verifying the layers

```bash
cd "BUSINESSES/supernova-editor"

# Layer 1 — v4.1 baseline commit + remote tracking
git log --oneline -5
git ls-remote origin HEAD

# Layer 2 — pre-commit hook installed and executable
ls -la .git/hooks/pre-commit
# Self-test:
cp api/_v41-prompt.js /tmp/_v41-bak && rm api/_v41-prompt.js
git add -u api/_v41-prompt.js
git commit -m "test"   # should be REFUSED
git restore --staged api/_v41-prompt.js
mv /tmp/_v41-bak api/_v41-prompt.js

# Layer 3 — Claude Code session guard
ls -la ~/.claude/hooks/supernova-v41-guard.sh
# Self-test (should print BLOCKED + exit 2):
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' \
  | bash ~/.claude/hooks/supernova-v41-guard.sh

# Layer 4 — GitHub branch protection
gh api repos/laminsn/supernova-editor/branches/main/protection \
  | python3 -c "import json,sys; d=json.load(sys.stdin); \
    [print(f'{k}: {d[k][\"enabled\"]}') for k in \
     ['required_linear_history','allow_force_pushes','allow_deletions']]"

# Layer 5 — health check + Vercel wiring
./scripts/v41-health-check.sh && echo "build OK" || echo "deploy SKIPPED"
grep ignoreCommand vercel.json
```

---

## Bypassing a layer (legitimate cases)

| Layer | Bypass | When you'd actually do this |
|---|---|---|
| 2 | Add `[remove-v41]` to commit message body | You're explicitly removing v4.1 because the feature was retired |
| 3 | `SUPERNOVA_OVERRIDE=1 <command>` | One-off destructive op you understand and accept |
| 4 | GitHub UI → Settings → Branches → temporarily disable | Recovery from a bad state; re-enable immediately after |
| 5 | Edit `vercel.json` to remove `ignoreCommand` | Major refactor that legitimately removes v4.1 |

If you find yourself bypassing a layer, that's a signal to update this
document with what changed.

---

## Removed v4.1 entirely?

Run all five of these so the layers come down cleanly together:

1. Commit with `[remove-v41]` in the message (Layer 2 bypass)
2. Comment out the v4.1 marker checks in [scripts/v41-health-check.sh](./scripts/v41-health-check.sh) (Layer 5 self-disables)
3. Remove `ignoreCommand` from [vercel.json](./vercel.json)
4. Remove the v4.1 guard from `~/.claude/settings.json` PreToolUse Bash hooks (Layer 3)
5. Delete `.git/hooks/pre-commit` (Layer 2)

(Branch protection at Layer 4 stays — it protects against force-push
regardless of what's on the branch.)

---

## Reference commits

- `6c6705b` — original v4.1 restore (5 API files + index.html + vercel.json)
- `28bdb8e` — Layer 5 health check + Vercel ignoreCommand
- `dcad58a` — `handle_new_auth_user()` `SET search_path = public, pg_temp` (the actual login fix; survived the v4.1 wipe because it was already committed)
