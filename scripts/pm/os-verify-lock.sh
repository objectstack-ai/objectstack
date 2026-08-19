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
# The lock fd is closed in the wrapped command's child (`{LFD}>&-`), so a
# process the command leaves behind cannot inherit the lock — mechanism 3 above.
# Release still belongs to the fd: this script never hand-rolls a lockfile, and
# a kill -9 at any point releases the lock the moment the process dies.
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
QUEUE_DIR="${LOCK_FILE}.q"
HOLDER_FILE="${LOCK_FILE}.holder"
readonly TICKET_MAX_AGE_S=$((HARD_CAP_S + 300))

SELF="${BASH_SOURCE[0]}"
TICKET=""
HOLDING=0
BUDGET_NOTE=""

log() { printf 'os-verify-lock: %s\n' "$*" >&2; }

now_s() { printf '%s' "${EPOCHSECONDS}"; }

# Microsecond arrival stamp, zero-padded so plain lexical (glob) order IS
# arrival order. `EPOCHREALTIME` renders its separator per locale, hence the
# character class; `date` is the fallback if the shell ever stops providing it.
now_stamp() {
  local raw="${EPOCHREALTIME:-}"
  raw="${raw/[.,]/}"
  case "$raw" in '' | *[!0-9]*) raw="$(date +%s%N 2> /dev/null || echo 0)" ;; esac
  printf '%020d' "$raw"
}

# Field 22 of /proc/<pid>/stat (process start time). Strips through the LAST
# ') ' first: field 2 is the comm, which may itself contain spaces and parens.
proc_starttime() {
  local pid="$1" stat rest
  [[ -r "/proc/${pid}/stat" ]] || return 1
  stat="$(< "/proc/${pid}/stat")" || return 1
  rest="${stat##*) }"
  [[ "$rest" != "$stat" ]] || return 1
  awk '{ print $20 }' <<< "$rest"
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
  [[ -d "/proc/${pid}" ]] || return 1
  [[ "$(proc_starttime "$pid" 2> /dev/null || echo x)" == "$start" ]] || return 1
  now="$(now_s)"
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
    if [[ -d "/proc/${pid}" && "$(proc_starttime "$pid" 2> /dev/null || echo x)" == "$start" ]]; then
      held=$(($(now_s) - stamp))
      printf 'holder pid %s, held %ss — %s' "$pid" "$held" "${label:-?}"
      return 0
    fi
    rm -f "$HOLDER_FILE" 2> /dev/null || true
  fi
  if lock_is_held; then
    printf 'holder did NOT come through this entry point (no duration available); processes with the lock file open: %s' \
      "$(fuser "$LOCK_FILE" 2> /dev/null | tr -s ' ' || echo unknown)"
    return 0
  fi
  printf 'lock is free'
}

# Definitive held/free: a non-blocking acquisition attempt in a child. `fuser`
# alone cannot answer this — it lists every process with the file OPEN, which
# includes the waiters.
lock_is_held() {
  flock -n -E 99 "$LOCK_FILE" -c true > /dev/null 2>&1
  (($? == 99))
}

human_s() {
  local s="$1"
  if ((s >= 60)); then printf '%ss (%dm%02ds)' "$s" $((s / 60)) $((s % 60)); else printf '%ss' "$s"; fi
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
Exit 99 means this call never acquired the lock; every run prints a VERDICT line.
USAGE
}

mode_status() {
  local n=0 file pid start stamp label
  printf 'lock: %s\n' "$LOCK_FILE"
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

  effective_budget
  [[ -n "$BUDGET_NOTE" ]] && log "⚠ $BUDGET_NOTE"

  local started deadline waited=0 ordered=1
  started="$(now_s)"
  deadline=$((started + BUDGET))

  trap cleanup EXIT
  trap 'cleanup; exit 130' INT TERM HUP
  if queue_usable && take_ticket "$label"; then
    : # ordered acquisition; our ticket decides when we may call flock
  else
    ordered=0
    log "⚠ ticket queue at ${QUEUE_DIR} is unusable — falling back to unordered acquisition (the cap and the lock itself are unaffected)."
  fi

  # Wait for headship. Only the head touches flock, so this loop is pure
  # polling and costs the lock nothing.
  local -a q
  local last_report=0 now pos i
  while ((ordered == 1)); do
    now="$(now_s)"
    if ((now >= deadline)); then
      waited=$((now - started))
      log "VERDICT queue-timeout (exit 99) · never acquired · waited $(human_s "$waited") · never reached the head of the queue · $(holder_line)"
      exit 99
    fi
    mapfile -t q < <(queue_live)
    pos=0
    for i in "${!q[@]}"; do
      [[ "${q[$i]}" == "$TICKET" ]] && {
        pos=$((i + 1))
        break
      }
    done
    # Our own ticket pruned out from under us (over-age, or a hostile cleanup):
    # take a fresh one rather than silently waiting on a queue we left.
    if ((pos == 0)); then
      take_ticket "$label" || {
        ordered=0
        break
      }
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
  local lfd remaining
  exec {lfd}>> "$LOCK_FILE" || {
    log "✗ cannot open ${LOCK_FILE} for locking."
    exit 1
  }
  while :; do
    now="$(now_s)"
    remaining=$((deadline - now))
    if ((remaining <= 0)); then
      waited=$((now - started))
      log "VERDICT queue-timeout (exit 99) · never acquired · waited $(human_s "$waited") · $(holder_line)"
      exit 99
    fi
    ((remaining > SLICE_S)) && remaining="$SLICE_S"
    if flock -w "$remaining" "$lfd"; then break; fi
    now="$(now_s)"
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
    bash -c "$1" {lfd}>&- || rc=$?
  else
    "$@" {lfd}>&- || rc=$?
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
  mapfile -t live < <(queue_live)
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
  local s1 s2
  s1="$(now_stamp)"
  sleep 0.01
  s2="$(now_stamp)"
  st_case 'arrival stamps are fixed-width and increasing' \
    "$([[ ${#s1} -eq 20 && ${#s2} -eq 20 && "$s1" < "$s2" ]] && echo yes || echo no)" yes

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
        exit 2
      }
      mode_run shell "$2" "$2"
      ;;
    --)
      shift
      [[ $# -ge 1 ]] || {
        log "✗ -- needs a command."
        usage
        exit 2
      }
      mode_run argv "$*" "$@"
      ;;
    '')
      usage
      exit 2
      ;;
    *)
      log "✗ unknown argument '${1}'. There is no -w here on purpose: the acquisition budget is capped at the call site."
      usage
      exit 2
      ;;
  esac
}

main "$@"
