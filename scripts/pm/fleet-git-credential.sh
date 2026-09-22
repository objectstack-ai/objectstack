#!/usr/bin/env bash
# fleet-git-credential.sh — the git credential helper `with-fleet.sh` hands git
# through the ENVIRONMENT, so a push can act as the fleet's App identity with
# nothing on disk: no token in a remote URL, no `git config` value in any file,
# and `git remote -v` unchanged.
#
#   printf 'protocol=https\nhost=github.com\n' | GITHUB_TOKEN=… fleet-git-credential.sh get
#     → username=x-access-token
#       password=…
#
# git calls it as `<helper> get` with the request on stdin. It answers ONLY for
# github.com (and its subdomains), ONLY for `get`, and ONLY when `GITHUB_TOKEN`
# is set — every other case prints nothing, which git reads as "this helper has
# no opinion" and moves on. `store` and `erase` are ignored on purpose: a token
# that lives fifty-five minutes has nothing to store and nothing to erase.
#
# ⛔ The token is read from the environment at the moment git asks and is
# written to stdout for git alone. It appears in no argument, no file and no
# log line of this script.

set -euo pipefail

op="${1:-get}"
[[ "$op" == get ]] || exit 0

host=''
while IFS= read -r line; do
  case "$line" in
    host=*) host="${line#host=}" ;;
  esac
done

case "$host" in
  github.com | *.github.com) ;;
  *) exit 0 ;;
esac

[[ -n "${GITHUB_TOKEN:-}" ]] || exit 0

printf 'username=x-access-token\npassword=%s\n' "$GITHUB_TOKEN"
