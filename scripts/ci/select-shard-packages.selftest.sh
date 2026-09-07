#!/usr/bin/env bash
#
# Self-test for scripts/ci/select-shard-packages.sh (#16453).
#
# The script decides the Test Core package set from the event, and every one
# of its fallbacks is a `::warning::` plus the FULL list -- so the property
# under test is not "does it exit 0" (it nearly always does) but WHICH branch
# it took: which `turbo ls` calls it made and with what `TURBO_SCM_BASE`,
# whether the cross-package union ran and over which changed-file list, which
# warnings it printed, and what landed in `turbo-ls.json`. Every case pins all
# of those, and pins the ABSENCE of the warnings it must not print (the
# #10057 guard on a merge group is the one that matters most: an empty
# docs-only group has to select nothing without complaint).
#
# Hermetic and offline: a throwaway upstream + clone (+ a shallow clone) under
# $TMPDIR, a fake `pnpm`/`turbo` pair on PATH that answers from control files
# and records every call, and a stub `check-cross-package-test-inputs.mjs`
# inside the fixture that records its argv and appends what it is told to.
# The REAL union script has its own self-test (`check:cross-package-test-
# inputs`); what is pinned here is that the selection script hands it the
# right files and ships its answer. Needs git, node and bash; ~2s.
#
# Run: bash scripts/ci/select-shard-packages.selftest.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

SCRIPT="$PWD/scripts/ci/select-shard-packages.sh"
FIX=$(mktemp -d "${TMPDIR:-/tmp}/os-select-shard-selftest.XXXXXX") || exit 1
trap 'rm -rf "$FIX"' EXIT INT TERM

fail=0
cases=0
checks=0

git_q() {
  git -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false "$@"
}

# ── The fakes ───────────────────────────────────────────────────────────────
mkdir -p "$FIX/bin"
cat > "$FIX/bin/pnpm" <<EOF
#!/usr/bin/env bash
# fake pnpm: the script only ever spells \`pnpm exec turbo ...\`.
if [ "\${1:-}" != exec ] || [ "\${2:-}" != turbo ]; then
  echo "fake pnpm: unexpected argv: \$*" >&2
  exit 97
fi
shift 2
exec "$FIX/bin/turbo" "\$@"
EOF
cat > "$FIX/bin/turbo" <<EOF
#!/usr/bin/env bash
# fake turbo: records the call (argv and TURBO_SCM_BASE), answers from the
# control files, exits as told.
case " \$* " in
  *" --affected "*)
    printf 'affected argv=[%s] TURBO_SCM_BASE=%s\n' "\$*" "\${TURBO_SCM_BASE:-unset}" >> "$FIX/turbo-calls.log"
    cat "$FIX/affected.json"
    exit "\$(cat "$FIX/affected-exit")"
    ;;
  *)
    printf 'full argv=[%s] TURBO_SCM_BASE=%s\n' "\$*" "\${TURBO_SCM_BASE:-unset}" >> "$FIX/turbo-calls.log"
    cat "$FIX/full.json"
    exit 0
    ;;
esac
EOF
chmod +x "$FIX/bin/pnpm" "$FIX/bin/turbo"

# The stub union script, committed into the fixture upstream's scripts/ dir.
write_union_stub() {
  mkdir -p "$1/scripts"
  cat > "$1/scripts/check-cross-package-test-inputs.mjs" <<EOF
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const FIX = '$FIX';
const argv = process.argv.slice(2);
appendFileSync(FIX + '/union.log', 'argv ' + argv.join(' ') + '\n');
const list = argv[argv.indexOf('--union-into') + 1];
const changed = argv[argv.indexOf('--changed') + 1];
const files = readFileSync(changed, 'utf8').split('\n').filter(Boolean);
appendFileSync(FIX + '/union.log', 'changed ' + (files.join(',') || '(none)') + '\n');
const doc = JSON.parse(readFileSync(list, 'utf8'));
const add = readFileSync(FIX + '/union-add', 'utf8').trim();
if (add) {
  doc.packages.items.push({ name: add, path: 'packages/' + add });
  doc.packages.count = doc.packages.items.length;
}
writeFileSync(list, JSON.stringify(doc));
process.exit(Number(readFileSync(FIX + '/union-exit', 'utf8').trim() || 0));
EOF
}

# ── Control files ───────────────────────────────────────────────────────────
full_json='{"packageManager":"pnpm@10.0.0","packages":{"count":3,"items":[{"name":"a","path":"packages/a"},{"name":"b","path":"packages/b"},{"name":"c","path":"packages/c"}]}}'
printf '%s\n' "$full_json" > "$FIX/full.json"

# set_affected <name>...  -- what the fake `turbo ls --affected` answers
set_affected() {
  local items='' name
  for name in "$@"; do
    [ -n "$items" ] && items="$items,"
    items="$items{\"name\":\"$name\",\"path\":\"packages/$name\"}"
  done
  printf '{"packageManager":"pnpm@10.0.0","packages":{"count":%d,"items":[%s]}}\n' "$#" "$items" > "$FIX/affected.json"
}
reset_controls() {
  set_affected a
  printf '0' > "$FIX/affected-exit"
  : > "$FIX/union-add"
  printf '0' > "$FIX/union-exit"
}

# ── Fixture repositories ────────────────────────────────────────────────────
UP="$FIX/upstream"
mkdir -p "$UP"
git_q -C "$UP" init -q
git_q -C "$UP" symbolic-ref HEAD refs/heads/main
mkdir -p "$UP/packages/a" "$UP/docs"
printf '{"name":"fixture","private":true}\n' > "$UP/package.json"
printf 'export const a = 1;\n' > "$UP/packages/a/index.ts"
printf '# guide\n' > "$UP/docs/guide.md"
# The stub union script is part of C0, so every commit carries it unchanged
# and no changed-file list below ever names it.
write_union_stub "$UP"
git_q -C "$UP" add -A
git_q -C "$UP" commit -q -m 'C0: root'
C0=$(git_q -C "$UP" rev-parse HEAD)
printf 'export const a = 2;\n' > "$UP/packages/a/index.ts"
git_q -C "$UP" commit -q -am 'C1: a moves'
C1=$(git_q -C "$UP" rev-parse HEAD)
# A merge group's base is fetched BY SHA; a local upstream has to be told to
# serve one (GitHub does so for every reachable commit -- actions/checkout
# itself fetches the merge ref by sha).
git_q -C "$UP" config uploadpack.allowReachableSHA1InWant true
git_q -C "$UP" config uploadpack.allowAnySHA1InWant true

REPO="$FIX/repo"
git_q clone -q "$UP" "$REPO"
git_q -C "$REPO" checkout -q -b feature
printf 'export const leaf = 1;\n' > "$REPO/packages/a/leaf.ts"
git_q -C "$REPO" add -A
git_q -C "$REPO" commit -q -m 'F1: leaf change on the feature branch'
F1=$(git_q -C "$REPO" rev-parse HEAD)
# The queue's HEAD: this entry merged onto its base.
git_q -C "$REPO" checkout -q --detach "$C1"
git_q -C "$REPO" merge -q --no-ff -m 'M: feature merged onto C1' feature
M=$(git_q -C "$REPO" rev-parse HEAD)
# A docs-only entry on top of that.
printf '# guide, revised\n' > "$REPO/docs/guide.md"
git_q -C "$REPO" commit -q -am 'D: docs only'
D=$(git_q -C "$REPO" rev-parse HEAD)
# Created AFTER the clone, so the clone has no refs/remotes/origin/release:
# the pull_request fetch path has something to fetch.
git_q -C "$UP" branch release "$C1"

SHALLOW="$FIX/shallow"
git_q clone -q --depth 1 "file://$UP" "$SHALLOW" 2>/dev/null

ZEROS=0000000000000000000000000000000000000000

# ── The runner and the assertions ───────────────────────────────────────────
at() { git_q -C "$REPO" checkout -q --detach "$1"; }

RT=''
rc=0
# run_case <label> <cwd> <event> <pr base ref> <pr pinned sha> <merge-group base sha>
run_case() {
  label=$1
  cases=$((cases + 1))
  RT="$FIX/rt-$cases"
  mkdir -p "$RT"
  : > "$FIX/turbo-calls.log"
  : > "$FIX/union.log"
  (
    cd "$2" && PATH="$FIX/bin:$PATH" RUNNER_TEMP="$RT" \
      OS_SHARD_EVENT_NAME="$3" OS_SHARD_PR_BASE_REF="$4" \
      OS_SHARD_PR_PINNED_BASE_SHA="$5" OS_SHARD_MERGE_GROUP_BASE_SHA="$6" \
      bash "$SCRIPT"
  ) > "$RT/out.txt" 2>&1
  rc=$?
  echo "case: $label"
}

# Captured script output is echoed INDENTED: the Actions runner parses a
# `::warning::` at line start into a real annotation, and the failing case
# must not mint one on the lint job's behalf.
show_output() {
  echo "        -- output --"
  sed 's/^/        | /' "$RT/out.txt"
}

ok() { checks=$((checks + 1)); printf '  ok    %s\n' "$1"; }
bad() {
  checks=$((checks + 1))
  fail=1
  printf '  FAIL  %s\n' "$1"
  shift
  while [ $# -gt 0 ]; do printf '        %s\n' "$1"; shift; done
  show_output
}

expect_rc() {
  if [ "$rc" -eq "$1" ]; then ok "exit $1"; else bad "exit $1" "got exit $rc"; fi
}

# expect_file_is <label> <file> <expected content, newline-separated>
expect_file_is() {
  printf '%s' "$3" > "$RT/want.txt"
  if [ -n "$3" ]; then printf '\n' >> "$RT/want.txt"; fi
  if diff -u "$RT/want.txt" "$2" > "$RT/diff.txt"; then
    ok "$1"
  else
    bad "$1" "$(sed 's/^/diff: /' "$RT/diff.txt" | tr '\n' ' ')"
  fi
}

expect_warnings() {
  grep '^::warning::' "$RT/out.txt" > "$RT/warnings.txt"
  expect_file_is "warnings: ${1:-none}" "$RT/warnings.txt" "$2"
}
expect_turbo() { expect_file_is "turbo calls: $1" "$FIX/turbo-calls.log" "$2"; }
expect_union() { expect_file_is "union: $1" "$FIX/union.log" "$2"; }

# The package set that landed in turbo-ls.json, as `count:name,name`.
expect_packages() {
  local got
  got=$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(j.packages.count + ":" + j.packages.items.map((i) => i.name).sort().join(","));
  ' "$RT/turbo-ls.json" 2>&1)
  if [ "$got" = "$1" ]; then ok "turbo-ls.json = $1"; else bad "turbo-ls.json = $1" "got: $got"; fi
}
expect_line() {
  if grep -qF -- "$1" "$RT/out.txt"; then ok "prints: $1"; else bad "prints: $1"; fi
}
expect_no_line() {
  if grep -qF -- "$1" "$RT/out.txt"; then bad "does not print: $1"; else ok "does not print: $1"; fi
}

W_UNION='::warning::Could not union cross-package scans into the affected set; falling back to the full package list for this shard.'
affected_call() { echo "affected argv=[ls --affected --output=json] TURBO_SCM_BASE=$1"; }
full_call='full argv=[ls --output=json] TURBO_SCM_BASE=unset'
union_lines() { printf 'argv --union-into %s/turbo-ls.json --changed %s/changed-files.txt\nchanged %s' "$RT" "$RT" "$1"; }

echo "select-shard-packages selftest  (fixture: C0=${C0:0:7} C1=${C1:0:7} F1=${F1:0:7} M=${M:0:7} D=${D:0:7})"

# ── usage ───────────────────────────────────────────────────────────────────
reset_controls
cases=$((cases + 1)); RT="$FIX/rt-$cases"; mkdir -p "$RT"
(cd "$REPO" && env -u RUNNER_TEMP PATH="$FIX/bin:$PATH" OS_SHARD_EVENT_NAME=push bash "$SCRIPT") > "$RT/out.txt" 2>&1
rc=$?
echo "case: usage: no RUNNER_TEMP is a usage error, not a selection"
expect_rc 2
expect_line 'usage: RUNNER_TEMP='

# ── push ────────────────────────────────────────────────────────────────────
reset_controls; at "$M"
run_case 'push: the FULL list, one turbo call, no warnings' "$REPO" push '' '' ''
expect_rc 0
expect_warnings '' ''
expect_turbo 'full only' "$full_call"
expect_union 'not invoked' ''
expect_packages '3:a,b,c'

reset_controls; at "$M"
run_case 'push: the event decides, not the variables that happen to be set' "$REPO" push main "$C0" "$C1"
expect_rc 0
expect_warnings '' ''
expect_turbo 'full only' "$full_call"
expect_packages '3:a,b,c'

reset_controls; at "$M"
run_case 'an event that is neither: the FULL list' "$REPO" workflow_dispatch '' '' ''
expect_rc 0
expect_warnings '' ''
expect_turbo 'full only' "$full_call"
expect_packages '3:a,b,c'

# ── pull_request ────────────────────────────────────────────────────────────
reset_controls; at "$F1"
run_case 'pull_request: affected against merge-base(origin/main, HEAD), unioned' "$REPO" pull_request main "$C0" ''
expect_rc 0
expect_warnings '' ''
expect_turbo 'affected only, base = merge-base' "$(affected_call "$C1")"
expect_union 'the diff base..HEAD' "$(union_lines packages/a/leaf.ts)"
expect_packages '1:a'
expect_line "Affected-set diff base: $C1  (merge-base of origin/main and HEAD)"
expect_line "Frozen payload base.sha: $C0  -- main has moved 1 commit(s) since it was frozen"

reset_controls; at "$F1"; printf 'spec' > "$FIX/union-add"
run_case 'pull_request: the union adds a declaring package and the set ships it' "$REPO" pull_request main "$C0" ''
expect_rc 0
expect_warnings '' ''
expect_packages '2:a,spec'

reset_controls; at "$F1"; printf '1' > "$FIX/union-exit"
run_case 'pull_request: a failed union falls back to the FULL list, loudly' "$REPO" pull_request main "$C0" ''
expect_rc 0
expect_warnings 'union fallback' "$W_UNION"
expect_turbo 'affected, then full' "$(affected_call "$C1")
$full_call"
expect_packages '3:a,b,c'

reset_controls; at "$C1"; set_affected
run_case 'pull_request: an EMPTY diff is #10057 -- the FULL list, never an empty set' "$REPO" pull_request main "$C0" ''
expect_rc 0
expect_warnings '#10057' "::warning::The diff against merge-base $C1 listed no changed files, which a pull_request cannot legitimately produce; falling back to the full package list for this shard rather than selecting nothing (#10057)."
expect_turbo 'affected, then full' "$(affected_call "$C1")
$full_call"
expect_union 'ran over an empty list' "$(union_lines '(none)')"
expect_packages '3:a,b,c'

reset_controls; at "$F1"
run_case 'pull_request: no base branch in the payload' "$REPO" pull_request '' "$C0" ''
expect_rc 0
expect_warnings 'no base + #6195' '::warning::This pull_request event carries no base branch, so the affected-set diff base cannot be computed.
::warning::Could not resolve merge-base(origin/, HEAD); falling back to the full package list for this shard rather than diffing from the frozen base.sha (#6195).'
expect_turbo 'full only' "$full_call"
expect_union 'not invoked' ''
expect_packages '3:a,b,c'

reset_controls; at "$F1"
if git_q -C "$REPO" rev-parse -q --verify refs/remotes/origin/release > /dev/null; then
  bad 'precondition: origin/release is absent before the fetch case'
else
  ok 'precondition: origin/release is absent before the fetch case'
fi
run_case 'pull_request: a base ref absent locally is fetched, then diffed' "$REPO" pull_request release "$C1" ''
expect_rc 0
expect_warnings '' ''
if git_q -C "$REPO" rev-parse -q --verify refs/remotes/origin/release > /dev/null; then
  ok 'origin/release exists after the run (the fetch happened)'
else
  bad 'origin/release exists after the run (the fetch happened)'
fi
expect_turbo 'affected only' "$(affected_call "$C1")"
expect_packages '1:a'
expect_line "Frozen payload base.sha: $C1  -- release has moved 0 commit(s) since it was frozen"

reset_controls; at "$F1"
run_case 'pull_request: an unfetchable base ref warns twice and falls back' "$REPO" pull_request nope "$C0" ''
expect_rc 0
expect_warnings 'fetch + #6195' '::warning::Could not fetch origin/nope; the merge-base resolution below will decide.
::warning::Could not resolve merge-base(origin/nope, HEAD); falling back to the full package list for this shard rather than diffing from the frozen base.sha (#6195).'
expect_turbo 'full only' "$full_call"
expect_packages '3:a,b,c'

reset_controls; at "$F1"; printf '1' > "$FIX/affected-exit"
run_case 'pull_request: a failing `turbo ls --affected` reds the step (bash -e parity), no fallback' "$REPO" pull_request main "$C0" ''
expect_rc 1
expect_turbo 'affected only' "$(affected_call "$C1")"
expect_union 'not reached' ''

# ── merge_group ─────────────────────────────────────────────────────────────
reset_controls; at "$M"
run_case 'merge_group: affected against the group base_sha, unioned' "$REPO" merge_group '' '' "$C1"
expect_rc 0
expect_warnings '' ''
expect_turbo 'affected only, base = base_sha' "$(affected_call "$C1")"
expect_union 'the diff base_sha..HEAD' "$(union_lines packages/a/leaf.ts)"
expect_packages '1:a'
expect_line "Affected-set diff base: $C1  (the merge group's base_sha)"
expect_no_line 'Frozen payload base.sha'

reset_controls; at "$D"; set_affected
run_case 'merge_group: a docs-only group selects NOTHING and warns about nothing' "$REPO" merge_group '' '' "$M"
expect_rc 0
expect_warnings '' ''
expect_turbo 'affected only -- no fallback to full' "$(affected_call "$M")"
expect_union 'the docs file' "$(union_lines docs/guide.md)"
expect_packages '0:'

reset_controls; at "$C1"; set_affected
run_case 'merge_group: an EMPTY diff is NOT #10057 -- nothing selected, no warning' "$REPO" merge_group '' '' "$C1"
expect_rc 0
expect_warnings '' ''
expect_no_line '#10057'
expect_turbo 'affected only' "$(affected_call "$C1")"
expect_union 'ran over an empty list' "$(union_lines '(none)')"
expect_packages '0:'

reset_controls; at "$M"; printf 'spec' > "$FIX/union-add"
run_case 'merge_group: the union adds a declaring package and the set ships it' "$REPO" merge_group '' '' "$C1"
expect_rc 0
expect_warnings '' ''
expect_packages '2:a,spec'

reset_controls; at "$M"; printf '1' > "$FIX/union-exit"
run_case 'merge_group: a failed union falls back to the FULL list, loudly' "$REPO" merge_group '' '' "$C1"
expect_rc 0
expect_warnings 'union fallback' "$W_UNION"
expect_turbo 'affected, then full' "$(affected_call "$C1")
$full_call"
expect_packages '3:a,b,c'

reset_controls
if git_q -C "$SHALLOW" cat-file -e "$C0^{commit}" 2>/dev/null; then
  bad 'precondition: the shallow clone lacks C0 before the fetch case'
else
  ok 'precondition: the shallow clone lacks C0 before the fetch case'
fi
run_case 'merge_group: a base_sha absent from a shallow checkout is fetched BY SHA' "$SHALLOW" merge_group '' '' "$C0"
expect_rc 0
expect_warnings '' ''
if git_q -C "$SHALLOW" cat-file -e "$C0^{commit}" 2>/dev/null; then
  ok 'C0 is present after the run (the fetch happened)'
else
  bad 'C0 is present after the run (the fetch happened)'
fi
expect_turbo 'affected only, base = base_sha' "$(affected_call "$C0")"
expect_union 'the diff C0..C1' "$(union_lines packages/a/index.ts)"
expect_packages '1:a'

reset_controls; at "$M"
run_case 'merge_group: an unfetchable base_sha warns twice and falls back' "$REPO" merge_group '' '' "$ZEROS"
expect_rc 0
expect_warnings 'fetch + resolve' "::warning::Could not fetch the merge group's base $ZEROS; the resolution below will decide.
::warning::Could not resolve the merge group's base '$ZEROS' in this checkout; falling back to the full package list for this shard rather than selecting nothing (#16453)."
expect_turbo 'full only' "$full_call"
expect_union 'not invoked' ''
expect_packages '3:a,b,c'

reset_controls; at "$M"
run_case 'merge_group: no base_sha in the payload' "$REPO" merge_group '' '' ''
expect_rc 0
expect_warnings 'no base + resolve' "::warning::This merge_group event carries no base_sha, so the affected-set diff base cannot be computed.
::warning::Could not resolve the merge group's base '' in this checkout; falling back to the full package list for this shard rather than selecting nothing (#16453)."
expect_turbo 'full only' "$full_call"
expect_packages '3:a,b,c'

reset_controls; at "$M"; printf '1' > "$FIX/affected-exit"
run_case 'merge_group: a failing `turbo ls --affected` reds the step, exactly as on pull_request' "$REPO" merge_group '' '' "$C1"
expect_rc 1
expect_turbo 'affected only' "$(affected_call "$C1")"
expect_union 'not reached' ''

# ── Verdict ─────────────────────────────────────────────────────────────────
# #4690: a battery that ran nothing is a failure, never a pass.
if [ "$cases" -lt 20 ] || [ "$checks" -lt 80 ]; then
  echo "SELFTEST FAILED: only $cases case(s) / $checks check(s) ran -- the battery is short"
  exit 1
fi
if [ "$fail" -ne 0 ]; then
  echo "SELFTEST FAILED ($cases cases, $checks checks)"
  exit 1
fi
echo "all $cases cases passed ($checks checks)"
