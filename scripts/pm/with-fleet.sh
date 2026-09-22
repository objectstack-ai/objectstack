#!/usr/bin/env bash
# with-fleet.sh — run ONE command as the fleet's GitHub identity, behind the
# fleet-wide write gate.
#
#   scripts/pm/with-fleet.sh -- gh api -X POST /repos/o/r/pulls/12/ready_for_review
#   scripts/pm/with-fleet.sh --kind 'git push' -- git push origin HEAD
#   scripts/pm/with-fleet.sh --read -- gh api /rate_limit        # a read: identity only, no gate
#   scripts/pm/with-fleet.sh --batch 17 --kind 'gh api POST' -- …  # rule ⑤ announced for this token
#   scripts/pm/with-fleet.sh --self-test                          # offline: a fixture cache, no network
#
# What it does, in order:
#
#   ① `fleet-token.mjs --export` — the App's installation token (cached at
#      mode 0600, minted when stale, serialised across processes by the write
#      lease), evaluated into THIS shell: GITHUB_TOKEN and GH_TOKEN for `gh`
#      and for every tool under scripts/pm that reads
#      `process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN` — which is how no
#      business line in those tools had to change.
#   ② the git identity, from the environment only: the COMMITTER is always
#      `<bot login>` <`<bot user id>+<bot login>@users.noreply.github.com`>;
#      the AUTHOR is the same unless `OS_FLEET_GIT_AUTHOR_LOGIN` named a real
#      login, which `fleet-token.mjs` resolved to its numeric id — so a commit
#      can read "someone authored, objectstack-fleet[bot] committed" while the
#      actor of the push stays the bot.
#   ③ git credentials, from the environment only: `GIT_CONFIG_COUNT` pairs
#      that RESET the credential-helper list (the host's keychain would answer
#      first with a person's token) and add `fleet-git-credential.sh`, which
#      reads the token from `GITHUB_TOKEN` when git asks. Nothing lands in any
#      config file, no remote URL carries a token, and `git remote -v` is
#      unchanged — stronger than a masked URL, because there is nothing to mask.
#   ④ `write-pace.mjs --run` — the lease (one write in flight, fleet-wide), the
#      gap, the batch gap when announced, the stop marker — around the command,
#      with inherited stdio; `--read` skips ④ because a read is never gated.
#
# Exit codes: the command's own, passed through. Before the command runs:
#   2 usage · 3 / 5 / 10 exactly as `fleet-token.mjs` and `write-pace.mjs`
#   define them (prerequisite · platform refused · throttle refused), with
#   their prescriptions already printed.
#
# ⛔ The token is never printed by this script, never placed in an argument,
# and never written anywhere but the minter's 0600 cache. `set -x` in a
# CALLING shell would echo the eval'd exports — do not trace this script.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="${HERE}/$(basename "${BASH_SOURCE[0]}")" # absolute: the self-test cd's into a throwaway repo
EXIT_USAGE=2

usage() {
  cat >&2 << 'USAGE'
usage:
  scripts/pm/with-fleet.sh [--read] [--kind <label>] [--batch <N>] [--no-git-identity] -- <command…>
  scripts/pm/with-fleet.sh --self-test

  Mints (or reuses) the fleet's installation token, exports it for gh/git and every scripts/pm tool,
  sets the git committer to the bot, hands git its credential through the environment, and runs the
  command behind write-pace's lease and gap. --read skips the gate (reads are never gated).
  Exits: the command's own · 2 usage · 3/5/10 from the minter or the gate, before the command ran.
USAGE
}

log() { printf 'with-fleet: %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# self-test — offline. A fixture cache stands in for the platform; the assertions
# are about what THIS script exports, what git sees, and what never leaks.
# ---------------------------------------------------------------------------

ST_PASS=0
ST_FAIL=0
ST_MIN_CASES=17
st_case() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then
    ST_PASS=$((ST_PASS + 1))
  else
    ST_FAIL=$((ST_FAIL + 1))
    printf '  ✗ %s — got %q, want %q\n' "$name" "$got" "$want" >&2
  fi
}

self_test() {
  local dir token cache pace out rc err repo
  set +e # every case below reads a status; a failing case is a finding, not an abort
  dir="$(mktemp -d "${TMPDIR:-/tmp}/with-fleet-XXXXXX")"
  trap 'rm -rf "$dir"' RETURN
  token='ghs_FixtureTokenNotRealAtAll0000000000000'
  cache="$dir/fleet-token.json"
  pace="$dir/pace.jsonl"
  err="$dir/stderr.log"
  : > "$err"
  # A far-future expiry, the bot identity, and a resolved author: what the
  # minter would have cached. No network is needed to read it back.
  cat > "$cache" << EOF
{
  "token": "$token",
  "expires_at": "2099-01-01T00:00:00Z",
  "bot": { "login": "objectstack-fleet[bot]", "id": 332303061 },
  "author": { "login": "someone", "id": 42, "name": "Some One" },
  "app_id": "1",
  "installation_id": "2",
  "permissions": { "contents": "write" },
  "repository_selection": "all",
  "minted_at": "2026-09-22T00:00:00Z"
}
EOF
  chmod 600 "$cache"

  # The environment every case runs under. GIT_* location variables are
  # stripped so a hook-inherited GIT_DIR cannot point the throwaway repo below
  # at the real one (scripts/git-env.mjs, the incident it records).
  run() {
    env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_CONFIG_COUNT \
      OS_FLEET_TOKEN_CACHE_FILE="$cache" OS_FLEET_APP_ID=1 OS_FLEET_INSTALLATION_ID=2 OS_FLEET_PRIVATE_KEY= \
      OS_PM_WRITE_PACE_FILE="$pace" OS_PM_WRITE_MIN_GAP_MS=0 HTTPS_PROXY= https_proxy= \
      GITHUB_TOKEN= GH_TOKEN= \
      bash "$SELF" "$@" 2>> "$err"
  }

  # ① the token reaches the command as GITHUB_TOKEN and GH_TOKEN
  out="$(run --read -- sh -c 'printf "%s|%s" "$GITHUB_TOKEN" "$GH_TOKEN"')"
  st_case 'the token is exported as GITHUB_TOKEN and GH_TOKEN' "$out" "$token|$token"

  # ② the git identity: committer is the bot; author is the resolved login when one was given
  out="$(run --read -- sh -c 'printf "%s <%s>|%s <%s>" "$GIT_COMMITTER_NAME" "$GIT_COMMITTER_EMAIL" "$GIT_AUTHOR_NAME" "$GIT_AUTHOR_EMAIL"')"
  st_case 'the committer is the bot, by its USER id; the author is the resolved login' "$out" \
    'objectstack-fleet[bot] <332303061+objectstack-fleet[bot]@users.noreply.github.com>|Some One <42+someone@users.noreply.github.com>'

  # …and without an author in the cache, author == committer == bot
  local cache2="$dir/fleet-token-noauthor.json"
  sed '/"author"/d' "$cache" > "$cache2" && chmod 600 "$cache2"
  out="$(OS_FLEET_TOKEN_CACHE_FILE="$cache2" env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE OS_FLEET_TOKEN_CACHE_FILE="$cache2" OS_FLEET_APP_ID=1 OS_FLEET_INSTALLATION_ID=2 OS_PM_WRITE_PACE_FILE="$pace" HTTPS_PROXY= https_proxy= bash "$SELF" --read -- sh -c 'printf "%s|%s" "$GIT_AUTHOR_EMAIL" "$GIT_COMMITTER_EMAIL"' 2>> "$err")"
  st_case 'with no author login the author is the bot too' "$out" \
    '332303061+objectstack-fleet[bot]@users.noreply.github.com|332303061+objectstack-fleet[bot]@users.noreply.github.com'

  # ③ a real commit in a throwaway repo carries that identity, and the remote stays token-free
  repo="$dir/repo"
  mkdir -p "$repo"
  ( cd "$repo" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git init -q . && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git remote add origin https://github.com/objectstack-ai/objectstack.git )
  out="$(cd "$repo" && run --read -- git commit -q --allow-empty -m 'fixture' && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git log -1 --format='%an <%ae>|%cn <%ce>')"
  st_case 'a commit made under the wrapper is authored by the login and committed by the bot' "$out" \
    'Some One <42+someone@users.noreply.github.com>|objectstack-fleet[bot] <332303061+objectstack-fleet[bot]@users.noreply.github.com>'
  out="$(cd "$repo" && run --read -- git remote -v | tr '\n' ' ')"
  st_case '`git remote -v` under the wrapper carries no token and the plain URL' \
    "$([[ "$out" != *"$token"* && "$out" == *'https://github.com/objectstack-ai/objectstack.git'* ]] && echo clean || echo "leaked: $out")" clean
  out="$(cd "$repo" && run --read -- git config --show-origin --get-all credential.helper | grep 'fleet-git-credential' | cut -f1)"
  st_case 'the credential helper reaches git from the ENVIRONMENT (git reports it as "command line:"), never from a file' "$out" 'command line:'
  # …and it is the helper that ANSWERS: the reset dropped the host keychain, so
  # `git credential fill` gets the fixture token and not a person's.
  out="$(cd "$repo" && printf 'protocol=https\nhost=github.com\n\n' | run --read -- git credential fill | grep -E '^(username|password)=' | tr '\n' '|')"
  st_case '`git credential fill` for github.com is answered by the fleet helper, not the host keychain' "$out" "username=x-access-token|password=$token|"

  # …and the helper itself answers github.com only, from GITHUB_TOKEN only
  out="$(printf 'protocol=https\nhost=github.com\n' | GITHUB_TOKEN="$token" bash "$HERE/fleet-git-credential.sh" get | tr '\n' '|')"
  st_case 'the helper answers github.com with x-access-token and the token' "$out" "username=x-access-token|password=$token|"
  out="$(printf 'protocol=https\nhost=example.com\n' | GITHUB_TOKEN="$token" bash "$HERE/fleet-git-credential.sh" get)"
  st_case '…and nothing for any other host' "$out" ''
  out="$(printf 'protocol=https\nhost=github.com\n' | GITHUB_TOKEN= bash "$HERE/fleet-git-credential.sh" get)"
  st_case '…and nothing without a token' "$out" ''
  out="$(printf 'protocol=https\nhost=github.com\n' | GITHUB_TOKEN="$token" bash "$HERE/fleet-git-credential.sh" erase)"
  st_case '…and ignores store/erase' "$out" ''

  # ④ the gate: a write records a reservation; --read records nothing
  rm -f "$pace"
  run --kind 'fixture write' -- true
  rc=$?
  st_case 'a gated command runs (exit 0) and the throttle recorded ONE reservation under the kind given' \
    "$rc|$(grep -c '"kind":"fixture write"' "$pace" 2> /dev/null || echo 0)" '0|1'
  st_case '…and the lease was released' "$([[ -d "$pace.lease" ]] && echo held || echo free)" free
  rc=0
  run -- sh -c 'exit 7' || rc=$?
  st_case "a failing command's own exit code passes through, never rewritten" "$rc" 7
  # A scripts/pm tool on the write-pace roster gates itself: identity only.
  printf 'A body.\n' > "$dir/b.md"
  : > "$err.tool"
  env -u GIT_DIR OS_FLEET_TOKEN_CACHE_FILE="$cache" OS_FLEET_APP_ID=1 OS_FLEET_INSTALLATION_ID=2 OS_PM_WRITE_PACE_FILE="$pace" OS_PM_WRITE_MIN_GAP_MS=0 HTTPS_PROXY= https_proxy= \
    bash "$SELF" -- node "$HERE/issue-create.mjs" --dry-run --repo o/r --title x --body-file "$dir/b.md" > /dev/null 2> "$err.tool"
  rc=$?
  st_case 'a roster tool under the wrapper runs with identity only — no second gate around a tool that gates itself' \
    "$rc|$(grep -c 'gates itself' "$err.tool")" '0|1'
  cat "$err.tool" >> "$err"

  # ⑤ usage and prerequisites
  rc=0
  run --bogus -- true || rc=$?
  st_case 'an unknown flag is usage (2)' "$rc" "$EXIT_USAGE"
  rc=0
  run --read || rc=$?
  st_case 'no command is usage (2)' "$rc" "$EXIT_USAGE"
  rc=0
  # OS_FLEET_INPUTS_FROM_GITHUB=0: on a CI runner a GITHUB_TOKEN is present, and
  # this case must refuse from the environment alone, never read real variables.
  env -u GIT_DIR OS_FLEET_TOKEN_CACHE_FILE="$dir/absent.json" OS_FLEET_APP_ID= OS_FLEET_INSTALLATION_ID= OS_FLEET_INPUTS_FROM_GITHUB=0 OS_PM_WRITE_PACE_FILE="$pace" HTTPS_PROXY= https_proxy= bash "$SELF" --read -- true 2>> "$err" || rc=$?
  st_case 'missing fleet inputs and no cache is the minter\x27s exit 3, before the command runs' "$rc" 3

  # ⑥ redaction: nothing this script or the minter wrote to stderr carries the token
  st_case '⛔ the token appears in NO stderr line of any case above' "$(grep -c "$token" "$err" || true)" 0

  local total=$((ST_PASS + ST_FAIL))
  if ((total < ST_MIN_CASES)); then
    printf '✗ with-fleet self-test: only %d case(s) ran, below the pinned floor of %d — cases that used to run no longer do.\n' "$total" "$ST_MIN_CASES" >&2
    return 1
  fi
  if ((ST_FAIL > 0)); then
    printf '✗ with-fleet self-test: %d of %d case(s) failed.\n' "$ST_FAIL" "$total" >&2
    return 1
  fi
  printf '✓ with-fleet self-test: %d cases pass — the token and the bot identity reach the command from a fixture cache, a commit is authored by the login and committed by the bot, the remote and every stderr line stay token-free, the helper answers github.com alone, and the gate records exactly one reservation per gated run.\n' "$total"
  SELF_TEST_REACHED_VERDICT=1
  return 0
}

# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------

READ=0
KIND=''
BATCH=''
GIT_IDENTITY=1
SELF_TEST_REACHED_VERDICT=0
while (($#)); do
  case "$1" in
    --) shift; break ;;
    --read) READ=1; shift ;;
    --kind) KIND="${2:-}"; shift 2 ;;
    --batch) BATCH="${2:-}"; shift 2 ;;
    --no-git-identity) GIT_IDENTITY=0; shift ;;
    --self-test)
      self_test
      rc=$?
      if ((rc == 0)) && ((SELF_TEST_REACHED_VERDICT != 1)); then
        printf '✗ with-fleet self-test: returned without reaching its verdict.\n' >&2
        exit 1
      fi
      exit "$rc"
      ;;
    --help | -h) usage; exit 0 ;;
    *) log "unrecognised option: $1"; usage; exit "$EXIT_USAGE" ;;
  esac
done
if (($# == 0)); then
  log 'a command is required after --'
  usage
  exit "$EXIT_USAGE"
fi

# ① the identity, into this shell. A non-zero exit here is the minter's own
# (3 prerequisite · 5 platform refused · 10 throttle refused), already explained.
EXPORTS="$(node "$HERE/fleet-token.mjs" --export)" || {
  rc=$?
  log "fleet-token.mjs --export failed (exit $rc); the command was not run."
  exit "$rc"
}
eval "$EXPORTS"
unset EXPORTS
export GITHUB_TOKEN GH_TOKEN

# ② the git identity, from the environment only.
if ((GIT_IDENTITY)); then
  export GIT_COMMITTER_NAME="$OS_FLEET_BOT_LOGIN"
  export GIT_COMMITTER_EMAIL="${OS_FLEET_BOT_USER_ID}+${OS_FLEET_BOT_LOGIN}@users.noreply.github.com"
  if [[ -n "${OS_FLEET_GIT_AUTHOR_EMAIL:-}" ]]; then
    export GIT_AUTHOR_NAME="${OS_FLEET_GIT_AUTHOR_NAME:-$OS_FLEET_BOT_LOGIN}"
    export GIT_AUTHOR_EMAIL="$OS_FLEET_GIT_AUTHOR_EMAIL"
  else
    export GIT_AUTHOR_NAME="$GIT_COMMITTER_NAME"
    export GIT_AUTHOR_EMAIL="$GIT_COMMITTER_EMAIL"
  fi

  # ③ the credential, from the environment only. Appended AFTER any pairs the
  # container already carries (its proxy CA, its `insteadOf` rewrites), which
  # `scripts/git-env.mjs` names as transport configuration a network child
  # must keep. An EMPTY credential.helper value resets the list, so the host
  # keychain (a person's token) never answers first.
  n="${GIT_CONFIG_COUNT:-0}"
  export "GIT_CONFIG_KEY_${n}=credential.helper" "GIT_CONFIG_VALUE_${n}="
  export "GIT_CONFIG_KEY_$((n + 1))=credential.helper" "GIT_CONFIG_VALUE_$((n + 1))=!'${HERE}/fleet-git-credential.sh'"
  export GIT_CONFIG_COUNT=$((n + 2))
  export GIT_TERMINAL_PROMPT=0
fi

# ④ the gate — unless the command IS a scripts/pm tool that gates itself (the
# write-pace roster): it calls both halves of the throttle around its own
# requests, so wrapping it in a second gate would only hold the lease over its
# head. Identity only for those; the roster is read from write-pace, not copied.
if ((READ == 0)) && [[ "${1##*/}" == node && "${2:-}" == *scripts/pm/*.mjs ]]; then
  tool="${2##*/}"
  if node --input-type=module -e "const m = await import(process.argv[1]); process.exit(m.WIRED_WRITE_TOOLS.includes(process.argv[2]) ? 0 : 1)" -- "file://$HERE/write-pace.mjs" "$tool" 2> /dev/null; then
    log "$tool gates itself (write-pace roster) — identity only, no second gate around it."
    READ=1
  fi
fi
GATE=("$HERE/write-pace.mjs" --run)
((READ)) && GATE+=(--read)
[[ -n "$KIND" ]] && GATE+=(--kind "$KIND")
[[ -n "$BATCH" ]] && GATE+=(--batch "$BATCH")
exec node "${GATE[@]}" -- "$@"
