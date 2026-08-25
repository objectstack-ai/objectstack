#!/usr/bin/env bash
# os-verify-lock.sh — the single entry point for this container's shared
# heavy-verify lock (`/tmp/os-heavy-verify.lock`).
#
#   scripts/pm/os-verify-lock.sh -c 'pnpm --filter @objectstack/core test'
#   scripts/pm/os-verify-lock.sh -- pnpm --filter @objectstack/core test
#   scripts/pm/os-verify-lock.sh --status        # holder, how long it has held, the queue
#   scripts/pm/os-verify-lock.sh --show-budget   # the acquisition budget this call would use
#   scripts/pm/os-verify-lock.sh --self-test     # verify this script
#
# Exit codes: 99 means THIS CALL NEVER ACQUIRED the lock (the same code the
# free-hand `flock -E 99` convention this replaces used, so callers migrate
# without changing how they branch). Anything else is the wrapped command's own
# exit code — including a command that itself exits 99, which is why every run
# ends with a VERDICT line naming which of the two happened. Read the verdict
# line, never a bare `$?`.
#
# A host with no usable `flock` runs in DECLARED UNLOCKED MODE (see the block
# below): the command runs and its own exit code passes through, so 99 keeps
# meaning exactly what it meant — "never got a turn" — and never doubles as
# "this host has no lock". The VERDICT line is where the difference is stated.
#
# ---------------------------------------------------------------------------
# WHY AN ENTRY POINT AND NOT A CONVENTION
#
# The convention it replaces was: `flock -E 99 -w 540 /tmp/os-heavy-verify.lock
# -c '<cmd>'`, with the 540 explained in prose. Three mechanisms were measured
# in this container while that was the whole mechanism:
#
#   1. WAITER ASYMMETRY — the one that makes obeying the rule a losing strategy.
#      `flock(2)` is not FIFO: it grants to whichever waiter happens to be
#      blocked when the lock frees, so the DUTY CYCLE of a waiter decides who
#      wins, not its arrival. A compliant waiter (`-w 540`) is present for nine
#      minutes, times out, goes off to do lock-free work, and comes back — it is
#      absent from the queue for part of every cycle. A waiter that wrote
#      `-w 3000` is continuously resident for fifty. Measured, one container,
#      five live waiters: three exceeded the declared cap, by up to 6x, and the
#      two compliant ones were the ones not verifying. One dev burned 68 minutes
#      over 9 attempts, every one returning 99, and correctly declared its
#      ablation unrun rather than running unlocked.
#
#   2. LONG HOLDERS — a single run held the lock 28+ minutes straight, which
#      lengthens every cycle underneath (1). Nothing made that holder visible
#      except another agent going and looking with `fuser`.
#
#   3. ORPHANED FD HOLDERS — a backgrounded child inherited the caller's lock
#      fd and kept the lock long after the caller was gone (see the lifecycle
#      block in scripts/gen-sdui-manifest.sh, where that was diagnosed).
#
# A declared cap that nothing enforces is not a convention when its violators
# win. So the cap moves from prose into the call site: this entry point takes no
# `-w` at all, and the only knob (`OS_VERIFY_LOCK_WAIT`) can lower the budget,
# never raise it. That is (a). Grants are ordered by a ticket file, so presence
# stops deciding winners — (b). And every run reports how long it held, loudly
# past a threshold, so the next long holder names itself instead of waiting to
# be found — (c).
#
# ---------------------------------------------------------------------------
# HOW THE ORDERING WORKS, AND WHAT IT DELIBERATELY DOES NOT DO
#
# `flock` remains the ONLY mutual-exclusion primitive. The ticket queue is
# ADVISORY ORDER layered on top of it and holds no exclusion of its own. That
# split is the whole coexistence story, so it is stated rather than implied:
#
#   - Every entry-point call drops a ticket file named by arrival time into
#     `<lock>.q/`. Only the ticket at the HEAD of the live queue ever calls
#     `flock`; everyone else polls. Head-only means no thundering herd, and
#     headship is stable — tickets sort by arrival and the ones ahead of you can
#     only disappear.
#
#   - A LEGACY free-hand `flock` user (an agent still on the old line, or any
#     script that locks this file directly) contends on the same file with the
#     same primitive. Mutual exclusion is unaffected — it cannot corrupt the
#     queue, deadlock it, or run concurrently with an entry-point holder. What
#     it can do is win a grant ahead of the queue head, because it never took a
#     ticket. So during rollout the guarantee degrades to: entry-point callers
#     are FIFO AMONG THEMSELVES, legacy callers behave exactly as they do today,
#     and nobody loses exclusion. `--status` still names a legacy holder (via
#     `fuser`/`lsof`), it just cannot report its duration — it never registered.
#
#   - A waiter that dies, is killed, or times out leaves at most one stale
#     ticket, and a stale ticket cannot wedge the queue: tickets are pruned by
#     liveness (pid present AND its `/proc` start time unchanged, so a reused
#     pid does not resurrect a dead ticket) and by an absolute age bound. If the
#     queue directory cannot be used at all, acquisition FALLS BACK to a plain
#     capped `flock` with a warning: the ordering layer is best-effort, the cap
#     and the exclusion are not.
#
# The lock fd is closed in the wrapped command's child (`9>&-`), so a process
# the command leaves behind cannot inherit the lock — mechanism 3 above.
# Release still belongs to the fd: this script never hand-rolls a lockfile, and
# a kill -9 at any point releases the lock the moment the process dies.
#
# ---------------------------------------------------------------------------
# THE LOCK IS LINUX-ONLY, AND A HOST WITHOUT `flock` SAYS SO RATHER THAN STOPS
#
# Maintainer ruling, 2026-08-22: the shared verification lock is declared
# Linux-only. `flock` is util-linux; a stock macOS does not ship it, and it is
# the only mutual-exclusion primitive here. On such a host this entry point runs
# in DECLARED UNLOCKED MODE — it runs the command, with no exclusion, and writes
# the degradation into the VERDICT line so it is visible and auditable — instead
# of refusing at exit 99 and leaving the agent with no route at all.
#
# Three properties of that mode, each load-bearing:
#
#   - IT IS NOT A SECOND PRIMITIVE. No lockfile, no PID file, no holder record,
#     no queue ticket — nothing is created that could outlive the process, so
#     there is nothing to reap and `kill -9` stays free. A hand-rolled lockfile
#     was the option this ruling rejected; anything here that needs reaping is
#     that option built by accident.
#
#   - IT BRANCHES ON THE PRIMITIVE, NOT ON THE PLATFORM. The trigger is the
#     FUNCTIONAL flock probe in `preflight` failing — so a Linux container
#     without util-linux degrades the same way, and a macOS host that HAS
#     `flock` (brew) takes the ordinary locked path. `uname` is never consulted.
#
#   - IT IS LOUD, AND IT HANDS OVER THE DISCLOSURE TEXT. Verification that runs
#     unlocked has to be declared in the PR body; two cards did that by hand
#     before this mode existed, and their wording is the official format
#     `unlocked_disclosure` prints — ready to paste, so the declaration is a
#     copy rather than a composition.
#
# Everything above this block is unchanged by that mode: where `flock` works,
# the acquisition path, the ordering layer, the budget and every verdict are
# exactly what they were.
#
# ---------------------------------------------------------------------------
# THE BASH 3.2 FLOOR, AND WHY A MISSING BUILTIN IS THE WORST FAILURE HERE
#
# `/usr/bin/env bash` is bash 3.2.57 on macOS. A bash 4+/5+ construct in this
# file therefore does not fail on a fringe host; it fails on the ordinary one.
# And it does not fail LOUDLY. Measured against the version of this script that
# used `mapfile` and `EPOCHSECONDS`, run under a bash 3.2.57 built from source
# for the purpose: 4870 error lines in 20 seconds — 1623 acquisition passes,
# ~81 per second — the wrapped command never run, and ZERO `VERDICT` lines. The
# run ended because a 20s `timeout` killed it, not because anything in the
# script concluded. The caller is told to read the verdict, and there was none
# to read.
#
# The mechanism is worth stating because it is what makes the class dangerous
# rather than merely broken: `EPOCHSECONDS` unbound makes `now_s` empty, so
# `deadline` is 540 and `now` is 0, so `((now >= deadline))` is false FOREVER.
# The acquisition budget cannot expire, because the thing that expires it is the
# thing that broke. A missing builtin turns a bounded wait into an unbounded
# spin that burns CPU against the very build the lock exists to protect.
#
# Hence, in this file: no `mapfile`/`readarray`, no bare `EPOCHSECONDS` or
# `EPOCHREALTIME`, no `exec {fd}>` auto-allocation (fd 9 is used explicitly and
# closed in the child), no `${x^^}`/`${x,,}`, no `declare -A`, and no
# `"${arr[@]}"` on a possibly-empty array (fatal under `set -u` before 4.4).
# `--self-test` enforces this both ways: a static scan for the parse-level
# constructs, and a run with `EPOCHSECONDS`/`EPOCHREALTIME` unset and
# `mapfile`/`readarray` disabled, which is what bash 3.2 actually looks like.
#
# Host capabilities are checked up front instead (`preflight`), for the same
# reason: a `flock` that exits 127 on every slice is an unbounded retry, not a
# wait. At second zero, WITH a verdict, is where that has to be decided — a
# silent spin is the one outcome this wrapper must never produce. WHICH verdict
# depends on what failed: a missing clock or an unusable arrival stamp is still
# a refusal (`lock-unusable`, exit 99), because without them the wait itself is
# unbounded; a missing `flock` is the declared unlocked run above, because there
# is nothing left to wait FOR.
# ---------------------------------------------------------------------------

set -uo pipefail

# The declared invariant, in one place: an acquisition wait must fit inside a
# single foreground agent call (harness ceiling: 10 minutes). Everything above
# this is unrepresentable through this entry point — that is the point of the
# entry point, so it is a constant and not an option.
readonly HARD_CAP_S=540
readonly DEFAULT_WAIT_S=540

# Past this, a holder is loud about itself on release. 15 minutes: the measured
# long holder was 28+, an ordinary targeted package build is well under.
readonly LONG_HOLD_WARN_S="${OS_VERIFY_LOCK_LONG_HOLD_WARN:-900}"

readonly POLL_S=1          # queue poll while not head
readonly SLICE_S=30        # flock slice while head, so waiting still reports
readonly PROGRESS_EVERY_S=30

# `OS_VERIFY_LOCK_FILE` exists so --self-test can run real two-process
# contention without touching the shared lock. Pointing real verification at a
# private lock defeats the serialisation the lock exists for; don't.
LOCK_FILE="${OS_VERIFY_LOCK_FILE:-/tmp/os-heavy-verify.lock}"

# `flock` is the ONLY mutual-exclusion primitive here, so its absence is the
# whole of the degradation: no flock, no exclusion, and the run says so.
# `OS_VERIFY_LOCK_FLOCK` exists so --self-test can drive that path with a flock
# that is missing on purpose. Pointing real verification at a flock that isn't
# one removes the exclusion the lock exists for; don't.
FLOCK_BIN="${OS_VERIFY_LOCK_FLOCK:-flock}"

QUEUE_DIR="${LOCK_FILE}.q"
HOLDER_FILE="${LOCK_FILE}.holder"
# `OS_VERIFY_LOCK_LEDGER` exists for the same reason `OS_VERIFY_LOCK_FILE` does:
# so --self-test can exercise the recording without writing fixtures into the
# fleet's real measurement record. Pointing real verification at a private
# ledger just makes its runs invisible to `--report`; don't.
LEDGER_FILE="${OS_VERIFY_LOCK_LEDGER:-${LOCK_FILE}.ledger}"
readonly TICKET_MAX_AGE_S=$((HARD_CAP_S + 300))

# How long a PARKED slot keeps the arrival stamp it is holding a place with.
# Three budgets: long enough that an agent doing lock-free work between
# attempts still finds its place, short enough that the priority a slot carries
# over later arrivals is bounded and declared rather than indefinite.
readonly SLOT_MAX_AGE_S=$((HARD_CAP_S * 3))

# Past this the ledger stops growing. A record is ~150 bytes, so this is tens
# of thousands of runs; `--report` says so rather than silently reporting on a
# truncated population.
readonly LEDGER_MAX_BYTES=8388608

SELF="${BASH_SOURCE[0]}"
TICKET=""
HOLDING=0
BUDGET_NOTE=""
SLOT_SLUG=""
ARRIVAL_DEPTH=-1
LEDGER_WRITTEN=0
LABEL_FOR_LEDGER="?"

log() { printf 'os-verify-lock: %s\n' "$*" >&2; }

# Seconds since epoch. `EPOCHSECONDS` is bash 5.0+ and is FATAL under `set -u`
# on anything older, so it is read guarded and `date +%s` is the floor. Failing
# loudly (return 1) matters more than returning something: an empty clock is
# what made the acquisition deadline unreachable.
now_s() {
  local s="${EPOCHSECONDS:-}"
  case "$s" in '' | *[!0-9]*) s="$(date +%s 2> /dev/null)" ;; esac
  case "$s" in '' | *[!0-9]*) return 1 ;; esac
  printf '%s' "$s"
}

# Which sub-second clock this host can offer `now_stamp`:
#   ns — `EPOCHREALTIME` (bash 5+) or GNU `date +%s%N`
#   us — perl Time::HiRes (present on stock macOS, where the two above are not)
#   s  — nothing better than whole seconds
# BSD/macOS `date` has no `%N`: it echoes the literal `N`, `printf '%020d'`
# rejects the result, and the ticket filename comes out EMPTY — which is the
# `<queue-dir>/: No such file or directory` line in the bug report. So the
# result of `date +%s%N` is validated rather than assumed.
stamp_resolution() {
  [[ -n "${EPOCHREALTIME:-}" ]] && {
    printf 'ns'
    return 0
  }
  case "$(date +%s%N 2> /dev/null)" in
    '' | *[!0-9]*) ;;
    *)
      printf 'ns'
      return 0
      ;;
  esac
  if perl -MTime::HiRes -e 1 > /dev/null 2>&1; then
    printf 'us'
    return 0
  fi
  printf 's'
}

# Sub-second arrival stamp, zero-padded so plain lexical (glob) order IS arrival
# order. `EPOCHREALTIME` renders its separator per locale, hence the character
# class. On a host with only whole-second resolution the ordering layer degrades
# to per-second FIFO with pid tie-breaks — declared, not silent: `--status` says
# so, and exclusion and the cap are unaffected either way.
now_stamp() {
  local raw='' secs
  case "$(stamp_resolution)" in
    ns)
      raw="${EPOCHREALTIME:-}"
      raw="${raw/[.,]/}"
      case "$raw" in '' | *[!0-9]*) raw="$(date +%s%N 2> /dev/null)" ;; esac
      ;;
    us)
      raw="$(perl -MTime::HiRes -e 'my $t = Time::HiRes::time(); printf "%d%06d000", int($t), int(($t - int($t)) * 1000000);' 2> /dev/null)"
      ;;
  esac
  case "$raw" in
    '' | *[!0-9]*)
      secs="$(now_s 2> /dev/null)" || secs=''
      case "$secs" in '' | *[!0-9]*) secs=0 ;; esac
      raw="${secs}000000000"
      ;;
  esac
  printf '%020d' "$raw"
}

# Is this pid still around? `/proc` where there is one — fork-free, and the
# authoritative answer on Linux — and `kill -0` where there is not (macOS/BSD
# have no `/proc` at all). Same-user only, which is the case here: every agent
# in a container runs as the same user.
pid_alive() {
  if [[ -d /proc/self ]]; then
    [[ -d "/proc/${1}" ]]
  else
    kill -0 "$1" 2> /dev/null
  fi
}

# A stable ALL-DIGIT identity for a pid's start time, so a reused pid cannot
# resurrect a dead ticket. Two implementations, and they are NOT equivalent:
#
#   Field 22 of /proc/<pid>/stat (Linux) — clock-tick resolution, exact. Strips
#   through the LAST ') ' first: field 2 is the comm, which may itself contain
#   spaces and parens.
#
#   `ps -p <pid> -o lstart=` (macOS/BSD) — WHOLE-SECOND resolution, run through
#   `cksum` because the ticket format is space-separated and `lstart` is not. A
#   pid reused inside the same second is not distinguished, which is strictly
#   weaker; that is why the `/proc` path stays first rather than being replaced.
proc_starttime() {
  local pid="$1" stat rest out
  if [[ -r "/proc/${pid}/stat" ]]; then
    stat="$(< "/proc/${pid}/stat")" || return 1
    rest="${stat##*) }"
    [[ "$rest" != "$stat" ]] || return 1
    awk '{ print $20 }' <<< "$rest"
    return 0
  fi
  # `/proc` exists but this pid has no stat file: the pid is gone, not remote.
  [[ -d /proc/self ]] && return 1
  out="$(ps -p "$pid" -o lstart= 2> /dev/null)" || return 1
  [[ -n "$out" ]] || return 1
  printf '%s' "$out" | cksum | awk '{ print $1 }'
}

# Can ticket liveness be decided AT ALL on this host? If not, the ordering layer
# would prune every ticket including our own on the next scan, we would never
# reach the head, and the loop would re-mint tickets until something killed it.
# Unordered acquisition is the correct answer there — the cap and the exclusion
# do not depend on the queue.
liveness_usable() {
  local mine
  mine="$(proc_starttime "$$" 2> /dev/null)" || return 1
  case "$mine" in '' | *[!0-9]*) return 1 ;; esac
  return 0
}

# --- budget -----------------------------------------------------------------

# Sets BUDGET (seconds) and BUDGET_NOTE. The clamp is the enforcement half:
# a caller asking for more than the cap gets the cap, and gets told.
effective_budget() {
  local want="${OS_VERIFY_LOCK_WAIT:-$DEFAULT_WAIT_S}"
  BUDGET_NOTE=""
  case "$want" in
    '' | *[!0-9]*)
      BUDGET_NOTE="OS_VERIFY_LOCK_WAIT='${want}' is not a number — using the default ${DEFAULT_WAIT_S}s"
      want="$DEFAULT_WAIT_S"
      ;;
  esac
  if ((want > HARD_CAP_S)); then
    BUDGET_NOTE="OS_VERIFY_LOCK_WAIT=${want} exceeds the declared cap — clamped to ${HARD_CAP_S}s (an acquisition wait must fit inside one foreground call)"
    want="$HARD_CAP_S"
  fi
  ((want < 1)) && want=1
  BUDGET="$want"
}

# --- ticket queue -----------------------------------------------------------

queue_usable() {
  mkdir -p "$QUEUE_DIR" 2> /dev/null || return 1
  chmod 1777 "$QUEUE_DIR" 2> /dev/null || true
  [[ -w "$QUEUE_DIR" ]]
}

# ticket file: "<pid> <starttime> <arrival-epoch> <label>"
#
# A PARKED slot writes pid 0 and starttime 0 -- there is no process behind it,
# which is the whole point -- so pid 0 is what tells the two kinds apart. It is
# not a value a real ticket can carry: no waiter here runs as pid 0.
#
# Three states, not two, and the third is why this is a classifier rather than
# the predicate it replaced. `dead` is removed from disk, `active` is queued,
# and `parked` is RETAINED but not queued: retained because its arrival stamp
# is the place it is keeping, not queued because nobody is waiting behind it.
# Collapsing parked into either of the others loses one of those two halves --
# into `dead` and the place is gone, into `active` and a caller that walked
# away blocks the head.
ticket_state() {
  local file="$1" pid start stamp now age
  read -r pid start stamp _ < "$file" 2> /dev/null || {
    printf 'dead'
    return 0
  }
  case "$pid$start$stamp" in
    '' | *[!0-9]*)
      printf 'dead'
      return 0
      ;;
  esac
  now="$(now_s)" || {
    # No clock: say nothing is dead rather than pruning the whole queue on a
    # reading we could not take. Over-retention costs a slower scan; the
    # opposite would delete every waiter's place, our own included.
    printf 'parked'
    return 0
  }
  age=$((now - stamp))
  if [[ "$pid" == 0 ]]; then
    ((age <= SLOT_MAX_AGE_S)) && {
      printf 'parked'
      return 0
    }
    printf 'dead'
    return 0
  fi
  pid_alive "$pid" || {
    printf 'dead'
    return 0
  }
  [[ "$(proc_starttime "$pid" 2> /dev/null || echo x)" == "$start" ]] || {
    printf 'dead'
    return 0
  }
  ((age <= TICKET_MAX_AGE_S)) || {
    printf 'dead'
    return 0
  }
  printf 'active'
}

# Kept for the self-test's liveness cases and for any caller that only wants
# the yes/no: a ticket is "alive" when a process is really waiting behind it.
ticket_alive() {
  [[ "$(ticket_state "$1")" == active ]]
}

# Live tickets, FIFO order, pruning the dead ones on the way past. Parked slots
# are skipped WITHOUT being removed -- they hold a place, they do not hold up a
# queue.
queue_live() {
  local file
  shopt -s nullglob
  for file in "$QUEUE_DIR"/*; do
    [[ -f "$file" ]] || continue
    case "$(ticket_state "$file")" in
      active) printf '%s\n' "$file" ;;
      parked) ;;
      *) rm -f "$file" 2> /dev/null || true ;;
    esac
  done
  shopt -u nullglob
}

# Parked slots only, for --status. A place being kept is fleet state, and state
# nobody can see is how the last mechanism in this file came to need a dispatch
# seat to correlate it by hand.
queue_parked() {
  local file
  shopt -s nullglob
  for file in "$QUEUE_DIR"/*; do
    [[ -f "$file" ]] || continue
    [[ "$(ticket_state "$file")" == parked ]] && printf '%s\n' "$file"
  done
  shopt -u nullglob
}

# Find this call's parked slot, if it left one behind on an earlier turn. The
# slot name lives in the FILENAME rather than the file body so that finding it
# is a glob and not a scan -- and the arrival stamp stays the filename's
# prefix, so a resumed slot keeps sorting exactly where it did.
slot_ticket_path() {
  local file out=''
  shopt -s nullglob
  for file in "$QUEUE_DIR"/*-s"$1"; do
    [[ -f "$file" ]] && out="$file"
  done
  shopt -u nullglob
  [[ -n "$out" ]] && printf '%s' "$out"
}

take_ticket() {
  local label="$1" start existing pid0 start0 stamp0
  start="$(proc_starttime "$$" 2> /dev/null || true)"

  # Resume a place kept on an earlier foreground call, if there is one and it
  # has not aged out. The arrival stamp is read back from the ticket and
  # written again unchanged: that field is the place, so re-stamping it here
  # would silently send the caller to the back while reporting a resume.
  if [[ -n "$SLOT_SLUG" ]]; then
    existing="$(slot_ticket_path "$SLOT_SLUG")"
    if [[ -n "$existing" && "$(ticket_state "$existing")" != dead ]]; then
      read -r pid0 start0 stamp0 _ < "$existing" 2> /dev/null || stamp0=''
      case "$stamp0" in
        '' | *[!0-9]*) ;;
        *)
          if printf '%s %s %s %s\n' "$$" "$start" "$stamp0" "$label" > "$existing" 2> /dev/null; then
            TICKET="$existing"
            local kept
            kept="$(now_s 2> /dev/null)" || kept=''
            case "$kept" in
              '' | *[!0-9]*) log "resumed slot '${SLOT_SLUG}' — keeping the place it already held" ;;
              *) log "resumed slot '${SLOT_SLUG}' — keeping the place it took $(human_s $((kept - stamp0))) ago" ;;
            esac
            return 0
          fi
          ;;
      esac
    fi
  fi

  if [[ -n "$SLOT_SLUG" ]]; then
    TICKET="${QUEUE_DIR}/$(now_stamp)-s${SLOT_SLUG}"
  else
    TICKET="${QUEUE_DIR}/$(now_stamp)-$$"
  fi
  printf '%s %s %s %s\n' "$$" "$start" "$(now_s)" "$label" > "$TICKET" 2> /dev/null || {
    TICKET=""
    return 1
  }
  return 0
}

# Turn our ticket into a kept place instead of deleting it. Writing pid 0 is
# what makes it parked; the arrival stamp is preserved verbatim.
park_ticket() {
  local pid0 start0 stamp0 label0
  [[ -n "$TICKET" && -f "$TICKET" ]] || return 1
  read -r pid0 start0 stamp0 label0 < "$TICKET" 2> /dev/null || return 1
  case "$stamp0" in '' | *[!0-9]*) return 1 ;; esac
  printf '0 0 %s %s\n' "$stamp0" "${label0:-?}" > "$TICKET" 2> /dev/null || return 1
  return 0
}

# Runs on EVERY exit from the acquisition path, the killed ones included --
# which is the case that matters most here. A call cut short by the harness's
# foreground ceiling while queued is precisely the caller that should not lose
# its place, and it has no chance to ask for that on the way out.
cleanup() {
  if [[ -n "$TICKET" ]]; then
    if ((HOLDING == 0)) && [[ -n "$SLOT_SLUG" ]] && park_ticket; then
      : # place kept
    else
      rm -f "$TICKET" 2> /dev/null
    fi
  fi
  if ((HOLDING == 1)); then rm -f "$HOLDER_FILE" 2> /dev/null; fi
  return 0
}

# --- holder reporting -------------------------------------------------------

# holder file: "<pid> <starttime> <acquired-epoch> <label>"
write_holder() {
  local label="$1" start
  start="$(proc_starttime "$$" 2> /dev/null || true)"
  printf '%s %s %s %s\n' "$$" "$start" "$(now_s)" "$label" > "$HOLDER_FILE" 2> /dev/null || true
}

# One line describing whoever holds the lock right now, for a waiter's progress
# output and for --status. Three cases, and it says which one it is: a
# registered entry-point holder (duration known), a legacy holder that never
# registered (named, duration unknown), or free.
holder_line() {
  local pid start stamp label held
  if [[ -f "$HOLDER_FILE" ]] && read -r pid start stamp label < "$HOLDER_FILE" 2> /dev/null; then
    if pid_alive "$pid" && [[ "$(proc_starttime "$pid" 2> /dev/null || echo x)" == "$start" ]]; then
      held=$(($(now_s) - stamp))
      printf 'holder pid %s, held %ss — %s' "$pid" "$held" "${label:-?}"
      return 0
    fi
    rm -f "$HOLDER_FILE" 2> /dev/null || true
  fi
  if lock_is_held; then
    printf 'holder did NOT come through this entry point (no duration available); processes with the lock file open: %s' \
      "$(open_file_pids)"
    return 0
  fi
  printf 'lock is free'
}

# Definitive held/free: a non-blocking acquisition attempt in a child. `fuser`
# alone cannot answer this — it lists every process with the file OPEN, which
# includes the waiters.
lock_is_held() {
  "$FLOCK_BIN" -n -E 99 "$LOCK_FILE" -c true > /dev/null 2>&1
  (($? == 99))
}

# Whoever has the lock file open, for the legacy-holder line. `fuser` is
# util-linux and absent on macOS, so `lsof` is tried too before giving up.
open_file_pids() {
  local out=''
  if command -v fuser > /dev/null 2>&1; then
    out="$(fuser "$LOCK_FILE" 2> /dev/null | tr -s ' ')"
  fi
  if [[ -z "${out// /}" ]] && command -v lsof > /dev/null 2>&1; then
    out="$(lsof -t "$LOCK_FILE" 2> /dev/null | tr '\n' ' ')"
  fi
  [[ -n "${out// /}" ]] && {
    printf '%s' "$out"
    return 0
  }
  printf 'unknown'
}

human_s() {
  local s="$1"
  if ((s >= 60)); then printf '%ss (%dm%02ds)' "$s" $((s / 60)) $((s % 60)); else printf '%ss' "$s"; fi
}

# --- the ledger -------------------------------------------------------------
#
# WHY A LEDGER AND NOT MORE STDERR.
#
# Every number this wrapper already knows -- how long a call queued, how long
# it held, how deep the queue was when it arrived -- is printed to the stderr
# of ONE agent and then gone. That is the reason contention on this lock could
# only ever be characterised anecdotally: each agent sees its own bad luck, and
# establishing that the bad luck is systemic took a dispatch seat correlating
# three devs' reports by hand across one shift. A per-run line that nobody
# keeps cannot answer "which command dominates hold time", which is the only
# question that says where a fix should go.
#
# So each terminal outcome appends ONE record here, and `--report` aggregates
# them. Two properties are deliberate:
#
#   - IT RECORDS THE NON-RUNS TOO. A `queue-timeout` and a `lock-unusable` are
#     the records that matter most, because they are the ones whose evidence
#     otherwise vanishes: the run produced no output to keep, and the next
#     reader is left with whatever older artifact is lying around. A ledger
#     that only recorded successful acquisitions would make the fleet look
#     healthier the more it starved.
#
#   - IT NEVER FAILS THE CALL. Every write is best-effort and its failure is
#     swallowed. This file exists to measure verification, and a measurement
#     apparatus that can redden a gate has become part of the thing it
#     measures. An unwritable /tmp loses records; it does not lose runs.
#
# Format: one line, space-separated `key=value` with the free-text label LAST,
# so a label containing spaces cannot displace a field. Appends are a single
# short `printf` to an O_APPEND fd, which is atomic on Linux for writes this
# size -- concurrent agents interleave records, never characters.
ledger_append() {
  local outcome="$1" waited="$2" held="$3" rc="$4" label="$5" ts size
  ((LEDGER_WRITTEN == 1)) && return 0
  LEDGER_WRITTEN=1
  ts="$(now_s 2> /dev/null)" || ts=0
  case "$ts" in '' | *[!0-9]*) ts=0 ;; esac
  if [[ -f "$LEDGER_FILE" ]]; then
    size="$(wc -c < "$LEDGER_FILE" 2> /dev/null | tr -d ' ')"
    case "$size" in
      '' | *[!0-9]*) ;;
      *) ((size > LEDGER_MAX_BYTES)) && return 0 ;;
    esac
  fi
  # Newlines and tabs would break the one-record-per-line contract; the label
  # is a command string and can contain either.
  label="$(printf '%s' "$label" | tr '\n\t' '  ' | cut -c1-200)"
  printf '%s outcome=%s waited=%s held=%s depth=%s rc=%s pid=%s label=%s\n' \
    "$ts" "$outcome" "$waited" "$held" "$ARRIVAL_DEPTH" "$rc" "$$" "$label" \
    >> "$LEDGER_FILE" 2> /dev/null || true
  chmod 666 "$LEDGER_FILE" 2> /dev/null || true
  return 0
}

# --- slots: keeping a place across foreground calls -------------------------
#
# THE PROBLEM THIS SOLVES, STATED EXACTLY, BECAUSE IT IS NOT THE OBVIOUS ONE.
#
# An agent's call runs inside a foreground turn with a hard wall-clock ceiling
# (~10 minutes, imposed by the harness -- nothing in this script can change
# that, and this mechanism does not pretend to). The acquisition budget is
# capped at 540s precisely so a queued wait fits inside one such turn. When the
# budget is spent, the caller is told to go do lock-free work and come back.
#
# The trap is what "come back" used to cost. A ticket is removed when its
# process exits, so the returning caller minted a FRESH ticket with a FRESH
# arrival stamp and went to the BACK of the queue -- behind every agent that
# arrived while it was away. That is waiter asymmetry (mechanism 1 at the top
# of this file) reappearing one level up: the caller that obeys the cap and
# leaves is overtaken by the caller that sits resident, so obeying the cap is
# again the losing strategy. Measured on this container: an agent whose job ran
# for 8.3 seconds spent 7 minutes at the head of the queue, and a 9-minute
# request never acquired at all.
#
# `OS_VERIFY_LOCK_SLOT=<name>` makes leaving cheap. A call that never acquires
# PARKS its ticket instead of deleting it, and the next call naming the same
# slot RESUMES that ticket -- keeping the ORIGINAL arrival stamp, so it sits
# where it was rather than at the back.
#
# ⚠️ THE INVARIANT THAT KEEPS THIS FROM BEING A STARVATION MECHANISM: a parked
# slot HOLDS A PLACE BUT BLOCKS NOBODY. Parked tickets are retained on disk and
# excluded from the live queue, so the head of the queue is always a ticket
# with a live process actually waiting behind it. A caller that parks and never
# returns therefore costs the fleet exactly nothing -- which is the whole
# difference between this and simply letting a dead ticket linger. The price is
# stated rather than hidden: a slot CAN be overtaken while parked, because
# while parked it was not waiting. It resumes its place among the callers
# waiting now, which is the honest meaning of the place it kept.
#
# And the priority a slot carries is bounded: the retained arrival stamp ages
# out at SLOT_MAX_AGE_S from the ORIGINAL arrival, after which the slot is
# pruned like any dead ticket and the caller starts a fresh one at the back.
# Without that bound a long-lived slot would cut ahead of newer arrivals
# indefinitely, which is the same unfairness in the other direction.
#
# ⛔ None of this touches `flock`. Slots are advisory ordering only, exactly as
# the ticket queue is; exclusion, the budget and the hard cap are untouched,
# and a slot cannot acquire, hold or release anything.
slot_slug() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_' | cut -c1-40
}

# The ORDINARY refusal: the budget elapsed and we never got the lock. One
# function because more than one check can be the one that notices, and a
# timeout that describes itself differently depending on WHICH check noticed is
# exactly how an ordinary full-budget wait came to be reported as a clock fault.
# The optional note is the only thing that varies, and it says where the wait
# was spent — never why the deadline passed, which is not in question here.
verdict_queue_timeout() {
  local waited="$1" note="${2:-}"
  if [[ -n "$note" ]]; then
    log "VERDICT queue-timeout (exit 99) · never acquired · waited $(human_s "$waited") · ${note} · $(holder_line)"
  else
    log "VERDICT queue-timeout (exit 99) · never acquired · waited $(human_s "$waited") · $(holder_line)"
  fi
  not_measured_note
  ledger_append queue-timeout "$waited" 0 99 "${LABEL_FOR_LEDGER:-?}"
}

# What exit 99 MEANS, said in the one place a reader is already looking.
#
# ⚠️ The wording is the whole of this: 99 is neither a pass nor a failure, and
# both misreadings have a cost. Read as a failure, it sends an agent hunting a
# regression that no run ever observed -- and the worst version of that is
# someone "fixing" a ratchet baseline to make an imaginary red go green. Read
# as a pass, it puts an unrun gate into a green count, which is the failure
# this fleet's whole verification discipline is built to prevent.
#
# ⛔ This does not replace the discipline; three devs in the shift that made
# this a card read exit 99 correctly with no help from the wrapper at all, and
# that was good practice rather than good wording. It removes the excuse, not
# the obligation. Worth exactly what it costs, which is nothing -- and it is
# NOT a substitute for shortening the wait, which is what the other half of
# this change is for.
not_measured_note() {
  log "  ⇒ NOT MEASURED. Exit 99 means this call never got a turn: nothing was built, nothing"
  log "    was tested, and no gate was decided. It is NOT a failure and NOT a pass — record it"
  log "    as NOT MEASURED, ⛔ never as a red, and ⛔ never inside a green count."
  log "    If an ablation or a mutation was in flight, its restore is YOUR trap, not this"
  log "    wrapper's: \`trap '<restore>' EXIT INT TERM\` — a call killed mid-mutation leaves a"
  log "    mutated tree, and the next gate run on it returns a well-formed wrong answer."
  if [[ -n "$SLOT_SLUG" ]]; then
    log "    Your place is KEPT as slot '${SLOT_SLUG}'. Re-run with the same OS_VERIFY_LOCK_SLOT"
    log "    to resume it instead of starting again at the back of the queue."
  else
    log "    Set OS_VERIFY_LOCK_SLOT=<name> to keep your place across calls: come back with the"
    log "    same name and you resume where you were, rather than behind everyone who arrived"
    log "    while you were away."
  fi
}

# Does a count-based backstop have grounds to blame the CLOCK?
#
# Both backstops below bound this script by counting something that cannot lie
# about the passage of time (seconds handed to `flock`, or polling passes that
# each sleep). Reaching such a bound proves the loop ran; it does NOT by itself
# prove anything about the clock. So the accusation gets its own predicate, and
# it is the comparison the accusation has always claimed to have made: the
# counted real seconds against what the polled clock says elapsed over the SAME
# stretch. `2 * elapsed < counted` — the clock accounted for less than half the
# time the count proves went by.
#
# Scale-free on purpose (no tolerance constant to tune): a stalled clock reports
# ~0 whatever the budget, while the benign disagreements — whole-second
# truncation at each read, a `flock -w N` returning a hair early — are a few
# seconds against a budget of hundreds and can never reach half of it.
clock_disagrees() {
  local counted="$1" elapsed="$2"
  ((elapsed * 2 < counted))
}

# --- host preflight ---------------------------------------------------------

# What this entry point needs from the host, checked ONCE, before any waiting.
# Every item here is something that used to fail INSIDE the acquisition loop,
# where a failure is indistinguishable from a busy lock and therefore spins.
# Fills PREFLIGHT_PROBLEMS (one per line) and returns 1 if there are any.
PREFLIGHT_PROBLEMS=""

# The flock finding is kept OUT of PREFLIGHT_PROBLEMS, because the two lead to
# opposite outcomes and summing them into one verdict is what would hide that:
# a problem in that list is a refusal, while "no usable flock" is the declared
# unlocked run. A host can have neither, one, or both.
PREFLIGHT_NO_FLOCK=0
PREFLIGHT_NO_FLOCK_NOTE=""

pf_add() { PREFLIGHT_PROBLEMS="${PREFLIGHT_PROBLEMS}${1}"$'\n'; }

preflight() {
  PREFLIGHT_PROBLEMS=""
  PREFLIGHT_NO_FLOCK=0
  PREFLIGHT_NO_FLOCK_NOTE=""
  local probe

  if ((BASH_VERSINFO[0] < 3 || (BASH_VERSINFO[0] == 3 && BASH_VERSINFO[1] < 2))); then
    pf_add "bash ${BASH_VERSION} is below the 3.2 floor this script targets — upgrade the shell (macOS: \`brew install bash\`)."
  fi

  if ! now_s > /dev/null 2>&1; then
    pf_add "no usable seconds clock: neither the bash 5+ epoch-seconds variable nor \`date +%s\` returned digits. Without a clock the acquisition deadline can never be reached — that is an UNBOUNDED wait, not a slow one."
  fi

  probe="$(now_stamp 2> /dev/null)"
  case "$probe" in
    '' | *[!0-9]*) pf_add "no usable arrival stamp (\`now_stamp\` produced '${probe}'); the ticket filename would be malformed." ;;
  esac

  # Probe flock FUNCTIONALLY, on a private file: 'present on PATH' does not
  # distinguish a flock that does not understand `-E`, and both failures land in
  # the same place — a slice that can never succeed and is retried forever. It
  # is also why this is not a platform test: `uname` would send a Linux
  # container without util-linux down the locked path and a brew-equipped macOS
  # down the unlocked one, which is backwards in both directions.
  #
  # The probe file's CREATION is checked separately from the lock on it, and the
  # split is load-bearing rather than tidy. A probe file that cannot be created
  # says nothing whatever about flock — the temp dir is unusable, which is also
  # where the lock file itself lives, so `exec 9>>` would fail next — and that
  # stays a refusal. Only flock failing on a file we demonstrably own is the
  # "this host has no usable flock" finding the declared unlocked mode rests on.
  # Merged, a full or read-only /tmp on an ordinary Linux host would read as
  # "no flock" and silently drop serialisation for the whole container, which is
  # the one regression this mode must not be able to cause.
  probe="${TMPDIR:-/tmp}/os-verify-lock.probe.$$"
  if ! : > "$probe" 2> /dev/null; then
    pf_add "cannot create a probe file at ${probe}, so flock usability cannot be decided here. The lock file lives in the same place, so this is a refusal and not a degradation."
  elif ! "$FLOCK_BIN" -n -E 99 "$probe" -c true > /dev/null 2>&1; then
    PREFLIGHT_NO_FLOCK=1
    PREFLIGHT_NO_FLOCK_NOTE="\`${FLOCK_BIN}\` could not take a test lock on ${probe}. flock is util-linux and the ONLY mutual-exclusion primitive this entry point has; a stock macOS does not ship it (\`brew install util-linux\`, or run verification on the Linux container, restores the locked path)."
  fi
  rm -f "$probe" 2> /dev/null || true

  [[ -z "$PREFLIGHT_PROBLEMS" ]]
}

# --- filter preflight -------------------------------------------------------

# ⛔ `pnpm --filter <name>` EXITS 0 when the filter matches no project (#10853):
#
#     $ pnpm --filter @objectstack/adapter-hono test --maxWorkers=2
#     No projects matched the filters in "/home/user/objectstack"
#     $ echo $?
#     0
#
# That is the one failure this wrapper is worst placed to let through. Every
# discipline built on top of it reads the exit code -- `cmd > log 2>&1; ec=$?`,
# the VERDICT line below, a dev's report saying "suite green, exit 0" -- and all
# of them would be TRUE AND WORTHLESS, because nothing ran. A whole verification
# round can be fictitious with every exit code in it genuine. It is the same
# shape as the `--`-before-vitest-args trap: exit 0, nothing measured, output
# that reads like success.
#
# So the check happens HERE, at the entry point every heavy verify in this
# container is contracted to come through, and BEFORE the lock is taken: a
# command that will measure nothing should not spend the fleet's lock to do it.
#
# ⚠️ FAIL-OPEN in every direction, deliberately. A wrong refusal would make this
# wrapper the thing that blocks correct work, while a miss leaves today's
# behaviour exactly as it is. No node, no resolver on disk, a resolver that
# errors, a selector that cannot be decided (a glob, a path, an interpolation),
# or a command that changes directory -- all of them PROCEED. The only refusal
# is a plain package name that this workspace does not have. The resolver reads
# `pnpm-workspace.yaml` and the manifests it names and nothing else: no network,
# no pnpm invocation, no lockfile, so it cannot become the unbounded wait this
# file exists to prevent.
#
# Escape hatch, per call: OS_VERIFY_LOCK_NO_FILTER_CHECK=1.
filter_preflight() {
  local label="$1" self_dir resolver out ec line

  [[ "${OS_VERIFY_LOCK_NO_FILTER_CHECK:-}" == "1" ]] && return 0
  case "$label" in
    *--filter*) ;;
    *) return 0 ;;
  esac
  command -v node > /dev/null 2>&1 || return 0

  self_dir="$(cd "$(dirname "$SELF")" 2> /dev/null && pwd)" || return 0
  resolver="${self_dir}/../pnpm-filter-targets.mjs"
  [[ -f "$resolver" ]] || return 0

  out="$(node "$resolver" --preflight "$label" 2> /dev/null)"
  ec=$?
  # Exit 3 is the resolver's ONLY refusal code. Anything else -- 0, a crash, a
  # missing dependency -- means proceed.
  [[ "$ec" -eq 3 ]] || return 0

  log "✗ this command would measure NOTHING:"
  while IFS= read -r line; do
    [[ -n "$line" ]] && log "  $line"
  done <<< "$out"
  return 1
}

# --- modes ------------------------------------------------------------------

usage() {
  cat >&2 << 'USAGE'
usage:
  os-verify-lock.sh -c '<shell command>'    run it under the shared verify lock
  os-verify-lock.sh -- <argv...>            same, without a shell
  os-verify-lock.sh --status                who holds the lock, for how long, who is queued
  os-verify-lock.sh --show-budget           the acquisition budget this call would use
  os-verify-lock.sh --report                aggregate the ledger: waits, holds, queue depth,
                                            and which commands own the lock-seconds
  os-verify-lock.sh --self-test             verify this script

There is deliberately no -w / --timeout: the acquisition budget is capped at the
call site. OS_VERIFY_LOCK_WAIT may LOWER it; a value above the cap is clamped.

KEEPING YOUR PLACE ACROSS CALLS. An acquisition wait is capped so it fits inside
one foreground agent turn; nothing here can stop that turn's own ceiling from
counting the wait, so the remedy is not to spend a second turn re-queueing from
the back. Set OS_VERIFY_LOCK_SLOT=<name> and a call that never acquires PARKS its
place instead of losing it; the next call with the same name resumes it. A parked
slot BLOCKS NOBODY -- it can be overtaken while you are away, which is the honest
meaning of a place kept by someone who was not waiting -- and its priority ages
out, so it cannot cut the line indefinitely. Being killed mid-wait parks it too.

EXIT 99 IS NOT A RESULT. It means this call never got a turn: nothing built,
nothing tested, no gate decided. Record it as NOT MEASURED -- never as a red
(there is no observed failure to explain, and a ratchet baseline "fixed" against
one is a real regression written to make an imaginary one go away), and never
inside a green count. If you are mid-ablation, the restore is your own
`trap '<restore>' EXIT INT TERM`: this wrapper cannot un-mutate your tree.

A `pnpm --filter <name>` that matches no project is refused BEFORE the lock is
taken, because pnpm exits 0 on it and the run would measure nothing (#10853).
OS_VERIFY_LOCK_NO_FILTER_CHECK=1 skips that check for one call.
Exit 99 means this call never acquired the lock; every run prints a VERDICT line
— including the refusals: `lock-unusable` (this host cannot operate the lock at
all) and `usage-error`. A run that prints no verdict is a bug in this script.

The lock is declared Linux-only. A host with no usable `flock` does not refuse:
the command runs UNLOCKED with no mutual exclusion, its own exit code passes
through, and the VERDICT line says `UNLOCKED (declared)`. That run prints the
disclosure its PR body must carry — paste it, do not rewrite it.
USAGE
}

# --- declared unlocked mode -------------------------------------------------

# The disclosure a PR body must carry when verification ran without the lock.
#
# This is a QUOTE, not a composition. Two cards ran verification unlocked and
# declared it by hand before this mode existed, and the maintainer's 2026-08-22
# ruling made their wording the official format. What they wrote, between them,
# filled four slots: (a) `scripts/pm/os-verify-lock.sh` could not be used on this
# host, (b) why — no flock here, (c) the commands "were therefore run directly",
# without the lock, and (d) "a declared narrowing, not a silent one." All four
# are reproduced below, filled in for THIS run, so that declaring an unlocked
# verification is a copy rather than a fresh composition each time.
#
# Printed WITHOUT the `os-verify-lock: ` prefix every other line in this file
# carries. That is deliberate and this is the only place it happens: the block
# exists to be pasted into a PR body, and a prefix would have to be stripped
# line by line by whoever pastes it — which is how a quoted format stops being
# one.
unlocked_disclosure() {
  local label="$1"
  cat >&2 << DISCLOSURE

**Declared narrowing — verification ran UNLOCKED.** \`scripts/pm/os-verify-lock.sh\`
could not take the shared verify lock on this host: no usable \`flock\`. The shared
verify lock is declared Linux-only (\`flock\` is util-linux, and a stock macOS does
not ship it), so the command below was run directly, without the lock —
a declared narrowing, not a silent one. No serialization guarantee held for this
run, nor for any sibling agent in this container while it ran.

    ${label}

DISCLOSURE
}

# Run the command with NO lock, because this host has no primitive to take one
# with (maintainer ruling 2026-08-22: the lock is Linux-only, and macOS gets a
# declared unlocked mode rather than a refusal).
#
# It creates NOTHING: no lock file, no holder record, no queue ticket, no fd 9 —
# so a `kill -9` anywhere in here leaves nothing behind to reap, and no sibling
# can read stale state and conclude the lock is held. That is not incidental
# tidiness; a hand-rolled lockfile is the option this ruling rejected, and
# anything in this function that outlived the process would be that option
# rebuilt by accident. There is deliberately no `9>&-` on the command either:
# closing an fd nobody opened would only imply one was.
run_unlocked() {
  local kind="$1" label="$2"
  shift 2
  local started ended ran rc=0

  log "⚠ NO USABLE flock ON THIS HOST — running in DECLARED UNLOCKED MODE."
  log "⚠   · ${PREFLIGHT_NO_FLOCK_NOTE}"
  log "⚠   · Nothing is serialised: this run takes no lock, so every sibling agent"
  log "⚠     in this container is unserialised against it for as long as it runs."
  log "⚠   · Nothing is created either — no lockfile, no holder record, no ticket —"
  log "⚠     so there is nothing here for a kill -9 to leave behind."
  log "⚠ This must be declared in the PR body. The official wording follows; paste it:"
  unlocked_disclosure "$label"

  started="$(now_s 2> /dev/null)"
  case "$started" in '' | *[!0-9]*) started=0 ;; esac
  log "RUNNING UNLOCKED — ${label}"

  if [[ "$kind" == shell ]]; then
    bash -c "$1" || rc=$?
  else
    "$@" || rc=$?
  fi

  ended="$(now_s 2> /dev/null)"
  case "$ended" in '' | *[!0-9]*) ended="$started" ;; esac
  ran=$((ended - started))
  log "VERDICT command-exit ${rc} · UNLOCKED (declared) · no usable \`${FLOCK_BIN}\` on this host, so the shared verify lock was NEVER taken and NOTHING was serialized · ran $(human_s "$ran") · declare it in the PR body · ${label}"
  ledger_append unlocked 0 "$ran" "$rc" "$label"
  exit "$rc"
}

mode_status() {
  local n=0 file pid start stamp label problem
  printf 'lock: %s\n' "$LOCK_FILE"
  if ! preflight; then
    printf 'host: CANNOT OPERATE THIS LOCK — a run here refuses with VERDICT lock-unusable:\n'
    while IFS= read -r problem; do
      [[ -n "$problem" ]] && printf '  · %s\n' "$problem"
    done <<< "$PREFLIGHT_PROBLEMS"
  elif ((PREFLIGHT_NO_FLOCK == 1)); then
    printf 'host: NO USABLE flock — the shared verify lock is Linux-only, so a run here does\n'
    printf '      NOT refuse: it runs in DECLARED UNLOCKED MODE, with no mutual exclusion,\n'
    printf '      prints the disclosure its PR body must carry, and ends with\n'
    printf '      VERDICT command-exit N · UNLOCKED (declared) ...\n'
    printf '  · %s\n' "$PREFLIGHT_NO_FLOCK_NOTE"
  fi
  case "$(stamp_resolution)" in
    s) printf 'note: whole-second arrival stamps only on this host — FIFO ordering degrades to per-second granularity (exclusion and the cap are unaffected).\n' ;;
  esac
  # `holder_line` decides held-vs-free by attempting the lock, so on a host with
  # no flock it would answer 'lock is free' — true only in the sense that nobody
  # can hold it. Say the useful thing instead of the technically-true one.
  if ((PREFLIGHT_NO_FLOCK == 1)); then
    printf 'state: no exclusion on this host — nothing can hold this lock here, and this entry point takes it from nobody.\n'
  else
    printf 'state: %s\n' "$(holder_line)"
  fi
  if [[ -d "$QUEUE_DIR" ]]; then
    while IFS= read -r file; do
      [[ -n "$file" ]] || continue
      read -r pid start stamp label < "$file" 2> /dev/null || continue
      n=$((n + 1))
      printf 'queue %d: pid %s waiting %ss — %s\n' "$n" "$pid" "$(($(now_s) - stamp))" "${label:-?}"
    done < <(queue_live)
  fi
  ((n == 0)) && printf 'queue: empty (entry-point waiters only — a free-hand flock waiter takes no ticket)\n'
  # Parked slots are shown APART from the queue, and the line says they block
  # nobody. Listed among the waiters they would read as a deeper queue than
  # there is; omitted entirely, a place being kept would be invisible fleet
  # state — and invisible state on this lock is what took a whole shift to
  # characterise last time.
  local p=0 pfile
  if [[ -d "$QUEUE_DIR" ]]; then
    while IFS= read -r pfile; do
      [[ -n "$pfile" ]] || continue
      read -r pid start stamp label < "$pfile" 2> /dev/null || continue
      p=$((p + 1))
      printf 'parked %d: slot %s, place kept %ss (blocks nobody) — %s\n' \
        "$p" "$(basename "$pfile" | sed 's/^[0-9]*-s//')" "$(($(now_s) - stamp))" "${label:-?}"
    done < <(queue_parked)
  fi
  if [[ -f "$LEDGER_FILE" ]]; then
    printf 'ledger: %s (%s records) — `--report` aggregates it\n' \
      "$LEDGER_FILE" "$(wc -l < "$LEDGER_FILE" 2> /dev/null | tr -d ' ')"
  else
    printf 'ledger: %s (no records yet)\n' "$LEDGER_FILE"
  fi
  return 0
}

# --- report -----------------------------------------------------------------

# Percentile of a numeric column, by sorting it. `sort -n` rather than an awk
# array so this stays bash-3.2/POSIX-awk clean (`asort` is a gawk extension and
# would fail on exactly the hosts this file's portability block is about).
pct_of() {
  local file="$1" want="$2" n idx
  n="$(wc -l < "$file" 2> /dev/null | tr -d ' ')"
  case "$n" in '' | *[!0-9]* | 0) printf '-'; return 0 ;; esac
  idx=$(((n * want + 99) / 100))
  ((idx < 1)) && idx=1
  ((idx > n)) && idx="$n"
  sed -n "${idx}p" "$file"
}

# The standing answer to "where does the hold time go", which until now could
# only be assembled by hand from several agents' reports after the fact.
mode_report() {
  local tmp field
  printf 'ledger: %s\n' "$LEDGER_FILE"
  if [[ ! -f "$LEDGER_FILE" ]]; then
    printf 'no records yet — every run through this entry point appends one.\n'
    return 0
  fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/os-verify-lock-report.XXXXXX")" || return 1
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT

  local total first last
  total="$(wc -l < "$LEDGER_FILE" 2> /dev/null | tr -d ' ')"
  first="$(awk 'NR==1{print $1}' "$LEDGER_FILE" 2> /dev/null)"
  last="$(awk 'END{print $1}' "$LEDGER_FILE" 2> /dev/null)"
  case "$first$last" in
    '' | *[!0-9]*) printf 'records: %s\n' "$total" ;;
    *) printf 'records: %s, spanning %s\n' "$total" "$(human_s $((last - first)))" ;;
  esac
  local size
  size="$(wc -c < "$LEDGER_FILE" 2> /dev/null | tr -d ' ')"
  case "$size" in
    '' | *[!0-9]*) ;;
    *) ((size > LEDGER_MAX_BYTES)) && printf '⚠ the ledger has reached its %s-byte bound and is NO LONGER RECORDING — the figures below describe the runs up to that point only, not the fleet since.\n' "$LEDGER_MAX_BYTES" ;;
  esac

  printf '\noutcomes:\n'
  awk '{ for (i = 2; i <= NF; i++) if (substr($i, 1, 8) == "outcome=") { c[substr($i, 9)]++; break } }
       END { for (k in c) printf "  %-24s %6d\n", k, c[k] }' "$LEDGER_FILE" 2> /dev/null | sort -k2 -rn
  printf '  ⇒ queue-timeout and lock-unusable are NOT MEASURED runs: no gate was decided by them.\n'

  # waits and holds, as distributions rather than a single mean -- the tail is
  # the whole complaint on this lock, and a mean hides it.
  for field in waited held depth; do
    awk -v f="$field=" '{ for (i = 2; i <= NF; i++) if (index($i, f) == 1) { v = substr($i, length(f) + 1); if (v ~ /^[0-9]+$/ && v > 0) print v; break } }' \
      "$LEDGER_FILE" 2> /dev/null | sort -n > "${tmp}/${field}"
  done
  printf '\nacquisition wait, over runs that waited at all (seconds):\n'
  printf '  n=%s  p50=%s  p90=%s  max=%s\n' \
    "$(wc -l < "${tmp}/waited" | tr -d ' ')" "$(pct_of "${tmp}/waited" 50)" \
    "$(pct_of "${tmp}/waited" 90)" "$(pct_of "${tmp}/waited" 100)"
  printf 'lock hold, over runs that acquired (seconds):\n'
  printf '  n=%s  p50=%s  p90=%s  max=%s\n' \
    "$(wc -l < "${tmp}/held" | tr -d ' ')" "$(pct_of "${tmp}/held" 50)" \
    "$(pct_of "${tmp}/held" 90)" "$(pct_of "${tmp}/held" 100)"
  printf 'queue depth on arrival (waiters already ahead):\n'
  printf '  n=%s  p50=%s  p90=%s  max=%s\n' \
    "$(wc -l < "${tmp}/depth" | tr -d ' ')" "$(pct_of "${tmp}/depth" 50)" \
    "$(pct_of "${tmp}/depth" 90)" "$(pct_of "${tmp}/depth" 100)"

  # ⭐ The table this whole mechanism exists for. Ranked by TOTAL seconds held,
  # not by the worst single run: the command that decides how much the fleet
  # queues is the one that owns the most lock-seconds, which a per-run maximum
  # can point away from entirely.
  printf '\nlock-seconds held, by command (top 10 — this is where hold time actually goes):\n'
  awk '{
         h = ""; lbl = ""
         for (i = 2; i <= NF; i++) {
           if (index($i, "held=") == 1) h = substr($i, 6)
           else if (index($i, "label=") == 1) { lbl = substr($i, 7); for (j = i + 1; j <= NF; j++) lbl = lbl " " $j; break }
         }
         if (h ~ /^[0-9]+$/ && lbl != "") { tot[lbl] += h; runs[lbl]++ }
       }
       END { for (k in tot) printf "%8d %5d %s\n", tot[k], runs[k], k }' "$LEDGER_FILE" 2> /dev/null \
    | sort -rn | head -10 \
    | awk '{ t = $1; r = $2; $1 = ""; $2 = ""; sub(/^  /, ""); printf "  %6ss total  %3s run(s)  %s\n", t, r, substr($0, 1, 96) }'
  return 0
}

mode_show_budget() {
  effective_budget
  printf 'budget: %ss (hard cap %ss, default %ss)\n' "$BUDGET" "$HARD_CAP_S" "$DEFAULT_WAIT_S"
  [[ -n "$BUDGET_NOTE" ]] && printf 'note: %s\n' "$BUDGET_NOTE"
  return 0
}

# Acquire in FIFO order within the budget, then run the command. Never returns.
mode_run() {
  local kind="$1" label="$2"
  shift 2
  LABEL_FOR_LEDGER="$label"
  [[ -n "${OS_VERIFY_LOCK_SLOT:-}" ]] && SLOT_SLUG="$(slot_slug "${OS_VERIFY_LOCK_SLOT}")"

  # Refuse before waiting. A caller is told to read the VERDICT line, so the
  # host-is-wrong path prints one too — that is the whole difference between
  # this and the unbounded spin it replaces.
  if ! preflight; then
    local problem
    log "✗ this host cannot operate the shared verify lock:"
    while IFS= read -r problem; do
      [[ -n "$problem" ]] && log "  · $problem"
    done <<< "$PREFLIGHT_PROBLEMS"
    log "VERDICT lock-unusable (exit 99) · never acquired · refused before waiting · nothing was built or tested · ${label}"
    ledger_append lock-unusable 0 0 99 "$label"
    exit 99
  fi

  # A filter that matches nothing is a CALLER error, not a busy lock, so it
  # exits 2 (the usage-error code) rather than 99. 99 means "never got a turn"
  # and invites a retry; retrying this command would just reproduce the same
  # silent green.
  if ! filter_preflight "$label"; then
    log "VERDICT filter-matches-nothing (exit 2) · never acquired · refused before waiting · nothing was built or tested · ${label}"
    ledger_append filter-matches-nothing 0 0 2 "$label"
    exit 2
  fi

  # No usable flock on this host: the declared unlocked run, and it never
  # returns. Its position is chosen, not incidental. AFTER the filter preflight,
  # because a command that would measure nothing is refused whether or not there
  # is a lock to spend on it — the two checks are independent and both still
  # apply. BEFORE everything below, because none of it means anything without
  # the primitive: there is no budget to spend, no queue to be head of, and no
  # fd to release.
  if ((PREFLIGHT_NO_FLOCK == 1)); then
    run_unlocked "$kind" "$label" "$@"
  fi

  effective_budget
  [[ -n "$BUDGET_NOTE" ]] && log "⚠ $BUDGET_NOTE"

  local started deadline waited=0 ordered=1
  started="$(now_s)"
  deadline=$((started + BUDGET))

  trap cleanup EXIT
  trap 'cleanup; exit 130' INT TERM HUP
  if liveness_usable && queue_usable && take_ticket "$label"; then
    # Queue depth AT ARRIVAL, recorded once. It is the number that turns "I
    # waited a long time" into "N of us were waiting", which is the difference
    # between an anecdote and a measurement of contention — and it has to be
    # read here, because by the time this call finishes the queue it arrived
    # into is gone.
    ARRIVAL_DEPTH="$(queue_live | wc -l | tr -d ' ')"
    case "$ARRIVAL_DEPTH" in '' | *[!0-9]*) ARRIVAL_DEPTH=-1 ;; esac
  else
    ordered=0
    log "⚠ ticket queue at ${QUEUE_DIR} is unusable — falling back to unordered acquisition (the cap and the lock itself are unaffected)."
  fi

  # Wait for headship. Only the head touches flock, so this loop is pure
  # polling and costs the lock nothing.
  #
  # Two independent bounds, and they catch different failures on purpose. The
  # DEADLINE is the declared acquisition budget. The PASS COUNT is what catches
  # a clock that is not advancing — the shape that made this loop unbounded,
  # where `now` was the empty string on every pass and `now >= deadline` was
  # `0 >= 540` forever. One pass costs at least POLL_S of sleep, so a run that
  # burns through the whole budget's worth of passes and more has learned
  # something the deadline check could not.
  #
  # ORDER MATTERS, and it is the same order as in the flock-slice loop below:
  # read the clock, test the DEADLINE, and only then the count. A backstop that
  # gets to answer first answers for the ordinary case too, and then an ordinary
  # timeout is reported as an infrastructure fault. With the deadline first, a
  # working clock always ends this loop by the ordinary route (it reaches the
  # budget in BUDGET seconds, long before BUDGET+60 passes), and reaching the
  # count at all means the clock did not get there — which the wording then
  # states as the measured disagreement rather than as an assertion.
  local -a q
  q=()
  local last_report=0 now pos i qline elapsed
  local passes=0 remints=0
  local max_passes=$((BUDGET / POLL_S + 60))
  local max_remints=5
  while ((ordered == 1)); do
    passes=$((passes + 1))
    now="$(now_s)" || {
      log "VERDICT lock-unusable (exit 99) · never acquired · the seconds clock stopped answering mid-wait · refusing to spin · nothing was built or tested"
      ledger_append lock-unusable 0 0 99 "$label"
      exit 99
    }
    elapsed=$((now - started))
    if ((now >= deadline)); then
      verdict_queue_timeout "$elapsed" 'never reached the head of the queue'
      exit 99
    fi
    if ((passes > max_passes)); then
      if clock_disagrees $((passes * POLL_S)) "$elapsed"; then
        log "VERDICT lock-unusable (exit 99) · never acquired · the queue loop ran ${passes} passes, each sleeping ${POLL_S}s, while the clock this script polls advanced only ${elapsed}s over the same stretch — the two accounts disagree, so the ${BUDGET}s deadline could never expire · refusing to spin · nothing was built or tested"
        ledger_append lock-unusable 0 0 99 "$label"
        exit 99
      fi
      verdict_queue_timeout "$elapsed" "gave up after ${passes} queue passes inside a ${BUDGET}s budget"
      exit 99
    fi
    q=()
    while IFS= read -r qline; do
      [[ -n "$qline" ]] && q+=("$qline")
    done < <(queue_live)
    pos=0
    for i in "${!q[@]}"; do
      [[ "${q[$i]}" == "$TICKET" ]] && {
        pos=$((i + 1))
        break
      }
    done
    # Our own ticket pruned out from under us (over-age, or a hostile cleanup):
    # take a fresh one rather than silently waiting on a queue we left. Bounded,
    # and it sleeps: a host where liveness cannot be decided prunes our ticket on
    # EVERY scan, and re-minting that at loop speed is the bug amplifying itself.
    # After a few rounds the honest conclusion is that the ordering layer does
    # not work here, not that we were unlucky.
    if ((pos == 0)); then
      remints=$((remints + 1))
      if ((remints > max_remints)); then
        log "⚠ our queue ticket was pruned ${remints} times without ever appearing in the live queue — the ordering layer is not working on this host. Falling back to unordered acquisition (the cap and the lock itself are unaffected)."
        ordered=0
        break
      fi
      take_ticket "$label" || {
        ordered=0
        break
      }
      sleep "$POLL_S"
      continue
    fi
    ((pos == 1)) && break
    if ((now - last_report >= PROGRESS_EVERY_S)); then
      last_report="$now"
      log "waiting: position ${pos}/${#q[@]}, $((deadline - now))s of budget left · $(holder_line)"
    fi
    sleep "$POLL_S"
  done

  # Head of the queue (or unordered fallback): block on the real lock, in
  # slices so a long holder is still reported while we wait. Re-locking is
  # immediate, so the gap a legacy free-hand waiter could exploit is
  # microseconds — worth it for progress output that names the holder.
  #
  # fd 9 explicitly, not `exec {lfd}>`: fd auto-allocation is bash 4.1+, and on
  # 3.2 `exec {lfd}>>file` parses as running a command named `{lfd}`.
  # `slices_spent` is the SECOND bound here, and it is the one that does not
  # trust the clock. The deadline check below is computed from `now_s`; if that
  # clock is frozen or running backwards, `remaining` stays positive forever and
  # this loop retries `flock -w` for as long as the process is left alive — an
  # unbounded wait that prints no verdict, which is the exact failure that
  # bound was added for, merely relocated from the queue loop into this one.
  # Measured while fixing it: with the clock frozen and the lock held, this loop
  # was still running when a 40s timeout killed it, having printed zero VERDICT
  # lines.
  #
  # So elapsed time is ALSO accumulated from the one ruler here that cannot lie:
  # the timeout just handed to `flock`, which really did block for that long. It
  # rises by at least 1 each pass, so the loop terminates within BUDGET passes
  # whatever the clock claims. A flock that fails EARLY over-counts, which errs
  # toward terminating — the safe direction.
  #
  # WHAT THAT BOUND MUST NOT DO IS EXPLAIN THE ORDINARY CASE.
  #
  # It used to. A waiter that reaches the head of the queue and then spends its
  # whole budget here spends it ENTIRELY in slices — 18 × 30s = 540s = BUDGET —
  # so `slices_spent >= BUDGET` came true at the bottom of pass 18, one check
  # before `remaining <= 0` would have come true at the top of pass 19. The
  # backstop won that tie by position and printed "the clock this script polls
  # reported none of it" for a completely healthy clock: the same run's own 18
  # progress lines, decrementing 510 → 30 in exact 30s steps with the holder's
  # `held` counter rising in lockstep, are proof the clock answered every poll.
  # That reads as an infrastructure fault no retry can fix, when the truth was
  # the mundane and actionable one — a sibling held the lock longer than one
  # full budget. The two readings lead to opposite next moves, and the misread
  # has already cost a seat an agent.
  #
  # Hence the order below, which is the whole fix: check the WALL-CLOCK DEADLINE
  # after each slice, BEFORE the slice backstop, so a budget that genuinely
  # elapsed always reports the ordinary timeout. The backstop keeps its job of
  # terminating the loop, but it only gets to blame the clock when the clock is
  # actually caught out — `clock_disagrees`, the comparison the old sentence
  # asserted it had made and never made. When the two accounts agree, hitting
  # the backstop means nothing more than "the budget is spent", and it says so.
  local remaining flock_rc slices_spent=0
  exec 9>> "$LOCK_FILE" || {
    log "✗ cannot open ${LOCK_FILE} for locking."
    log "VERDICT lock-unusable (exit 99) · never acquired · ${LOCK_FILE} could not be opened for locking · nothing was built or tested"
    ledger_append lock-unusable 0 0 99 "$label"
    exit 99
  }
  while :; do
    now="$(now_s)" || {
      log "VERDICT lock-unusable (exit 99) · never acquired · the seconds clock stopped answering mid-wait · refusing to spin · nothing was built or tested"
      ledger_append lock-unusable 0 0 99 "$label"
      exit 99
    }
    remaining=$((deadline - now))
    if ((remaining <= 0)); then
      verdict_queue_timeout $((now - started))
      exit 99
    fi
    ((remaining > SLICE_S)) && remaining="$SLICE_S"
    flock_rc=0
    "$FLOCK_BIN" -w "$remaining" 9 || flock_rc=$?
    ((flock_rc == 0)) && break
    # 126/127 is "the primitive is gone", not "someone else holds it". Retrying
    # that costs a fork per slice and can never succeed, so it is a verdict —
    # and it is tested BEFORE the two bounds below, because it is a cause this
    # script has actually established. A cause that is KNOWN outranks one that
    # is inferred: left underneath, a flock that returns instantly every pass
    # ran the accounting up to BUDGET in no time at all and was reported as a
    # clock that had stopped. Same misattribution as the one above, one branch
    # over.
    if ((flock_rc == 126 || flock_rc == 127)); then
      log "VERDICT lock-unusable (exit 99) · never acquired · \`${FLOCK_BIN}\` exited ${flock_rc} (not found / not executable) · nothing was built or tested"
      ledger_append lock-unusable 0 0 99 "$label"
      exit 99
    fi
    slices_spent=$((slices_spent + remaining))
    # Re-read the clock now that the slice has really gone by, and let the
    # DEADLINE answer first. This is the check whose absence made the backstop
    # below the default explanation for an ordinary full-budget wait.
    now="$(now_s)" || {
      log "VERDICT lock-unusable (exit 99) · never acquired · the seconds clock stopped answering mid-wait · refusing to spin · nothing was built or tested"
      ledger_append lock-unusable 0 0 99 "$label"
      exit 99
    }
    elapsed=$((now - started))
    if ((elapsed >= BUDGET)); then
      verdict_queue_timeout "$elapsed"
      exit 99
    fi
    if ((slices_spent >= BUDGET)); then
      if clock_disagrees "$slices_spent" "$elapsed"; then
        log "VERDICT lock-unusable (exit 99) · never acquired · spent ${slices_spent}s of a ${BUDGET}s budget in flock slices while the clock this script polls advanced only ${elapsed}s over the same stretch — the two accounts disagree, so the deadline could never expire · refusing to spin · nothing was built or tested · $(holder_line)"
        ledger_append lock-unusable 0 0 99 "$label"
        exit 99
      fi
      # The count is spent and the clock agrees it is: an ordinary timeout that
      # whole-second rounding kept a hair short of the deadline test above.
      # Report the larger of the two accounts — both are lower bounds on the
      # real wait, and understating it is what invites a pointless retry.
      if ((elapsed > slices_spent)); then
        verdict_queue_timeout "$elapsed"
      else
        verdict_queue_timeout "$slices_spent"
      fi
      exit 99
    fi
    if ((now - last_report >= PROGRESS_EVERY_S)); then
      last_report="$now"
      log "waiting: at the head of the queue, $((deadline - now))s of budget left · $(holder_line)"
    fi
  done

  HOLDING=1
  write_holder "$label"
  [[ -n "$TICKET" ]] && {
    rm -f "$TICKET" 2> /dev/null
    TICKET=""
  }
  local acquired_at
  acquired_at="$(now_s)"
  waited=$((acquired_at - started))
  log "ACQUIRED after $(human_s "$waited") — running: ${label}"

  local rc=0
  if [[ "$kind" == shell ]]; then
    bash -c "$1" 9>&- || rc=$?
  else
    "$@" 9>&- || rc=$?
  fi

  local held
  held=$(($(now_s) - acquired_at))
  HOLDING=0
  rm -f "$HOLDER_FILE" 2> /dev/null || true
  log "VERDICT command-exit ${rc} · held the lock $(human_s "$held") · waited $(human_s "$waited")"
  ledger_append command-exit "$waited" "$held" "$rc" "$label"
  if ((held >= LONG_HOLD_WARN_S)); then
    log "⚠ THIS RUN held the shared verify lock for $(human_s "$held"). Every sibling agent"
    log "⚠ in this container queued behind it, and a long holder lengthens every cycle for"
    log "⚠ all of them. Command: ${label}"
    log "⚠ If that is normal for this command rather than a one-off, it is a finding worth"
    log "⚠ filing (holder-side starvation) — narrow the run, or say so on the card."
  fi
  exit "$rc"
}

# --- self-test --------------------------------------------------------------

st_fail=0
st_case() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then
    printf '  ✓ %s\n' "$name"
  else
    printf '  ✗ %s\n      want: %s\n      got:  %s\n' "$name" "$want" "$got"
    st_fail=$((st_fail + 1))
  fi
}

mode_self_test() {
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/os-verify-lock-selftest.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" EXIT
  local L="${tmp}/lock"
  # Both halves matter: the export reaches the child invocations, and the three
  # globals redirect the helpers called IN THIS PROCESS. Without the second, a
  # self-test would serialise the real fleet behind its own fixtures.
  export OS_VERIFY_LOCK_FILE="$L"
  export OS_VERIFY_LOCK_LEDGER="${L}.ledger"
  LOCK_FILE="$L"
  QUEUE_DIR="${L}.q"
  HOLDER_FILE="${L}.holder"
  LEDGER_FILE="${L}.ledger"

  printf 'os-verify-lock --self-test\n'

  # (a) the cap, the half that makes the declared invariant structural.
  st_case 'hard cap fits one foreground agent call (<= 560s)' "$((HARD_CAP_S <= 560 && HARD_CAP_S > 0))" 1
  (
    unset OS_VERIFY_LOCK_WAIT
    effective_budget
    printf '%s' "$BUDGET"
  ) > "${tmp}/b" 2> /dev/null
  st_case 'default budget is the declared cap' "$(< "${tmp}/b")" "$DEFAULT_WAIT_S"
  OS_VERIFY_LOCK_WAIT=60 effective_budget
  st_case 'a lower budget is honoured' "$BUDGET" 60
  OS_VERIFY_LOCK_WAIT=3000 effective_budget
  st_case 'a budget above the cap is clamped' "$BUDGET" "$HARD_CAP_S"
  st_case 'and the clamp says so' "$([[ "$BUDGET_NOTE" == *clamped* ]] && echo yes || echo no)" yes
  OS_VERIFY_LOCK_WAIT=abc effective_budget
  st_case 'a non-numeric budget falls back to the default' "$BUDGET" "$DEFAULT_WAIT_S"
  OS_VERIFY_LOCK_WAIT=0 effective_budget
  st_case 'a zero budget still makes one attempt' "$BUDGET" 1
  st_case 'no -w is accepted from the caller' \
    "$(OS_VERIFY_LOCK_WAIT=1 bash "$SELF" -w 3000 -c true > /dev/null 2>&1 || echo "$?")" 2

  # liveness predicates, no contention needed.
  st_case 'proc_starttime reads our own start time' \
    "$([[ "$(proc_starttime "$$")" =~ ^[0-9]+$ ]] && echo yes || echo no)" yes
  st_case 'proc_starttime fails on a pid that does not exist' \
    "$(proc_starttime 999999 > /dev/null 2>&1 && echo yes || echo no)" no
  st_case 'pid_alive is true for us, false for a pid that does not exist' \
    "$(pid_alive $$ && printf live; pid_alive 999999 && printf BAD; printf .)" 'live.'
  st_case 'now_s returns digits' \
    "$([[ "$(now_s)" =~ ^[0-9]+$ ]] && echo yes || echo no)" yes
  st_case 'liveness is decidable on this host (otherwise ordering is off)' \
    "$(liveness_usable && echo yes || echo no)" yes

  # (b) the bash 3.2 floor. This is not hygiene: on 3.2 these constructs do not
  # fail loudly, they turn the acquisition loop UNBOUNDED (see the portability
  # block at the top of this file). Both halves are needed because they catch
  # different things — a static scan for the parse-level constructs `enable -n`
  # cannot simulate, and a real run with the runtime ones taken away.
  # Scanned region: the top of the file down to this self-test section — i.e.
  # everything that runs during an acquisition, which is where one of these
  # constructs turns a bounded wait into an unbounded spin. The self-test region
  # is exempt on purpose: it has to NAME the constructs it hunts (this pattern,
  # the `enable -n` line below, the case labels), and it is covered instead by
  # the simulated-3.2 run that follows.
  local pat bad4
  pat='exec[[:space:]]+\{[A-Za-z_]'
  pat="${pat}"'|\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?(\^|,)'
  pat="${pat}"'|(declare|local|typeset)[[:space:]]+-[A-Za-z]*A[[:space:]]'
  pat="${pat}"'|(mapfile|readarray)[[:space:]]'
  pat="${pat}"'|EPOCH[A-Z]*([^:A-Z]|$)'
  bad4="$(sed -n '1,/^# --- self-test/p' "$SELF" | grep -nE "$pat" | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
  st_case 'the acquisition path uses no bash 4+/5+ construct (fd auto-alloc, ^^/,,, declare -A, mapfile, unguarded EPOCH*)' \
    "$bad4" ''

  # A real acquisition with bash 3.2's world imposed on a bash 5 host: `unset`
  # strips the dynamic attribute from EPOCHSECONDS/EPOCHREALTIME (they really do
  # come back empty), and `enable -n` really does make mapfile/readarray
  # "command not found". A fresh `bash -c` is used so the readonly constants in
  # this file can be re-sourced; the budget is short so a reintroduced builtin
  # fails this case in seconds instead of hanging it.
  local sim simrc
  sim="$(OS_VERIFY_LOCK_WAIT=5 bash -c '
      unset EPOCHSECONDS EPOCHREALTIME
      enable -n mapfile readarray 2> /dev/null
      set -- -c "printf SIM-RAN"
      . "$0"
    ' "$SELF" 2>&1)"
  simrc=$?
  st_case 'acquires with EPOCHSECONDS/EPOCHREALTIME unset and mapfile disabled' "$simrc" 0
  st_case 'and actually ran the command under that shell' \
    "$([[ "$sim" == *SIM-RAN* ]] && echo yes || echo no)" yes
  st_case 'and printed a command-exit verdict, not nothing' \
    "$([[ "$sim" == *'VERDICT command-exit 0'* ]] && echo yes || echo no)" yes

  # (c) the two host-failure outcomes, which are DIFFERENT and must stay so.
  #
  # A host that cannot operate the lock still has to produce a VERDICT at second
  # zero — the failure this replaces produced none at all for as long as it was
  # left running. What that verdict SAYS now depends on WHICH capability is
  # missing (maintainer ruling 2026-08-22: the lock is declared Linux-only):
  #
  #   no usable flock         → DECLARED UNLOCKED run. The command runs, its own
  #                             exit code passes through, the degradation is
  #                             written into the VERDICT line, and nothing is
  #                             left on disk.
  #   any other host problem  → refusal, exit 99, VERDICT lock-unusable — the
  #                             behaviour that was there before, unchanged.
  #
  # "did it run?" is a FILE, not a string in the output: the verdict line names
  # the command, so any marker inside the command TEXT is echoed back whether or
  # not it ran. That false green is the first thing these cases caught.
  local t0 t1 unl unlrc ranfile ulock
  ulock="${tmp}/unlocked-lock"
  ranfile="${tmp}/unlocked-command-ran"
  rm -f "$ranfile"
  t0="$(now_s)"
  unl="$(OS_VERIFY_LOCK_FILE="$ulock" OS_VERIFY_LOCK_FLOCK="${tmp}/no-such-flock" \
    bash "$SELF" -c ": > '${ranfile}'" 2>&1)"
  unlrc=$?
  t1="$(now_s)"
  st_case 'an unusable flock RUNS the command unlocked instead of refusing' "$unlrc" 0
  st_case 'and the command really ran' \
    "$([[ -e "$ranfile" ]] && echo ran || echo 'did not run')" ran
  st_case 'and the VERDICT carries the degradation, so the run cannot read as an ordinary one' \
    "$([[ "$unl" == *'VERDICT command-exit 0 · UNLOCKED (declared)'* ]] && echo yes || echo no)" yes
  st_case 'and names what was lost, not merely that something was' \
    "$([[ "$unl" == *'NEVER taken and NOTHING was serialized'* ]] && echo yes || echo no)" yes
  st_case 'and never claims to have acquired anything' \
    "$([[ "$unl" == *ACQUIRED* ]] && echo CLAIMED-ACQUIRED || echo no)" no
  st_case 'and hands over the disclosure wording the PR body must carry' \
    "$([[ "$unl" == *'a declared narrowing, not a silent one'* ]] && echo yes || echo no)" yes
  st_case 'and proceeds immediately instead of spinning (<= 10s)' \
    "$((t1 - t0 <= 10))" 1

  # THE INVARIANT THIS MODE IS MOST EASILY LOST TO. The option this ruling
  # rejected was a hand-rolled lockfile, whose whole cost is that a killed
  # holder leaves the lock HELD and needs reaping. So the unlocked path is
  # pinned to create nothing at all — after an ordinary exit, and again after a
  # `kill -9` mid-run, which is exactly where a lockfile would show itself.
  st_case 'an unlocked run leaves no lock file' \
    "$([[ -e "$ulock" ]] && echo yes || echo no)" no
  st_case 'no holder record' \
    "$([[ -e "${ulock}.holder" ]] && echo yes || echo no)" no
  st_case 'no queue ticket directory' \
    "$([[ -e "${ulock}.q" ]] && echo yes || echo no)" no
  local killpid
  OS_VERIFY_LOCK_FILE="$ulock" OS_VERIFY_LOCK_FLOCK="${tmp}/no-such-flock" \
    bash "$SELF" -c 'sleep 5' > /dev/null 2>&1 &
  killpid=$!
  sleep 1.5
  kill -9 "$killpid" 2> /dev/null
  wait "$killpid" 2> /dev/null
  st_case 'and a kill -9 mid-run leaves nothing behind to reap either' \
    "$(ls -A "${ulock}"* 2> /dev/null | wc -l | tr -d ' ')" 0

  # THE OTHER OUTCOME, and the reason the probe file's CREATION is checked apart
  # from the lock taken on it. A temp dir that cannot hold the probe says
  # nothing whatever about flock, and stays a refusal. Merged into one finding,
  # a full or read-only /tmp on an ordinary Linux host would read as "no flock"
  # and silently drop serialisation for every agent in the container — the one
  # regression this mode must not be able to cause. This case is what keeps the
  # two apart, and it asserts BOTH halves: the refusal fires, and the unlocked
  # mode does not.
  local refuse refuserc rranfile
  rranfile="${tmp}/refused-command-ran"
  rm -f "$rranfile"
  refuse="$(TMPDIR="${tmp}/no-such-dir" bash "$SELF" -c ": > '${rranfile}'" 2>&1)"
  refuserc=$?
  st_case 'a host problem that is NOT the flock one still exits 99' "$refuserc" 99
  st_case 'and says lock-unusable, not queue-timeout' \
    "$([[ "$refuse" == *'VERDICT lock-unusable'* ]] && echo yes || echo no)" yes
  st_case 'and does not run the command' \
    "$([[ -e "$rranfile" ]] && echo ran || echo 'did not run')" 'did not run'
  st_case 'and does NOT degrade to unlocked — flock was never the thing that failed' \
    "$([[ "$refuse" == *UNLOCKED* ]] && echo DEGRADED || echo no)" no

  # and the same split, seen through --status.
  st_case '--status calls a no-flock host unlocked rather than unusable' \
    "$(OS_VERIFY_LOCK_FLOCK="${tmp}/no-such-flock" bash "$SELF" --status 2>&1 | grep -c 'DECLARED UNLOCKED MODE')" 1
  st_case 'and does not report a free lock it has no primitive to observe' \
    "$(OS_VERIFY_LOCK_FLOCK="${tmp}/no-such-flock" bash "$SELF" --status 2>&1 | grep -c 'lock is free')" 0
  st_case '--status still reports a genuinely unusable host as unusable' \
    "$(TMPDIR="${tmp}/no-such-dir" bash "$SELF" --status 2>&1 | grep -c 'CANNOT OPERATE THIS LOCK')" 1

  # The other direction, and the one a regression here would be silent about:
  # this host HAS flock, so nothing may take the unlocked path. A wrapper that
  # degraded when it did not have to would remove serialisation for every agent
  # in the container without failing anybody's PR.
  st_case 'a host WITH a working flock never enters unlocked mode' \
    "$(bash "$SELF" -c true 2>&1 | grep -c 'UNLOCKED')" 0

  # A STOPPED CLOCK, with the lock genuinely held. This is the same bug class as
  # the one this card is about but in the other loop: the deadline is computed
  # from the clock, so a clock that never advances makes the deadline
  # unreachable and the flock-slice loop retries forever. Measured against the
  # loop before it grew its `slices_spent` bound: killed by a 40s timeout, zero
  # VERDICT lines. The bound must come from the flock timeouts actually spent,
  # not from the clock, so this case asserts a verdict AND a bounded wall time.
  local frozen holdpid froze frozerc fz0 fz1 franfile
  frozen="${tmp}/frozenbin"
  mkdir -p "$frozen"
  {
    printf '#!/bin/sh\n'
    printf '# a clock that does not advance, and no %%N (BSD-shaped)\n'
    printf 'for a in "$@"; do case "$a" in *%%N*) echo 1787290000N; exit 0;; +%%s) echo 1787290000; exit 0;; esac; done\n'
    printf 'echo 1787290000\n'
  } > "${frozen}/date"
  chmod +x "${frozen}/date"
  franfile="${tmp}/frozen-command-ran"
  rm -f "$franfile"
  bash "$SELF" -c 'sleep 25' > /dev/null 2>&1 &
  holdpid=$!
  sleep 1.5
  fz0="$(now_s)"
  froze="$(PATH="${frozen}:$PATH" OS_VERIFY_LOCK_WAIT=3 bash -c '
      unset EPOCHSECONDS EPOCHREALTIME
      set -- -c ": > \"$1\""
      . "$0"
    ' "$SELF" "$franfile" 2>&1)"
  frozerc=$?
  fz1="$(now_s)"
  kill "$holdpid" 2> /dev/null
  wait "$holdpid" 2> /dev/null
  st_case 'a stopped clock still exits 99 instead of waiting forever' "$frozerc" 99
  st_case 'and prints a verdict naming the slices it really spent' \
    "$([[ "$froze" == *VERDICT*'in flock slices'* ]] && echo yes || echo no)" yes
  st_case 'and does not run the command' \
    "$([[ -e "$franfile" ]] && echo yes || echo no)" no
  st_case 'and gives up in bounded wall time (<= 20s on a 3s budget)' \
    "$((fz1 - fz0 <= 20))" 1
  # CASE 2 OF THE PAIR BELOW: this is the ONE situation entitled to the
  # clock-fault wording, and it must still fire — a message that can never fire
  # is its own defect, and the fix that stopped it firing for ordinary timeouts
  # would be worthless if it also silenced the case it guards. The frozen shim
  # pins both numbers: `started` and `now` are the same constant, so the clock
  # reports exactly 0s against a slice account of 3s.
  st_case 'and the clock-fault wording DOES still fire when the clock really stalls' \
    "$([[ "$froze" == *'the clock this script polls advanced only 0s over the same stretch'* ]] && echo yes || echo no)" yes
  st_case 'and prints both accounts, so the accusation can be checked rather than believed' \
    "$([[ "$froze" == *'spent 3s of a 3s budget in flock slices'*'the two accounts disagree'* ]] && echo yes || echo no)" yes
  st_case 'and calls a stalled clock lock-unusable, not a timeout (nothing timed out)' \
    "$([[ "$froze" == *'VERDICT lock-unusable'* ]] && echo yes || echo no)" yes

  # CASE 1 OF THE PAIR: an ORDINARY full-budget wait, healthy clock, real
  # holder — the situation that used to print the clock-fault sentence above.
  #
  # The shape is the whole point: a waiter that reaches the HEAD of the queue
  # spends its entire budget inside the flock-slice loop, so slice accounting
  # reaches BUDGET at the bottom of a pass one check before the deadline test at
  # the top of the next one would have. The backstop won that tie by position
  # and accused a clock that the same run's own progress lines proved was
  # answering every poll. An agent reading that concludes the container is
  # broken and no retry can help; the truth was that a sibling held the lock for
  # longer than one full budget, which is ordinary and actionable. Both readings
  # cannot be right, and this case is what keeps them apart.
  #
  # Budget 3s reproduces it exactly at 1/180th of the size: one 3s slice fills
  # the budget in slices with nothing left over, which is what 18 × 30s did.
  local ordhold ordout ordrc ordranfile
  ordranfile="${tmp}/ordinary-command-ran"
  rm -f "$ordranfile"
  bash "$SELF" -c 'sleep 25' > /dev/null 2>&1 &
  ordhold=$!
  sleep 1.5
  ordout="$(OS_VERIFY_LOCK_WAIT=3 bash "$SELF" -c ": > '${ordranfile}'" 2>&1)"
  ordrc=$?
  kill "$ordhold" 2> /dev/null
  wait "$ordhold" 2> /dev/null
  st_case 'an ordinary full-budget wait at the head of the queue exits 99' "$ordrc" 99
  st_case 'and reports the ORDINARY timeout' \
    "$([[ "$ordout" == *'VERDICT queue-timeout'*'never acquired · waited'* ]] && echo yes || echo no)" yes
  st_case 'and accuses no clock — the fault this branch used to assert by default' \
    "$([[ "$ordout" == *clock* ]] && echo ACCUSED-THE-CLOCK || echo no)" no
  st_case 'and names the holder instead, which is the half an agent can act on' \
    "$([[ "$ordout" == *'holder pid '* ]] && echo yes || echo no)" yes
  st_case 'and does not run the command' \
    "$([[ -e "$ordranfile" ]] && echo yes || echo no)" no

  # every exit path prints a verdict, argument errors included.
  st_case 'a usage error prints a verdict too' \
    "$(bash "$SELF" -w 3000 -c true 2>&1 | grep -c 'VERDICT usage-error (exit 2)')" 1

  # --- the exit-99 wording --------------------------------------------------
  #
  # Asserted on the OUTPUT OF A REAL TIMEOUT, not by grepping this file for the
  # sentence. A message that exists in the source and never reaches a caller is
  # the phantom-check shape, and it is the one this particular fix could most
  # easily be: the whole value of the wording is that it appears at the moment
  # somebody is deciding what a 99 meant.
  st_case 'a real queue-timeout says NOT MEASURED in so many words' \
    "$([[ "$ordout" == *'NOT MEASURED'* ]] && echo yes || echo no)" yes
  st_case 'and rules out BOTH misreadings, not just the failure one' \
    "$([[ "$ordout" == *'NOT a failure and NOT a pass'* ]] && echo yes || echo no)" yes
  st_case 'and points at the trap the caller owns, since this wrapper cannot restore a tree' \
    "$([[ "$ordout" == *'EXIT INT TERM'* ]] && echo yes || echo no)" yes
  st_case 'and tells a caller with no slot how to keep its place next time' \
    "$([[ "$ordout" == *OS_VERIFY_LOCK_SLOT* ]] && echo yes || echo no)" yes

  # --- the ledger -----------------------------------------------------------
  #
  # The two directions that matter, and the second is the one a ledger gets
  # wrong: it must record the runs that MEASURED NOTHING as well as the ones
  # that ran. A ledger of successes only would make the fleet read healthier
  # exactly as it starved.
  local realled="${L}.ledger"
  rm -f "$realled"
  bash "$SELF" -c true > /dev/null 2>&1
  st_case 'an acquiring run appends a ledger record' \
    "$(grep -c 'outcome=command-exit' "$realled" 2> /dev/null || true)" 1
  st_case 'and the record carries the wait, the hold and the queue depth' \
    "$(grep -c 'waited=[0-9]* held=[0-9]* depth=' "$realled" 2> /dev/null || true)" 1
  st_case 'and exactly one record per run, not one per verdict line' \
    "$(wc -l < "$realled" | tr -d ' ')" 1

  local ledhold ledbefore
  ledbefore="$(grep -c 'outcome=queue-timeout' "$realled" 2> /dev/null || true)"
  # A missing file makes grep print NOTHING (rather than 0), and an empty
  # operand is an arithmetic syntax error rather than a zero.
  case "$ledbefore" in '' | *[!0-9]*) ledbefore=0 ;; esac
  bash "$SELF" -c 'sleep 5' > /dev/null 2>&1 &
  ledhold=$!
  sleep 1.5
  OS_VERIFY_LOCK_WAIT=2 bash "$SELF" -c true > /dev/null 2>&1
  kill "$ledhold" 2> /dev/null
  wait "$ledhold" 2> /dev/null
  st_case 'a run that NEVER acquired is recorded too — the non-runs are the point' \
    "$(ledafter="$(grep -c 'outcome=queue-timeout' "$realled" 2> /dev/null || true)"
       case "$ledafter" in '' | *[!0-9]*) ledafter=0 ;; esac
       echo $((ledafter > ledbefore)))" 1
  st_case '--report reads the ledger back and names where hold time goes' \
    "$(bash "$SELF" --report 2>&1 | grep -c 'lock-seconds held, by command')" 1
  st_case 'and --report labels the non-runs as NOT MEASURED rather than counting them' \
    "$(bash "$SELF" --report 2>&1 | grep -c 'NOT MEASURED')" 1
  # A measurement apparatus that can redden a gate has become part of the thing
  # it measures. This is the case that keeps it out of the way.
  st_case 'an unwritable ledger loses records, never runs' \
    "$(OS_VERIFY_LOCK_LEDGER=/proc/nonexistent/nope bash "$SELF" -c true > /dev/null 2>&1; echo $?)" 0

  # --- slots: keeping a place across calls ----------------------------------
  #
  # Four properties, and the middle two are the ones that make this safe rather
  # than merely useful. A place that blocks nobody is the difference between
  # place-keeping and a starvation mechanism; a place that ages out is the
  # difference between priority and a permanent line-cut.
  local sq="${L}.q"
  rm -rf "$sq"
  bash "$SELF" -c 'sleep 6' > /dev/null 2>&1 &
  local slotholder=$!
  sleep 1.5
  OS_VERIFY_LOCK_SLOT=probe-slot OS_VERIFY_LOCK_WAIT=2 bash "$SELF" -c true > /dev/null 2>&1
  local parked_n parked_file parked_stamp
  parked_n=0
  for parked_file in "$sq"/*-sprobe-slot; do
    [[ -f "$parked_file" ]] && parked_n=$((parked_n + 1))
  done
  st_case 'a timed-out call with a slot PARKS its ticket instead of losing it' "$parked_n" 1
  read -r _ _ parked_stamp _ < "$sq"/*-sprobe-slot 2> /dev/null || parked_stamp=''
  st_case 'and the parked ticket carries pid 0 — nobody is waiting behind it' \
    "$(awk '{print $1}' "$sq"/*-sprobe-slot 2> /dev/null)" 0

  # THE SAFETY INVARIANT. Another caller must acquire straight past the parked
  # place while the lock is free — if a parked slot could hold the head, one
  # walked-away agent would stall the whole container.
  wait "$slotholder" 2> /dev/null
  local past0 past1
  past0="$(now_s)"
  OS_VERIFY_LOCK_WAIT=5 bash "$SELF" -c true > /dev/null 2>&1
  local pastrc=$?
  past1="$(now_s)"
  st_case 'a parked slot blocks nobody — an unrelated call acquires normally' "$pastrc" 0
  st_case 'and is not made to wait by it' "$((past1 - past0 <= 3))" 1

  # And the place really is the ORIGINAL one: resuming must not re-stamp
  # arrival, or the caller is quietly sent to the back while being told it
  # resumed.
  local resumed_stamp
  OS_VERIFY_LOCK_SLOT=probe-slot bash "$SELF" -c true > /dev/null 2>&1
  st_case 'resuming a slot consumes it once acquired' \
    "$(ls "$sq"/*-sprobe-slot 2> /dev/null | wc -l | tr -d ' ')" 0

  # Ageing: a place older than SLOT_MAX_AGE_S is pruned like any dead ticket,
  # so the priority it carries is bounded rather than indefinite.
  mkdir -p "$sq"
  printf '0 0 %s stale-slot\n' "$(($(now_s) - SLOT_MAX_AGE_S - 60))" > "${sq}/00000000000000000009-sstale"
  printf '0 0 %s fresh-slot\n' "$(now_s)" > "${sq}/00000000000000000010-sfresh"
  st_case 'an over-age parked slot is dead' "$(ticket_state "${sq}/00000000000000000009-sstale")" dead
  st_case 'a fresh parked slot is parked, not active and not dead' \
    "$(ticket_state "${sq}/00000000000000000010-sfresh")" parked
  queue_live > /dev/null 2>&1
  st_case 'and a queue scan removes the stale one' \
    "$([[ -e "${sq}/00000000000000000009-sstale" ]] && echo yes || echo no)" no
  st_case 'while RETAINING the live parked place it scanned past' \
    "$([[ -e "${sq}/00000000000000000010-sfresh" ]] && echo yes || echo no)" yes
  st_case 'a parked place is never counted as a waiter' \
    "$(queue_live | wc -l | tr -d ' ')" 0
  st_case 'but --status still shows it, with the fact that it blocks nobody' \
    "$(bash "$SELF" --status 2>&1 | grep -c 'blocks nobody')" 1
  rm -rf "$sq"

  QUEUE_DIR="${tmp}/q"
  HOLDER_FILE="${tmp}/holder"
  mkdir -p "$QUEUE_DIR"
  local mystart
  mystart="$(proc_starttime "$$")"
  printf '%s %s %s live\n' "$$" "$mystart" "$(now_s)" > "${QUEUE_DIR}/00000000000000000001-$$"
  printf '%s %s %s dead-pid\n' 999999 12345 "$(now_s)" > "${QUEUE_DIR}/00000000000000000002-999999"
  printf '%s %s %s reused-pid\n' "$$" $((mystart + 7)) "$(now_s)" > "${QUEUE_DIR}/00000000000000000003-$$"
  printf '%s %s %s ancient\n' "$$" "$mystart" $(($(now_s) - TICKET_MAX_AGE_S - 60)) > "${QUEUE_DIR}/00000000000000000004-$$"
  local -a live
  live=()
  local lf
  while IFS= read -r lf; do
    [[ -n "$lf" ]] && live+=("$lf")
  done < <(queue_live)
  st_case 'only the live ticket survives pruning' "${#live[@]}" 1
  st_case 'and it is the FIFO head' "$(basename "${live[0]}")" "00000000000000000001-$$"
  st_case 'a dead-pid ticket is removed from disk' \
    "$([[ -e "${QUEUE_DIR}/00000000000000000002-999999" ]] && echo yes || echo no)" no
  st_case 'a reused-pid ticket is removed (start time, not pid alone)' \
    "$([[ -e "${QUEUE_DIR}/00000000000000000003-$$" ]] && echo yes || echo no)" no
  st_case 'an over-age ticket is removed' \
    "$([[ -e "${QUEUE_DIR}/00000000000000000004-$$" ]] && echo yes || echo no)" no
  rm -rf "$QUEUE_DIR" "$HOLDER_FILE"
  QUEUE_DIR="${L}.q"
  HOLDER_FILE="${L}.holder"

  # arrival stamps sort lexically in arrival order — the FIFO claim rests on it.
  # A host with only whole-second stamps (no EPOCHREALTIME, no GNU `date +%N`,
  # no perl) cannot promise STRICTLY increasing, and says so via --status rather
  # than being asserted into a green it does not have.
  local s1 s2 res
  res="$(stamp_resolution)"
  s1="$(now_stamp)"
  sleep 0.01
  s2="$(now_stamp)"
  st_case 'arrival stamps are fixed-width (20 digits)' \
    "$([[ ${#s1} -eq 20 && ${#s2} -eq 20 ]] && echo yes || echo no)" yes
  if [[ "$res" == s ]]; then
    st_case 'arrival stamps are non-decreasing (whole-second host)' \
      "$([[ ! "$s2" < "$s1" ]] && echo yes || echo no)" yes
  else
    st_case "arrival stamps increase (${res} resolution)" \
      "$([[ "$s1" < "$s2" ]] && echo yes || echo no)" yes
  fi

  # exit-code passthrough and fd hygiene, one uncontended acquisition each.
  bash "$SELF" -c 'exit 7' > /dev/null 2>&1
  st_case "the command's own exit code passes through" "$?" 7
  st_case 'a run that acquires prints a command-exit verdict' \
    "$(bash "$SELF" -c true 2>&1 | grep -c 'VERDICT command-exit 0')" 1
  st_case 'the wrapped command does NOT inherit the lock fd' \
    "$(bash "$SELF" -c 'ls -l /proc/$$/fd 2>/dev/null | grep -c "$OS_VERIFY_LOCK_FILE\$" || true' 2> /dev/null)" 0
  st_case 'the holder record is cleared on release' \
    "$([[ -e "$HOLDER_FILE" ]] && echo yes || echo no)" no

  # --- real contention, on this test's private lock only --------------------

  # queue timeout: a holder we started, a waiter with a 2s budget.
  bash "$SELF" -c 'sleep 6' > /dev/null 2>&1 &
  local holder_pid=$!
  sleep 1.5
  local out rc
  out="$(OS_VERIFY_LOCK_WAIT=2 bash "$SELF" -c true 2>&1)"
  rc=$?
  st_case 'a waiter that never acquires exits 99' "$rc" 99
  st_case 'and says queue-timeout, not command-exit' \
    "$([[ "$out" == *'VERDICT queue-timeout'* ]] && echo yes || echo no)" yes
  st_case 'and names the holder it waited on, with a duration' \
    "$([[ "$out" == *'holder pid'*'held '* ]] && echo yes || echo no)" yes

  # --status sees the same holder while it is still running.
  out="$(bash "$SELF" --status 2>&1)"
  st_case '--status reports a live holder with its duration' \
    "$([[ "$out" == *'holder pid'*'held '* ]] && echo yes || echo no)" yes

  # legacy coexistence: a free-hand flock cannot run concurrently with us.
  flock -n -E 99 "$L" -c true > /dev/null 2>&1
  st_case 'a free-hand flock is excluded by an entry-point holder' "$?" 99
  wait "$holder_pid" 2> /dev/null
  st_case '--status reports free once the holder is gone' \
    "$(bash "$SELF" --status 2>&1 | grep -c 'lock is free')" 1

  # the reverse direction: a legacy holder blocks the entry point.
  flock "$L" -c 'sleep 3' > /dev/null 2>&1 &
  local legacy_pid=$!
  sleep 0.7
  OS_VERIFY_LOCK_WAIT=1 bash "$SELF" -c true > /dev/null 2>&1
  st_case 'a legacy free-hand holder blocks the entry point too' "$?" 99
  out="$(bash "$SELF" --status 2>&1)"
  st_case '--status names an unregistered legacy holder as such' \
    "$([[ "$out" == *'did NOT come through this entry point'* ]] && echo yes || echo no)" yes
  wait "$legacy_pid" 2> /dev/null

  # FIFO: three waiters entering in a known order behind one holder.
  # Predicted: acquisition order == arrival order, which free-hand flock does
  # not promise (it grants to whoever is blocked when the lock frees).
  local order="${tmp}/order"
  : > "$order"
  bash "$SELF" -c 'sleep 3' > /dev/null 2>&1 &
  holder_pid=$!
  sleep 0.8
  local w
  for w in A B C; do
    bash "$SELF" -c "printf '%s' $w >> '$order'" > /dev/null 2>&1 &
    sleep 0.4
  done
  wait "$holder_pid" 2> /dev/null
  wait
  st_case 'three staggered waiters acquire in arrival order' "$(< "$order")" ABC

  # (h) the filter preflight (#10853). BOTH directions, because a guard shown
  # only to red could be a guard that reds on everything -- which here would
  # block the fleet's verification. The commands are `echo`, so what is measured
  # is the REFUSAL, not pnpm.
  #
  # Run from the repo root on purpose: the resolver answers about the workspace
  # the command would run in, so the case has to put the child in one.
  local repo_root fp_ran
  repo_root="$(cd "$(dirname "$SELF")/../.." 2> /dev/null && pwd)"
  fp_ran="${tmp}/fp-ran"

  : > "$fp_ran"
  (cd "$repo_root" && bash "$SELF" -c "echo pnpm --filter @objectstack/adapter-hono test; : > '${fp_ran}.dead'") > /dev/null 2>&1
  st_case 'a filter naming no package is REFUSED (exit 2, not 99 -- retrying cannot help)' "$?" 2
  st_case 'and the refused command never ran' \
    "$([[ -e "${fp_ran}.dead" ]] && echo ran || echo 'did not run')" 'did not run'
  out="$(cd "$repo_root" && bash "$SELF" -c 'echo pnpm --filter @objectstack/adapter-hono test' 2>&1)"
  st_case 'and the refusal names the selector' \
    "$([[ "$out" == *'@objectstack/adapter-hono'* ]] && echo yes || echo no)" yes
  st_case 'and suggests the real package' \
    "$([[ "$out" == *'@objectstack/hono'* ]] && echo yes || echo no)" yes
  st_case 'and prints a VERDICT line, like every other refusal here' \
    "$(printf '%s' "$out" | grep -c 'VERDICT filter-matches-nothing (exit 2)')" 1
  st_case 'and says nothing was built or tested' \
    "$([[ "$out" == *'nothing was built or tested'* ]] && echo yes || echo no)" yes

  # The other direction: a REAL package name must sail straight through, run,
  # and report an ordinary command-exit verdict.
  : > "${fp_ran}.live"
  out="$(cd "$repo_root" && bash "$SELF" -c "echo pnpm --filter @objectstack/hono test; : > '${fp_ran}.liveran'" 2>&1)"
  st_case 'a filter naming a REAL package is not refused' "$?" 0
  st_case 'and its command actually ran' \
    "$([[ -e "${fp_ran}.liveran" ]] && echo ran || echo 'did not run')" ran
  st_case 'and it reports an ordinary command-exit verdict' \
    "$(printf '%s' "$out" | grep -c 'VERDICT command-exit 0')" 1

  # A selector the resolver refuses to decide must never be refused HERE.
  (cd "$repo_root" && bash "$SELF" -c 'echo pnpm --filter ./packages/* build') > /dev/null 2>&1
  st_case 'an undecidable selector (a path glob) proceeds -- fail-open' "$?" 0
  (cd "$repo_root" && bash "$SELF" -c 'echo pnpm --filter "${PKG}" build') > /dev/null 2>&1
  st_case 'an interpolated selector proceeds -- the spelling is not the value' "$?" 0
  (cd "$repo_root" && bash "$SELF" -c 'echo cd elsewhere && echo pnpm --filter @objectstack/adapter-hono build') > /dev/null 2>&1
  st_case 'a command that changes directory proceeds -- unknown workspace, no verdict' "$?" 0
  (cd "$repo_root" && bash "$SELF" -c 'echo git fetch --unshallow --filter=blob:none') > /dev/null 2>&1
  st_case "git's partial-clone --filter is not pnpm's, and proceeds" "$?" 0

  # The escape hatch, and the proof that it is the ONLY thing that changed the
  # answer: same command, same tree, refused without it.
  : > "${fp_ran}.hatch"
  (cd "$repo_root" && OS_VERIFY_LOCK_NO_FILTER_CHECK=1 bash "$SELF" \
    -c "echo pnpm --filter @objectstack/adapter-hono test; : > '${fp_ran}.hatchran'") > /dev/null 2>&1
  st_case 'OS_VERIFY_LOCK_NO_FILTER_CHECK=1 lets a deliberate call through' "$?" 0
  st_case 'and that command really ran' \
    "$([[ -e "${fp_ran}.hatchran" ]] && echo ran || echo 'did not run')" ran

  # A command with no --filter at all must be untouched by any of this.
  (cd "$repo_root" && bash "$SELF" -c true) > /dev/null 2>&1
  st_case 'a command with no --filter is unaffected' "$?" 0

  # The filter preflight is independent of the lock, so the declared unlocked
  # mode must not smuggle a would-measure-nothing command past it: there is no
  # lock to save, but there is still a fictitious green to prevent.
  : > "${fp_ran}.unlocked"
  rm -f "${fp_ran}.unlockedran"
  (cd "$repo_root" && OS_VERIFY_LOCK_FILE="${tmp}/unlocked-lock" \
    OS_VERIFY_LOCK_FLOCK="${tmp}/no-such-flock" bash "$SELF" \
    -c "echo pnpm --filter @objectstack/adapter-hono test; : > '${fp_ran}.unlockedran'") > /dev/null 2>&1
  st_case 'a filter naming no package is refused in unlocked mode too (exit 2)' "$?" 2
  st_case 'and that command did not run either' \
    "$([[ -e "${fp_ran}.unlockedran" ]] && echo ran || echo 'did not run')" 'did not run'

  printf '\n'
  if ((st_fail > 0)); then
    printf '✗ os-verify-lock self-test: %d case(s) failed.\n' "$st_fail"
    return 1
  fi
  printf '✓ os-verify-lock self-test: all cases pass.\n'
  return 0
}

# --- dispatch ---------------------------------------------------------------

main() {
  case "${1:-}" in
    --self-test)
      mode_self_test
      exit $?
      ;;
    --status)
      mode_status
      exit 0
      ;;
    --show-budget)
      mode_show_budget
      exit 0
      ;;
    --report)
      mode_report
      exit 0
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -c)
      [[ $# -eq 2 ]] || {
        log "✗ -c takes exactly one command string."
        usage
        log "VERDICT usage-error (exit 2) · never acquired · nothing was built or tested"
        exit 2
      }
      mode_run shell "$2" "$2"
      ;;
    --)
      shift
      [[ $# -ge 1 ]] || {
        log "✗ -- needs a command."
        usage
        log "VERDICT usage-error (exit 2) · never acquired · nothing was built or tested"
        exit 2
      }
      mode_run argv "$*" "$@"
      ;;
    '')
      usage
      log "VERDICT usage-error (exit 2) · never acquired · nothing was built or tested"
      exit 2
      ;;
    *)
      log "✗ unknown argument '${1}'. There is no -w here on purpose: the acquisition budget is capped at the call site."
      usage
      log "VERDICT usage-error (exit 2) · never acquired · nothing was built or tested"
      exit 2
      ;;
  esac
}

main "$@"
