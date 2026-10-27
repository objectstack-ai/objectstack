#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# Self-test for scripts/ci/board-snapshot-r2-upload.sh (#26086).
#
#   bash scripts/ci/board-snapshot-r2-upload.selftest.sh
#
# The upload runs only on the scheduled archive job, with the maintainer's R2
# secrets, so no pull request reaches it. This drives the real script offline:
# a throwaway `archive/` git repository whose commits carry known committer
# times, a stub `aws` that records every call and answers per case, and a stub
# `date` for the tarball's day. Each case pins the exit status, the
# `$GITHUB_OUTPUT` status line, the annotations, and the exact `aws` calls --
# which is where "unset secrets touch nothing" and "a failed sync writes no
# tarball" actually live. The expected values were captured by running the
# INLINE step body (main at 6390fe52) through this same file before the move.
#
# Every fixture path is under a mktemp directory; none is spelled as a repo
# path (check:declared-population-live reads quoted slash literals).
set -u

SCRIPT_REL='scripts/ci/board-snapshot-r2-upload.sh'
SCRIPT="$PWD/$SCRIPT_REL"
FIX=$(mktemp -d "${TMPDIR:-/tmp}/os-r2-upload-selftest.XXXXXX") || exit 1

# The handshake: the verdict sets `reached`, and the EXIT trap refuses a run
# that left without it -- an early `exit 0` above the verdict would otherwise
# read as a pass.
reached=0
on_exit() {
  local code=$?
  rm -rf "$FIX"
  if [ "$reached" != 1 ] && [ "$code" = 0 ]; then
    echo "✗ board-snapshot-r2-upload self-test: exited without reaching its verdict -- that is not a pass" >&2
    exit 1
  fi
}
trap on_exit EXIT

if [ ! -f "$SCRIPT" ]; then
  echo "✗ board-snapshot-r2-upload self-test: $SCRIPT_REL is missing -- nothing to test is a failure, not a skip" >&2
  exit 1
fi

fail=0
# Battery roster: every case name, with the minimum checks it must register.
# A case that stops running, or runs fewer checks, names itself at the floor.
declare -A FLOOR=(
  ['unset secrets: one notice, status skipped, exit 0, no aws call']=5
  ['a configured sync: mtimes from history, then the sync, then the day tarball']=9
  ['the day tarball already exists: no second tarball, and the status says so']=4
  ['a failing sync is red: FAILED status, an error annotation, no tarball']=5
  ['an unreadable history falls back to a FULL re-upload, warned, never skipped']=4
)
ROSTER_SIZE=5
declare -A SEEN=()
current=''

check() { # check <description> <condition-exit-status>
  SEEN[$current]=$(( ${SEEN[$current]:-0} + 1 ))
  if [ "$2" != 0 ]; then
    echo "  ✗ [$current] $1"
    fail=1
  fi
}
has()    { grep -qF -- "$2" "$1"; }
hasnt()  { ! grep -qF -- "$2" "$1"; }

git_q() {
  git -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false "$@"
}

# ── The fakes ───────────────────────────────────────────────────────────────
mkdir -p "$FIX/bin"
cat > "$FIX/bin/aws" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$AWS_STUB_LOG"
case "$1 $2" in
  's3 sync')
    if [ "${AWS_STUB_SYNC_EXIT:-0}" != 0 ]; then echo "fatal error: stubbed sync refusal" >&2; exit "$AWS_STUB_SYNC_EXIT"; fi
    echo "upload: archive/board/a.json to s3://bucket/objectstack/board/a.json"
    echo "upload: archive/board/sub/b.json to s3://bucket/objectstack/board/sub/b.json"
    echo "delete: s3://bucket/objectstack/board/board/stale.json"
    ;;
  's3 ls') exit "${AWS_STUB_LS_EXIT:-1}" ;;
  's3 cp') [ -f "$3" ] || { echo "stub aws: cp source $3 missing" >&2; exit 9; } ;;
  *) echo "stub aws: unexpected call: $*" >&2; exit 98 ;;
esac
EOF
cat > "$FIX/bin/date" <<'EOF'
#!/usr/bin/env bash
if [ "$*" = '-u +%Y-%m-%d' ]; then echo 2026-10-27; exit 0; fi
exec /bin/date "$@"
EOF
chmod +x "$FIX/bin/aws" "$FIX/bin/date"

# The archive: two commits with known committer times, so the mtime pass has
# something to be right or wrong about.
SEED="$FIX/seed"
mkdir -p "$SEED/board/sub"
git_q init -q "$SEED"
echo '{"a":1}' > "$SEED/board/a.json"
echo '{"b":1}' > "$SEED/board/sub/b.json"
git_q -C "$SEED" add -A
GIT_COMMITTER_DATE='2026-10-01T00:00:00Z' git_q -C "$SEED" commit -q -m one
echo '{"a":2}' > "$SEED/board/a.json"
git_q -C "$SEED" add -A
GIT_COMMITTER_DATE='2026-10-02T00:00:00Z' git_q -C "$SEED" commit -q -m two
T_ONE=$(/bin/date -u -d '2026-10-01T00:00:00Z' +%s)
T_TWO=$(/bin/date -u -d '2026-10-02T00:00:00Z' +%s)

# run_case <name> [VAR=value ...] -- a fresh work dir holding a copy of the
# archive, the script run with the stubs first on PATH and the case's env.
run_case() {
  current=$1; shift
  W="$FIX/work-${#SEEN[@]}"
  mkdir -p "$W/runner-temp"
  cp -a "$SEED" "$W/archive"
  : > "$W/out"; : > "$W/aws.log"
  (
    cd "$W" || exit 97
    env -i PATH="$FIX/bin:$PATH" HOME="$FIX" RUNNER_TEMP="$W/runner-temp" GITHUB_OUTPUT="$W/out" \
      AWS_STUB_LOG="$W/aws.log" AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required "$@" \
      bash -e "$SCRIPT" > "$W/stdout" 2> "$W/stderr"
  )
  CODE=$?
  SEEN[$current]=${SEEN[$current]:-0}
}

SECRETS=(AWS_ACCESS_KEY_ID=id AWS_SECRET_ACCESS_KEY=secret R2_ACCOUNT_ID=acct R2_BUCKET=bucket)
SYNC='s3 sync archive/board/ s3://bucket/objectstack/board/ --endpoint-url https://acct.r2.cloudflarestorage.com --delete --no-progress'
LS='s3 ls s3://bucket/objectstack/snapshots/2026-10-27.tar.gz --endpoint-url https://acct.r2.cloudflarestorage.com'

run_case 'unset secrets: one notice, status skipped, exit 0, no aws call' AWS_ACCESS_KEY_ID=id R2_BUCKET=bucket
check "exit 0 (got $CODE)" "$([ "$CODE" = 0 ]; echo $?)"
check 'status=skipped in GITHUB_OUTPUT' "$(has "$W/out" 'status=skipped — no R2 credentials configured in this repository'; echo $?)"
check 'one ::notice:: naming all four secrets' "$(has "$W/stdout" '::notice::R2 upload skipped: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not all set'; echo $?)"
check 'no aws call at all' "$([ ! -s "$W/aws.log" ]; echo $?)"
check 'no mtime helper written' "$([ ! -e "$W/runner-temp/archive-mtimes.cjs" ]; echo $?)"

run_case 'a configured sync: mtimes from history, then the sync, then the day tarball' "${SECRETS[@]}"
check "exit 0 (got $CODE)" "$([ "$CODE" = 0 ]; echo $?)"
check 'a.json carries the time of the commit that last changed it' "$([ "$(stat -c %Y "$W/archive/board/a.json")" = "$T_TWO" ]; echo $?)"
check 'sub/b.json carries the time of the commit that created it' "$([ "$(stat -c %Y "$W/archive/board/sub/b.json")" = "$T_ONE" ]; echo $?)"
check 'the mtime note names the stamp count and the history depth' "$(has "$W/stdout" 'mtimes from history: 2 file(s) stamped from 2 commit(s)'; echo $?)"
check 'aws call 1 is the sync of the snapshot directory onto the mirror prefix' "$([ "$(sed -n 1p "$W/aws.log")" = "$SYNC" ]; echo $?)"
check 'aws call 2 asks whether the day tarball exists' "$([ "$(sed -n 2p "$W/aws.log")" = "$LS" ]; echo $?)"
check 'aws call 3 uploads the day tarball, and there is no fourth' "$([ "$(sed -n 3p "$W/aws.log")" = "s3 cp $W/runner-temp/2026-10-27.tar.gz s3://bucket/objectstack/snapshots/2026-10-27.tar.gz --endpoint-url https://acct.r2.cloudflarestorage.com --no-progress" ] && [ "$(wc -l < "$W/aws.log")" = 3 ]; echo $?)"
check 'the status line counts both verbs and the tarball' "$(has "$W/out" 'status=synced 2 object(s), deleted 1 (mtimes from history: 2 file(s) stamped from 2 commit(s)); daily tarball written for 2026-10-27'; echo $?)"
check 'no secret value reaches stdout, stderr or the output file' "$(! grep -qE 'secret|=id\b' "$W/stdout" "$W/stderr" "$W/out"; echo $?)"

run_case 'the day tarball already exists: no second tarball, and the status says so' "${SECRETS[@]}" AWS_STUB_LS_EXIT=0
check "exit 0 (got $CODE)" "$([ "$CODE" = 0 ]; echo $?)"
check 'two aws calls: the sync and the existence probe' "$([ "$(wc -l < "$W/aws.log")" = 2 ] && [ "$(sed -n 2p "$W/aws.log")" = "$LS" ]; echo $?)"
check 'no tarball built' "$([ ! -e "$W/runner-temp/2026-10-27.tar.gz" ]; echo $?)"
check 'the status says already written' "$(has "$W/out" 'daily tarball already written for 2026-10-27'; echo $?)"

run_case 'a failing sync is red: FAILED status, an error annotation, no tarball' "${SECRETS[@]}" AWS_STUB_SYNC_EXIT=2
check "exit 1 (got $CODE)" "$([ "$CODE" = 1 ]; echo $?)"
check 'status=FAILED with the sync exit code' "$(has "$W/out" 'status=FAILED — aws s3 sync exited 2'; echo $?)"
check 'an ::error:: that says the copy is now behind' "$(has "$W/stdout" '::error::aws s3 sync to R2 exited 2. This run IS archived on board-archive'; echo $?)"
check 'the sync log is replayed on stderr' "$(has "$W/stderr" 'fatal error: stubbed sync refusal'; echo $?)"
check 'one aws call: nothing after the failed sync' "$([ "$(wc -l < "$W/aws.log")" = 1 ]; echo $?)"

run_case 'an unreadable history falls back to a FULL re-upload, warned, never skipped' "${SECRETS[@]}"
# Re-run against an archive that is not a git repository.
rm -rf "$W/archive/.git"; : > "$W/aws.log"; : > "$W/out"
( cd "$W" && env -i PATH="$FIX/bin:$PATH" HOME="$FIX" RUNNER_TEMP="$W/runner-temp" GITHUB_OUTPUT="$W/out" \
    AWS_STUB_LOG="$W/aws.log" "${SECRETS[@]}" bash -e "$SCRIPT" > "$W/stdout" 2> "$W/stderr" )
CODE=$?
check "exit 0 (got $CODE)" "$([ "$CODE" = 0 ]; echo $?)"
check 'a ::warning:: that every object is re-uploaded' "$(has "$W/stdout" "::warning::Could not set the archive's mtimes from its git history (output above), so this sync re-uploads every object."; echo $?)"
check 'the status line names the fallback' "$(has "$W/out" '(FULL re-upload, mtimes not restored)'; echo $?)"
check 'the sync still ran' "$([ "$(sed -n 1p "$W/aws.log")" = "$SYNC" ]; echo $?)"

# ── Verdict ─────────────────────────────────────────────────────────────────
if [ "${#FLOOR[@]}" -lt "$ROSTER_SIZE" ]; then
  echo "  ✗ the roster declares ${#FLOOR[@]} batteries, below the pinned $ROSTER_SIZE"
  fail=1
fi
for name in "${!SEEN[@]}"; do
  if [ -z "${FLOOR[$name]+x}" ]; then echo "  ✗ case \"$name\" is not in the roster"; fail=1; fi
done
for name in "${!FLOOR[@]}"; do
  got=${SEEN[$name]:-0}
  if [ "$got" -lt "${FLOOR[$name]}" ]; then
    echo "  ✗ battery \"$name\" registered $got check(s), below its floor of ${FLOOR[$name]} -- it DID NOT RUN in full"
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  echo "✗ board-snapshot-r2-upload self-test FAILED"
  exit 1
fi
total=0; for n in "${SEEN[@]}"; do total=$((total + n)); done
echo "✓ board-snapshot-r2-upload self-test: ${#SEEN[@]} cases, $total checks"
reached=1
