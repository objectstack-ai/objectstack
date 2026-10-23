#!/usr/bin/env bash
# Self-test for session-start-fleet.sh — run it after touching that hook:
#
#   .claude/hooks/session-start-fleet.selftest.sh
#
# Runs the hook the way the harness does on SessionStart (a JSON envelope on stdin, stdout
# collected) and asserts, case by case, what it prints and that it exits 0. Hermetic: it
# builds its OWN throwaway checkout under $TMPDIR — a git repo carrying a copy of the hook at
# the hook's real relative position, a `SKILL.md`, and two lane files (one with a `Seat post:`
# line, one without) — so the matrix never depends on which machine or checkout it runs from,
# nor on how deep this clone is. Needs jq (to read settings.json) and git; no install, no
# build, no network. Exit 0 = all cases hold.
#
# Every case is a line the hook PRINTS, so the exit-0 contract is asserted on each of them
# rather than once: the one failure this hook must never have is a non-zero exit, in any
# shape of input. NON-VACUITY at the foot proves the matrix can fail — a mutated copy that
# prints the wrong pointer is caught by the same `says` the real hook passes.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="${SESSION_START_FLEET_HOOK:-$here/session-start-fleet.sh}"
settings="${SESSION_START_FLEET_SETTINGS:-$here/../settings.json}"
pass=0
fail=0

command -v jq >/dev/null 2>&1 || { echo "selftest needs jq to read settings.json" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "selftest needs git to build the fixture" >&2; exit 1; }
[ -x "$hook" ] || { echo "hook not executable: $hook" >&2; exit 1; }

short() { printf '%s' "${1/#$HOME/~}"; }

# --- fixture -----------------------------------------------------------------------------
# REPO    a checkout: .claude/hooks/<hook copy>, SKILL.md, lanes/skills.md (Seat post: #19287),
#         lanes/devx.md (no seat-post line), one commit.
# BARE    the same tree with NO SKILL.md, no git.
# PLAIN   the hook copy alone in a directory that is no checkout at all.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
REPO="$tmp/repo"
BARE="$tmp/bare"
PLAIN="$tmp/plain"
SKILL_REL='.claude/skills/pm-dispatch/SKILL.md'
LANES_REL='.claude/skills/pm-dispatch/references/lanes'
for r in "$REPO" "$BARE" "$PLAIN"; do mkdir -p "$r/.claude/hooks"; cp "$hook" "$r/.claude/hooks/session-start-fleet.sh"; done
mkdir -p "$REPO/$LANES_REL" "$BARE/$LANES_REL"
printf '# pm-dispatch (fixture)\n\nrules live here.\n' > "$REPO/$SKILL_REL"
printf '# lane: skills\n\n- Seat post: #19287 — the stub on the board.\n- posture lives in the project.\n' > "$REPO/$LANES_REL/skills.md"
printf '# lane: devx\n\n- talks about the seat post but names no number.\n' > "$REPO/$LANES_REL/devx.md"
printf '# lane: skills\n\n- Seat post: #19287\n' > "$BARE/$LANES_REL/skills.md"
(
  cd "$REPO" || exit 1
  git init -q .
  git config user.email selftest@example.com
  git config user.name selftest
  git add -A
  git commit -qm 'fixture: hook, skill, lanes'
) || { echo "fixture build failed" >&2; exit 1; }
REPO_TOUCH="$(git -C "$REPO" log -1 --format=%h -- "$SKILL_REL")"
REPO_TOUCH_FULL="$(git -C "$REPO" log -1 --format=%H -- "$SKILL_REL")"

# run <hook-path> [env…] -> stdout of the hook, with the harness's envelope on stdin;
# the exit code is kept in RC (captured BEFORE any pipe, so it is the hook's own).
RC=""
OUT=""
run() {
  local h="$1"; shift
  local payload='{"session_id":"selftest","hook_event_name":"SessionStart","source":"startup","cwd":"/nowhere"}'
  OUT="$(printf '%s' "$payload" | env "$@" "$h" 2>/dev/null)"
  RC=$?
}

ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
nope() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

exit0() { # exit0 <label> — RC of the last run must be 0
  if [ "$RC" = 0 ]; then ok "exit 0   $1"; else nope "exit $RC  $1 (must be 0: a hook that fails must never block a session)"; fi
}
says() { # says <needle> <label>
  case "$OUT" in
    *"$1"*) ok "says     $2" ;;
    *) nope "missing \"$1\"  $2" ;;
  esac
}
lacks() { # lacks <needle> <label>
  case "$OUT" in
    *"$1"*) nope "still says \"$1\"  $2" ;;
    *) ok "lacks    $2" ;;
  esac
}
lines_le() { # lines_le <n> <label>
  local n; n="$(printf '%s\n' "$OUT" | grep -c '' )"
  if [ "$n" -le "$1" ]; then ok "lines    $n ≤ $1  $2"; else nope "lines    $n > $1  $2"; fi
}

POINTER='Fleet protocol: read .claude/skills/pm-dispatch/SKILL.md (and the stage references its index names) before any dispatch, claim, review or landing act.'
STUB='the seat post is a stub; posture and ledger live in the project'
H="$REPO/.claude/hooks/session-start-fleet.sh"

echo "== the pointer, the touch, and the lane line without OS_FLEET_LANE =="
run "$H"
exit0 'plain run'
says "$POINTER" 'the pointer line, verbatim'
says "SKILL.md: $REPO/$SKILL_REL" 'the skill path, resolved from the HOOK FILE, never the cwd'
says "touch: $REPO_TOUCH " "the latest touch of SKILL.md ($REPO_TOUCH), as git log -1 -- <path> names it"
says 'compare with the opening mark' 'the touch line says what the sha is for'
says 'lane: not set' 'no OS_FLEET_LANE ⇒ lane: not set'
lacks 'SHALLOW' 'a full fixture clone is not called shallow'
lacks 'note: this session' 'no project-dir note when CLAUDE_PROJECT_DIR is unset'
lines_le 15 'the whole print stays within the budget'

echo "== the hook is located by its own path: the cwd and CLAUDE_PROJECT_DIR are not inputs =="
( cd "$tmp" && run "$H" ); # subshell cwd = the parent of the checkout, the project-session shape
run "$H" CLAUDE_PROJECT_DIR="$tmp"
exit0 'run with CLAUDE_PROJECT_DIR = the PARENT of the checkout'
says "SKILL.md: $REPO/$SKILL_REL" 'the skill path still resolves to the checkout the hook lives in'
says 'note: this session' 'a project dir that is not this checkout is named as the reason for the pointer'
run "$H" CLAUDE_PROJECT_DIR="$REPO"
exit0 'run with CLAUDE_PROJECT_DIR = this checkout'
lacks 'note: this session' 'no note when the project dir IS this checkout'
run "$H" CLAUDE_PROJECT_DIR="$REPO/"
lacks 'note: this session' 'a trailing slash on the project dir is the same checkout'

echo "== OS_FLEET_LANE names a lane =="
run "$H" OS_FLEET_LANE=skills
exit0 'lane with a Seat post: line'
says 'lane: skills · seat post #19287' 'the seat-post number is read from references/lanes/skills.md'
says "$STUB" 'the stub reminder rides the lane line'
run "$H" OS_FLEET_LANE=devx
exit0 'lane whose file carries no Seat post: line'
says 'seat post: not recorded in' 'no number is invented when the lane file names none'
says "$STUB" 'the stub reminder still rides the line'
lacks 'seat post #' 'a sentence that merely mentions the seat post passes no number'
run "$H" OS_FLEET_LANE=nope
exit0 'lane with no file at all'
says "lane: nope · no $LANES_REL/nope.md on this checkout" 'a lane with no file says so, with the path looked for'
run "$H" OS_FLEET_LANE='../skills'
exit0 'a lane value with path characters'
says 'OS_FLEET_LANE refused' 'a value that is not a lane name is refused before it reaches a path'
lacks '../skills' 'the refused value is not echoed into the context'
run "$H" OS_FLEET_LANE='skills; echo pwned'
exit0 'a lane value with shell metacharacters'
says 'OS_FLEET_LANE refused' 'refused the same way'
lacks 'pwned' 'and never spelled into the output'
run "$H" OS_FLEET_LANE=''
says 'lane: not set' 'an EMPTY OS_FLEET_LANE reads as not set'

echo "== a checkout with no SKILL.md, and a directory that is no checkout =="
run "$BARE/.claude/hooks/session-start-fleet.sh" OS_FLEET_LANE=skills
exit0 'no SKILL.md, no git'
says "$POINTER" 'the pointer still prints'
says 'SKILL.md: MISSING at' 'the missing skill is named, with the path looked for'
says 'lane: skills · seat post #19287' 'the lane file is still read on its own'
run "$PLAIN/.claude/hooks/session-start-fleet.sh"
exit0 'hook copy in a directory that is no checkout'
says 'SKILL.md: MISSING at' 'a plain directory has no skill either'
says 'lane: not set' 'and the lane line still prints'

echo "== a shallow clone's boundary is labelled, never presented as a measured touch =="
shallow_file="$(git -C "$REPO" rev-parse --git-path shallow)"
case "$shallow_file" in /*) ;; *) shallow_file="$REPO/$shallow_file" ;; esac
printf '%s\n' "$REPO_TOUCH_FULL" > "$shallow_file"
run "$H"
exit0 'run on a checkout whose touch commit is the shallow boundary'
says "touch: $REPO_TOUCH is this SHALLOW clone's boundary" 'the boundary sha is named AS a boundary'
lacks 'latest commit touching SKILL.md' 'and is not called the latest touch'
says 'deepen' 'the line says what to do about it'
rm -f "$shallow_file"
run "$H"
says "touch: $REPO_TOUCH — latest commit touching SKILL.md" 'with the shallow file gone the same sha is a measured touch again'

echo "== inputs the hook must survive at exit 0 =="
OUT="$("$H" </dev/null 2>/dev/null)"; RC=$?
exit0 'stdin closed (no envelope at all)'
says "$POINTER" 'and it still prints the pointer'
OUT="$(printf 'not json at all' | "$H" 2>/dev/null)"; RC=$?
exit0 'malformed stdin'
OUT="$(printf '' | "$H" 2>/dev/null)"; RC=$?
exit0 'empty stdin'
nogit="$(mktemp -d)"
for b in bash env cat sed grep head dirname; do p="$(command -v "$b")" && ln -s "$p" "$nogit/$b"; done
OUT="$(printf '{}' | PATH="$nogit" "$H" 2>/dev/null)"; RC=$?
rm -rf "$nogit"
exit0 'git not on PATH'
says 'touch: unavailable' 'without git the touch is reported unavailable, not invented'
says "$POINTER" 'and the pointer still prints'

echo "== syntax and mode =="
# The bash-3.2 floor itself is held repo-wide over `.claude/hooks/**` by
# `scripts/check-bash32-floor.mjs` (`pnpm check:bash32-floor`), whose scan has no filename
# allowlist and flags a construct's TOKEN wherever it stands; it is deliberately not re-scanned
# here, because spelling the forbidden tokens into a grep pattern is itself a finding there.
if bash -n "$hook" 2>/dev/null; then ok 'bash -n parses the hook'; else nope 'bash -n rejects the hook'; fi
if [ -x "$hook" ]; then ok 'the hook is executable'; else nope 'the hook is not executable'; fi

echo "== wiring: settings.json registers this hook on SessionStart =="
if [ -f "$settings" ]; then
  cmds="$(jq -r '.hooks.SessionStart[]?.hooks[]? | select(.type == "command") | .command' "$settings" 2>/dev/null || true)"
  case "$cmds" in
    *session-start-fleet.sh*) ok "settings.json runs session-start-fleet.sh on SessionStart ($(short "$settings"))" ;;
    *) nope "settings.json has no SessionStart command naming session-start-fleet.sh ($(short "$settings"))" ;;
  esac
  case "$cmds" in
    *'$CLAUDE_PROJECT_DIR/.claude/hooks/session-start-fleet.sh'*) ok 'the registration is spelled like its siblings ($CLAUDE_PROJECT_DIR/.claude/hooks/…)' ;;
    *) nope 'the registration does not use the sibling spelling $CLAUDE_PROJECT_DIR/.claude/hooks/session-start-fleet.sh' ;;
  esac
  pre="$(jq -r '.hooks.PreToolUse[]?.hooks[]? | .command' "$settings" 2>/dev/null || true)"
  case "$pre" in
    *session-start-fleet.sh*) nope 'the hook is ALSO wired as a PreToolUse guard — it prints context, it judges no tool call' ;;
    *) ok 'the hook is not wired as a PreToolUse guard' ;;
  esac
else
  nope "settings.json not found at $(short "$settings")"
fi

echo "== NON-VACUITY: the matrix can fail =="
# A copy that prints a different pointer must be caught by the same `says` the real hook
# passes; a copy that exits 1 must be caught by `exit0`. Both are run against the fixture.
MUT="$tmp/mut/.claude/hooks"; mkdir -p "$MUT"
sed 's/^printf .%s.n. "Fleet protocol: /printf "%s\\n" "Wrong pointer: /' "$hook" > "$MUT/session-start-fleet.sh"; chmod +x "$MUT/session-start-fleet.sh"
run "$MUT/session-start-fleet.sh"
case "$OUT" in
  *"$POINTER"*) nope 'a mutated pointer was NOT caught — the pointer assertion is vacuous' ;;
  *'Wrong pointer:'*) ok 'a mutated pointer is caught (the mutation really applied and `says` sees the difference)' ;;
  *) nope 'the mutation did not apply (sed anchor missed); the non-vacuity run proved nothing' ;;
esac
printf '#!/usr/bin/env bash\nexit 1\n' > "$MUT/session-start-fleet.sh"
run "$MUT/session-start-fleet.sh"
if [ "$RC" = 1 ]; then ok 'a copy that exits 1 is seen as exit 1 by `run` (so exit0 can fail)'; else nope "a copy that exits 1 read as exit $RC — exit0 cannot fail"; fi
# The trap is what makes an `-u` abort exit 0: a copy that references an unset variable
# under `set -u` must still exit 0, which the trap alone provides.
sed 's/^SKILL_REL=/: "$UNSET_ON_PURPOSE"\nSKILL_REL=/' "$hook" > "$MUT/session-start-fleet.sh"; chmod +x "$MUT/session-start-fleet.sh"
if grep -q 'UNSET_ON_PURPOSE' "$MUT/session-start-fleet.sh"; then
  run "$MUT/session-start-fleet.sh"
  exit0 'an unset-variable abort under set -u still exits 0 (the EXIT trap holds the contract)'
else
  nope 'the set -u mutation did not apply (sed anchor missed)'
fi

printf '\nsession-start-fleet selftest: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
