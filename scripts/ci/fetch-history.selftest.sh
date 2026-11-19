#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# Self-test for scripts/ci/fetch-history.sh (#34561).
#
#   bash scripts/ci/fetch-history.selftest.sh
#
# The property under test is the one the four 2026-11-16/17 step timeouts
# broke: an attempt that STALLS is ended and retried, while an attempt that
# keeps moving is left alone. Since #34994 a stall is also one that keeps
# PRINTING server progress while no pack arrives: curl's low-speed abort ends
# it (exit 128, "curl 28"), so the cases pin that the script hands git that
# bound and retries what it ends, and that each phase prints as it starts. A real stalled transfer cannot be ordered on
# demand, so a stub `git` on PATH plays `fetch` per attempt (healthy, silent
# hang, hang after some progress, slow but moving, fast failure) and hands
# every other git command to the real git. A healthy `fetch` IS the real one,
# against a throwaway upstream over file://, so the unshallow, the refspecs and
# the closing "History:" line are the script's own.
#
# Each case pins the exit status, the attempt count, the `fetch` arguments, the
# ::warning:: / ::error:: lines, and for a hang that the stub's child process
# (standing in for git-remote-https) is gone afterwards -- the process-group
# kill. The last sections read ci.yml and lint.yml: all five ci.yml jobs call
# the script and no inline copy of the old loop is left; both workflows carry
# the same low-speed bound as the script's defaults; `lint-eslint` checks out
# at depth 1.
#
# Offline; ~40 s (the stall bound is 2 s here, 60 s in CI). Every fixture path
# is under a mktemp directory; none is spelled as a repo path
# (check:declared-population-live reads quoted slash literals).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

SCRIPT_REL='scripts/ci/fetch-history.sh'
WORKFLOW_REL='.github/workflows/ci.yml'
LINT_WORKFLOW_REL='.github/workflows/lint.yml'
SCRIPT="$PWD/$SCRIPT_REL"
REAL_GIT="$(command -v git)"
FIX=$(mktemp -d "${TMPDIR:-/tmp}/os-fetch-history-selftest.XXXXXX") || exit 1
trap 'rm -rf "$FIX"' EXIT

fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# ── fixtures: an upstream with history on main and on a release branch ──────
up="$FIX/upstream"
"$REAL_GIT" init -q -b main "$up"
for i in 1 2 3 4 5; do
  echo "$i" > "$up/f"
  "$REAL_GIT" -C "$up" add f
  "$REAL_GIT" -C "$up" -c user.name=t -c user.email=t@t commit -qm "c$i"
done
"$REAL_GIT" -C "$up" branch release-x
"$REAL_GIT" -C "$up" tag v0.0.1

# ── the stub: `git fetch` plays the attempt's line of $STUB_PLAN ────────────
bin="$FIX/bin"
mkdir -p "$bin"
cat > "$bin/git" << 'STUB'
#!/usr/bin/env bash
if [ "${1:-}" != fetch ]; then exec "$STUB_REAL_GIT" "$@"; fi
n=$(( $(cat "$STUB_DIR/attempts" 2> /dev/null || echo 0) + 1 ))
echo "$n" > "$STUB_DIR/attempts"
echo "$*" >> "$STUB_DIR/argv"
echo "${GIT_HTTP_LOW_SPEED_LIMIT-unset} ${GIT_HTTP_LOW_SPEED_TIME-unset}" >> "$STUB_DIR/env"
step=$(echo "$STUB_PLAN" | cut -d, -f"$n")
case "$step" in
  ok) exec "$STUB_REAL_GIT" "$@" ;;
  fail) echo "fatal: unable to access the remote: Connection reset" >&2; exit 128 ;;
  hang | hang-after-progress)
    if [ "$step" = hang-after-progress ]; then printf 'Receiving objects:  50%% (5/10)\r' >&2; fi
    sleep "${STUB_HANG_SECONDS:-300}" &
    echo "$!" >> "$STUB_DIR/children"
    wait
    exit 1
    ;;
  talk-then-curl28)
    # The 2026-11-17 shape: no pack, but server progress every second, longer
    # than the stall bound, then curl's low-speed abort as git reports it.
    for i in 1 2 3 4 5; do printf 'remote: Counting objects:  %d0%% (%d/10)\r' "$i" "$i" >&2; sleep 1; done
    echo "error: RPC failed; curl 28 Operation too slow. Less than 1000 bytes/sec transferred the last 120 seconds" >&2
    echo "fatal: expected 'packfile'" >&2
    exit 128
    ;;
  slow)
    for i in 1 2 3 4 5; do printf 'Receiving objects:  %d0%% (%d/10)\r' "$i" "$i" >&2; sleep 1; done
    exec "$STUB_REAL_GIT" "$@"
    ;;
  *) echo "stub: no plan for attempt $n" >&2; exit 99 ;;
esac
STUB
chmod +x "$bin/git"

# run_case NAME PLAN [shallow|full] [PR_BASE_REF]
run_case() {
  local name=$1 plan=$2 depth=${3:-shallow} base=${4:-}
  case_dir="$FIX/$name"
  mkdir -p "$case_dir/stub"
  if [ "$depth" = shallow ]; then
    "$REAL_GIT" clone -q --depth 1 --no-tags "file://$up" "$case_dir/ws"
  else
    "$REAL_GIT" clone -q --no-tags "file://$up" "$case_dir/ws"
  fi
  local start end
  start=$(date +%s)
  local low=()
  if [ -n "${CASE_LOW_SPEED:-}" ]; then
    low=(GIT_HTTP_LOW_SPEED_LIMIT="${CASE_LOW_SPEED% *}" GIT_HTTP_LOW_SPEED_TIME="${CASE_LOW_SPEED#* }")
  fi
  (
    cd "$case_dir/ws" &&
      env -u GIT_HTTP_LOW_SPEED_LIMIT -u GIT_HTTP_LOW_SPEED_TIME ${low[@]+"${low[@]}"} \
      PATH="$bin:$PATH" STUB_REAL_GIT="$REAL_GIT" STUB_DIR="$case_dir/stub" STUB_PLAN="$plan" \
        FETCH_HISTORY_STALL_SECONDS=2 FETCH_HISTORY_RETRY_SLEEP=0 PR_BASE_REF="$base" RUNNER_TEMP="$case_dir" \
        bash "$SCRIPT" > "$case_dir/out" 2>&1
  )
  rc=$?
  end=$(date +%s)
  elapsed=$((end - start))
  attempts=$(cat "$case_dir/stub/attempts" 2> /dev/null || echo 0)
  out=$(cat "$case_dir/out")
  argv1=$(head -n 1 "$case_dir/stub/argv" 2> /dev/null)
  env1=$(head -n 1 "$case_dir/stub/env" 2> /dev/null)
  ws="$case_dir/ws"
}
children_gone() {
  local pid
  [ -s "$case_dir/stub/children" ] || return 1
  while read -r pid; do
    if kill -0 "$pid" 2> /dev/null; then kill "$pid" 2> /dev/null; return 1; fi
  done < "$case_dir/stub/children"
  return 0
}
head_of() { "$REAL_GIT" -C "$up" rev-parse "$1"; }

echo "-- healthy: one attempt, real unshallow, main fetched, no tags"
run_case healthy ok
check "healthy exits 0" '[ "$rc" = 0 ]'
check "healthy takes one attempt" '[ "$attempts" = 1 ]'
check "healthy fetch args" '[ "$argv1" = "fetch --progress --no-tags --unshallow origin $(head_of main) +refs/heads/main:refs/remotes/origin/main" ]'
check "healthy clone is no longer shallow" '[ "$("$REAL_GIT" -C "$ws" rev-parse --is-shallow-repository)" = false ]'
check "healthy clone has all 5 commits" '[ "$("$REAL_GIT" -C "$ws" rev-list --count HEAD)" = 5 ]'
check "healthy fetched no tag" '[ -z "$("$REAL_GIT" -C "$ws" tag)" ]'
check "healthy prints the History line" 'grep -q "^History: 5 commit(s) behind HEAD, shallow=false, no tags" <<< "$out"'
check "healthy prints no warning" '! grep -q "::warning::" <<< "$out"'
check "healthy hands git the low-speed defaults (1000 B/s for 120 s)" '[ "$env1" = "1000 120" ]'
check "healthy names the bound once" '[ "$(grep -c "^Each attempt ends when it moves under 1000 bytes/s for 120s (curl) or writes nothing for 2s, and is retried.$" <<< "$out")" = 1 ]'

echo "-- #34994: a bound the workflow already set is kept, not overwritten"
CASE_LOW_SPEED="5 7" run_case preset ok
check "preset exits 0" '[ "$rc" = 0 ]'
check "preset hands git the workflow's values" '[ "$env1" = "5 7" ]'

echo "-- a PR into another branch fetches that branch too; a PR into main does not repeat main"
run_case pr-release ok shallow release-x
check "PR into release-x adds its refspec" '[ "$argv1" = "fetch --progress --no-tags --unshallow origin $(head_of main) +refs/heads/main:refs/remotes/origin/main +refs/heads/release-x:refs/remotes/origin/release-x" ]'
check "PR into release-x has the remote ref" '"$REAL_GIT" -C "$ws" rev-parse -q --verify refs/remotes/origin/release-x > /dev/null'
run_case pr-main ok shallow main
check "PR into main fetches main once" '[ "$argv1" = "fetch --progress --no-tags --unshallow origin $(head_of main) +refs/heads/main:refs/remotes/origin/main" ]'

echo "-- a full clone is not asked to unshallow"
run_case full ok full
check "full clone exits 0" '[ "$rc" = 0 ]'
check "full clone fetch has no --unshallow" '[ "$argv1" = "fetch --progress --no-tags origin $(head_of main) +refs/heads/main:refs/remotes/origin/main" ]'

echo "-- #34561: a silent hang is killed with its process group and retried"
run_case hang-then-ok hang,ok
check "hang-then-ok exits 0" '[ "$rc" = 0 ]'
check "hang-then-ok takes two attempts" '[ "$attempts" = 2 ]'
check "hang-then-ok names the stall" 'grep -q "::warning::git fetch wrote nothing for 2s after 0 byte(s) of output" <<< "$out"'
check "hang-then-ok left no child process (group kill)" 'children_gone'
check "hang-then-ok ends unshallowed" '[ "$("$REAL_GIT" -C "$ws" rev-parse --is-shallow-repository)" = false ]'
check "hang-then-ok is bounded (<= 10 s)" '[ "$elapsed" -le 10 ]'

echo "-- a hang after some progress shows the phase it stopped in"
run_case progress-then-hang hang-after-progress,ok
check "progress-then-hang exits 0" '[ "$rc" = 0 ]'
check "progress-then-hang takes two attempts" '[ "$attempts" = 2 ]'
check "progress-then-hang prints the stalled phase" 'grep -q "^Receiving objects:  50% (5/10)$" <<< "$out"'
check "progress-then-hang left no child process" 'children_gone'

echo "-- a slow fetch that keeps moving is never cut"
run_case slow slow
check "slow exits 0" '[ "$rc" = 0 ]'
check "slow takes one attempt" '[ "$attempts" = 1 ]'
check "slow ran longer than the stall bound" '[ "$elapsed" -ge 4 ]'
check "slow prints no warning" '! grep -q "::warning::" <<< "$out"'
check "slow prints one line for its progress phase" '[ "$(grep -c "^Receiving objects:" <<< "$out")" = 1 ]'
check "slow names its phase live, once" '[ "$(grep -cE "^fetch-history: \+[0-9]+s Receiving objects$" <<< "$out")" = 1 ]'

echo "-- #34994: a fetch that keeps printing server progress but gets no pack is ended by curl and retried"
run_case talk-then-ok talk-then-curl28,ok
check "talk-then-ok exits 0" '[ "$rc" = 0 ]'
check "talk-then-ok takes two attempts" '[ "$attempts" = 2 ]'
check "talk-then-ok: the silence bound did not fire (it cannot: the log kept growing)" '! grep -q "::warning::git fetch wrote nothing" <<< "$out"'
check "talk-then-ok: both attempts ran under the low-speed bound" '[ "$(grep -c "^1000 120$" "$case_dir/stub/env")" = 2 ]'
check "talk-then-ok shows curl's abort" 'grep -q "curl 28 Operation too slow" <<< "$out"'
check "talk-then-ok names the server phase it stood in, live" 'grep -qE "^fetch-history: \+[0-9]+s remote: Counting objects$" <<< "$out"'
check "talk-then-ok ends unshallowed" '[ "$("$REAL_GIT" -C "$ws" rev-parse --is-shallow-repository)" = false ]'

echo "-- three fast failures end red, named"
run_case fail3 fail,fail,fail
check "fail3 exits 1" '[ "$rc" = 1 ]'
check "fail3 takes three attempts" '[ "$attempts" = 3 ]'
check "fail3 prints the ::error::" 'grep -q "::error::Could not fetch .* after 3 attempts" <<< "$out"'
check "fail3 shows git's own error" 'grep -q "fatal: unable to access the remote" <<< "$out"'
check "fail3 stays shallow" '[ "$("$REAL_GIT" -C "$ws" rev-parse --is-shallow-repository)" = true ]'

echo "-- three hangs end red inside three stall bounds, not at the step's wall"
run_case hang3 hang,hang,hang
check "hang3 exits 1" '[ "$rc" = 1 ]'
check "hang3 takes three attempts" '[ "$attempts" = 3 ]'
check "hang3 warns three times" '[ "$(grep -c "::warning::git fetch wrote nothing" <<< "$out")" = 3 ]'
check "hang3 prints the ::error::" 'grep -q "::error::Could not fetch" <<< "$out"'
check "hang3 is bounded (<= 20 s)" '[ "$elapsed" -le 20 ]'
check "hang3 left no child process" 'children_gone'

echo "-- ci.yml: every job calls the script, and no inline loop is left"
wf="$PWD/$WORKFLOW_REL"
steps=$(grep -c "^      - name: Fetch this commit's history and the base branch$" "$wf")
calls=$(grep -c "^        run: bash scripts/ci/fetch-history.sh$" "$wf")
check "ci.yml has five fetch steps" '[ "$steps" = 5 ]'
check "ci.yml calls the script five times" '[ "$calls" = 5 ]'
check "each fetch step's run line is the script" '[ "$(grep -A4 "^      - name: Fetch this commit'"'"'s history and the base branch$" "$wf" | grep -c "^        run: bash scripts/ci/fetch-history.sh$")" = 5 ]'
check "each fetch step passes PR_BASE_REF" '[ "$(grep -A4 "^      - name: Fetch this commit'"'"'s history and the base branch$" "$wf" | grep -c "PR_BASE_REF: \${{ github.event.pull_request.base.ref }}")" = 5 ]'
check "no inline fetch loop is left in ci.yml" '! grep -q "git fetch --no-tags \"\${deepen\[@\]}\"" "$wf"'

echo "-- #34994: both workflows set the script's low-speed bound for every job"
lint_wf="$PWD/$LINT_WORKFLOW_REL"
script_limit=$(sed -n 's/^export GIT_HTTP_LOW_SPEED_LIMIT="\${GIT_HTTP_LOW_SPEED_LIMIT:-\([0-9]*\)}"$/\1/p' "$SCRIPT")
script_time=$(sed -n 's/^export GIT_HTTP_LOW_SPEED_TIME="\${GIT_HTTP_LOW_SPEED_TIME:-\([0-9]*\)}"$/\1/p' "$SCRIPT")
check "the script's defaults read as 1000 and 120" '[ "$script_limit" = 1000 ] && [ "$script_time" = 120 ]'
for f in "$wf" "$lint_wf"; do
  name=$(basename "$f")
  block=$(awk '/^env:$/ { on = 1; next } on && /^[^ ]/ { on = 0 } on' "$f")
  check "$name has one workflow-level env: block" '[ "$(grep -c "^env:$" "$f")" = 1 ]'
  check "$name's env: sets GIT_HTTP_LOW_SPEED_LIMIT to the script's default" 'grep -qx "  GIT_HTTP_LOW_SPEED_LIMIT: '"'"'$script_limit'"'"'" <<< "$block"'
  check "$name's env: sets GIT_HTTP_LOW_SPEED_TIME to the script's default" 'grep -qx "  GIT_HTTP_LOW_SPEED_TIME: '"'"'$script_time'"'"'" <<< "$block"'
done

echo "-- #34994: lint-eslint reads no history, so it checks out at depth 1"
eslint_job=$(awk '/^  lint-eslint:$/ { on = 1; next } on && /^  [a-z0-9_-]+:$/ { on = 0 } on' "$lint_wf")
check "lint.yml has the lint-eslint job" '[ -n "$eslint_job" ] && grep -q "uses: actions/checkout@" <<< "$eslint_job"'
check "lint-eslint's checkout sets no fetch-depth" '! grep -qE "^ +fetch-depth:" <<< "$eslint_job"'

echo ""
if [ "$fails" -gt 0 ]; then
  echo "fetch-history self-test: $fails check(s) FAILED"
  exit 1
fi
echo "fetch-history self-test: all checks passed"
