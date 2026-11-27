#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# dev-worktree.sh — the worktree-first procedure of `.claude/agents/os-dev.md`
# basic rule 1, as one command. Run it from the checkout of the repository the
# task lands in; it builds the task's own worktree BESIDE that checkout and
# never edits the checkout itself.
#
#   bash scripts/pm/dev-worktree.sh --branch=claude/issue-<n>-<slug>
#        [--worktree=<name>] [--resume-from=BRANCH@SHA] [--probe | --no-probe]
#        [--scratchpad=<dir>] [--no-install] [--backoff=<s,s,…>]
#   bash scripts/pm/dev-worktree.sh --base        # inside a worktree: print the pinned base
#   bash scripts/pm/dev-worktree.sh --pin-base    # inside a worktree: pin HEAD as the base, once
#   bash scripts/pm/dev-worktree.sh --self-test   # offline: fixture repos, no network
#
# ## What it runs, in this order — each step is a line of rule 1
#
#   1. `git fetch origin main`, then
#      `git worktree add --no-track ../<repo>-issue-<n> -b <branch> origin/main`.
#      `<repo>` is the checkout's own directory name and `<n>` is read from the
#      branch, so the tree and the branch cannot disagree; `--worktree=<name>`
#      names the tree when the claim does.
#   2. `--resume-from=BRANCH@SHA` (a claim's `Resume-from:` line): the same-name
#      branch is built from `origin/BRANCH` instead, after checking that its tip
#      IS that sha. The merge of `origin/main` the rule orders next is
#      `bash scripts/pm/os-regen-merge.sh`, run inside the new tree; this script
#      names it and does not run it.
#   3. the base is PINNED: `git rev-parse HEAD`, written to a file in the
#      worktree's own git dir, where it survives every shell and leaves with
#      `git worktree remove`. `--base` prints it. A resumed branch is pinned
#      after its merge, with `--pin-base`; a pin is never moved.
#   4. the empty-branch probe, `git push -u origin <branch>`, before any edit.
#      A 403 stops at once (exit 3: report `blocked`, no retry). Only a network
#      error is retried, on the `--backoff` schedule, and then given up (exit
#      4). Any other refusal stops without a retry (exit 5).
#   5. `--scratchpad=<dir>` (the session's scratchpad directory): `issue-<n>/`
#      is made under it.
#   6. `pnpm install` inside the new tree (`--no-install` leaves it to you).
#
# ## A branch the platform assigned is never pushed
#
# The probe is for a branch you build yourself. A card thread's branch is
# assigned by the platform and pushed by the harness, so it takes `--no-probe`.
# `claude/issue-<n>-<slug>` is the spelling rule 1 gives a self-built branch,
# and only that spelling is probed by default; for any other name this script
# will not guess — say `--probe` or `--no-probe`.
#
# ## What it will not do
#
# It never forces: no `--force`, no `-B`, no checkout in the shared tree. An
# existing path, an existing local branch, or a branch already on `origin`
# with no `--resume-from` is REFUSED before anything is created — the last one
# is either a claim whose `Resume-from:` you did not pass, or another session's
# work in flight (rule 2: stop and report `blocked`).
#
# Running it again for a tree it already built is safe: nothing is re-created,
# the pin is read back, and the probe is sent only if the branch is still
# empty and still absent from `origin` — so a network give-up (exit 4) is
# retried by the same command.
#
# ## Output
#
# stdout is `KEY=value` lines and one last `VERDICT …` line; the narration is
# on stderr.
#
#   WORKTREE=<absolute path>      BRANCH=<branch>
#   BASE=<sha> | unpinned         PROBE=pushed | on-origin | skipped | owed | 403 | network | refused
#   SCRATCH=<dir>                 INSTALL=done | skipped | failed
#
# Exit codes: 0 ready · 1 refused, nothing was created · 2 usage ·
#   3 the probe answered 403 · 4 the probe was not delivered (network, retries
#   spent) · 5 the probe was refused for another reason · 6 `pnpm install`
#   failed. From 3 up the worktree exists; the VERDICT line says what is owed.
#
# Bash 3.2 clean (`pnpm check:bash32-floor`): no associative array, no
# `mapfile`, no case-modifying expansion.

set -euo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

EXIT_REFUSED=1
EXIT_USAGE=2
EXIT_PROBE_403=3
EXIT_PROBE_NETWORK=4
EXIT_PROBE_REFUSED=5
EXIT_INSTALL=6

BASE_FILE_NAME='os-dev-worktree-base'
DEFAULT_BACKOFF='2,4,8,16'

log() { printf 'dev-worktree: %s\n' "$*" >&2; }

usage() {
  cat >&2 << 'USAGE'
usage:
  bash scripts/pm/dev-worktree.sh --branch=claude/issue-<n>-<slug> [--worktree=<name>]
       [--resume-from=BRANCH@SHA] [--probe | --no-probe] [--scratchpad=<dir>] [--no-install]
       [--backoff=<s,s,…>]
  bash scripts/pm/dev-worktree.sh --base        (inside a worktree) print the pinned base
  bash scripts/pm/dev-worktree.sh --pin-base    (inside a worktree) pin HEAD as the base, once
  bash scripts/pm/dev-worktree.sh --self-test

  Builds the task's worktree beside the current checkout from a freshly fetched origin/main
  (or, with --resume-from, from origin/BRANCH at the claimed sha), pins the base, sends the
  empty-branch probe, makes the issue's scratchpad directory and runs pnpm install.
  --no-probe: the branch is platform-assigned (a card thread) — it is never pushed here.
  Exits: 0 ready · 1 refused, nothing created · 2 usage · 3 probe 403 (report blocked, no retry)
         · 4 probe not delivered (network) · 5 probe refused otherwise · 6 pnpm install failed
USAGE
}

die_usage() {
  log "$*"
  usage
  exit "$EXIT_USAGE"
}

refuse() {
  log "REFUSED — $*"
  printf 'VERDICT refused — nothing was created\n'
  exit "$EXIT_REFUSED"
}

# ---------------------------------------------------------------------------
# The probe's failure, classified from what git printed. 403 is checked FIRST:
# git reports a refused push as `RPC failed; HTTP 403`, which also carries the
# words of a transport failure, and a 403 read as "network" would be retried.
# ---------------------------------------------------------------------------
classify_push_failure() {
  local out="$1"
  if printf '%s\n' "$out" | grep -Eq '(error:|HTTP|status|code)[ :]+403([^0-9]|$)|Permission to .+ denied'; then
    printf '403\n'
    return 0
  fi
  if printf '%s\n' "$out" | grep -Eiq 'Could not resolve host|Temporary failure in name resolution|Failed to connect|Network is unreachable|Connection (refused|reset|timed out)|Operation timed out|Empty reply from server|remote end hung up unexpectedly|unexpected disconnect|early EOF|RPC failed|(error:|HTTP)[ :]+5[0-9][0-9]([^0-9]|$)|gnutls_handshake|SSL_ERROR_SYSCALL|SSL_connect|TLS connection was non-properly terminated'; then
    printf 'network\n'
    return 0
  fi
  printf 'other\n'
}

# The pin lives in the worktree's OWN git dir: private to it, outside the tree,
# and gone with `git worktree remove`.
base_file_of() { printf '%s/%s\n' "$(git -C "$1" rev-parse --absolute-git-dir)" "$BASE_FILE_NAME"; }

read_base() {
  local file sha
  file="$(base_file_of "$1")"
  [ -f "$file" ] || return 1
  sha="$(head -n 1 "$file" | tr -d '[:space:]')"
  [ -n "$sha" ] || return 1
  git -C "$1" cat-file -e "${sha}^{commit}" 2> /dev/null || return 1
  printf '%s\n' "$sha"
}

is_shared_checkout() {
  local git_dir common
  git_dir="$(git -C "$1" rev-parse --absolute-git-dir)"
  common="$(cd "$1" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
  [ "$git_dir" = "$common" ]
}

mode_base() {
  local top sha
  top="$(git rev-parse --show-toplevel 2> /dev/null)" || { log 'not inside a git checkout'; exit "$EXIT_REFUSED"; }
  if sha="$(read_base "$top")"; then
    printf '%s\n' "$sha"
    return 0
  fi
  log "no base is pinned for $top — a tree this script built fresh pins one at creation; a resumed or hand-built tree pins with --pin-base, before its first edit"
  exit "$EXIT_REFUSED"
}

mode_pin_base() {
  local top sha file
  top="$(git rev-parse --show-toplevel 2> /dev/null)" || { log 'not inside a git checkout'; exit "$EXIT_REFUSED"; }
  if is_shared_checkout "$top"; then
    log "REFUSED — $top is the shared checkout, never a task tree (rule 1: worktree first); nothing was pinned"
    exit "$EXIT_REFUSED"
  fi
  if sha="$(read_base "$top")"; then
    log "REFUSED — a base is already pinned here ($sha) and a pin is never moved: it anchors every diff, log and reset of this task"
    exit "$EXIT_REFUSED"
  fi
  sha="$(git -C "$top" rev-parse HEAD)"
  file="$(base_file_of "$top")"
  printf '%s\n' "$sha" > "$file"
  log "pinned BASE=$sha for $top"
  printf '%s\n' "$sha"
}

# The branch a registered worktree at exactly this path has checked out; empty
# when no worktree is registered there.
worktree_branch_at() {
  git worktree list --porcelain | awk -v want="$1" '
    $1 == "worktree" { path = substr($0, 10); branch = "" }
    $1 == "branch" && path == want { sub(/^refs\/heads\//, "", $2); print $2 }
  '
}

# Sends the probe. Sets PROBE and returns 0, or one of the EXIT_PROBE_* codes.
PROBE=''
PROBE_ATTEMPTS=0
probe_push() {
  local wt="$1" branch="$2" out rc kind
  # The positional parameters become the delays still to spend.
  # shellcheck disable=SC2046
  set -- $(printf '%s' "$BACKOFF" | tr ',' ' ')
  while :; do
    PROBE_ATTEMPTS=$((PROBE_ATTEMPTS + 1))
    if out="$(git -C "$wt" push -u origin "$branch" 2>&1)"; then rc=0; else rc=$?; fi
    printf '%s\n' "$out" | sed 's/^/    | /' >&2
    if [ "$rc" -eq 0 ]; then
      PROBE='pushed'
      return 0
    fi
    kind="$(classify_push_failure "$out")"
    case "$kind" in
      403)
        PROBE='403'
        log "the probe answered 403 (git exit $rc) — STOP: report \`blocked\`; a 403 is never retried"
        return "$EXIT_PROBE_403"
        ;;
      network)
        if [ "$#" -eq 0 ]; then
          PROBE='network'
          log "the probe was not delivered: a network error on each of $PROBE_ATTEMPTS attempt(s) — run this command again to retry it"
          return "$EXIT_PROBE_NETWORK"
        fi
        log "the probe hit a network error (git exit $rc, attempt $PROBE_ATTEMPTS) — retrying in $1 s"
        sleep "$1"
        shift
        ;;
      *)
        PROBE='refused'
        log "the probe was refused (git exit $rc) and it is neither a 403 nor a network error — not retried; read the lines above"
        return "$EXIT_PROBE_REFUSED"
        ;;
    esac
  done
}

mode_build() {
  local top main_checkout parent repo issue='' path start resume_branch='' resume_sha='' built=0
  local existing remote_line tip base='' scratch='' install='skipped' rc=0 verdict head

  top="$(git rev-parse --show-toplevel 2> /dev/null)" || refuse 'not inside a git checkout: run this from the repository the task lands in'
  main_checkout="$(git -C "$top" worktree list --porcelain | sed -n '1s/^worktree //p')"
  [ -n "$main_checkout" ] || refuse "cannot read the main checkout of $top"
  parent="$(cd "$(dirname "$main_checkout")" && pwd -P)"
  repo="$(basename "$main_checkout")"

  if [ -n "$RESUME_FROM" ]; then
    case "$RESUME_FROM" in
      *@*) ;;
      *) die_usage "--resume-from takes BRANCH@SHA, exactly as the claim's Resume-from: line spells it (got: $RESUME_FROM)" ;;
    esac
    resume_branch="${RESUME_FROM%@*}"
    resume_sha="$(printf '%s' "${RESUME_FROM##*@}" | tr 'A-F' 'a-f')"
    if ! printf '%s' "$resume_sha" | grep -Eq '^[0-9a-f]{7,64}$'; then
      die_usage "--resume-from: '$resume_sha' is not a sha of 7 or more hex digits"
    fi
    if [ -n "$BRANCH" ] && [ "$BRANCH" != "$resume_branch" ]; then
      die_usage "--branch=$BRANCH and --resume-from name different branches: a resume continues the SAME branch ($resume_branch)"
    fi
    BRANCH="$resume_branch"
  fi
  [ -n "$BRANCH" ] || die_usage '--branch=<branch> is required'
  git check-ref-format --branch "$BRANCH" > /dev/null 2>&1 || die_usage "'$BRANCH' is not a branch name git accepts"
  case "$BRANCH" in
    main | master) die_usage "'$BRANCH' is the trunk, never a task branch" ;;
  esac

  if printf '%s' "$BRANCH" | grep -Eq '^claude/issue-[0-9]+(-|$)'; then
    issue="$(printf '%s' "$BRANCH" | sed -E 's|^claude/issue-([0-9]+).*$|\1|')"
  fi
  if [ -z "$WORKTREE" ]; then
    [ -n "$issue" ] || die_usage "the branch '$BRANCH' carries no issue number, so the tree has no default name: pass --worktree=<name>"
    WORKTREE="${repo}-issue-${issue}"
  fi
  if ! printf '%s' "$WORKTREE" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
    die_usage "--worktree takes a directory NAME (letters, digits, dot, dash, underscore), built beside the checkout — not a path: $WORKTREE"
  fi
  if [ -z "$PROBE_MODE" ]; then
    if [ -n "$issue" ]; then
      PROBE_MODE='probe'
    else
      die_usage "'$BRANCH' is not the claude/issue-<n>-<slug> spelling of a self-built branch, and this script will not guess: a platform-assigned branch (a card thread; the harness pushes it) takes --no-probe, a branch you were ordered to build takes --probe"
    fi
  fi
  if ! printf '%s\n' "$BACKOFF" | grep -Eq '^([0-9]+(,[0-9]+)*)?$'; then
    die_usage "--backoff takes seconds separated by commas (got: $BACKOFF)"
  fi
  if [ -n "$SCRATCHPAD" ]; then
    [ -d "$SCRATCHPAD" ] || die_usage "--scratchpad=$SCRATCHPAD is not a directory (pass the session's scratchpad directory)"
    [ -n "$issue" ] || die_usage "--scratchpad makes issue-<n>/ and '$BRANCH' carries no issue number: make the task's subdirectory yourself"
  fi
  path="${parent}/${WORKTREE}"

  if [ -e "$path" ]; then
    existing="$(worktree_branch_at "$path")"
    [ "$existing" = "$BRANCH" ] || refuse "$path exists and is not the worktree of $BRANCH${existing:+ (it holds $existing)} — nothing is ever forced; read what is there (git -C $path status)"
    built=1
    log "$path is already the worktree of $BRANCH — nothing is re-created"
  else
    if git -C "$top" show-ref --verify --quiet "refs/heads/$BRANCH"; then
      refuse "a local branch $BRANCH already exists (another worktree holds it, or an earlier run left it) — it is never reset; read \`git worktree list\`"
    fi
    if [ -n "$resume_branch" ]; then
      git -C "$top" fetch origin main "+refs/heads/${resume_branch}:refs/remotes/origin/${resume_branch}" >&2 \
        || refuse "git fetch of origin main and $resume_branch failed"
      tip="$(git -C "$top" rev-parse --verify --quiet "refs/remotes/origin/${resume_branch}^{commit}")" \
        || refuse "origin/$resume_branch does not resolve after the fetch"
      case "$tip" in
        "$resume_sha"*) ;;
        *) refuse "origin/$resume_branch is at $tip, and the claim's Resume-from names $resume_sha: the branch moved after the Release (or the line is stale) — read who pushed it before building on it" ;;
      esac
      start="origin/$resume_branch"
    else
      git -C "$top" fetch origin main >&2 || refuse 'git fetch origin main failed'
      remote_line="$(git -C "$top" ls-remote --heads origin "refs/heads/$BRANCH")" \
        || refuse "cannot read origin's heads, so whether $BRANCH is already there is unknown"
      if [ -n "$remote_line" ]; then
        refuse "$BRANCH is already on origin (${remote_line%%[[:space:]]*}): a claim with a Resume-from: line ⇒ pass --resume-from=BRANCH@SHA; otherwise it is another session's work in flight (rule 2: stop and report \`blocked\`)"
      fi
      start='origin/main'
    fi
    git -C "$top" worktree add --no-track "$path" -b "$BRANCH" "$start" >&2 \
      || refuse "git worktree add failed for $path"
    if [ -z "$resume_branch" ]; then
      head="$(git -C "$path" rev-parse HEAD)"
      printf '%s\n' "$head" > "$(base_file_of "$path")"
    fi
  fi

  if base="$(read_base "$path")"; then :; else base=''; fi

  # ── the empty-branch probe ───────────────────────────────────────────────
  if [ "$PROBE_MODE" = 'no-probe' ]; then
    PROBE='skipped'
    log "no probe: $BRANCH was declared platform-assigned (--no-probe), and such a branch is never pushed from here"
  elif [ "$built" -eq 1 ]; then
    remote_line="$(git -C "$path" ls-remote --heads origin "refs/heads/$BRANCH")" \
      || refuse "cannot read origin's heads, so whether the probe landed is unknown"
    if [ -n "$remote_line" ]; then
      PROBE='on-origin'
    elif [ -n "$base" ] && [ "$(git -C "$path" rev-parse HEAD)" = "$base" ]; then
      probe_push "$path" "$BRANCH" || rc=$?
    else
      PROBE='owed'
      log "$BRANCH is not on origin and is no longer an empty branch — your own first push is the probe now"
    fi
  else
    probe_push "$path" "$BRANCH" || rc=$?
  fi

  # ── scratchpad, install ──────────────────────────────────────────────────
  if [ "$rc" -eq 0 ] && [ -n "$SCRATCHPAD" ]; then
    scratch="$(cd "$SCRATCHPAD" && pwd -P)/issue-${issue}"
    mkdir -p "$scratch"
  fi
  if [ "$rc" -eq 0 ] && [ "$INSTALL" -eq 1 ]; then
    if (cd "$path" && pnpm install) >&2; then
      install='done'
    else
      install='failed'
      rc="$EXIT_INSTALL"
      log "pnpm install failed in $path — the tree, the pin and the probe stand; run it again there"
    fi
  fi

  printf 'WORKTREE=%s\n' "$path"
  printf 'BRANCH=%s\n' "$BRANCH"
  printf 'BASE=%s\n' "${base:-unpinned}"
  printf 'PROBE=%s\n' "$PROBE"
  [ -z "$scratch" ] || printf 'SCRATCH=%s\n' "$scratch"
  printf 'INSTALL=%s\n' "$install"
  if [ -z "$base" ] && [ -n "$resume_branch" ]; then
    log "BASE is unpinned: a resumed branch merges origin/main first (cd $path && bash scripts/pm/os-regen-merge.sh), then pins the base before its first edit (bash scripts/pm/dev-worktree.sh --pin-base)"
  elif [ -z "$base" ]; then
    log "BASE is unpinned: this tree was not built fresh by this script — pin the commit its work starts from, inside it, before the next edit (bash scripts/pm/dev-worktree.sh --pin-base)"
  fi
  case "$rc" in
    0) verdict="ready — cd $path" ;;
    "$EXIT_PROBE_403") verdict='blocked-403 — the write route refused the probe: stop, report blocked, do not retry' ;;
    "$EXIT_PROBE_NETWORK") verdict="probe-network — not delivered after $PROBE_ATTEMPTS attempt(s); the same command retries it" ;;
    "$EXIT_PROBE_REFUSED") verdict='probe-refused — neither a 403 nor a network error; not retried' ;;
    *) verdict="install-failed — run pnpm install in $path" ;;
  esac
  printf 'VERDICT %s\n' "$verdict"
  return "$rc"
}

# ---------------------------------------------------------------------------
# self-test — offline. A bare repository stands in for origin; a `git` shim on
# PATH answers the probe from a plan file and hands every other call to the
# real git, and a `pnpm` shim records the install it was asked for.
# ---------------------------------------------------------------------------

# name=minimum, one per line. A battery below its minimum means cases stopped
# running; the roster's own length is pinned too, so a deleted row cannot take
# its floor with it.
ST_BATTERIES='the probe failure classifier=10
a fresh worktree=13
refusals before anything is created=12
resume from a claimed sha=11
the probe=15
re-run, scratchpad and install=13
what the script never spells=4'
ST_BATTERY_FLOOR=7
ST_OPEN=''
ST_SEEN=''
ST_FAIL=0
ST_DIR=''
SELF_TEST_REACHED_VERDICT=0

st_battery() { ST_OPEN="$1"; }
st_case() {
  local name="$1" got="$2" want="$3"
  ST_SEEN="${ST_SEEN}${ST_OPEN:-(no battery open)}
"
  if [ "$got" = "$want" ]; then
    return 0
  fi
  ST_FAIL=$((ST_FAIL + 1))
  printf '  ✗ [%s] %s — got %s, want %s\n' "${ST_OPEN:-(no battery open)}" "$name" "$got" "$want" >&2
}

self_test() {
  set +e # every case below reads a status; a failing case is a finding, not an abort
  local dir real_git shim out rc err sha wt base main_sha origin tip plan
  dir="$(mktemp -d "${TMPDIR:-/tmp}/dev-worktree-XXXXXX")"
  dir="$(cd "$dir" && pwd -P)"
  # Global and removed at EXIT: the self-test always ends in the dispatch's
  # `exit`, and a function-local name would be gone by the time a trap ran.
  ST_DIR="$dir"
  trap 'rm -rf "$ST_DIR"' EXIT
  real_git="$(command -v git)"
  # Hermetic: no user or system git config reaches the fixture repositories or
  # the script under test (a host's `push.negotiate`, hooks path or identity
  # would otherwise be part of what these cases measure).
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  shim="$dir/shim"
  err="$dir/stderr.log"
  mkdir -p "$shim" "$dir/bin"

  cat > "$dir/bin/git" << 'SHIM'
#!/bin/sh
# Answers `push` from the plan (line N = attempt N: 403 | network | other |
# anything else = the real push) and counts the attempts; every other call is
# the real git.
for a in "$@"; do
  if [ "$a" = push ]; then
    n=$(cat "$OS_TEST_DEV_WORKTREE_SHIM/push.count" 2> /dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "$OS_TEST_DEV_WORKTREE_SHIM/push.count"
    mode=$(sed -n "${n}p" "$OS_TEST_DEV_WORKTREE_SHIM/push.plan" 2> /dev/null)
    case "$mode" in
      403)
        echo 'remote: Permission to objectstack-ai/objectstack.git denied to someone.' >&2
        echo "fatal: unable to access 'https://github.com/objectstack-ai/objectstack/': The requested URL returned error: 403" >&2
        exit 128
        ;;
      network)
        echo "fatal: unable to access 'https://github.com/objectstack-ai/objectstack/': Could not resolve host: github.com" >&2
        exit 128
        ;;
      other)
        echo ' ! [remote rejected] HEAD -> branch (pre-receive hook declined)' >&2
        exit 1
        ;;
    esac
  fi
done
exec "$OS_TEST_DEV_WORKTREE_REAL_GIT" "$@"
SHIM
  cat > "$dir/bin/pnpm" << 'SHIM'
#!/bin/sh
printf '%s|%s\n' "$PWD" "$*" >> "$OS_TEST_DEV_WORKTREE_SHIM/pnpm.log"
exit "$(cat "$OS_TEST_DEV_WORKTREE_SHIM/pnpm.exit" 2> /dev/null || echo 0)"
SHIM
  chmod +x "$dir/bin/git" "$dir/bin/pnpm"

  # origin (bare) · seed (a second clone, to move origin) · objectstack (the shared checkout)
  origin="$dir/origin.git"
  "$real_git" init --quiet --bare --initial-branch=main "$origin"
  "$real_git" clone --quiet "$origin" "$dir/seed" 2> /dev/null
  (
    cd "$dir/seed" || exit 1
    "$real_git" config user.email selftest@objectstack.ai
    "$real_git" config user.name selftest
    echo one > f.txt
    "$real_git" add f.txt
    "$real_git" commit --quiet -m c1
    "$real_git" push --quiet origin HEAD:main
  )
  "$real_git" clone --quiet "$origin" "$dir/objectstack"
  (
    cd "$dir/objectstack" || exit 1
    "$real_git" config user.email selftest@objectstack.ai
    "$real_git" config user.name selftest
  )
  # origin moves AFTER the shared checkout was cloned: a tree built from the
  # checkout's stale origin/main would miss this commit.
  (
    cd "$dir/seed" || exit 1
    echo two > f.txt
    "$real_git" commit --quiet -am c2
    "$real_git" push --quiet origin HEAD:main
  )
  main_sha="$("$real_git" -C "$dir/seed" rev-parse HEAD)"

  # run <cwd> <args…> — the script under the shims, stdout captured, stderr to $err
  run() {
    local cwd="$1"
    shift
    (
      cd "$cwd" || exit 97
      env -u GIT_DIR -u GIT_WORK_TREE PATH="$dir/bin:$PATH" \
        OS_TEST_DEV_WORKTREE_SHIM="$shim" OS_TEST_DEV_WORKTREE_REAL_GIT="$real_git" \
        bash "$SELF" "$@" 2> "$err"
    )
  }
  reset_shim() {
    rm -f "$shim/push.count" "$shim/push.plan" "$shim/pnpm.log" "$shim/pnpm.exit"
    [ -z "${1:-}" ] || printf '%s\n' "$1" | tr ',' '\n' > "$shim/push.plan"
  }
  pushes() { cat "$shim/push.count" 2> /dev/null || echo 0; }
  field() { printf '%s\n' "$1" | sed -n "s/^$2=//p"; }
  on_origin() { "$real_git" -C "$origin" rev-parse --verify --quiet "refs/heads/$1" 2> /dev/null || echo absent; }

  # ── the probe failure classifier ──────────────────────────────────────────
  st_battery 'the probe failure classifier'
  st_case "git's own 403 line" \
    "$(classify_push_failure "fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 403")" 403
  st_case "GitHub's permission line, with no number on it" \
    "$(classify_push_failure 'remote: Permission to o/r.git denied to someone.')" 403
  st_case '⛔ `RPC failed; HTTP 403` is a 403, although it carries the words of a transport failure — checked first, or it would be retried' \
    "$(classify_push_failure 'error: RPC failed; HTTP 403 curl 22 The requested URL returned error: 403')" 403
  st_case 'a name that does not resolve is a network error' \
    "$(classify_push_failure "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com")" network
  st_case 'a reset connection is a network error' \
    "$(classify_push_failure 'fatal: unable to access: Recv failure: Connection reset by peer')" network
  st_case 'a hung-up remote is a network error' \
    "$(classify_push_failure 'fatal: the remote end hung up unexpectedly')" network
  st_case 'a gateway 502 is a network error' \
    "$(classify_push_failure 'error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502')" network
  st_case 'a declined hook is neither — it is not retried' \
    "$(classify_push_failure ' ! [remote rejected] HEAD -> b (pre-receive hook declined)')" other
  st_case 'a 401 is neither: only a 403 is the blocked verdict and only a network error is retried' \
    "$(classify_push_failure "fatal: unable to access 'https://github.com/o/r/': The requested URL returned error: 401")" other
  st_case 'a byte count that happens to read 403 is not a 403' \
    "$(classify_push_failure 'Writing objects: 100% (3/3), 403 bytes | 403.00 KiB/s, done.')" other

  # ── a fresh worktree ──────────────────────────────────────────────────────
  st_battery 'a fresh worktree'
  reset_shim
  mkdir -p "$dir/pad"
  out="$(run "$dir/objectstack" --branch=claude/issue-7-demo --no-install --scratchpad="$dir/pad")"
  rc=$?
  wt="$dir/objectstack-issue-7"
  st_case 'it exits 0 and the last line is the ready verdict' "$rc|$(printf '%s\n' "$out" | tail -n 1)" "0|VERDICT ready — cd $wt"
  st_case 'the tree is built BESIDE the checkout, named <repo>-issue-<n> from the branch' "$(field "$out" WORKTREE)|$([ -d "$wt" ] && echo dir)" "$wt|dir"
  st_case 'it is on the branch asked for' "$("$real_git" -C "$wt" rev-parse --abbrev-ref HEAD)|$(field "$out" BRANCH)" 'claude/issue-7-demo|claude/issue-7-demo'
  st_case 'it starts from the FETCHED origin/main — the commit that landed after the checkout was cloned' \
    "$("$real_git" -C "$wt" rev-parse HEAD)" "$main_sha"
  st_case 'the base printed is that commit' "$(field "$out" BASE)" "$main_sha"
  st_case '--base inside the tree reads the pin back' "$(run "$wt" --base)" "$main_sha"
  st_case 'the pin is a file in the worktree'\''s own git dir, not in the tree' \
    "$(cat "$("$real_git" -C "$wt" rev-parse --absolute-git-dir)/$BASE_FILE_NAME")|$("$real_git" -C "$wt" status --porcelain | wc -l | tr -d ' ')" "$main_sha|0"
  st_case 'the probe was pushed once, and origin now holds the empty branch at that commit' \
    "$(field "$out" PROBE)|$(pushes)|$(on_origin claude/issue-7-demo)" "pushed|1|$main_sha"
  st_case 'the push set the upstream the branch was created without' \
    "$("$real_git" -C "$wt" rev-parse --abbrev-ref '@{upstream}' 2> /dev/null)" 'origin/claude/issue-7-demo'
  st_case 'the scratchpad got its issue-<n>/ directory' "$(field "$out" SCRATCH)|$([ -d "$dir/pad/issue-7" ] && echo dir)" "$dir/pad/issue-7|dir"
  st_case '--no-install ran no pnpm' "$(field "$out" INSTALL)|$([ -f "$shim/pnpm.log" ] && echo ran || echo none)" 'skipped|none'
  st_case 'the shared checkout was not touched: same branch, clean tree' \
    "$("$real_git" -C "$dir/objectstack" rev-parse --abbrev-ref HEAD)|$("$real_git" -C "$dir/objectstack" status --porcelain | wc -l | tr -d ' ')" 'main|0'
  st_case '--base in the shared checkout has nothing to print and exits 1' "$(run "$dir/objectstack" --base)|$?" '|1'

  # ── refusals before anything is created ───────────────────────────────────
  st_battery 'refusals before anything is created'
  reset_shim
  mkdir -p "$dir/objectstack-issue-8"
  out="$(run "$dir/objectstack" --branch=claude/issue-8-x --no-install)"
  rc=$?
  st_case 'a path that already exists is refused (1) and the branch was not created' \
    "$rc|$("$real_git" -C "$dir/objectstack" show-ref --verify --quiet refs/heads/claude/issue-8-x && echo branch || echo none)|$(pushes)" '1|none|0'
  st_case '…and the verdict says nothing was created' "$(printf '%s\n' "$out" | tail -n 1)" 'VERDICT refused — nothing was created'
  rmdir "$dir/objectstack-issue-8"
  "$real_git" -C "$dir/objectstack" branch claude/issue-8-x main
  out="$(run "$dir/objectstack" --branch=claude/issue-8-x --no-install)"
  st_case 'a local branch that already exists is refused (1), never reset, and no tree is built' \
    "$?|$([ -e "$dir/objectstack-issue-8" ] && echo built || echo none)|$(grep -c 'never reset' "$err")" '1|none|1'
  "$real_git" -C "$dir/objectstack" branch -D claude/issue-8-x > /dev/null
  "$real_git" -C "$dir/seed" push --quiet origin HEAD:refs/heads/claude/issue-8-x
  out="$(run "$dir/objectstack" --branch=claude/issue-8-x --no-install)"
  st_case 'a branch already on origin with no --resume-from is refused (1): no tree, no local branch, no push' \
    "$?|$([ -e "$dir/objectstack-issue-8" ] && echo built || echo none)|$("$real_git" -C "$dir/objectstack" show-ref --verify --quiet refs/heads/claude/issue-8-x && echo branch || echo none)|$(pushes)" '1|none|none|0'
  st_case '…and the refusal names both readings: the resume flag, and another session'\''s work in flight' \
    "$(grep -c -- '--resume-from=BRANCH@SHA' "$err")|$(grep -c 'in flight' "$err")" '1|1'
  out="$(run "$dir/objectstack" --branch=claude/project-thread-abc123 --worktree=objectstack-thread --no-install)"
  st_case '⛔ a branch that is not claude/issue-<n>-… is not probed by guess: usage (2), nothing built, nothing pushed' \
    "$?|$([ -e "$dir/objectstack-thread" ] && echo built || echo none)|$(pushes)|$(grep -c 'this script will not guess' "$err")" '2|none|0|1'
  out="$(run "$dir/objectstack" --branch=claude/project-thread-abc123 --no-probe --no-install)"
  st_case 'a branch with no issue number has no default tree name: usage (2)' "$?" 2
  out="$(run "$dir/objectstack" --no-install)"
  st_case 'no --branch is usage (2)' "$?" 2
  out="$(run "$dir/objectstack" --branch=claude/issue-8-y --worktree=../elsewhere --no-install)"
  st_case '--worktree takes a NAME beside the checkout, never a path: usage (2)' "$?|$([ -e "$dir/elsewhere" ] && echo built || echo none)" '2|none'
  out="$(run "$dir/objectstack" --branch=main --worktree=objectstack-main --no-install)"
  st_case 'the trunk is never a task branch: usage (2)' "$?" 2
  out="$(run "$dir/objectstack" --branch=claude/issue-8-y --frobnicate)"
  st_case 'an unknown flag is usage (2)' "$?" 2
  mkdir -p "$dir/plain"
  out="$(run "$dir/plain" --branch=claude/issue-8-y --no-install)"
  st_case 'outside any git checkout it is refused (1)' "$?" 1

  # ── resume from a claimed sha ─────────────────────────────────────────────
  st_battery 'resume from a claimed sha'
  reset_shim
  (
    cd "$dir/seed" || exit 1
    "$real_git" checkout --quiet -b claude/issue-9-resume "$main_sha~1"
    echo resumed > g.txt
    "$real_git" add g.txt
    "$real_git" commit --quiet -m 'work in flight'
    "$real_git" push --quiet origin claude/issue-9-resume
    "$real_git" checkout --quiet main
  )
  tip="$("$real_git" -C "$dir/seed" rev-parse claude/issue-9-resume)"
  out="$(run "$dir/objectstack" --resume-from="claude/issue-9-resume@deadbeef" --no-install)"
  st_case 'a Resume-from sha that is not the tip of origin/BRANCH is refused (1) before anything is built' \
    "$?|$([ -e "$dir/objectstack-issue-9" ] && echo built || echo none)|$(grep -c 'the branch moved after the Release' "$err")" '1|none|1'
  out="$(run "$dir/objectstack" --branch=claude/issue-9-other --resume-from="claude/issue-9-resume@$tip" --no-install)"
  st_case 'a --branch that differs from the resumed one is usage (2): a resume continues the SAME branch' "$?" 2
  out="$(run "$dir/objectstack" --resume-from=claude/issue-9-resume --no-install)"
  st_case '--resume-from without @SHA is usage (2)' "$?" 2
  out="$(run "$dir/objectstack" --resume-from="claude/issue-9-resume@$(printf '%s' "$tip" | cut -c1-12 | tr 'a-f' 'A-F')" --no-install)"
  rc=$?
  wt="$dir/objectstack-issue-9"
  st_case 'with the claimed sha (abbreviated, any case) the same-name branch is built from origin/BRANCH, at that commit' \
    "$rc|$("$real_git" -C "$wt" rev-parse --abbrev-ref HEAD)|$("$real_git" -C "$wt" rev-parse HEAD)" "0|claude/issue-9-resume|$tip"
  st_case 'a resumed tree is NOT pinned at creation: the base is taken after the merge of origin/main' "$(field "$out" BASE)" unpinned
  st_case '…and the line that says so names the merge script and --pin-base' \
    "$(grep -c 'os-regen-merge.sh' "$err")|$(grep -c -- '--pin-base' "$err")" '1|1'
  st_case 'the probe on a resumed branch pushes nothing new: origin keeps the claimed commit' "$(field "$out" PROBE)|$(on_origin claude/issue-9-resume)" "pushed|$tip"
  st_case '--pin-base inside the tree pins HEAD and prints it' "$(run "$wt" --pin-base)|$(run "$wt" --base)" "$tip|$tip"
  "$real_git" -C "$wt" -c user.email=selftest@objectstack.ai -c user.name=selftest commit --quiet --allow-empty -m later
  out="$(run "$wt" --pin-base)"
  st_case '⛔ a second --pin-base is refused (1) and the pin has not moved, although HEAD has' "$?|$(run "$wt" --base)" "1|$tip"
  out="$(run "$dir/objectstack" --pin-base)"
  st_case '⛔ --pin-base in the shared checkout is refused (1): it is never a task tree' \
    "$?|$([ -f "$("$real_git" -C "$dir/objectstack" rev-parse --absolute-git-dir)/$BASE_FILE_NAME" ] && echo pinned || echo none)" '1|none'
  out="$(run "$dir/plain" --base)"
  st_case '--base outside any git checkout exits 1 with empty stdout' "$?|$out" '1|'

  # ── the probe ─────────────────────────────────────────────────────────────
  st_battery 'the probe'
  reset_shim 403
  out="$(run "$dir/objectstack" --branch=claude/issue-10-denied --backoff=0,0)"
  rc=$?
  st_case '⛔ a 403 exits 3 after exactly ONE push — it is never retried' "$rc|$(pushes)|$(field "$out" PROBE)" '3|1|403'
  st_case '…the verdict is the blocked one' "$(printf '%s\n' "$out" | tail -n 1 | cut -c1-19)" 'VERDICT blocked-403'
  st_case '…the tree stands and its base is pinned, so the report can name both' \
    "$([ -d "$dir/objectstack-issue-10" ] && echo dir)|$(field "$out" BASE)" "dir|$main_sha"
  st_case '…and it STOPPED there: no pnpm install ran after a refused probe' "$(field "$out" INSTALL)|$([ -f "$shim/pnpm.log" ] && echo ran || echo none)" 'skipped|none'
  reset_shim network,network
  out="$(run "$dir/objectstack" --branch=claude/issue-11-flaky --no-install --backoff=0,0)"
  st_case 'two network errors, then the real push: retried on the backoff schedule, exit 0 after 3 attempts' \
    "$?|$(pushes)|$(field "$out" PROBE)|$(on_origin claude/issue-11-flaky)" "0|3|pushed|$main_sha"
  reset_shim network,network,network
  out="$(run "$dir/objectstack" --branch=claude/issue-12-down --no-install --backoff=0,0)"
  rc=$?
  st_case 'a network error on every attempt is given up at 1 + the schedule'\''s length: exit 4, three pushes, never a loop' \
    "$rc|$(pushes)|$(field "$out" PROBE)|$(on_origin claude/issue-12-down)" '4|3|network|absent'
  st_case '…and the verdict says the same command retries it' "$(printf '%s\n' "$out" | tail -n 1 | grep -c 'the same command retries it')" 1
  reset_shim network
  out="$(run "$dir/objectstack" --branch=claude/issue-13-once --no-install --backoff=)"
  st_case 'an empty --backoff spends no retry: one push, exit 4' "$?|$(pushes)" '4|1'
  reset_shim other
  out="$(run "$dir/objectstack" --branch=claude/issue-14-hook --no-install --backoff=0,0)"
  st_case 'a refusal that is neither is exit 5 after ONE push — only a network error is retried' "$?|$(pushes)|$(field "$out" PROBE)" '5|1|refused'
  reset_shim
  out="$(run "$dir/objectstack" --branch=claude/project-thread-abc123 --worktree=objectstack-thread --no-probe --no-install)"
  rc=$?
  st_case '⛔ --no-probe (a platform-assigned branch) builds the tree and pushes NOTHING: zero pushes, origin has no such branch' \
    "$rc|$(pushes)|$(field "$out" PROBE)|$(on_origin claude/project-thread-abc123)|$([ -d "$dir/objectstack-thread" ] && echo dir)" '0|0|skipped|absent|dir'
  st_case '…and it still pins the base' "$(field "$out" BASE)" "$main_sha"
  reset_shim
  out="$(run "$dir/objectstack" --branch=release-notes-fix --worktree=objectstack-notes --probe --no-install)"
  st_case 'a self-built branch with another spelling is probed when the caller says --probe' \
    "$?|$(pushes)|$(on_origin release-notes-fix)" "0|1|$main_sha"
  reset_shim
  out="$(run "$dir/objectstack" --branch=claude/issue-15-both --probe --no-probe --no-install)"
  st_case '--probe and --no-probe together are usage (2)' "$?|$(pushes)" '2|0'
  out="$(run "$dir/objectstack" --branch=claude/issue-15-both --no-install --backoff=soon)"
  st_case 'a --backoff that is not seconds is usage (2), before anything is built' "$?|$([ -e "$dir/objectstack-issue-15" ] && echo built || echo none)" '2|none'
  st_case 'the default schedule is four retries, 30 seconds in all' "$DEFAULT_BACKOFF" '2,4,8,16'

  # ── re-run, scratchpad and install ────────────────────────────────────────
  st_battery 're-run, scratchpad and install'
  reset_shim
  wt="$dir/objectstack-issue-7"
  out="$(run "$dir/objectstack" --branch=claude/issue-7-demo --no-install)"
  st_case 'a re-run for a tree already built exits 0, re-creates nothing and pushes nothing' \
    "$?|$(pushes)|$(field "$out" PROBE)|$(grep -c 'nothing is re-created' "$err")" '0|0|on-origin|1'
  st_case '…and reads the SAME base back' "$(field "$out" BASE)" "$main_sha"
  reset_shim
  out="$(run "$dir/objectstack" --branch=claude/issue-12-down --no-install)"
  st_case 'the re-run after a network give-up sends the probe that was owed: one push, exit 0, the branch on origin' \
    "$?|$(pushes)|$(field "$out" PROBE)|$(on_origin claude/issue-12-down)" "0|1|pushed|$main_sha"
  reset_shim
  "$real_git" -C "$dir/objectstack-issue-13" -c user.email=selftest@objectstack.ai -c user.name=selftest commit --quiet --allow-empty -m 'work'
  out="$(run "$dir/objectstack" --branch=claude/issue-13-once --no-install)"
  st_case '⛔ a re-run never pushes WORK as a probe: a branch with commits and absent from origin reads `owed`, zero pushes' \
    "$?|$(pushes)|$(field "$out" PROBE)|$(on_origin claude/issue-13-once)" '0|0|owed|absent'
  out="$(run "$dir/objectstack" --branch=claude/issue-99-other --worktree=objectstack-issue-7 --no-install)"
  st_case 'a path that is another branch'\''s worktree is refused (1), and the refusal names the branch it holds' \
    "$?|$(grep -c 'it holds claude/issue-7-demo' "$err")" '1|1'
  reset_shim
  out="$(run "$dir/objectstack" --branch=claude/issue-16-install)"
  rc=$?
  st_case 'without --no-install, pnpm install runs once, inside the NEW tree' \
    "$rc|$(field "$out" INSTALL)|$(cat "$shim/pnpm.log")" "0|done|$dir/objectstack-issue-16|install"
  reset_shim
  echo 1 > "$shim/pnpm.exit"
  out="$(run "$dir/objectstack" --branch=claude/issue-17-broken)"
  rc=$?
  st_case 'a failing pnpm install is exit 6, with the tree, the pin and the probe standing' \
    "$rc|$(field "$out" INSTALL)|$(field "$out" PROBE)|$(field "$out" BASE)" "6|failed|pushed|$main_sha"
  st_case '…and the verdict names the directory to run it in' "$(printf '%s\n' "$out" | tail -n 1)" "VERDICT install-failed — run pnpm install in $dir/objectstack-issue-17"
  reset_shim
  out="$(run "$dir/objectstack" --branch=claude/issue-18-pad --no-install --scratchpad="$dir/no-such-dir")"
  st_case 'a --scratchpad that is not a directory is usage (2), before anything is built' "$?|$([ -e "$dir/objectstack-issue-18" ] && echo built || echo none)" '2|none'
  out="$(run "$dir/objectstack" --branch=release-notes-2 --worktree=objectstack-notes-2 --probe --no-install --scratchpad="$dir/pad")"
  st_case '--scratchpad with a branch that carries no issue number is usage (2): there is no issue-<n>/ to make' "$?" 2
  reset_shim
  out="$(run "$dir/objectstack-issue-7" --branch=claude/issue-19-nested --no-install)"
  st_case 'run from INSIDE another worktree, the new tree is still built beside the shared checkout' \
    "$?|$(field "$out" WORKTREE)" "0|$dir/objectstack-issue-19"
  mkdir -p "$dir/hotcrm-src"
  "$real_git" clone --quiet "$origin" "$dir/hotcrm"
  out="$(run "$dir/hotcrm" --branch=claude/issue-20-sibling --no-install)"
  st_case 'run from a SIBLING repository'\''s checkout, the tree takes that repository'\''s name' \
    "$?|$(field "$out" WORKTREE)" "0|$dir/hotcrm-issue-20"
  st_case 'every stdout of a build is KEY=value lines and one VERDICT line' \
    "$(printf '%s\n' "$out" | grep -Evc '^(WORKTREE|BRANCH|BASE|PROBE|SCRATCH|INSTALL)=|^VERDICT ')" 0

  # ── what the script never spells ──────────────────────────────────────────
  # Read from the part of this file ABOVE the self-test, with comment lines
  # dropped: the cases below would otherwise match their own text.
  st_battery 'what the script never spells'
  plan="$(sed -n '1,/^# self-test — offline/p' "$SELF" | grep -v '^[[:space:]]*#')"
  st_case '⛔ no force anywhere: not on a push, a worktree, a branch or a checkout' \
    "$(printf '%s\n' "$plan" | grep -Ec -- '--force|git[^|;]*[[:space:]](-f|-B)([[:space:]]|$)')" 0
  st_case 'the one `worktree add` carries --no-track and a NEW branch (-b)' \
    "$(printf '%s\n' "$plan" | grep -c 'worktree add --no-track "$path" -b "$BRANCH" "$start"')|$(printf '%s\n' "$plan" | grep -c '" worktree add ')" '1|1'
  st_case 'the one push is `push -u origin <branch>`, and nothing deletes or rewrites a remote ref' \
    "$(printf '%s\n' "$plan" | grep -c 'push -u origin "$branch"')|$(printf '%s\n' "$plan" | grep -Ec 'push .*(--delete|--mirror|:refs/)|git .*reset --hard|git .*checkout ')" '1|0'
  st_case 'the shared checkout is only ever READ through -C "$top": fetch, ls-remote, show-ref, rev-parse, worktree' \
    "$(printf '%s\n' "$plan" | grep -Eo 'git -C "\$top" [a-z-]+' | sort -u | tr '\n' ' ')" 'git -C "$top" fetch git -C "$top" ls-remote git -C "$top" rev-parse git -C "$top" show-ref git -C "$top" worktree '

  # ── the floor: every declared battery ran, and ran its cases ──────────────
  local declared line name min count breached=0
  declared="$(printf '%s\n' "$ST_BATTERIES" | grep -c '=')"
  if [ "$declared" -lt "$ST_BATTERY_FLOOR" ]; then
    breached=1
    printf '  ✗ ST_BATTERIES declares %s batteries, below the pinned %s — a battery deleted from the roster takes its floor with it.\n' "$declared" "$ST_BATTERY_FLOOR" >&2
  fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    name="${line%=*}"
    min="${line##*=}"
    count="$(printf '%s' "$ST_SEEN" | grep -cFx -- "$name")"
    if [ "$count" -lt "$min" ]; then
      breached=1
      printf '  ✗ self-test battery "%s" registered %s case(s), below its pinned floor of %s — cases that used to run no longer do.\n' "$name" "$count" "$min" >&2
    fi
  done << EOF
$ST_BATTERIES
EOF
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if ! printf '%s\n' "$ST_BATTERIES" | grep -qF -- "${line}="; then
      breached=1
      printf '  ✗ a case registered under "%s", which is not a declared battery — nothing floors it.\n' "$line" >&2
    fi
  done << EOF
$(printf '%s' "$ST_SEEN" | sort -u)
EOF

  local total
  total="$(printf '%s' "$ST_SEEN" | grep -c '')"
  if [ "$breached" -ne 0 ] || [ "$ST_FAIL" -gt 0 ]; then
    printf '✗ dev-worktree self-test: %s of %s case(s) failed%s.\n' "$ST_FAIL" "$total" "$([ "$breached" -ne 0 ] && printf ', and a battery floor was breached')" >&2
    return 1
  fi
  printf '✓ dev-worktree self-test: %s cases pass across %s batteries — offline, a bare fixture origin, no network.\n' "$total" "$declared"
  SELF_TEST_REACHED_VERDICT=1
  return 0
}

# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------

BRANCH=''
WORKTREE=''
RESUME_FROM=''
PROBE_MODE=''
SCRATCHPAD=''
INSTALL=1
BACKOFF="$DEFAULT_BACKOFF"
MODE='build'

set_probe_mode() {
  if [ -n "$PROBE_MODE" ] && [ "$PROBE_MODE" != "$1" ]; then
    die_usage '--probe and --no-probe contradict each other'
  fi
  PROBE_MODE="$1"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --self-test)
      rc=0
      self_test || rc=$?
      if [ "$rc" -eq 0 ] && [ "$SELF_TEST_REACHED_VERDICT" -ne 1 ]; then
        printf '✗ dev-worktree self-test: returned without reaching its verdict.\n' >&2
        exit 1
      fi
      exit "$rc"
      ;;
    --base) MODE='base' ;;
    --pin-base) MODE='pin-base' ;;
    --branch=*) BRANCH="${1#--branch=}" ;;
    --worktree=*) WORKTREE="${1#--worktree=}" ;;
    --resume-from=*) RESUME_FROM="${1#--resume-from=}" ;;
    --scratchpad=*) SCRATCHPAD="${1#--scratchpad=}" ;;
    --backoff=*) BACKOFF="${1#--backoff=}" ;;
    --probe) set_probe_mode 'probe' ;;
    --no-probe) set_probe_mode 'no-probe' ;;
    --no-install) INSTALL=0 ;;
    --help | -h)
      usage
      exit 0
      ;;
    *) die_usage "unrecognised argument: $1" ;;
  esac
  shift
done

case "$MODE" in
  base) mode_base ;;
  pin-base) mode_pin_base ;;
  *)
    rc=0
    mode_build || rc=$?
    exit "$rc"
    ;;
esac
