#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" for @objectstack/docs.
#
# Vercel's contract is inverted from the usual one:
#   exit 0 -> IGNORE the build (skip)
#   exit 1 -> RUN the build
#
# Why this exists: every push to `main` used to rebuild the docs site. Measured
# over one week, that was 228 production builds consuming 2835 build-minutes —
# 98.6% of the whole team's build time — while `objectui` (18s/build) and
# `hotcrm` (6s/build) queued behind them on a `concurrentBuilds: 1` team. The
# queue reached 92 deployments, the oldest 34 hours old (#12743).
#
# ⚠️ The single most important property of this script is its FAILURE DIRECTION.
# A wrong "build" costs a few build-minutes. A wrong "skip" silently stops
# publishing documentation, with no error anywhere — the site just quietly goes
# stale. Every indeterminate case below therefore exits 1.
set -uo pipefail

# All paths below are repo-relative, but Vercel runs this from the project's
# Root Directory (apps/docs), so anchor to the repo root first.
cd "$(git rev-parse --show-toplevel)" || exit 1

# `VERCEL_GIT_COMMIT_SHA` is what Vercel is deploying; falling back to HEAD lets
# this script be exercised locally and in tests.
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
PREV_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"

# 1. Preview deployments never build the docs site. This preserves exactly the
#    behaviour of the dashboard rule this replaces, whose preview half was
#    already correct; only its production half ("always build") was wasteful.
if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "skip: VERCEL_ENV=${VERCEL_ENV:-unset} is not production"
  exit 0
fi

# 2. No baseline to compare against -> build. Happens on the first deployment
#    after this lands, and any time Vercel cannot name a previous success.
if [ -z "$PREV_SHA" ]; then
  echo "build: no VERCEL_GIT_PREVIOUS_SHA to compare against"
  exit 1
fi

# 3. Vercel builds from a shallow clone, so the previous commit is frequently
#    absent. Try to fetch it; if it stays unreachable, build.
if ! git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null; then
  git fetch --depth=100 origin "$PREV_SHA" >/dev/null 2>&1 || true
fi
if ! git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null; then
  echo "build: previous SHA ${PREV_SHA} is not reachable in this clone"
  exit 1
fi

# 4. The site's own sources.
#
#    This check is NOT redundant with turbo-ignore below, and removing it breaks
#    documentation publishing. `turbo --filter=<pkg>...[range]` computes affected
#    packages BY PACKAGE DIRECTORY. This repo's MDX lives at the repo root in
#    `content/`, outside the `apps/docs` package boundary, so turbo does not see
#    it. `turbo.json` does list `"$TURBO_ROOT$/content/**"` under
#    `@objectstack/docs#build`'s `inputs`, but `inputs` only feeds the cache
#    hash — it does not widen the affected-package calculation.
#
#    Measured on `main`: commit 1265f12b touches only
#    `content/docs/api/client-sdk.mdx`, and `turbo-ignore` alone reports SKIP.
if ! git diff --quiet "$PREV_SHA" "$HEAD_SHA" -- content apps/docs; then
  echo "build: content/ or apps/docs/ changed since ${PREV_SHA}"
  exit 1
fi

# 5. Nothing in the site's own sources changed. Ask turbo whether the docs app
#    is affected through its dependency graph — `@objectstack/spec` is the only
#    workspace dependency, but it changes often.
#
#    Deliberately NOT `turbo-ignore`: that wrapper is deprecated upstream ("Use
#    `turbo query affected` instead") and it derives its own comparison range,
#    falling back to `[HEAD^]` when it cannot read Vercel's git environment —
#    a range that silently answers a different question than the one asked here.
#    Naming the range explicitly keeps this decision reviewable and testable.
echo "no direct docs changes; asking turbo about the dependency graph"
DRY=$(npx --yes "turbo@${TURBO_VERSION:-^2}" run build \
        --filter="@objectstack/docs...[${PREV_SHA}...${HEAD_SHA}]" \
        --dry=json 2>/dev/null)
if [ -z "$DRY" ]; then
  echo "build: could not get a verdict from turbo"
  exit 1
fi

AFFECTED=$(printf '%s' "$DRY" | node -e '
  let s="";
  process.stdin.on("data", d => s += d);
  process.stdin.on("end", () => {
    try { process.stdout.write(String((JSON.parse(s).tasks || []).length)); }
    catch { process.stdout.write("error"); }
  });
' 2>/dev/null)

case "$AFFECTED" in
  0) echo "skip: nothing in @objectstack/docs dependency graph changed since ${PREV_SHA}"; exit 0 ;;
  ''|*[!0-9]*) echo "build: could not parse turbo's verdict (${AFFECTED:-empty})"; exit 1 ;;
  *) echo "build: ${AFFECTED} task(s) in the docs dependency graph affected"; exit 1 ;;
esac
