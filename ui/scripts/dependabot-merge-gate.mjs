#!/usr/bin/env node
/**
 * The merge gate `.github/workflows/dependabot-auto-merge.yml` consults before
 * it approves or enqueues a Dependabot pull request (objectui#4973).
 *
 * ## What went wrong, measured
 *
 * The workflow used to run, unconditionally, for every semver-patch/minor bump:
 *
 *     gh pr merge --auto --squash "$PR_URL"
 *
 * `--auto` lands the merge the moment GitHub considers the pull request
 * mergeable — that is, the moment the *branch-protection required set* is
 * satisfied. It does NOT wait for the checks this repository actually runs. On
 * 2026-08-17 that difference was cashed in on #4959 (`lucide-react` 1.29.0 ->
 * 1.31.0), whose own head SHA `31745d8b` was red:
 *
 *   08:07:41Z  PR opened
 *   08:13:07Z  the four `Test (shard N/4)` jobs start
 *   08:13:30Z  this workflow's own `dependabot` job completes
 *   08:13:36Z  github-actions[bot] MERGES it into `main`
 *   08:18:55Z  shard 4/4 reports success
 *   08:21:01Z  shard 3/4 reports FAILURE   (5m25s after the merge)
 *   08:21:56Z  shard 1/4 reports FAILURE   (8m20s after the merge)
 *   08:22:33Z  `Type Check` reports        (8m57s after the merge)
 *
 * Nine of the nineteen check runs on that SHA were still in flight when the
 * merge happened — all four shards, `Type Check`, `Lint`, `Build & E2E`,
 * `Build Docs` and `Bundle Analysis`. The four-way test shard matrix is the
 * slowest job in the repository BY CONSTRUCTION (it exists to cut a ~9 minute
 * wall clock, see `ci.yml`), so it is the check that `--auto` systematically
 * outruns. `main` went red for every parallel agent, which is what #4968 then
 * had to repair.
 *
 * The hole is not specific to lockfile ranges: ANY red on a slow job could ride
 * through it. Same family as objectui#3523 (an empty merge-queue required set
 * let #3503/#3510/#3516 land with `Type Check` at conclusion=failure) and
 * #3243.
 *
 * ## Why this is a script and not a `run:` block
 *
 * Same reason `scripts/render-budget-comment.mjs` and
 * `scripts/shadcn-check-report.mjs` exist: logic that lives in YAML is logic
 * nothing ever executes between real firings, and this particular logic decides
 * whether something lands on the shared `main`. Here it buys something extra —
 * `scripts/__tests__/dependabot-merge-gate.test.ts` replays the REAL #4959
 * check-run timeline through `evaluateGate()` and asserts the counterfactual
 * directly: `pending` at 08:13:36Z (so the merge does not happen) and `red`
 * once the shards report. A workflow cannot be run locally; this decision can.
 *
 * ## The contract: declared = enforced, and absence is never green
 *
 * The gate does NOT ask GitHub "are the required checks green?" — that question
 * is answered by the branch-protection required set, a repository-SETTINGS
 * surface this repository cannot WRITE (`content/docs/guide/ci-cd-pipeline.md`,
 * "Merge Queue", step 3): enrolling, removing or renaming a context there is a
 * maintainer action, and `GET /repos/{owner}/{repo}/branches/{branch}/protection`
 * answers `403 Resource not accessible by integration` to the token a job here
 * runs under.
 *
 * ⛔ What that set currently HOLDS is deliberately not restated here, and no
 * decision in this file turns on it. It IS readable from a job with network, and
 * this repository already reads it: `scripts/check-required-check-set.mjs`
 * (`pnpm check:required-check-set`, patrolled by
 * `.github/workflows/required-check-set-patrol.yml`) takes a live reading of the
 * ruleset and exits 2 when it could not take one — never 0. Ask that
 * instrument. A comment cannot be re-run.
 *
 * ⚠️ An earlier version of this paragraph did restate it: "demonstrably not
 * carrying the shards today", derived from #4959, where a merge landed while all
 * four shards were `in_progress`, which is possible only if none of them was
 * required. It was true when it was written and false by the time it was read —
 * the ruleset was edited afterwards and the prose was not (objectui#9502). So
 * the declaration below rests on two things no ruleset edit can move: it is
 * BROADER than a required set (every unfiltered blocking context this repository
 * produces, not the subset a maintainer chose to enforce), and it is visible to
 * review and to `dependabot-merge-gate.test.ts`, which off-repo configuration is
 * not.
 *
 * So the set is declared here, and three rules keep the declaration honest:
 *
 *  1. Every context in `REQUIRED_CONTEXTS` must be PRESENT and `success`.
 *     Missing counts as not-green, never as green — a renamed or skipped job
 *     must stall the gate and then fail it, which is the one direction that
 *     cannot silently let a red PR through. (objectui#3523's lesson stated the
 *     other way round: a check that never reports does not fail a required-set
 *     rule, it leaves the PR pending — so a gate that reads "absent = fine" is
 *     the same bug wearing the fix's clothes.)
 *  2. `OPTIONAL_CONTEXTS` are blocking checks whose WORKFLOW carries a
 *     trigger-level path filter, so they legitimately do not report on every
 *     pull request. Present -> must be `success`; absent -> not waited for.
 *  3. `NOT_A_GATE` names every remaining context a pull request produces, each
 *     with the reason it cannot gate. `dependabot-merge-gate.test.ts` asserts
 *     the three buckets partition the produced set EXACTLY — no name produced
 *     by a `pull_request`-triggered workflow may be unclassified, and no
 *     classified name may be unproduced. A new job or a renamed one fails that
 *     test instead of quietly shrinking the gate.
 *
 * Only `success` is green for a required context. `skipped` is not: every
 * required context here belongs to a workflow that reports on every pull
 * request by design (the path decision moved INTO the jobs in #3523, so an
 * ignored-paths run still reports `success`), which means a `skipped` required
 * context is a change in the pipeline, not a pass.
 *
 * ## What this file deliberately does not do
 *
 * It never mutates anything — no merge, no approval, no comment. It reads check
 * runs and returns a verdict; the workflow performs the two mutations, under an
 * `if:` on that verdict, so the whole set of things that can write is visible
 * in the YAML. A crash here (403 on `checks: read`, network, bad input) exits
 * non-zero and merges nothing, which is the correct direction to fail.
 *
 * ## The boundary of the declared set: check RUNS, not commit STATUSES
 *
 * Everything above is about check runs — what GitHub Actions jobs produce.
 * Third-party apps can also attach a legacy commit STATUS to the same SHA, and
 * this repository has one: `Vercel`, which on a pull request reports
 * `success` / "Canceled by Ignored Build Step" for changes its ignored-build
 * step filters out. The gate does not read statuses, so a red Vercel status
 * would not stop a Dependabot merge.
 *
 * That is a stated boundary, not an oversight, and it is not a regression: the
 * unconditional `--auto` this replaced waited for nothing at all. It is left
 * outside deliberately — requiring a preview deployment from a third-party
 * service would let an unrelated outage block every dependency bump, and
 * whether that trade is worth making is a maintainer's call, not a hot fix's.
 * It is written down here so the next reader does not have to infer the scope
 * from the endpoint being called.
 */

import fs from 'node:fs';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * Blocking checks whose workflow subscribes `pull_request` with NO trigger-level
 * path filter, so every pull request produces every one of them. Source of each
 * name, in the checks list rather than the file name:
 *
 *   ci.yml            Changeset Fixed Group Check, Type Check, Test,
 *                     Build & E2E, Build Docs
 *   lint.yml          Lint
 *   repo-gates.yml    Repo Gates
 *   changeset-presence.yml   Changeset Declaration
 *   governed-surface-guard.yml     Governed Surface Queue Guard
 *
 * `Repo Gates` is ONE context for fifteen checks (objectui#12214): the
 * one-check workflows that each produced a context of their own -- the
 * control-byte scan, the docs-link check, the skill-guide path, skill-example
 * and eval-token checks, the doc component-type, snippet-type, fence-language
 * and example-id checks, the pre-install import graph, the inert vi.mock check,
 * the shell-escape residue scan, the README export check, the docs-route eager
 * closure check and the action-ref convention -- were folded into one job whose
 * steps keep those names. The job is red when any of its steps is, so waiting
 * for this one name waits for all fifteen verdicts.
 *
 * `Governed Surface Queue Guard` is the newest and the one whose reading here
 * differs from every other row, so it is worth a sentence. On a PULL REQUEST it
 * is deliberately green whatever it finds — a governed pull request parked as a
 * draft for the maintainer is the healthy case, and a check red on the healthy
 * case is a permanently red check (objectui#6596). Its refusal lives on the
 * `merge_group` leg. Listing it here is still correct and still load-bearing:
 * this list is what `merge-queue-reporting.test.ts` derives the `merge_group`
 * subscription floor from, and a guard whose whole point is the queue build must
 * be inside that floor. What it costs a Dependabot bump depends on the
 * ecosystem. An `npm` bump touches no governed path, so the check reports CLEAR
 * without making a single API call. A `github-actions` bump edits
 * `.github/workflows/**`, which is governed since objectui#12255: on the pull
 * request the check is still green (an early warning, one review read), so this
 * gate still goes green and the workflow still approves and enqueues — but the
 * approval is `github-actions[bot]`'s, outside the guard's GOVERNED_APPROVERS,
 * so the `merge_group` leg refuses the bump until an authorized approval is on
 * record. That wait is the ruling's consequence, not a defect of this gate.
 *
 * The four shards are spelled out individually on purpose. A single `Test`
 * entry, or any pattern match, would be satisfied by whichever shard happened
 * to exist — and #4959 failed on shards 1 and 3 while 2 and 4 passed.
 */
export const REQUIRED_CONTEXTS = Object.freeze([
  'Changeset Fixed Group Check',
  'Type Check',
  // ⭐ ONE name, not one per shard (objectui#9499). This used to spell out
  // `Test (shard 1/4)` … `Test (shard 4/4)`, which made the SHARD COUNT a
  // member of the required set: widening the matrix renamed four live required
  // contexts at once. `Test` is `ci.yml`'s `test-aggregate` job, which `needs`
  // every shard and the dist-pin job and reads each one's OWN conclusion out of
  // the Actions API before it reports.
  //
  // ⚠️ This is NOT the shape the #4959 counterfactual below warns about. That
  // warning — "a gate that waited for `Test` as one name, or for whichever
  // shard reported first, would have merged this pull request" — is about a
  // single check produced BY a shard, which reports while its siblings are
  // still running. This one cannot report before every shard has finished
  // (`needs:`), and it is red unless every shard's own conclusion is `success`;
  // `skipped` is not a pass there. The distinction is the whole content of
  // `scripts/check-test-shard-results.mjs`.
  'Test',
  'Build & E2E',
  'Build Docs',
  'Lint',
  // objectui#12214: the fifteen one-check gate workflows, folded into one job.
  // Among its steps, the action-ref convention (objectui#8465) is worth naming:
  // it reads `.github/workflows/**`, which is exactly what a Dependabot
  // `github-actions` bump edits -- the pull requests most likely to introduce
  // an off-convention reference and the least likely to have a human reading
  // each edited line.
  'Repo Gates',
  'Changeset Declaration',
  'Governed Surface Queue Guard',
]);

/**
 * Blocking checks that a pull request may legitimately not produce, because
 * their workflow filters at the trigger. Waiting for one of these to appear
 * would hang the gate until its deadline on a pull request that was never going
 * to start it; requiring nothing of them when they DO run would let a real red
 * through. So: present -> must be `success`, absent -> ignored.
 *
 * They are evaluated on the same poll as the required set, i.e. only once every
 * required context has already reported. By then the whole check-run list for
 * the SHA has existed for minutes (on #4959 all nineteen runs were created
 * within three seconds of each other), so "absent" here means "the path filter
 * kept it out", not "it has not been created yet".
 */
export const OPTIONAL_CONTEXTS = Object.freeze({
  'Bundle Analysis':
    "performance-budget.yml filters on paths: packages/**, apps/console/**, pnpm-lock.yaml. Blocking when it runs (console gzip budget); absent on a PR that touches none of them.",
  'Changeset Bump Policy':
    'changeset-guard.yml filters on paths: .changeset/**. A Dependabot PR carries no changeset, so it normally does not report at all.',
  'Lockfile Dedupe Check':
    "lockfile-dedupe.yml (objectui#8333) runs `pnpm dedupe --check`: the committed lockfile must already be deduped, so a dependency bump cannot leave a forked peer group behind for `Bundle Analysis` to misattribute to the bump. Blocking when it runs; its pull_request trigger is path-filtered to `pnpm-lock.yaml` plus its own runtime closure, so a change touching none of them does not report at all. ⚠️ Enrolled as blocking where its neighbour `Lockfile Integrity Check` deliberately is NOT, and the difference is the remedy: #8326's gate names a duplication and leaves the answer open (re-lock, pin, or accept), which is a judgement call its header reserves for the maintainer, while this one has exactly one mechanical remedy that pnpm itself prints — run `pnpm dedupe` and commit the lockfile, changing no declaration, range or override. Cost of enrolling it, measured on objectui#8333 before it was taken: green on `main` as it stands (objectui#9215 collapsed the accumulated duplication first), red on the same tree with `better-auth` bumped. ⇒ nothing currently mergeable is blocked by it, and what it defends is that objectui#9215's paydown does not silently accrue again. To stop it blocking, move this name to `NOT_A_GATE`; ⛔ removing it from both buckets fails the partition test instead.",
  'Hook Self-Tests':
    'hook-selftests.yml filters on paths: .claude/hooks/**, plus the workflow file itself (objectui#5754). Blocking when it runs (the PreToolUse guard self-test matrices must pass); a Dependabot dependency bump never touches .claude/hooks/**, so it normally does not report at all.',
  'Regenerate the per-file test timings':
    "test-shard-timings-refresh.yml filters its pull_request trigger on paths: the workflow file and the two scripts it loads (`scripts/test-file-timings.mjs`, `scripts/test-shard-partition.mjs`, objectui#12208). Blocking when it runs: the pull_request leg runs the selection, the artifact downloads and the regeneration on a real runner and skips only the push and the pull request, so an edit that breaks the refresh is red before it merges. It is OPTIONAL rather than required because that path filter means it does not report on a pull request that touches none of those files, which is every dependency bump that does not edit that workflow.",
  'Snapshot the board to the archive branch':
    "board-snapshot.yml filters on paths: the workflow file itself (objectui#9387; since objectui#10208 the archiver runs from an objectstack checkout, so no script of this repository is on that list). Blocking when it runs: the pull_request leg runs the archiver's own --self-test and then a capped `--dry-run` snapshot on a real runner, so a workflow edit that breaks the archiver's invocation is red before it merges. It is OPTIONAL rather than required because that path filter means it does not report at all on a pull request that does not touch that file, which is every Dependabot bump. ⛔ Not NOT_A_GATE: that bucket says a check cannot gate, and this one is the only thing in the repository that exercises the archiver's wiring before it merges.",
});

/**
 * The coverage shards share one reason, spelled once (objectui#5403 split the
 * single `test-coverage` job into a 4-way matrix plus a merge job;
 * objectui#12256 widened it to 8). They are listed individually rather than
 * matched by pattern, for the same reason the sixteen PR shards below are: a
 * pattern is satisfied by whichever shard happens to exist. The count is held
 * to ci.yml's own matrix by the partition test in `dependabot-merge-gate.test.ts`,
 * which expands the matrix and fails on any produced name this list lacks.
 */
const COVERAGE_SHARD_NOT_A_GATE =
  "ci.yml's coverage lane runs on the full battery's events only (`push` and the hourly `schedule`, objectui#12214), so on a pull request it reports conclusion=skipped by design. Coverage is deliberately not recomputed per pull request — v8 instrumentation adds 40-100% overhead — so the PR lane is the `Test (shard N/16)` matrix, which reports through the `Test` aggregator above. ⛔ This lane's own sharding (4-way since objectui#5403, 8-way since objectui#12256) is unrelated to that matrix's width; objectui#9499 and objectui#12208 widened that matrix without touching this one.";

/**
 * The sixteen test shards share one reason, spelled once. Every one of them is
 * a real blocking leg — the difference from the coverage shards above is that
 * something else reports their verdict, not that they have none.
 *
 * ⛔ Listing them individually rather than by pattern is deliberate, for the
 * same reason the coverage shards are listed individually: a pattern is
 * satisfied by whichever shard happens to exist, so a matrix that quietly lost
 * a leg would still partition cleanly. Here the count is pinned by
 * `dependabot-merge-gate.test.ts` against ci.yml's own matrix, which is a test
 * that fails loudly and locally — ⛔ unlike the repository-settings surface the
 * count used to be welded to (objectui#9499).
 */
const PR_TEST_SHARD_NOT_A_GATE =
  "ci.yml's test matrix — the affected set on a pull request or queue build, the whole suite on `push` and `schedule` (objectui#12214). It is a blocking leg and it is NOT waited for by name: since objectui#9499 the `test-aggregate` job (`Test`, above) is the single required test context, and it reports only after every shard has finished, red unless each shard's OWN conclusion is `success` — `skipped` included. Waiting for the legs here as well would put the shard COUNT back into a second declaration, which is the coupling that card removed.";

/**
 * Everything else a pull request to `main` produces, and why it cannot gate.
 * Kept as a named list rather than an implicit "anything not required is
 * ignored", so that a new check has to be classified by a human instead of
 * defaulting into silence.
 */
export const NOT_A_GATE = Object.freeze({
  'Test (shard 1/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 2/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 3/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 4/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 5/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 6/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 7/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 8/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 9/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 10/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 11/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 12/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 13/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 14/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 15/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (shard 16/16)': PR_TEST_SHARD_NOT_A_GATE,
  'Test (dist pins)':
    "ci.yml's built-artifact pin lane, lifted out of the shard matrix by objectui#9499 (the lane itself is objectui#7183). Same reading as the shards above: it is blocking, and the `Test` aggregator asserts its result — `needs.test-dist-pins.result` is one job's own conclusion, so `skipped` is visible there without an API read — so the whole test lane still speaks through one required name.",
  dependabot:
    'This workflow itself. The gate runs inside this job, so requiring it would deadlock at its own deadline.',
  'Test (coverage)':
    "ci.yml's full-battery lane (`push` and the hourly `schedule`, objectui#12214), so on a pull request it reports conclusion=skipped by design. Since objectui#5403 this is the job at the END of the coverage lane — it merges every shard's blob report into one complete report, enforces the configured coverage thresholds over it, publishes it as the `coverage-report` artifact, and goes red whenever any of that did not happen (the Codecov upload it also carried was retired by objectui#5436). The PR lane is the `Test (shard N/16)` matrix, reported through the `Test` aggregator above.",
  'Test (coverage shard 1/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Test (coverage shard 2/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Test (coverage shard 3/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Test (coverage shard 4/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Test (coverage shard 5/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Test (coverage shard 6/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Test (coverage shard 7/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Test (coverage shard 8/8)': COVERAGE_SHARD_NOT_A_GATE,
  'Live E2E (informational)':
    'live-e2e.yml is declared INFORMATIONAL and NON-REQUIRED in its own header, and ci-cd-pipeline.md says in as many words not to add it to required checks. It carries no `continue-on-error` since objectui#8084 — that flag left this check run red anyway and only inverted the workflow-run conclusion — so a red here is a real red, ignored because the lane is advisory and never because the check could not fail.',
  label:
    'labeler.yml applies labels. It is a mutation, not a verdict — nothing about the change is judged by it.',
  'Changeset Overwrite Report':
    "changeset-guard.yml's second job is REPORT-ONLY by measurement (objectui#6336): it names any `.changeset/*.md` the change modified or deleted without having added it, and exits 0 whatever it finds — all 19 such modifications in this repository's history were legitimate, so blocking would have failed every one of those pull requests. It goes red only when it cannot compute its diff, which is a fact about the checkout rather than a verdict on the change. Its pull_request trigger is also path-filtered to `.changeset/**` and the two gate scripts, so a Dependabot bump never produces this check at all.",
  'Changeset Claim Re-read':
    "changeset-presence.yml's second job is REPORT-ONLY with no enforcing switch at all (objectui#9003): it names the pending `.changeset/*.md` bodies that spell a file this change touches, so the seat whose diff might have falsified a pending release note re-reads the paragraph before it publishes verbatim. \"A pending changeset names a file you edited\" is usually still TRUE, so the finding is a request to read and never a verdict on the change — it exits 0 whatever it finds, and goes red only when it cannot resolve its base, which is a fact about the checkout. It carries NO path filter, deliberately (the falsifying change is an ordinary source change under no obligation to touch `.changeset/**`), so unlike its sibling report it DOES run on a Dependabot bump — and classifying it here rather than requiring it is what keeps a report-only check out of the merge decision.",
  'Lockfile Integrity Check':
    "lockfile-integrity.yml (objectui#8326) reports a lockfile DELTA — a workspace-declared or `@objectstack/*` dependency gaining a physical copy (its backward-version rule was retired by objectui#12957: `@objectstack/*` resolves to the pinned build, which has no version to move). ⛔ It is deliberately NOT a blocking context: enrolling it changes what stops the merge queue, which is a maintainer decision the #8326 dispatch reserved rather than took, and its pull request writes up the cost as input (measured: it would have blocked 3 of the 40 most recent lockfile-changing commits on `main`, each for a real duplication of a runtime-declared package). Its pull_request trigger is also path-filtered to `pnpm-lock.yaml` and its own two files, so it cannot be REQUIRED under #3523's rule while that filter stands — promoting it means removing the filter as well.",
  'Live half-state sweep':
    'half-state-patrol.yml is REPORT-ONLY by ruling (objectui#5791): a completed sweep exits 0 whether it found 0 half-states or 40, and the job gates no branch and blocks no queue. It goes red only when the sweep could not RUN — the patrol reporting its own death, which is a fact about the patrol, not a verdict on the pull request. Its pull_request trigger is also path-filtered to the workflow file (the sweeper runs from an objectstack checkout since objectui#10208), so a Dependabot bump never produces this check at all.',
  'Line Citation Gate':
    'line-citation-gate.yml is REPORT-ONLY by ruling (objectui#8875, clause 2): it prints the cross-file line-address citations a pull request ADDED against its base and exits 0 whatever it finds, so requiring it would enrol a check that cannot say no. It goes red only when one of its own synthetic controls fails — the differ reporting its own death, which is a fact about the instrument and not a verdict on the pull request. It also declares NO `merge_group` trigger, because it needs a base to be differential at all and only a pull request has one; under #3523 a required context that never reports on a queue build stalls the queue until the ruleset timeout fails it, so promoting this one means giving it a queue leg first. That promotion is the flip condition the ruling states, and a maintainer decision, ⛔ not a tidy-up.',
});

/**
 * GitHub keeps every check run for a SHA, including superseded re-runs. The
 * verdict must come from the newest run per name: an old `success` next to a
 * fresh `queued` re-run means the answer is "wait", not "green".
 *
 * @param {Array<{ name: string, id?: number, status?: string, conclusion?: string|null }>} checkRuns
 * @returns {Map<string, { name: string, id?: number, status?: string, conclusion?: string|null }>}
 */
export function latestByName(checkRuns = []) {
  /** @type {Map<string, any>} */
  const latest = new Map();
  for (const run of checkRuns) {
    if (!run?.name) continue;
    const seen = latest.get(run.name);
    if (!seen || Number(run.id ?? 0) >= Number(seen.id ?? 0)) latest.set(run.name, run);
  }
  return latest;
}

/** A required context is green only when it has completed with `success`. */
function classify(run) {
  if (!run) return 'missing';
  if (run.status !== 'completed') return 'pending';
  return run.conclusion === 'success' ? 'green' : 'not-green';
}

/**
 * One verdict over one snapshot of a SHA's check runs.
 *
 * `red` wins over `pending`: once a required context has failed, the remaining
 * shards can only confirm it, and continuing to wait would just delay a report
 * the author already needs.
 *
 * @param {{ checkRuns?: Array<object>, required?: readonly string[], optional?: readonly string[] }} input
 * @returns {{ verdict: 'green'|'red'|'pending', failing: string[], pending: string[], missing: string[] }}
 */
export function evaluateGate({
  checkRuns = [],
  required = REQUIRED_CONTEXTS,
  optional = Object.keys(OPTIONAL_CONTEXTS),
} = {}) {
  const latest = latestByName(checkRuns);
  /** @type {string[]} */ const failing = [];
  /** @type {string[]} */ const pending = [];
  /** @type {string[]} */ const missing = [];

  for (const name of required) {
    const run = latest.get(name);
    switch (classify(run)) {
      case 'missing':
        missing.push(name);
        break;
      case 'pending':
        pending.push(`${name} (${run.status})`);
        break;
      case 'not-green':
        failing.push(`${name} (${run.conclusion ?? 'no conclusion'})`);
        break;
      default:
        break;
    }
  }

  for (const name of optional) {
    const run = latest.get(name);
    // Absent, or skipped: the path filter decided this pull request is not one
    // this check judges. Nothing to wait for and nothing to hold against it.
    if (!run || (run.status === 'completed' && run.conclusion === 'skipped')) continue;
    if (run.status !== 'completed') pending.push(`${name} (${run.status})`);
    else if (run.conclusion !== 'success') failing.push(`${name} (${run.conclusion ?? 'no conclusion'})`);
  }

  const verdict = failing.length > 0 ? 'red' : pending.length + missing.length > 0 ? 'pending' : 'green';
  return { verdict, failing, pending, missing };
}

/**
 * The Checks REST surface the gate needs, injectable so tests never reach the
 * network. Needs `checks: read`; a 403 here throws, which fails the job and
 * merges nothing.
 */
export function createChecksApi({
  token = process.env.GITHUB_TOKEN ?? '',
  apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  repository = process.env.GITHUB_REPOSITORY ?? '',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');

  const get = async (route) => {
    const res = await fetchImpl(`${apiUrl}${route}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET ${route} -> HTTP ${res.status}`);
    return res.json();
  };

  return {
    /**
     * Every check run on one SHA. `filter=latest` is GitHub's default and is
     * spelled out so a future default change cannot start feeding the gate
     * stale runs; `latestByName()` de-duplicates again on our side because the
     * endpoint's notion of "latest" is per check SUITE, not per name.
     */
    listCheckRuns: async (sha) => {
      /** @type {Array<object>} */ const all = [];
      for (let page = 1; page <= 10; page += 1) {
        const body = await get(`/repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`);
        const runs = body?.check_runs ?? [];
        all.push(...runs);
        if (runs.length < 100) break;
      }
      return all;
    },
  };
}

/**
 * Poll until the verdict is decided, or until the deadline turns an undecided
 * gate into a red one. A timeout is a failure, never a pass: the reason a
 * context is still missing at the deadline (renamed job, cancelled workflow,
 * a filter that stopped it reporting) is exactly the kind of thing that must
 * reach a human instead of a merge.
 *
 * @param {{ api: { listCheckRuns: (sha: string) => Promise<Array<object>> }, sha: string,
 *           timeoutMs?: number, intervalMs?: number,
 *           now?: () => number, sleep?: (ms: number) => Promise<void>, log?: (msg: string) => void }} input
 */
export async function waitForGate({
  api,
  sha,
  timeoutMs = 40 * 60 * 1000,
  intervalMs = 20 * 1000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
}) {
  if (!sha) throw new Error('waitForGate needs the head SHA the verdict is about');
  const startedAt = now();
  let polls = 0;

  for (;;) {
    const checkRuns = await api.listCheckRuns(sha);
    const result = evaluateGate({ checkRuns });
    polls += 1;
    const elapsedMs = now() - startedAt;

    if (result.verdict !== 'pending') return { ...result, polls, elapsedMs, timedOut: false, sha };

    if (elapsedMs >= timeoutMs) {
      return {
        ...result,
        verdict: /** @type {'red'} */ ('red'),
        polls,
        elapsedMs,
        timedOut: true,
        sha,
      };
    }

    log(
      `waiting: ${result.pending.length} in flight, ${result.missing.length} not reported yet ` +
        `(${Math.round(elapsedMs / 1000)}s of ${Math.round(timeoutMs / 1000)}s)`,
    );
    await sleep(intervalMs);
  }
}

/**
 * The visible artefact of a non-green gate: what is red, what never reported,
 * and the fact that nothing was merged. Rendered for both the step summary and
 * the pull-request comment so the outcome is legible without opening the run.
 *
 * @param {{ verdict: string, failing: string[], pending: string[], missing: string[],
 *           timedOut?: boolean, sha?: string, runUrl?: string, elapsedMs?: number }} result
 */
export function renderVerdict(result) {
  const lines = [];
  const sha7 = (result.sha ?? '').slice(0, 7);

  if (result.verdict === 'green') {
    lines.push(`### Dependabot merge gate: green (\`${sha7}\`)`);
    lines.push('');
    lines.push(`All ${REQUIRED_CONTEXTS.length} required contexts reported \`success\` on this head SHA.`);
  } else {
    lines.push(`### Dependabot merge gate: NOT merged (\`${sha7}\`)`);
    lines.push('');
    lines.push(
      result.timedOut
        ? 'The gate hit its deadline with contexts still undecided. A context that has not reported is **not** treated as green (objectui#4973), so nothing was merged.'
        : 'A required context is not green, so auto-merge was **not** enabled and this pull request was **not** approved (objectui#4973).',
    );
  }

  if (result.failing?.length) {
    lines.push('');
    lines.push('**Failing:**');
    for (const name of result.failing) lines.push(`- ${name}`);
  }
  if (result.pending?.length) {
    lines.push('');
    lines.push('**Still running at the deadline:**');
    for (const name of result.pending) lines.push(`- ${name}`);
  }
  if (result.missing?.length) {
    lines.push('');
    lines.push('**Never reported:**');
    for (const name of result.missing) lines.push(`- ${name}`);
  }
  if (typeof result.elapsedMs === 'number') {
    lines.push('');
    lines.push(`Waited ${Math.round(result.elapsedMs / 1000)}s.`);
  }
  if (result.runUrl) {
    lines.push('');
    lines.push(`[Gate run](${result.runUrl})`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A duration from the environment, in seconds, or a loud failure.
 *
 * `Number('40 minutes')` is `NaN`, and `elapsedMs >= NaN` is false forever — a
 * typo in the workflow would turn the deadline off and leave the gate polling
 * until the runner killed the job. That direction is still fail-closed (nothing
 * merges) but it burns 50 minutes of a runner and reports as a timeout rather
 * than as the misconfiguration it is. So a bad value throws here instead.
 *
 * @param {string|undefined} raw
 * @param {number} fallbackSeconds
 * @param {string} name
 */
function readDuration(raw, fallbackSeconds, name) {
  const seconds = raw === undefined || raw === '' ? fallbackSeconds : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`${name} must be a positive number of seconds, got ${JSON.stringify(raw)}`);
  }
  return seconds * 1000;
}

function appendTo(envVar, text) {
  const target = process.env[envVar];
  if (!target) return;
  fs.appendFileSync(target, `${text}\n`);
}

/**
 * The workflow's entry point. `api` is injectable for the tests; `env` is split
 * out for the same reason. Typed explicitly because a binding with no default in
 * a destructured JS parameter is dropped from the inferred signature under
 * `strict`, which would make the injected `api` a type error at the call site
 * (`tsconfig.scripts.json` compiles the pin tests).
 *
 * @param {{ api?: { listCheckRuns: (sha: string) => Promise<Array<object>> },
 *           env?: Record<string, string | undefined> }} [input]
 */
export async function main({ api, env = process.env } = {}) {
  const sha = env.HEAD_SHA ?? '';
  if (!sha) throw new Error('HEAD_SHA is not set — the gate must be told which commit it is judging');

  const timeoutMs = readDuration(env.GATE_TIMEOUT_SECONDS, 2400, 'GATE_TIMEOUT_SECONDS');
  const intervalMs = readDuration(env.GATE_INTERVAL_SECONDS, 20, 'GATE_INTERVAL_SECONDS');
  const reportFile = env.GATE_REPORT_FILE ?? 'dependabot-merge-gate.md';
  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : '';

  const result = await waitForGate({
    api: api ?? createChecksApi(),
    sha,
    timeoutMs,
    intervalMs,
    log: (msg) => console.log(msg),
  });

  const body = renderVerdict({ ...result, runUrl });
  fs.writeFileSync(reportFile, body);
  appendTo('GITHUB_STEP_SUMMARY', body);
  appendTo('GITHUB_OUTPUT', [`gate=${result.verdict}`, `gated_sha=${sha}`, `timed_out=${result.timedOut}`].join('\n'));

  if (result.verdict === 'green') {
    console.log(`::notice::Dependabot merge gate green on ${sha} after ${Math.round(result.elapsedMs / 1000)}s.`);
  } else {
    const detail = [...result.failing, ...result.missing.map((n) => `${n} (never reported)`)].join(', ');
    console.log(`::error::Dependabot merge gate refused ${sha}: ${detail || 'undecided at deadline'}. Nothing merged.`);
  }

  return result;
}

const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  await main();
}
