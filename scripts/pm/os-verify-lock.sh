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
# Two host capabilities are checked up front instead (`preflight`), for the same
# reason: `flock` — the only mutual-exclusion primitive here — is not present on
# a stock macOS, and a `flock` that exits 127 on every slice is an unbounded
# retry, not a wait. A refusal at second zero WITH a verdict is the correct
# outcome; a silent spin is the one outcome this wrapper must never produce.
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

# `flock` is the ONLY mutual-exclusion primitive here, so its absence is a
# refusal and not a degradation. `OS_VERIFY_LOCK_FLOCK` exists so --self-test can
# prove the refusal path with a flock that is missing on purpose. Pointing real
# verification at a flock that isn't one removes the exclusion the lock exists
# for; don't.
FLOCK_BIN="${OS_VERIFY_LOCK_FLOCK:-flock}"

QUEUE_DIR="${LOCK_FILE}.q"
HOLDER_FILE="${LOCK_FILE}.holder"
readonly TICKET_MAX_AGE_S=$((HARD_CAP_S + 300))

SELF="${BASH_SOURCE[0]}"
TICKET=""
HOLDING=0
BUDGET_NOTE=""

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
ticket_alive() {
  local file="$1" pid start stamp now
  read -r pid start stamp _ < "$file" 2> /dev/null || return 1
  case "$pid$start$stamp" in '' | *[!0-9]*) return 1 ;; esac
  pid_alive "$pid" || return 1
  [[ "$(proc_starttime "$pid" 2> /dev/null || echo x)" == "$start" ]] || return 1
  now="$(now_s)" || return 1
  ((now - stamp <= TICKET_MAX_AGE_S)) || return 1
  return 0
}

# Live tickets, FIFO order, pruning the dead ones on the way past.
queue_live() {
  local file
  shopt -s nullglob
  for file in "$QUEUE_DIR"/*; do
    [[ -f "$file" ]] || continue
    if ticket_alive "$file"; then
      printf '%s\n' "$file"
    else
      rm -f "$file" 2> /dev/null || true
    fi
  done
  shopt -u nullglob
}

take_ticket() {
  local label="$1" start
  start="$(proc_starttime "$$" 2> /dev/null || echo 0)"
  TICKET="${QUEUE_DIR}/$(now_stamp)-$$"
  printf '%s %s %s %s\n' "$$" "$start" "$(now_s)" "$label" > "$TICKET" 2> /dev/null || {
    TICKET=""
    return 1
  }
  return 0
}

cleanup() {
  [[ -n "$TICKET" ]] && rm -f "$TICKET" 2> /dev/null
  if ((HOLDING == 1)); then rm -f "$HOLDER_FILE" 2> /dev/null; fi
  return 0
}

# --- holder reporting -------------------------------------------------------

# holder file: "<pid> <starttime> <acquired-epoch> <label>"
write_holder() {
  local label="$1" start
  start="$(proc_starttime "$$" 2> /dev/null || echo 0)"
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

# --- host preflight ---------------------------------------------------------

# What this entry point needs from the host, checked ONCE, before any waiting.
# Every item here is something that used to fail INSIDE the acquisition loop,
# where a failure is indistinguishable from a busy lock and therefore spins.
# Fills PREFLIGHT_PROBLEMS (one per line) and returns 1 if there are any.
PREFLIGHT_PROBLEMS=""

pf_add() { PREFLIGHT_PROBLEMS="${PREFLIGHT_PROBLEMS}${1}"$'\n'; }

preflight() {
  PREFLIGHT_PROBLEMS=""
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
  # the same place — a slice that can never succeed and is retried forever.
  probe="${TMPDIR:-/tmp}/os-verify-lock.probe.$$"
  if ! "$FLOCK_BIN" -n -E 99 "$probe" -c true > /dev/null 2>&1; then
    pf_add "\`${FLOCK_BIN}\` could not take a test lock on ${probe}. flock is the ONLY mutual-exclusion primitive this entry point has, and a stock macOS does not ship it (\`brew install util-linux\`, or run verification on the Linux container)."
  fi
  rm -f "$probe" 2> /dev/null || true

  [[ -z "$PREFLIGHT_PROBLEMS" ]]
}

# --- modes ------------------------------------------------------------------

usage() {
  cat >&2 << 'USAGE'
usage:
  os-verify-lock.sh -c '<shell command>'    run it under the shared verify lock
  os-verify-lock.sh -- <argv...>            same, without a shell
  os-verify-lock.sh --status                who holds the lock, for how long, who is queued
  os-verify-lock.sh --show-budget           the acquisition budget this call would use
  os-verify-lock.sh --self-test             verify this script

There is deliberately no -w / --timeout: the acquisition budget is capped at the
call site. OS_VERIFY_LOCK_WAIT may LOWER it; a value above the cap is clamped.
Exit 99 means this call never acquired the lock; every run prints a VERDICT line
— including the refusals: `lock-unusable` (this host cannot operate the lock at
all) and `usage-error`. A run that prints no verdict is a bug in this script.
USAGE
}

mode_status() {
  local n=0 file pid start stamp label problem
  printf 'lock: %s\n' "$LOCK_FILE"
  if ! preflight; then
    printf 'host: CANNOT OPERATE THIS LOCK — a run here refuses with VERDICT lock-unusable:\n'
    while IFS= read -r problem; do
      [[ -n "$problem" ]] && printf '  · %s\n' "$problem"
    done <<< "$PREFLIGHT_PROBLEMS"
  fi
  case "$(stamp_resolution)" in
    s) printf 'note: whole-second arrival stamps only on this host — FIFO ordering degrades to per-second granularity (exclusion and the cap are unaffected).\n' ;;
  esac
  printf 'state: %s\n' "$(holder_line)"
  if [[ -d "$QUEUE_DIR" ]]; then
    while IFS= read -r file; do
      [[ -n "$file" ]] || continue
      read -r pid start stamp label < "$file" 2> /dev/null || continue
      n=$((n + 1))
      printf 'queue %d: pid %s waiting %ss — %s\n' "$n" "$pid" "$(($(now_s) - stamp))" "${label:-?}"
    done < <(queue_live)
  fi
  ((n == 0)) && printf 'queue: empty (entry-point waiters only — a free-hand flock waiter takes no ticket)\n'
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
    exit 99
  fi

  effective_budget
  [[ -n "$BUDGET_NOTE" ]] && log "⚠ $BUDGET_NOTE"

  local started deadline waited=0 ordered=1
  started="$(now_s)"
  deadline=$((started + BUDGET))

  trap cleanup EXIT
  trap 'cleanup; exit 130' INT TERM HUP
  if liveness_usable && queue_usable && take_ticket "$label"; then
    : # ordered acquisition; our ticket decides when we may call flock
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
  # something about the clock, not about the lock.
  local -a q
  q=()
  local last_report=0 now pos i qline
  local passes=0 remints=0
  local max_passes=$((BUDGET / POLL_S + 60))
  local max_remints=5
  while ((ordered == 1)); do
    passes=$((passes + 1))
    if ((passes > max_passes)); then
      log "VERDICT lock-unusable (exit 99) · never acquired · the queue loop ran ${passes} passes inside a ${BUDGET}s budget, so the clock this script polls is not advancing · refusing to spin · nothing was built or tested"
      exit 99
    fi
    now="$(now_s)" || {
      log "VERDICT lock-unusable (exit 99) · never acquired · the seconds clock stopped answering mid-wait · refusing to spin · nothing was built or tested"
      exit 99
    }
    if ((now >= deadline)); then
      waited=$((now - started))
      log "VERDICT queue-timeout (exit 99) · never acquired · waited $(human_s "$waited") · never reached the head of the queue · $(holder_line)"
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
  # unbounded wait that prints no verdict, which is the exact failure this card
  # is about, merely relocated from the queue loop into this one. Measured while
  # fixing it: with the clock frozen and the lock held, this loop was still
  # running when a 40s timeout killed it, having printed zero VERDICT lines.
  #
  # So elapsed time is ALSO accumulated from the one ruler here that cannot lie:
  # the timeout just handed to `flock`, which really did block for that long. It
  # rises by at least 1 each pass, so the loop terminates within BUDGET passes
  # whatever the clock claims. A flock that fails EARLY over-counts, which errs
  # toward terminating — the safe direction.
  local remaining flock_rc slices_spent=0
  exec 9>> "$LOCK_FILE" || {
    log "✗ cannot open ${LOCK_FILE} for locking."
    log "VERDICT lock-unusable (exit 99) · never acquired · ${LOCK_FILE} could not be opened for locking · nothing was built or tested"
    exit 99
  }
  while :; do
    now="$(now_s)" || {
      log "VERDICT lock-unusable (exit 99) · never acquired · the seconds clock stopped answering mid-wait · refusing to spin · nothing was built or tested"
      exit 99
    }
    remaining=$((deadline - now))
    if ((remaining <= 0)); then
      waited=$((now - started))
      log "VERDICT queue-timeout (exit 99) · never acquired · waited $(human_s "$waited") · $(holder_line)"
      exit 99
    fi
    ((remaining > SLICE_S)) && remaining="$SLICE_S"
    flock_rc=0
    "$FLOCK_BIN" -w "$remaining" 9 || flock_rc=$?
    ((flock_rc == 0)) && break
    slices_spent=$((slices_spent + remaining))
    if ((slices_spent >= BUDGET)); then
      log "VERDICT queue-timeout (exit 99) · never acquired · spent ${slices_spent}s of a ${BUDGET}s budget in flock slices while the clock this script polls reported none of it, so the deadline could never expire · refusing to spin · nothing was built or tested · $(holder_line)"
      exit 99
    fi
    # 126/127 is "the primitive is gone", not "someone else holds it". Retrying
    # that costs a fork per slice and can never succeed, so it is a verdict.
    if ((flock_rc == 126 || flock_rc == 127)); then
      log "VERDICT lock-unusable (exit 99) · never acquired · \`${FLOCK_BIN}\` exited ${flock_rc} (not found / not executable) · nothing was built or tested"
      exit 99
    fi
    now="$(now_s)" || now="$deadline"
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
  LOCK_FILE="$L"
  QUEUE_DIR="${L}.q"
  HOLDER_FILE="${L}.holder"

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

  # (c) the bounded refusal. A host that cannot operate the lock must produce a
  # VERDICT at second zero. The failure this replaces produced none at all, for
  # as long as it was left running.
  # "did it run?" is a FILE, not a string in the output: the verdict line names
  # the command it refused, so any marker inside the command text is echoed back
  # whether or not it ran. That false green is the first thing this case caught.
  local t0 t1 refuse refuserc ranfile
  ranfile="${tmp}/refused-command-ran"
  rm -f "$ranfile"
  t0="$(now_s)"
  refuse="$(OS_VERIFY_LOCK_FLOCK="${tmp}/no-such-flock" bash "$SELF" -c ": > '${ranfile}'" 2>&1)"
  refuserc=$?
  t1="$(now_s)"
  st_case 'an unusable flock exits 99 rather than retrying it' "$refuserc" 99
  st_case 'and says lock-unusable, not queue-timeout' \
    "$([[ "$refuse" == *'VERDICT lock-unusable'* ]] && echo yes || echo no)" yes
  st_case 'and does not run the command' \
    "$([[ -e "$ranfile" ]] && echo yes || echo no)" no
  st_case 'and refuses immediately instead of spinning (<= 10s)' \
    "$((t1 - t0 <= 10))" 1
  st_case '--status reports the same host as unusable' \
    "$(OS_VERIFY_LOCK_FLOCK="${tmp}/no-such-flock" bash "$SELF" --status 2>&1 | grep -c 'CANNOT OPERATE THIS LOCK')" 1

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

  # every exit path prints a verdict, argument errors included.
  st_case 'a usage error prints a verdict too' \
    "$(bash "$SELF" -w 3000 -c true 2>&1 | grep -c 'VERDICT usage-error (exit 2)')" 1

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
