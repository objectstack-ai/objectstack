#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# The one place CI turns a bare runner into a runner that can run `pnpm`
# (objectui#8099).
#
#   bash scripts/ci-setup-pnpm.sh              # what every workflow runs
#   bash scripts/ci-setup-pnpm.sh --self-test  # exercises the retry itself
#
# ## What went wrong, and why it is not one workflow's problem
#
# On PR #8091 -- a one-file `skills/**` prose diff -- the required check
# `README Export Check` went red ten seconds into the job, before any gate logic
# ran. The whole failure was Corepack fetching the pinned pnpm tarball from
# `registry.npmjs.org`, dying inside undici with
# `AssertionError: assert(!this.paused)`. `rerun_failed_jobs` on the SAME head
# (`3916de68`) turned it green with no code change: same commit, same gate,
# opposite conclusion. That control is what distinguishes a transient read from a
# diff-caused failure, and it is why this file exists rather than a re-run.
#
# The cost is not one re-run. `README Export Check` was a REQUIRED context
# (`scripts/dependabot-merge-gate.mjs`; since objectui#12214 it is a step of
# `Repo Gates`, which is), and since objectui#6160 the `merge_group`
# subscription floor derives from that same list. The README Export Check's
# trigger block (`readme-exports.yml` then, `repo-gates.yml` since objectui#12214)
# states the consequence, and `changeset-presence.yml` and `ci.yml` each state it
# independently:
#
#   "A required check that does not report on a queue build stalls the queue
#    until the ruleset's 60-minute timeout fails it."
#
# ## Why the toolchain fetch is made EXPLICIT here, not just retried
#
# Before this file, nothing in the tree decided WHERE the download happened; it
# happened wherever pnpm was first invoked, and that differs per workflow:
#
#   - ten sites run `pnpm --version` right after `corepack enable`, so the fetch
#     lands in a step named "Verify pnpm version";
#   - seven sites go straight to `actions/setup-node` with `cache: 'pnpm'`, whose
#     store probe shells out to pnpm -- so the fetch lands INSIDE a third-party
#     action's step, which is where it is hardest to recognise;
#   - one site (`docs-route-eager-closure.yml`) has no pnpm cache and no install,
#     so the fetch lands in the gate's own step and reads as the gate failing.
#
# A retry bolted onto `corepack enable` alone would therefore have protected
# nothing in seven of the eighteen sites, because `corepack enable` only writes
# shims -- it is the first pnpm INVOCATION that downloads. So this script does
# both halves in one place: enable the shims, then materialise the pinned binary
# itself, bounded and retried, under a step name that says what it is.
#
# ⭐ That naming is load-bearing beyond tidiness. objectui#8099's triage recorded
# a second cost sitting behind the first: an agent seeing this red has to prove
# the failure is not theirs, and for a markdown-only diff that means fetching the
# job log -- which for container seats is behind an egress-denied host. A red step
# literally named "download the pinned pnpm" is answerable from the checks list
# alone. That second cost is NOT fixed here; it is made unnecessary for this one
# failure class.
#
# ## ⛔ What this does NOT cover, stated so it is not mistaken for covered
#
#   - It does not remove the dependency on `registry.npmjs.org`. Every cold job
#     still reads the registry once. A SUSTAINED registry outage still reds every
#     workflow here; only a cached-tarball approach would survive that, and this
#     is deliberately not that (see the four-axis note on objectui#8099's PR).
#   - It does not make the failure impossible, only bounded-retryable. A blip that
#     outlasts the whole retry budget still fails the job -- loudly, and by then
#     under a step name that says which half of the world broke.
#   - It says nothing about workflows that do not run pnpm. Two files in
#     `.github/workflows/` MENTION `corepack enable` in comments only
#     (`changelog.yml`, `dependabot-auto-merge.yml`), and one of those comments
#     records the objectui#6392 ruling that removed the step there because nothing
#     in that job calls pnpm. ⛔ Neither is a site for this script, and
#     `scripts/__tests__/ci-setup-pnpm-wiring.test.ts` holds that line.
#
# ## Tunables
#
# `CI_SETUP_PNPM_ATTEMPTS` (default 4) and `CI_SETUP_PNPM_BACKOFF_SECONDS`
# (default 5, multiplied by the attempt number) exist so the self-test can run in
# milliseconds. Workflows pass neither -- a worst case of 5+10+15 = 30 seconds of
# sleep is the whole budget, against a 60-minute queue stall.
#
# ## bash 3.2
#
# `scripts/**` is inside `check-bash32-floor.mjs`'s population, so this file is
# held to the bash-3.2 floor (objectui#7692) like every other shell file here.

set -euo pipefail

ATTEMPTS="${CI_SETUP_PNPM_ATTEMPTS:-4}"
BACKOFF_SECONDS="${CI_SETUP_PNPM_BACKOFF_SECONDS:-5}"

# Enable the Corepack shims, then force the pinned package manager to
# materialise HERE rather than wherever it would otherwise be first invoked.
# `pnpm --version` is the probe on purpose: it is the smallest command that
# exercises the shim, reads the root `packageManager` pin, and performs the
# download -- so a green here means the next step's pnpm call cannot be the one
# that reaches the registry.
setup_pnpm() {
  corepack enable

  attempt=1
  while [ "${attempt}" -le "${ATTEMPTS}" ]; do
    if pnpm --version; then
      return 0
    fi

    if [ "${attempt}" -ge "${ATTEMPTS}" ]; then
      break
    fi

    delay=$(( BACKOFF_SECONDS * attempt ))
    echo "::warning title=pnpm toolchain download retry::Corepack could not materialise the pinned pnpm (attempt ${attempt} of ${ATTEMPTS}). Retrying in ${delay}s. This is the CI toolchain download, NOT a failure of the diff under test."
    sleep "${delay}"
    attempt=$(( attempt + 1 ))
  done

  echo "::error title=pnpm toolchain download failed::Corepack could not download the pnpm pinned in package.json after ${ATTEMPTS} attempts. This step reads registry.npmjs.org and judges nothing about the diff under test -- see objectui#8099 and scripts/ci-setup-pnpm.sh."
  return 1
}

# ---------------------------------------------------------------------------
# Self-test. Stubs `corepack` and `pnpm` on PATH and re-invokes this same file,
# so what is exercised is the shipped retry loop and not a copy of it.
# ---------------------------------------------------------------------------

self_test() {
  script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp}"' EXIT
  mkdir -p "${tmp}/bin"

  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "${tmp}/bin/corepack"
  chmod +x "${tmp}/bin/corepack"

  cat > "${tmp}/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
n=0
if [ -f "${STUB_COUNT_FILE}" ]; then n="$(cat "${STUB_COUNT_FILE}")"; fi
n=$(( n + 1 ))
echo "${n}" > "${STUB_COUNT_FILE}"
if [ "${n}" -le "${STUB_FAIL_TIMES}" ]; then
  echo "stub: simulated registry read failure (call ${n})" >&2
  exit 1
fi
echo "10.31.0"
STUB
  chmod +x "${tmp}/bin/pnpm"

  failures=0
  case_count=0

  # name / how many stub calls fail / expected exit status / expected call count
  run_case() {
    case_name="$1"
    fail_times="$2"
    want_status="$3"
    want_calls="$4"

    case_count=$(( case_count + 1 ))
    count_file="${tmp}/count.${case_count}"
    : > "${count_file}"
    echo 0 > "${count_file}"

    got_status=0
    PATH="${tmp}/bin:${PATH}" \
      STUB_COUNT_FILE="${count_file}" \
      STUB_FAIL_TIMES="${fail_times}" \
      CI_SETUP_PNPM_ATTEMPTS=3 \
      CI_SETUP_PNPM_BACKOFF_SECONDS=0 \
      bash "${script_path}" > "${tmp}/out.${case_count}" 2>&1 || got_status=$?

    got_calls="$(cat "${count_file}")"

    if [ "${got_status}" -eq "${want_status}" ] && [ "${got_calls}" -eq "${want_calls}" ]; then
      echo "ok   ${case_name} (status ${got_status}, ${got_calls} pnpm call(s))"
    else
      echo "FAIL ${case_name}: wanted status ${want_status} and ${want_calls} call(s), got status ${got_status} and ${got_calls}"
      sed 's/^/       | /' "${tmp}/out.${case_count}"
      failures=$(( failures + 1 ))
    fi
  }

  # A green first read must not retry, or every job pays the retry budget.
  run_case 'succeeds on the first read, without retrying' 0 0 1
  # The whole point: a transient read that fails and then succeeds is absorbed.
  run_case 'absorbs two transient failures and then succeeds' 2 0 3
  # And the budget is bounded -- an outage still fails, it does not spin.
  run_case 'gives up after the attempt budget' 99 1 3

  # Anti-vacuity: a stub that never ran would make all three cases meaningless.
  if grep -q 'simulated registry read failure' "${tmp}/out.2"; then
    echo "ok   control: the stub really did fail a read (case 2 saw one)"
  else
    echo "FAIL control: no simulated failure reached the loop, so the retry cases prove nothing"
    failures=$(( failures + 1 ))
  fi

  # The annotations are the answer to "is this red mine?" -- assert they exist.
  if grep -q '::warning title=pnpm toolchain download retry::' "${tmp}/out.2"; then
    echo "ok   a retry emits the warning annotation"
  else
    echo "FAIL a retry emitted no ::warning:: annotation"
    failures=$(( failures + 1 ))
  fi
  if grep -q '::error title=pnpm toolchain download failed::' "${tmp}/out.3"; then
    echo "ok   exhausting the budget emits the error annotation"
  else
    echo "FAIL exhausting the budget emitted no ::error:: annotation"
    failures=$(( failures + 1 ))
  fi

  if [ "${failures}" -ne 0 ]; then
    echo "${failures} self-test failure(s)"
    return 1
  fi
  echo "self-test OK"
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
else
  setup_pnpm
fi
