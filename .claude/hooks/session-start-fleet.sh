#!/usr/bin/env bash
# session-start-fleet.sh — SessionStart hook: prints the fleet-protocol pointer into the
# session's first context (stdout → context), so a session that did not discover this
# checkout's skills still learns where the dispatch rules live before it acts.
#
# Why: a multi-repo project session has the PARENT of several checkouts as its working
# directory. Each checkout's CLAUDE.md is loaded there, but a nested checkout's
# `.claude/skills/**` does not reach the session's skill list, so `/pm-dispatch` cannot be
# invoked and every seat read `SKILL.md` by hand only because the project's instructions said
# so. This hook puts the pointer in the context itself — the rule stays in the repository
# (one copy, in `SKILL.md`; this prints a pointer to it, never a second copy of the rules).
#
# What it prints — at most ~15 lines, measured by its self-test:
#   1. the pointer: read `.claude/skills/pm-dispatch/SKILL.md` and the stage references its
#      index names before any dispatch, claim, review or landing act;
#   2. the latest touch of `SKILL.md` on this checkout's HEAD (`git log -1 -- <path>`), so a
#      seat can compare it with the opening mark it left (seat-lifecycle.md 〈开轮互斥〉).
#      ⚠️ On a SHALLOW clone `git log -1 -- <path>` names the graft BOUNDARY whenever no commit
#      above the shallow floor touched the path: git treats the boundary as a root and diffs
#      it against the empty tree, so every path reads as touched there, at exit 0, with no
#      warning. A sha that is a boundary is therefore labelled as one, never presented as a
#      measured touch — a sha printed without that label is a real touch;
#   3. the lane line: `OS_FLEET_LANE` names a lane (set by the project's instructions or the
#      environment this hook runs in) ⇒ the lane's seat-post number, read from a line of the
#      form `Seat post: #<n>` in `references/lanes/<lane>.md`, and the reminder that the
#      seat post is a stub; absent ⇒ `lane: not set`. A lane file with no such line says so,
#      rather than inventing a number.
#
# What it never does: no network, no GitHub read, no write to any file. It exits 0 ALWAYS —
# a hook that fails must never block a session — so every read below tolerates absence
# (no git, not a checkout, no skill file, no lane file, unreadable stdin) and prints what it
# could not read instead of failing. Everything is located relative to THIS FILE's path,
# never the cwd and never `$CLAUDE_PROJECT_DIR`: in a project session the cwd is the parent
# of the checkouts, and the project dir is whatever the harness decided.
#
# Floor is bash 3.2 (macOS ships no bash 4+): no mapfile, no associative arrays, no `${x,,}`.
# Dependency-free: bash, git (optional), coreutils. No jq — the stdin envelope is not read.
#
# Self-test (no network, no build): .claude/hooks/session-start-fleet.selftest.sh

set -u

# Exit 0 whatever happens below — including an `-u` abort or a signal mid-run. The trap is the
# contract, the `exit 0` at the foot is its ordinary path.
trap 'exit 0' EXIT

# The harness hands a JSON envelope on stdin; nothing in it is needed here. Drain it so a
# writer that waits for the read does not stall, and never fail on a closed or absent stdin.
cat >/dev/null 2>&1 || true

SKILL_REL='.claude/skills/pm-dispatch/SKILL.md'
LANES_REL='.claude/skills/pm-dispatch/references/lanes'

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || here=""
repo=""
if [ -n "$here" ]; then
  repo="$(cd "$here/../.." 2>/dev/null && pwd)" || repo=""
fi

# --- 1. the pointer ------------------------------------------------------------------------
printf '%s\n' "Fleet protocol: read .claude/skills/pm-dispatch/SKILL.md (and the stage references its index names) before any dispatch, claim, review or landing act."

# --- 2. where the skill is, and its latest touch -------------------------------------------
if [ -z "$repo" ]; then
  printf '%s\n' "  SKILL.md: this hook could not resolve its own checkout (dirname of ${BASH_SOURCE[0]} unreadable); open the file by hand."
elif [ ! -f "$repo/$SKILL_REL" ]; then
  printf '%s\n' "  SKILL.md: MISSING at $repo/$SKILL_REL — this checkout carries no pm-dispatch protocol; nothing to load here."
else
  printf '%s\n' "  SKILL.md: $repo/$SKILL_REL"
  if command -v git >/dev/null 2>&1 && git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    head_short="$(git -C "$repo" rev-parse --short HEAD 2>/dev/null)" || head_short=""
    touch_full="$(git -C "$repo" log -1 --format=%H -- "$SKILL_REL" 2>/dev/null)" || touch_full=""
    touch_short="$(git -C "$repo" log -1 --format=%h -- "$SKILL_REL" 2>/dev/null)" || touch_short=""
    if [ -z "$touch_short" ]; then
      printf '%s\n' "  touch: unavailable — git log named no commit for $SKILL_REL on HEAD ${head_short:-?} (an untracked copy, or history the clone does not hold)."
    else
      # A shallow clone's graft boundaries live in the `shallow` file of the git dir; a touch
      # that IS one of them is the boundary artefact described in the header, not a reading.
      shallow_file="$(git -C "$repo" rev-parse --git-path shallow 2>/dev/null)" || shallow_file=""
      case "$shallow_file" in
        "") ;;
        /*) ;;
        *) shallow_file="$repo/$shallow_file" ;;
      esac
      boundary=0
      if [ -n "$shallow_file" ] && [ -f "$shallow_file" ] && grep -qx "$touch_full" "$shallow_file" 2>/dev/null; then
        boundary=1
      fi
      if [ "$boundary" = 1 ]; then
        printf '%s\n' "  touch: $touch_short is this SHALLOW clone's boundary, not a measured touch of SKILL.md (HEAD ${head_short:-?}); the real touch is older than the clone holds — deepen (git fetch --deepen=<n> origin) or read it from a full checkout before comparing with an opening mark."
      else
        printf '%s\n' "  touch: $touch_short — latest commit touching SKILL.md on HEAD ${head_short:-?}; compare with the opening mark (seat-lifecycle.md 〈开轮互斥〉) before the round."
      fi
    fi
  else
    printf '%s\n' "  touch: unavailable — $repo is not a git work tree here, or git is not on PATH; read SKILL.md itself."
  fi
fi

# A session rooted somewhere other than this checkout is exactly the case this hook exists
# for; say so once, so the reader knows why the skill list did not show pm-dispatch.
if [ -n "$repo" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ "${CLAUDE_PROJECT_DIR%/}" != "$repo" ]; then
  printf '%s\n' "  note: this session's project dir is not this checkout, so the harness's skill list does not include this checkout's .claude/skills — hence this pointer."
fi

# --- 3. the lane line ----------------------------------------------------------------------
STUB='the seat post is a stub; posture and ledger live in the project'
lane="${OS_FLEET_LANE:-}"
if [ -z "$lane" ]; then
  printf '%s\n' "lane: not set (OS_FLEET_LANE names the lane; set it in the environment this hook runs in — the project's instructions or the agent's launch environment)."
else
  # A lane name is a file stem under references/lanes/: letters, digits, `-`, `_`. Anything
  # else is refused before it is spelled into a path, and the refusal names the rule, not
  # the value, so a malformed value cannot smuggle text into the context.
  case "$lane" in
    *[!A-Za-z0-9_-]*)
      printf '%s\n' "lane: OS_FLEET_LANE refused — a lane name is letters, digits, - or _ only (the stem of references/lanes/<lane>.md); $STUB." ;;
    *)
      lane_file="$LANES_REL/$lane.md"
      if [ -z "$repo" ] || [ ! -f "$repo/$lane_file" ]; then
        printf '%s\n' "lane: $lane · no $lane_file on this checkout, so its seat post cannot be named here; $STUB."
      else
        # First `Seat post: #<n>` line, any bullet/emphasis prefix; digits only, so a sentence
        # that merely mentions the words cannot pass a number it does not carry.
        seat_post="$(sed -n 's/^[^A-Za-z]*[Ss]eat post:[[:space:]]*#\([0-9][0-9]*\).*$/\1/p' "$repo/$lane_file" 2>/dev/null | head -1)" || seat_post=""
        if [ -n "$seat_post" ]; then
          printf '%s\n' "lane: $lane · seat post #$seat_post ($lane_file); $STUB."
        else
          printf '%s\n' "lane: $lane · seat post: not recorded in $lane_file (no \`Seat post: #<n>\` line); read the pm:seat index for it; $STUB."
        fi
      fi ;;
  esac
fi

exit 0
