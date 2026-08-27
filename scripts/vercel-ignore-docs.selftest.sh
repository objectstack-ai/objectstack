#!/usr/bin/env bash
#
# Self-test for scripts/vercel-ignore-docs.sh.
#
# The script decides whether a docs production build runs. Its two failure
# directions are not symmetric: a wrong "build" wastes build-minutes, a wrong
# "skip" silently stops publishing documentation. These cases pin both, and in
# particular pin the `content/**` case (#12743) — the repo's MDX lives outside
# the `apps/docs` package boundary, so a dependency-graph check alone reports
# SKIP for a pure documentation edit.
#
# Run: bash scripts/vercel-ignore-docs.selftest.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

SCRIPT=scripts/vercel-ignore-docs.sh
fail=0

# Historical commits on `main`, each a single well-understood kind of change.
# If history is ever rewritten these stop resolving; the test says so rather
# than silently passing.
SHA_CONTENT=1265f12b   # touches only content/docs/api/client-sdk.mdx
SHA_SPEC=366f8957      # touches packages/spec (the docs app's only workspace dep)
SHA_CLAUDE=72f91652    # touches only .claude/**

check() {
  local label="$1" want="$2"; shift 2
  local out rc got
  out=$(env "$@" bash "$SCRIPT" 2>&1); rc=$?
  got=$([ "$rc" -eq 0 ] && echo skip || echo build)
  if [ "$got" = "$want" ]; then
    printf '  ok    %-32s -> %s\n' "$label" "$got"
  else
    printf '  FAIL  %-32s -> %s (wanted %s)\n        %s\n' "$label" "$got" "$want" "$(echo "$out" | tail -1)"
    fail=1
  fi
}

at() { # at <sha> -> echoes env assignments pinning the range to that commit
  local sha="$1" parent
  parent=$(git rev-parse "${sha}^" 2>/dev/null) || return 1
  echo "VERCEL_GIT_PREVIOUS_SHA=${parent} VERCEL_GIT_COMMIT_SHA=${sha}"
}

echo "vercel-ignore-docs selftest"

check "preview deployments skip"      skip  VERCEL_ENV=preview
check "no baseline builds"            build VERCEL_ENV=production
check "unreachable baseline builds"   build VERCEL_ENV=production \
        VERCEL_GIT_PREVIOUS_SHA=0000000000000000000000000000000000000000

for pair in "content-only:$SHA_CONTENT:build" "spec-dependency:$SHA_SPEC:build" "claude-only:$SHA_CLAUDE:skip"; do
  label=${pair%%:*}; rest=${pair#*:}; sha=${rest%%:*}; want=${rest#*:}
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    printf '  SKIP  %-32s (commit %s no longer in history)\n' "$label" "$sha"
    continue
  fi
  # shellcheck disable=SC2046
  check "$label" "$want" VERCEL_ENV=production $(at "$sha")
done

if [ "$fail" -ne 0 ]; then echo "SELFTEST FAILED"; exit 1; fi
echo "all cases passed"
