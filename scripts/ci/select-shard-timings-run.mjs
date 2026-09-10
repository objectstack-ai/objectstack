#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// select-shard-timings-run -- choose the CI run whose artifacts
// `.github/workflows/shard-timings-refresh.yml` regenerates
// scripts/test-shard-timings.json from, and judge afterwards whether that run
// actually measured the workspace (#16464).
//
// WHY SELECTION IS NOT "THE NEWEST RUN".
//
// The dataset is the balancing input for the Test Core shard split, and a
// refresh built on the wrong run is not a missing refresh -- it is a WRONG one,
// which is worse, because the file then carries a fresh `measuredAt` over
// numbers nobody measured. Three ways the newest run is the wrong one, all
// measured on this repo rather than imagined:
//
//   1. CANCELLED RUNS. `cancel-in-progress` kills a run on main the moment the
//      next run in its concurrency group starts, and merges arrive faster than
//      Test Core finishes: 36 of the last 60 push runs were censored that way.
//      Such a run leaves SOME artifacts, so "the artifacts exist" is not the
//      test -- every one of the six Test Core jobs must have concluded
//      `success`. The hourly run this now reads has its OWN concurrency group
//      (#16467, `github.event_name` is in ci.yml's key), so a merge cannot
//      censor it -- but a second hourly run can, which is why this test stays.
//
//   2. CACHE REPLAYS. A run whose six jobs all concluded `success` can still
//      have replayed most of the workspace from the turbo cache: shards were
//      measured at 7s and 98s against a 672s prediction (0.01x, 0.15x). The
//      generator REFUSES cached tasks, so those packages simply are not in the
//      resulting dataset -- and an absent package does not red anything, it
//      falls back to the test-file-count ESTIMATE. A partial replay therefore
//      trades measured weights for guesses, silently, on whichever slice of the
//      workspace happened to be warm. `coverageReport` below is the half that
//      catches this, and it catches it by looking at what was MEASURED rather
//      than at a duration threshold nobody can defend.
//
//   3. EXPIRED ARTIFACTS. Retention is 1 day, so the eligible window is
//      genuinely short and an empty candidate list is a normal Monday if main
//      was quiet -- it is reported as a loud, named refusal rather than as a
//      no-op, because "no PR opened" and "no run was good enough" must not read
//      the same way in the log.
//
// ⛔ It never picks a run it cannot fully justify. Every rejection is named with
// its reason, so the workflow log says WHY the newest four runs were passed over
// rather than leaving a bare run id to be taken on faith.
//
// WHICH EVENT'S RUNS, AND WHY THAT IS THE LOAD-BEARING PART (#16467).
//
// This used to read `event=push&branch=main`, on the argument that a push run
// was the FULL battery and therefore ground truth. Since #16467 it is not: a
// push to `main` computes its package set with `--affected` against
// `github.event.before`, so a push run measures the packages that merge
// touched and NOTHING ELSE. Nothing in the eligibility test below would have
// noticed. Six shard jobs still conclude `success`, six run-summary artifacts
// are still uploaded, and every guard reads green -- over a measurement of a
// slice of the workspace that nobody asked for.
//
// `coverageReport` is not the backstop for that either. It refuses a package
// that HAD a weight and now has neither a measurement nor a cache-hit witness
// -- and a package the affected set excluded is a cache HIT, witnessed
// unchanged, carried at its old weight. So a diet of affected-only runs would
// have produced a dataset that passes every check while its numbers age out
// one package at a time, which is exactly the silent rot this lane exists to
// end.
//
// So the event is named, and it is the HOURLY SCHEDULED RUN: `schedule` on
// ci.yml, minute 0, the one event the selection script treats as FULL by
// construction. `DEFAULT_RUN_EVENT` below is that name, spelled once.
//
// Usage:
//   node scripts/ci/select-shard-timings-run.mjs --candidates [--limit <n>]
//   node scripts/ci/select-shard-timings-run.mjs --check-coverage \
//     --committed <old.json> --refreshed <new.json> --workspace <turbo-ls.json> \
//     [--exclude <pkg>]...
//   node scripts/ci/select-shard-timings-run.mjs --self-test
//
// `--candidates` needs GITHUB_TOKEN and GITHUB_REPOSITORY in the environment and
// prints a JSON array, newest first. `--event <name>` overrides which event's
// runs are examined; it exists so the default can be exercised against a
// counter-example rather than trusted, and ⛔ is not a way to feed the dataset
// from an affected-only run. It has THREE exits and they are three different
// readings: 0 with the eligible runs on stdout, 1 when candidates existed and
// every one was rejected (a finding), and `EXIT_PREREQUISITE_NOT_MET` (3) when
// there were no candidates at all -- NOTHING was measured. See "TWO WAYS TO
// COME BACK WITH NOTHING" below; a caller that reads any non-zero as a finding
// will report a bootstrap window as a broken dataset. `--check-coverage` judges MEASURED UNION
// CARRIED against the workspace and exits non-zero when a package that HAD a
// measured weight has neither -- it names workspace packages that were never
// measured too, but those are a report rather than a refusal, because the
// partitioner already estimated them and this refresh did not change that.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

// The Test Core shard count. Spelled here as the number of jobs and artifacts a
// complete run must present; partition-test-shards.mjs owns the split itself and
// its own self-test reads ci.yml back, so this is a reader's expectation rather
// than a second declaration of the split.
export const SHARD_COUNT = 6;

const API = 'https://api.github.com';

// The event whose runs are a FULL measurement of the workspace. ⛔ Not `push`:
// see "WHICH EVENT'S RUNS" above -- a push run is affected-only since #16467
// and would pass every eligibility and coverage check while measuring a slice.
export const DEFAULT_RUN_EVENT = 'schedule';

// `Test Core (3/6)` -> 3. Anchored on both ends: a job merely CONTAINING that
// text (a future "Test Core (3/6) rerun") is not this job, and reading it as one
// would let a run qualify on a job that never ran the suite.
export function testCoreShard(jobName, shardCount = SHARD_COUNT) {
  const m = /^Test Core \((\d+)\/(\d+)\)$/.exec(String(jobName ?? '').trim());
  if (!m) return null;
  if (Number(m[2]) !== shardCount) return null;
  const index = Number(m[1]);
  return index >= 1 && index <= shardCount ? index : null;
}

// `test-core-run-summary-3-of-6` -> 3, by the same anchoring argument.
export function summaryArtifactShard(artifactName, shardCount = SHARD_COUNT) {
  const m = /^test-core-run-summary-(\d+)-of-(\d+)$/.exec(String(artifactName ?? '').trim());
  if (!m) return null;
  if (Number(m[2]) !== shardCount) return null;
  const index = Number(m[1]);
  return index >= 1 && index <= shardCount ? index : null;
}

// How long a shard's suite actually ran, from the job's own step window. This
// is the tighter reading than job wall-clock -- setup, install and cache restore
// are not the suite -- and it is what the refresh PR quotes as "per-shard
// durations" so a reviewer can compare measured against predicted without
// opening the run.
export const TEST_STEP_NAME = "Run this shard's tests";
export function testStepSeconds(job, stepName = TEST_STEP_NAME) {
  const step = (job?.steps ?? []).find((s) => s?.name === stepName);
  if (!step?.started_at || !step?.completed_at) return null;
  const seconds = (Date.parse(step.completed_at) - Date.parse(step.started_at)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// Is this run a complete, uncensored measurement? Both halves are required and
// they fail for different reasons, so both are named separately.
//
// ⛔ `conclusion === 'success'` is the test, NOT `status === 'completed'`: a
// cancelled job is completed too, and a cancelled Test Core shard is exactly the
// censored run this refuses. A job that is still running is likewise not a
// success -- it may yet fail -- so anything other than the literal string is a
// rejection.
export function runIsEligible({ jobs, artifacts }, shardCount = SHARD_COUNT) {
  const reasons = [];

  const byShard = new Map();
  for (const job of jobs ?? []) {
    const shard = testCoreShard(job?.name, shardCount);
    if (shard === null) continue;
    // A re-run leaves several job records for one shard; the run qualifies if
    // ANY attempt of that shard concluded success, which is the same rule the
    // artifacts follow (the successful attempt is the one that uploaded).
    if (job?.conclusion === 'success') byShard.set(shard, job);
  }
  const missingJobs = [];
  for (let i = 1; i <= shardCount; i++) if (!byShard.has(i)) missingJobs.push(`${i}/${shardCount}`);
  if (missingJobs.length > 0) {
    reasons.push(`Test Core ${missingJobs.join(', ')} did not conclude success (cancelled, failed or never ran)`);
  }

  const artifactByShard = new Map();
  for (const artifact of artifacts ?? []) {
    const shard = summaryArtifactShard(artifact?.name, shardCount);
    if (shard === null) continue;
    // An expired artifact is a 410 at download time, so it is not an input.
    if (artifact?.expired === true) continue;
    if (!artifactByShard.has(shard)) artifactByShard.set(shard, artifact.id);
  }
  const missingArtifacts = [];
  for (let i = 1; i <= shardCount; i++) if (!artifactByShard.has(i)) missingArtifacts.push(`${i}-of-${shardCount}`);
  if (missingArtifacts.length > 0) {
    reasons.push(`run summary artifact(s) ${missingArtifacts.join(', ')} are missing or expired`);
  }

  const shardSeconds = {};
  for (const [shard, job] of [...byShard.entries()].sort((a, b) => a[0] - b[0])) {
    shardSeconds[shard] = testStepSeconds(job);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    artifactIds: Object.fromEntries([...artifactByShard.entries()].sort((a, b) => a[0] - b[0])),
    shardSeconds,
  };
}

// The half that catches a cache replay, an incomplete slice set, or any other
// reason a run "succeeded" without measuring much (#16464 hazard 2 above).
//
// The judgement is deliberately about MEASUREMENT and not about duration: a
// package the committed dataset measured, that the workspace still contains, and
// that the refreshed dataset does NOT measure, has silently been demoted to the
// test-file-count estimate. That is the direction nobody notices, so it is the
// direction this refuses in. Comparing against the live workspace is what keeps
// a package legitimately deleted from the monorepo from blocking every future
// refresh -- it is gone from `workspace`, so it is not required.
// Coverage is judged on MEASURED UNION CARRIED, which after a `--merge-into`
// pass is simply the refreshed dataset's own key set: the generator has already
// folded in every package a cache HIT witnessed as unchanged, and refused to
// fold in anything else. Two outcomes are reported separately because they are
// different facts and only one of them is a regression:
//
//   `lost`   — the package HAD a measured weight, this refresh neither measured
//              it nor found a cache HIT to witness it, so it would drop to a
//              test-file-count ESTIMATE. That is the silent degradation this
//              whole lane exists to prevent, so it is a REFUSAL, by name.
//
//   `neverMeasured` — the package is in the workspace and has no measured
//              weight before OR after: a new package, or one the dataset has
//              never covered. The partitioner already estimates it from its
//              test-file count and this refresh changed nothing about it, so it
//              cannot be a regression — but it is NAMED rather than passed over
//              in silence, because "estimated" must never be something a reader
//              has to infer from an absence.
export function coverageReport({ committed, refreshed, workspace, exclude = [] }) {
  const excluded = new Set(exclude);
  const inWorkspace = new Set(workspace);
  const priorPackages = committed?.packages ?? {};
  const covered = new Set(Object.keys(refreshed?.packages ?? {}));
  const carried = new Set(refreshed?.carriedOver ?? []);

  const required = Object.keys(priorPackages).filter(
    (name) => inWorkspace.has(name) && !excluded.has(name)
  );
  const lost = required.filter((name) => !covered.has(name)).sort((a, b) => a.localeCompare(b, 'en'));

  const neverMeasured = [...inWorkspace]
    .filter((name) => !excluded.has(name) && !covered.has(name) && !Object.hasOwn(priorPackages, name))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const gained = [...covered]
    .filter((name) => !Object.hasOwn(priorPackages, name))
    .sort((a, b) => a.localeCompare(b, 'en'));

  return {
    ok: lost.length === 0,
    lost,
    neverMeasured,
    gained,
    carriedCount: carried.size,
    freshCount: covered.size - carried.size,
    requiredCount: required.length,
    measuredCount: covered.size,
  };
}

// `turbo ls --output=json` -> package names. The payload shape is asserted
// loudly for the same reason partition-test-shards.mjs asserts it: `turbo ls` is
// marked experimental, and a silently-empty package list here would make every
// package look deleted and every coverage check pass.
export function workspaceNames(parsed) {
  const items = parsed?.packages?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      'workspace: expected `turbo ls --output=json` output with a {packages:{items:[...]}} array'
    );
  }
  const names = items.map((item) => item?.name).filter((n) => typeof n === 'string' && n.length > 0);
  if (names.length === 0) throw new Error('workspace: `turbo ls` listed no packages');
  return names;
}

// ---------------------------------------------------------------------------
// The network half. Thin on purpose: every judgement above is a pure function
// with a self-test, and what is left here is paging and shape-reading.
// ---------------------------------------------------------------------------

async function api(pathname, { token, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API}${pathname}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathname} -> HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// Newest first, bounded. `limit` is how many runs are EXAMINED, not how many
// come back: the answer is often the fourth or fifth run, and stopping at the
// first eligible one would hide the fact that the newest four were replays.
export async function listCandidates({
  repo,
  token,
  workflow = 'ci.yml',
  shardCount = SHARD_COUNT,
  limit = 12,
  event = DEFAULT_RUN_EVENT,
  fetchImpl = fetch,
} = {}) {
  const runs = await api(
    `/repos/${repo}/actions/workflows/${workflow}/runs` +
      `?event=${encodeURIComponent(event)}&branch=main&status=completed&per_page=${limit}`,
    { token, fetchImpl }
  );
  const examined = [];
  for (const run of runs?.workflow_runs ?? []) {
    const [jobsPayload, artifactsPayload] = await Promise.all([
      api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, { token, fetchImpl }),
      api(`/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`, { token, fetchImpl }),
    ]);
    const verdict = runIsEligible(
      { jobs: jobsPayload?.jobs, artifacts: artifactsPayload?.artifacts },
      shardCount
    );
    examined.push({
      run_id: run.id,
      head_sha: run.head_sha,
      created_at: run.created_at,
      html_url: run.html_url,
      eligible: verdict.eligible,
      reasons: verdict.reasons,
      artifact_ids: verdict.artifactIds,
      shard_seconds: verdict.shardSeconds,
    });
  }
  return examined;
}

// ---------------------------------------------------------------------------
// TWO WAYS TO COME BACK WITH NOTHING, AND THEY ARE NOT THE SAME READING (#16467)
// ---------------------------------------------------------------------------
//
// Measured on this card's own PR, job 102286535939: the refresh lane ran with
// `event=schedule` before that trigger existed on `main`, and printed
//
//   NO ELIGIBLE RUN among the 0 most recent completed `schedule` runs ...
//   Every one was censored, failed, or has lost its run-summary artifacts ...
//
// Read the 0. NOTHING was examined -- and the sentence names three causes, none
// of which occurred. A diagnosis that lists causes that did not happen is worse
// than no diagnosis: it sends the next reader hunting a flake that does not
// exist. So the two outcomes are split, with two exits and two messages:
//
//   EMPTY CANDIDATE LIST -- the API has no completed run of this event at all.
//     The PREREQUISITE (an hourly run has happened, recently enough to still
//     hold its artifacts) is NOT MET, nothing was measured, and the code is the
//     repo-wide `EXIT_PREREQUISITE_NOT_MET` -- ⛔ never a finding's
//     `EXIT_FINDINGS`. This is the bootstrap window: at least an hour between
//     the trigger landing and the first hourly run finishing.
//
//   CANDIDATES EXISTED, NONE WAS ELIGIBLE -- every one really was censored,
//     failed, or lost its artifacts. That IS a finding, it keeps exit 1, and it
//     keeps the sentence naming those causes, because now they are justified.
//
// ⛔ A persistent NOT MEASURED is NOT a steady state. Once the hourly run has
// been live for a while, "zero completed schedule runs" stops meaning bootstrap
// and starts meaning the trigger was removed or every run is being cancelled --
// a defect to file, not a green day. Both the message below and the workflow
// step that reads the code say so, because a silent 3 is how a lane ends up
// passing because it never looked.

// The text of the empty-list refusal, as a VALUE so `--self-test` can assert on
// it without spawning a process or stubbing `process.exit`.
export function noCandidatesText({ event, workflow, limit }) {
  return (
    `select-shard-timings-run: PREREQUISITE NOT MET -- the API returned NO completed \`${event}\` run of ` +
    `${workflow} on main at all (asked for the ${limit} most recent).\n` +
    '\n  NOTHING was measured. This is NOT "every candidate was rejected": there were no candidates,' +
    '\n  so no run was censored, none failed, and none lost its artifacts. The dataset was left exactly' +
    '\n  as it is, which is the correct outcome for this reading.' +
    '\n' +
    `\n  Expected while the hourly \`${event}\` run is bootstrapping: the trigger has to land on main and` +
    '\n  one run has to finish before anything is downloadable, and run-summary artifacts are retained' +
    '\n  for 1 day.' +
    '\n' +
    '\n  ⛔ PERSISTENTLY NOT MEASURED IS A DEFECT, NOT A STEADY STATE. If this keeps saying zero after' +
    `\n  the hourly run has been live for a few hours, the \`${event}\` trigger is gone from ${workflow} or` +
    '\n  every hourly run is being cancelled -- and the balancing dataset is quietly ageing out. File it.' +
    '\n' +
    `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from a finding's ${EXIT_FINDINGS} -- capture it BEFORE any pipe:` +
    '\n  `node scripts/ci/select-shard-timings-run.mjs --candidates > /tmp/candidates.log 2>&1; echo "EXIT=$?"`.' +
    "\n  Piped, `$?` is the LAST command's status, and `head`/`tail` essentially never fail -- that" +
    '\n  is the false green.)\n'
  );
}

// The text of the none-eligible refusal. Unchanged in substance: here the three
// causes it names are the ones that actually applied, one per examined run.
export function noEligibleRunText({ examined, event, workflow }) {
  return (
    `select-shard-timings-run: NO ELIGIBLE RUN among the ${examined} most recent completed ` +
    `\`${event}\` runs of ${workflow} on main. Every one was censored, failed, or has lost its ` +
    'run-summary artifacts to the 1-day retention window. This is a refusal, not a no-op: nothing ' +
    'was regenerated.'
  );
}

// The `--candidates` production path, with `process.exit` and the writing of
// stdout lifted OUT so the self-test drives the real thing. What `main` does
// with the result is print it and exit with the code; everything that decides
// the code is here.
export async function runCandidates({ repo, token, limit, event, workflow = 'ci.yml', fetchImpl = fetch }) {
  const notes = [
    `select-shard-timings-run: examining the ${limit} most recent completed \`${event}\` runs of ` +
      `${workflow} on main. The hourly \`schedule\` run is the FULL battery; a \`push\` run has been ` +
      'affected-only since #16467 and is not a measurement of the workspace.',
  ];
  const examined = await listCandidates({ repo, token, limit, event, workflow, fetchImpl });
  for (const run of examined) {
    notes.push(
      run.eligible
        ? `  ELIGIBLE  ${run.run_id}  ${run.created_at}  ${String(run.head_sha).slice(0, 10)}`
        : `  rejected  ${run.run_id}  ${run.created_at}  ${run.reasons.join('; ')}`
    );
  }

  // LEG 1 -- nothing to examine. Checked BEFORE eligibility, because "none of
  // zero was eligible" is vacuously true and is exactly the sentence that lied.
  if (examined.length === 0) {
    return {
      exitCode: EXIT_PREREQUISITE_NOT_MET,
      notes,
      message: noCandidatesText({ event, workflow, limit }),
      eligible: [],
    };
  }

  // LEG 2 -- candidates existed and every one was rejected. A finding.
  const eligible = examined.filter((r) => r.eligible);
  if (eligible.length === 0) {
    return {
      exitCode: EXIT_FINDINGS,
      notes,
      message: noEligibleRunText({ examined: examined.length, event, workflow }),
      eligible: [],
    };
  }

  return { exitCode: 0, notes, message: null, eligible };
}

// The workflow file whose NOT MEASURED branch this script's exit 3 exists for.
// A quoted repo-relative literal: the dispatch derivation reads a gate's path
// literals as the population it watches, so editing that workflow schedules
// this self-test.
export const REFRESH_WORKFLOW = '.github/workflows/shard-timings-refresh.yml';

// The `run:` script of one named step, de-indented, so the self-test can drive
// the real branch instead of reading it. Text rather than a YAML parse: this
// file is dependency-free by design, and one block scalar at a known indent is
// not a parsing problem. Throws when the step or its `run:` is absent -- an
// extractor that returned '' would make every assertion below vacuous.
export function extractStepScript(yamlText, stepName) {
  const lines = String(yamlText).split('\n');
  const at = lines.findIndex((line) => line.trimEnd() === `      - name: ${stepName}`);
  if (at === -1) throw new Error(`extractStepScript: no step named '${stepName}'`);
  let i = at + 1;
  for (; i < lines.length; i += 1) {
    if (/^      - name: /.test(lines[i])) throw new Error(`extractStepScript: step '${stepName}' has no \`run:\``);
    if (lines[i].trimEnd() === '        run: |') break;
  }
  if (i >= lines.length) throw new Error(`extractStepScript: step '${stepName}' has no \`run:\``);
  const body = [];
  for (let j = i + 1; j < lines.length; j += 1) {
    const line = lines[j];
    if (line.trim() !== '' && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  if (body.join('').trim() === '') throw new Error(`extractStepScript: step '${stepName}' has an empty \`run:\``);
  return body.join('\n');
}

// ---------------------------------------------------------------------------
// -- The self-test's own battery roster and floor ---------------------------
//
// Same shape as the two scripts this one serves: what is pinned is the
// registered NAMES, and the count is a FLOOR -- a battery below it means cases
// stopped running, and the remedy is to find what stopped registering, never to
// lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'select-shard-timings-run self-test': 35,
  // #16467. Its own battery rather than more cases in the one above, so that
  // "the query stopped being tested" is a NAMED breach: the floor check below
  // reports a battery that registered zero cases by name, and a battery folded
  // into another only makes a number smaller.
  'select-shard-timings-run candidate selection': 13,
  // #16467, patch round. Its own battery so that "the empty/ineligible
  // distinction stopped being tested" is a NAMED breach rather than a smaller
  // number folded into a neighbour.
  'select-shard-timings-run empty vs ineligible': 17,
  // #16467, patch round. The CONSUMER of exit 3: the workflow step's own
  // `run:` block, lifted out of the YAML and driven under `bash -e` against a
  // stub `node`. An exit code nothing reads is not a distinction.
  'shard-timings-refresh NOT MEASURED path': 18,
});
const SELF_TEST_BATTERY_FLOOR = 4;
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed, so a `return` that
// leaves the function early cannot report as a pass.
const SELF_TEST_VERDICT = 'select-shard-timings-run self-test reached its verdict';

// Async because the candidate-selection battery drives `listCandidates`
// against an injected `fetchImpl`; every caller awaits the verdict.
async function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const check = (fn) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    fn();
  };
  const threw = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  battery('select-shard-timings-run self-test');

  // -- The two name matchers. Both are anchored, and the pins that matter are
  //    the NEAR MISSES: a matcher that also accepts a rerun job or a
  //    differently-sharded artifact would qualify a run on evidence from a run
  //    that is not this one.
  check(() => {
    if (testCoreShard('Test Core (3/6)') !== 3) throw new Error('job matcher: the plain shape did not parse');
  });
  check(() => {
    if (testCoreShard('Test Core (1/6)') !== 1 || testCoreShard('Test Core (6/6)') !== 6) {
      throw new Error('job matcher: an endpoint shard did not parse');
    }
  });
  check(() => {
    if (testCoreShard('Test Core (0/6)') !== null || testCoreShard('Test Core (7/6)') !== null) {
      throw new Error('job matcher: an out-of-range shard index was accepted');
    }
  });
  check(() => {
    if (testCoreShard('Test Core (3/6) rerun') !== null) {
      throw new Error('job matcher: a job merely CONTAINING the shape was accepted');
    }
  });
  check(() => {
    if (testCoreShard('Dogfood (3/6)') !== null) throw new Error('job matcher: a different job was accepted');
  });
  check(() => {
    if (testCoreShard('Test Core (3/8)') !== null) {
      throw new Error('job matcher: a job from a different shard count was accepted');
    }
  });
  check(() => {
    if (testCoreShard(undefined) !== null || testCoreShard('') !== null) {
      throw new Error('job matcher: a missing name was not rejected');
    }
  });
  check(() => {
    if (summaryArtifactShard('test-core-run-summary-4-of-6') !== 4) {
      throw new Error('artifact matcher: the plain shape did not parse');
    }
  });
  check(() => {
    if (summaryArtifactShard('test-core-run-summary-4-of-8') !== null) {
      throw new Error('artifact matcher: a different shard count was accepted');
    }
  });
  check(() => {
    if (summaryArtifactShard('test-core-run-summary-4-of-6-retry') !== null) {
      throw new Error('artifact matcher: a longer name was accepted');
    }
  });

  // -- Eligibility. The fixtures are built from the two rejection shapes this
  //    workflow actually meets: a cancelled shard, and an expired artifact.
  const jobs = (conclusions) =>
    conclusions.map((conclusion, i) => ({ name: `Test Core (${i + 1}/6)`, conclusion, status: 'completed' }));
  const artifacts = (present, expired = []) =>
    present.map((n) => ({ id: 1000 + n, name: `test-core-run-summary-${n}-of-6`, expired: expired.includes(n) }));
  const allSix = ['success', 'success', 'success', 'success', 'success', 'success'];

  check(() => {
    const v = runIsEligible({ jobs: jobs(allSix), artifacts: artifacts([1, 2, 3, 4, 5, 6]) });
    if (!v.eligible) throw new Error(`eligibility: a complete run was rejected (${v.reasons.join('; ')})`);
  });
  check(() => {
    const v = runIsEligible({ jobs: jobs(allSix), artifacts: artifacts([1, 2, 3, 4, 5, 6]) });
    if (v.artifactIds['5'] !== 1005) throw new Error(`eligibility: artifact ids were not returned per shard (${JSON.stringify(v.artifactIds)})`);
  });
  check(() => {
    const cancelled = [...allSix];
    cancelled[2] = 'cancelled';
    const v = runIsEligible({ jobs: jobs(cancelled), artifacts: artifacts([1, 2, 3, 4, 5, 6]) });
    if (v.eligible) throw new Error('eligibility: a run with a CANCELLED shard was accepted');
    if (!v.reasons.some((r) => r.includes('3/6'))) throw new Error(`eligibility: the cancelled shard was not named (${v.reasons.join('; ')})`);
  });
  check(() => {
    // A cancelled shard that still uploaded its artifact is the exact censored
    // shape: "the artifacts exist" must not be enough on its own.
    const cancelled = [...allSix];
    cancelled[0] = 'cancelled';
    const v = runIsEligible({ jobs: jobs(cancelled), artifacts: artifacts([1, 2, 3, 4, 5, 6]) });
    if (v.eligible) throw new Error('eligibility: a censored run passed because its artifacts were complete');
  });
  check(() => {
    const stillRunning = [...allSix];
    stillRunning[4] = null;
    const v = runIsEligible({ jobs: jobs(stillRunning), artifacts: artifacts([1, 2, 3, 4, 5, 6]) });
    if (v.eligible) throw new Error('eligibility: a shard with no conclusion was read as a success');
  });
  check(() => {
    const v = runIsEligible({ jobs: jobs(allSix), artifacts: artifacts([1, 2, 3, 4, 5]) });
    if (v.eligible) throw new Error('eligibility: a run missing an artifact was accepted');
    if (!v.reasons.some((r) => r.includes('6-of-6'))) throw new Error(`eligibility: the missing artifact was not named (${v.reasons.join('; ')})`);
  });
  check(() => {
    const v = runIsEligible({ jobs: jobs(allSix), artifacts: artifacts([1, 2, 3, 4, 5, 6], [2]) });
    if (v.eligible) throw new Error('eligibility: an EXPIRED artifact was counted as retained');
  });
  check(() => {
    // A re-run leaves a failed attempt beside the successful one. The shard
    // qualifies on the attempt that succeeded, which is also the one that
    // uploaded the artifact.
    const withRetry = [...jobs(allSix), { name: 'Test Core (2/6)', conclusion: 'failure', status: 'completed' }];
    const v = runIsEligible({ jobs: withRetry, artifacts: artifacts([1, 2, 3, 4, 5, 6]) });
    if (!v.eligible) throw new Error(`eligibility: a re-run's earlier failed attempt disqualified the shard (${v.reasons.join('; ')})`);
  });

  // -- The per-shard duration the PR body quotes. Read from the suite step's
  //    own window, and ABSENT rather than zero when the step never ran -- a
  //    missing duration reported as 0s would read as an instant suite, which is
  //    the cache-replay shape this file exists to catch.
  check(() => {
    const job = {
      steps: [
        { name: 'Install dependencies', started_at: '2026-09-07T00:00:00Z', completed_at: '2026-09-07T00:00:30Z' },
        { name: TEST_STEP_NAME, started_at: '2026-09-07T00:01:00Z', completed_at: '2026-09-07T00:10:20Z' },
      ],
    };
    if (testStepSeconds(job) !== 560) throw new Error(`step window: got ${testStepSeconds(job)}, expected 560`);
  });
  check(() => {
    if (testStepSeconds({ steps: [{ name: 'Something else', started_at: 'x', completed_at: 'y' }] }) !== null) {
      throw new Error('step window: a different step was measured as the suite');
    }
  });
  check(() => {
    if (testStepSeconds({ steps: [{ name: TEST_STEP_NAME, started_at: '2026-09-07T00:00:00Z' }] }) !== null) {
      throw new Error('step window: an unfinished step was reported as a duration');
    }
  });
  check(() => {
    if (testStepSeconds({}) !== null || testStepSeconds(undefined) !== null) {
      throw new Error('step window: a job with no steps was not rejected');
    }
  });

  // -- Coverage, the cache-replay catcher. The control leg first: an identical
  //    package set must pass, so the rejection below is about the LOSS and not
  //    about the comparison being broken.
  const committed = { packages: { a: 10, b: 20, c: 30 } };
  const ws = ['a', 'b', 'c'];
  check(() => {
    const r = coverageReport({ committed, refreshed: { packages: { a: 11, b: 21, c: 31 } }, workspace: ws });
    if (!r.ok) throw new Error(`coverage: a complete refresh was rejected (${r.lost.join(', ')})`);
  });
  check(() => {
    const r = coverageReport({ committed, refreshed: { packages: { a: 11 } }, workspace: ws });
    if (r.ok) throw new Error('coverage: a refresh that lost two thirds of the workspace was accepted');
    if (r.lost.join(',') !== 'b,c') throw new Error(`coverage: the lost packages were not named (${r.lost.join(',')})`);
  });
  check(() => {
    // A package deleted from the monorepo is NOT a loss -- otherwise one
    // deletion blocks every refresh from then on.
    const r = coverageReport({ committed, refreshed: { packages: { a: 11, b: 21 } }, workspace: ['a', 'b'] });
    if (!r.ok) throw new Error(`coverage: a package removed from the workspace was counted as lost (${r.lost.join(',')})`);
  });
  check(() => {
    // ci.yml excludes dogfood from Test Core, so it is absent by construction.
    const r = coverageReport({
      committed: { packages: { a: 10, '@objectstack/dogfood': 99 } },
      refreshed: { packages: { a: 11 } },
      workspace: ['a', 'ptsc/dogfood'.replace('ptsc/', '@objectstack/')],
      exclude: ['@objectstack/dogfood'],
    });
    if (!r.ok) throw new Error(`coverage: an excluded package was required (${r.lost.join(',')})`);
  });
  check(() => {
    const r = coverageReport({ committed, refreshed: { packages: { a: 1, b: 2, c: 3, d: 4 } }, workspace: [...ws, 'd'] });
    if (!r.ok || r.gained.join(',') !== 'd') throw new Error(`coverage: a newly measured package was not reported (${r.gained.join(',')})`);
  });

  // -- Coverage under the MERGE (#16464). After a `--merge-into` pass the
  //    refreshed dataset already holds the carried weights, so coverage is
  //    judged on measured UNION carried; what the cases below separate is the
  //    two ways a package can be missing, because only one of them is a
  //    regression.
  check(() => {
    // A carried package COUNTS as covered — it has a real weight, witnessed
    // unchanged by a cache hit — so a refresh that measured only `a` and
    // carried `b` and `c` is complete, not short.
    const r = coverageReport({
      committed,
      refreshed: { packages: { a: 11, b: 20, c: 30 }, carriedOver: ['b', 'c'] },
      workspace: ws,
    });
    if (!r.ok) throw new Error(`coverage: carried packages were not counted as covered (${r.lost.join(', ')})`);
    if (r.carriedCount !== 2 || r.freshCount !== 1) {
      throw new Error(`coverage: the carried/fresh split is wrong (carried ${r.carriedCount}, fresh ${r.freshCount})`);
    }
  });
  check(() => {
    // The regression that still refuses: `c` had a weight and is in NEITHER set.
    const r = coverageReport({
      committed,
      refreshed: { packages: { a: 11, b: 20 }, carriedOver: ['b'] },
      workspace: ws,
    });
    if (r.ok) throw new Error('coverage: a package that lost its measured weight was accepted');
    if (r.lost.join(',') !== 'c') throw new Error(`coverage: the lost package was not named (${r.lost.join(',')})`);
  });
  check(() => {
    // A workspace package that NEVER had a weight is named but is not a
    // refusal: the partitioner already estimated it and this refresh changed
    // nothing about it.
    const r = coverageReport({
      committed,
      refreshed: { packages: { a: 11, b: 20, c: 30 }, carriedOver: [] },
      workspace: [...ws, 'brand-new'],
    });
    if (!r.ok) throw new Error(`coverage: a never-measured package was treated as a regression (${r.lost.join(',')})`);
    if (r.neverMeasured.join(',') !== 'brand-new') {
      throw new Error(`coverage: the never-measured package was not named (${r.neverMeasured.join(',')})`);
    }
  });
  check(() => {
    // …and it is not confused with a carried one.
    const r = coverageReport({
      committed,
      refreshed: { packages: { a: 11, b: 20, c: 30 }, carriedOver: ['c'] },
      workspace: [...ws, 'brand-new'],
    });
    if (r.neverMeasured.includes('c') || r.carriedCount !== 1) {
      throw new Error(`coverage: carried and never-measured were conflated (never ${r.neverMeasured.join(',')}, carried ${r.carriedCount})`);
    }
  });
  check(() => {
    // A dataset with no carriedOver key at all (a plain replace) still reads.
    const r = coverageReport({ committed, refreshed: { packages: { a: 1, b: 2, c: 3 } }, workspace: ws });
    if (!r.ok || r.carriedCount !== 0) throw new Error('coverage: a dataset without carriedOver was misread');
  });

  // -- The workspace reader refuses a shape it cannot trust, rather than
  //    returning an empty list that would make every package look deleted.
  check(() => {
    if (workspaceNames({ packages: { items: [{ name: 'a' }, { name: 'b' }] } }).join(',') !== 'a,b') {
      throw new Error('workspace: a valid turbo ls payload did not parse');
    }
  });
  check(() => {
    if (!threw(() => workspaceNames({ packages: {} }))) throw new Error('workspace: a payload with no items array was accepted');
  });
  check(() => {
    if (!threw(() => workspaceNames({ packages: { items: [] } }))) throw new Error('workspace: an EMPTY package list was accepted');
  });

  // -------------------------------------------------------------------------
  battery('select-shard-timings-run candidate selection');
  // -------------------------------------------------------------------------
  // WHICH RUNS THE SELECTOR EVEN LOOKS AT (#16467). Everything above judges a
  // run once it is in hand; this battery judges the QUERY, which is the half
  // that decided the dataset was being fed by affected-only push runs.
  //
  // The fake API below serves BOTH a schedule-shaped and a push-shaped run,
  // and both are fully eligible -- six successful shards, six live artifacts.
  // That is the point: eligibility cannot tell them apart, so the only thing
  // that can is the event named in the request. Each reading therefore comes
  // with its two controls -- a leg that makes the fake serve the push run
  // (proving the absence below is a reading and not a mute fixture) and a leg
  // that asks for an event nobody publishes (proving the run list is keyed on
  // the event rather than handed back regardless of it).
  const SCHEDULE_RUN_ID = 900;
  const PUSH_RUN_ID = 100;
  const eligiblePayload = {
    jobs: { jobs: jobs(allSix) },
    artifacts: { artifacts: artifacts([1, 2, 3, 4, 5, 6]) },
  };
  const makeFakeApi = () => {
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(String(url));
      const { pathname, searchParams } = new URL(String(url));
      const runsMatch = /\/actions\/workflows\/([^/]+)\/runs$/.exec(pathname);
      if (runsMatch) {
        const byEvent = { schedule: SCHEDULE_RUN_ID, push: PUSH_RUN_ID };
        const id = byEvent[searchParams.get('event')];
        const workflow_runs = id
          ? [{ id, head_sha: `${id}`.padStart(40, 'f'), created_at: '2026-09-08T04:00:00Z', html_url: `https://example.invalid/${id}` }]
          : [];
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ workflow_runs }) };
      }
      const kind = /\/actions\/runs\/\d+\/(jobs|artifacts)$/.exec(pathname)?.[1];
      if (kind) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => eligiblePayload[kind] };
      }
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    };
    return { fetchImpl, requested };
  };
  const call = async (options = {}) => {
    const { fetchImpl, requested } = makeFakeApi();
    const examined = await listCandidates({ repo: 'o/r', token: 't', fetchImpl, ...options });
    return { examined, requested };
  };

  check(() => {
    if (DEFAULT_RUN_EVENT !== 'schedule') {
      throw new Error(`default event: expected 'schedule', got '${DEFAULT_RUN_EVENT}'`);
    }
  });
  check(() => {
    if (DEFAULT_RUN_EVENT === 'push') throw new Error('default event: the affected-only event is back as the default');
  });

  // THE READING: by default the selector asks for the hourly scheduled run and
  // gets it, and never asks for a push run at all.
  const defaultCall = await call();
  check(() => {
    const ids = defaultCall.examined.map((r) => r.run_id);
    if (ids.length !== 1 || ids[0] !== SCHEDULE_RUN_ID) {
      throw new Error(`default selection: expected only the schedule run, got [${ids.join(', ')}]`);
    }
  });
  check(() => {
    if (!defaultCall.examined[0]?.eligible) throw new Error('default selection: the schedule run was not judged eligible');
  });
  check(() => {
    const listQuery = defaultCall.requested.find((u) => u.includes('/runs?'));
    if (!listQuery?.includes('event=schedule')) throw new Error(`default selection: the run list was not asked for by event (${listQuery})`);
  });
  check(() => {
    if (defaultCall.requested.some((u) => u.includes('event=push'))) {
      throw new Error('default selection: a push run was requested');
    }
  });
  check(() => {
    if (defaultCall.examined.some((r) => r.run_id === PUSH_RUN_ID)) {
      throw new Error('default selection: the push-shaped run was returned');
    }
  });
  check(() => {
    const listQuery = defaultCall.requested.find((u) => u.includes('/runs?'));
    for (const fragment of ['branch=main', 'status=completed', 'per_page=']) {
      if (!listQuery.includes(fragment)) throw new Error(`default selection: '${fragment}' left the query (${listQuery})`);
    }
  });

  // FIRING CONTROL: the fake DOES serve a push run, and it is fully eligible.
  // So the zero above is a reading about the query, and the push run's
  // eligibility is not what excludes it -- nothing in `runIsEligible` can.
  const pushCall = await call({ event: 'push' });
  check(() => {
    const ids = pushCall.examined.map((r) => r.run_id);
    if (ids.length !== 1 || ids[0] !== PUSH_RUN_ID) {
      throw new Error(`firing control: the fake did not serve the push run, so the default reading is mute (got [${ids.join(', ')}])`);
    }
  });
  check(() => {
    if (!pushCall.examined[0]?.eligible) {
      throw new Error('firing control: the push run was rejected by eligibility, which would make the event guard look unnecessary');
    }
  });

  // NONSENSE CONTROL: an event nobody publishes returns nothing, so the run
  // list is genuinely keyed on the event rather than served regardless of it.
  const nonsenseCall = await call({ event: 'no-such-event' });
  check(() => {
    if (nonsenseCall.examined.length !== 0) {
      throw new Error(`nonsense control: an unpublished event returned ${nonsenseCall.examined.length} run(s)`);
    }
  });
  check(() => {
    const listQuery = nonsenseCall.requested.find((u) => u.includes('/runs?'));
    if (!listQuery?.includes('event=no-such-event')) {
      throw new Error(`nonsense control: the event was not forwarded into the query (${listQuery})`);
    }
  });

  // The limit is the number of runs EXAMINED, so it has to reach the query.
  const limited = await call({ limit: 3 });
  check(() => {
    const listQuery = limited.requested.find((u) => u.includes('/runs?'));
    if (!listQuery?.includes('per_page=3')) throw new Error(`limit: not forwarded (${listQuery})`);
  });

  // -------------------------------------------------------------------------
  battery('select-shard-timings-run empty vs ineligible');
  // -------------------------------------------------------------------------
  // The two ways to come back with nothing. Measured on this card's own PR:
  // the lane printed "NO ELIGIBLE RUN among the 0 ... Every one was censored,
  // failed, or has lost its artifacts" when nothing had been examined at all.
  // Both legs are pinned here, because a distinction with only one leg tested
  // is a distinction that collapses the first time someone simplifies it.
  const runsFor = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: 700 + i,
      head_sha: `${700 + i}`.padStart(40, 'e'),
      created_at: '2026-09-09T04:00:00Z',
      html_url: `https://example.invalid/${700 + i}`,
    }));
  // `shape` decides what the runs' jobs look like: 'eligible' is six successes,
  // 'censored' is six cancellations -- a real rejection cause, so leg 2's
  // message is justified when it fires.
  const fakeWithRuns = (count, shape) => async (url) => {
    const { pathname } = new URL(String(url));
    if (/\/actions\/workflows\/[^/]+\/runs$/.test(pathname)) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ workflow_runs: runsFor(count) }) };
    }
    if (/\/actions\/runs\/\d+\/jobs$/.test(pathname)) {
      const conclusions = shape === 'eligible' ? allSix : allSix.map(() => 'cancelled');
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ jobs: jobs(conclusions) }) };
    }
    if (/\/actions\/runs\/\d+\/artifacts$/.test(pathname)) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ artifacts: artifacts([1, 2, 3, 4, 5, 6]) }) };
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  };
  const candidates = (count, shape) =>
    runCandidates({ repo: 'o/r', token: 't', limit: 24, event: 'schedule', fetchImpl: fakeWithRuns(count, shape) });

  // LEG 1 -- the API has no completed run of this event at all.
  const empty = await candidates(0, 'eligible');
  await check(() => {
    if (empty.exitCode !== EXIT_PREREQUISITE_NOT_MET) {
      throw new Error(`empty leg: expected exit ${EXIT_PREREQUISITE_NOT_MET}, got ${empty.exitCode}`);
    }
  });
  await check(() => {
    if (empty.exitCode === EXIT_FINDINGS) throw new Error('empty leg: an unmet prerequisite exits as a finding');
  });
  await check(() => {
    if (!empty.message.includes('PREREQUISITE NOT MET')) throw new Error('empty leg: the refusal does not name the prerequisite');
  });
  await check(() => {
    // ⛔ The whole defect: it must not ASSERT causes that did not occur. The
    // words appear only inside the sentence that DENIES them, which is why the
    // forbidden strings here are the affirmative claims and not the bare nouns.
    for (const claim of ['Every one was censored', 'NO ELIGIBLE RUN']) {
      if (empty.message.includes(claim)) throw new Error(`empty leg: the message still claims '${claim}'`);
    }
  });
  await check(() => {
    if (!empty.message.includes('there were no candidates') || !empty.message.includes('no run was censored')) {
      throw new Error('empty leg: it does not deny the three causes it used to assert');
    }
  });
  await check(() => {
    if (!empty.message.includes('NOTHING was measured')) throw new Error('empty leg: it does not say nothing was measured');
  });
  await check(() => {
    // ⛔ A silent 3 is how a lane passes because it never looked.
    if (!empty.message.includes('PERSISTENTLY NOT MEASURED IS A DEFECT')) {
      throw new Error('empty leg: it does not say a persistent NOT MEASURED is a defect');
    }
  });
  await check(() => {
    if (!empty.message.includes(`Exit code ${EXIT_PREREQUISITE_NOT_MET}`) || !empty.message.includes(`a finding's ${EXIT_FINDINGS}`)) {
      throw new Error('empty leg: the advisory does not interpolate both codes');
    }
  });
  await check(() => {
    if (empty.eligible.length !== 0) throw new Error('empty leg: it returned runs it did not have');
  });

  // LEG 2 -- candidates existed and every one was rejected. Still a finding.
  const censored = await candidates(3, 'censored');
  await check(() => {
    if (censored.exitCode !== EXIT_FINDINGS) {
      throw new Error(`ineligible leg: expected exit ${EXIT_FINDINGS}, got ${censored.exitCode}`);
    }
  });
  await check(() => {
    if (censored.exitCode === EXIT_PREREQUISITE_NOT_MET) {
      throw new Error('ineligible leg: a real finding was demoted to NOT MEASURED');
    }
  });
  await check(() => {
    if (!censored.message.includes('NO ELIGIBLE RUN among the 3')) {
      throw new Error(`ineligible leg: the count is wrong or absent (${censored.message})`);
    }
  });
  await check(() => {
    if (censored.message.includes('PREREQUISITE NOT MET')) {
      throw new Error('ineligible leg: it printed the prerequisite refusal');
    }
  });
  await check(() => {
    // The causes it names really did apply: every shard concluded `cancelled`.
    if (!censored.notes.some((n) => n.includes('rejected') && n.includes('did not conclude success'))) {
      throw new Error(`ineligible leg: the per-run rejection reason was not printed (${censored.notes.join(' | ')})`);
    }
  });

  // POSITIVE CONTROL -- the same fake, one eligible run, exits 0 and returns it.
  // Without this the two refusals above could both be a fake that never works.
  const good = await candidates(2, 'eligible');
  await check(() => {
    if (good.exitCode !== 0) throw new Error(`positive control: an eligible run did not exit 0 (${good.exitCode})`);
  });
  await check(() => {
    if (good.eligible.length !== 2 || good.message !== null) {
      throw new Error(`positive control: expected two eligible runs and no message (${good.eligible.length})`);
    }
  });
  await check(() => {
    if (EXIT_PREREQUISITE_NOT_MET === EXIT_FINDINGS || EXIT_PREREQUISITE_NOT_MET === 0) {
      throw new Error('the NOT MEASURED code is not distinct from a finding or from success');
    }
  });

  // -------------------------------------------------------------------------
  battery('shard-timings-refresh NOT MEASURED path');
  // -------------------------------------------------------------------------
  // The exit code above only helps if its CONSUMER reads it. So the workflow
  // step is not read here, it is RUN: its `run:` block is lifted out of the
  // YAML and driven under `bash -e` against a stub `node` that answers with
  // whichever exit code the case is about. Three legs, because a branch tested
  // only on the path it was written for is a branch nobody has seen fail.
  const REFRESH_YAML = readFileSync(REFRESH_WORKFLOW, 'utf8');
  const SELECT_STEP = 'Choose a green, uncensored, un-replayed run';
  const stepScript = extractStepScript(REFRESH_YAML, SELECT_STEP);

  await check(() => {
    if (!stepScript.includes('--candidates')) throw new Error('extractor: the lifted block is not the selection step');
  });
  await check(() => {
    // NONSENSE CONTROL: an absent step must throw, not return an empty script
    // that makes every assertion below pass over nothing.
    if (!threw(() => extractStepScript(REFRESH_YAML, 'no such step in this workflow'))) {
      throw new Error('extractor: an absent step returned a script instead of throwing');
    }
  });

  // driveStep(exitCode) -- run the lifted block with a stub `node` that exits
  // `exitCode` for the `--candidates` call and defers to the real node for the
  // step's other `node -e` invocation.
  const driveStep = (exitCode) => {
    const dir = mkdtempSync(join(tmpdir(), 'os-timings-step-'));
    try {
      const runnerTemp = join(dir, 'runner-temp');
      const bin = join(dir, 'bin');
      mkdirSync(runnerTemp);
      mkdirSync(bin);
      const stub = join(bin, 'node');
      writeFileSync(
        stub,
        [
          '#!/usr/bin/env bash',
          'for a in "$@"; do',
          '  if [ "$a" = "--candidates" ]; then',
          `    echo "select-shard-timings-run: stubbed refusal text" >&2`,
          `    printf '[]'`,
          `    exit ${exitCode}`,
          '  fi',
          'done',
          `exec ${JSON.stringify(process.execPath)} "$@"`,
        ].join('\n')
      );
      chmodSync(stub, 0o755);
      const outputFile = join(dir, 'github-output');
      const summaryFile = join(dir, 'github-summary');
      writeFileSync(outputFile, '');
      writeFileSync(summaryFile, '');
      const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', stepScript], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          RUNNER_TEMP: runnerTemp,
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: summaryFile,
        },
      });
      return {
        status: run.status,
        stdout: run.stdout ?? '',
        output: readFileSync(outputFile, 'utf8'),
        summary: readFileSync(summaryFile, 'utf8'),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // LEG 3 -- NOT MEASURED. The step must go GREEN, skip the rest, and be LOUD.
  const notMeasured = driveStep(3);
  await check(() => {
    if (notMeasured.status !== 0) throw new Error(`workflow leg 3: the step failed (exit ${notMeasured.status}): ${notMeasured.stdout}`);
  });
  await check(() => {
    if (!notMeasured.output.includes('not_measured=true')) {
      throw new Error(`workflow leg 3: the skip output was not set (${notMeasured.output})`);
    }
  });
  await check(() => {
    if (!notMeasured.output.includes('select_exit=3')) throw new Error('workflow leg 3: the exit code was not recorded');
  });
  await check(() => {
    // ⛔ A silent 3 is the failure shape this branch exists to avoid.
    if (!notMeasured.stdout.includes('::warning::')) throw new Error('workflow leg 3: no annotation was minted');
  });
  await check(() => {
    if (!notMeasured.summary.includes('NOT MEASURED')) throw new Error('workflow leg 3: the step summary says nothing');
  });
  await check(() => {
    if (!notMeasured.summary.includes('A PERSISTENT NOT MEASURED IS A DEFECT, NOT A STEADY STATE')) {
      throw new Error('workflow leg 3: the summary omits the persistent-3-is-a-defect sentence');
    }
  });
  await check(() => {
    if (!notMeasured.summary.includes('there were')) throw new Error('workflow leg 3: the summary does not deny the causes that did not occur');
  });
  await check(() => {
    if (!notMeasured.summary.includes('stubbed refusal text')) {
      throw new Error("workflow leg 3: the selector's own refusal text was not quoted into the summary");
    }
  });

  // LEG 2 CONTROL -- a real finding must still fail the step, and must NOT be
  // reported as NOT MEASURED. Without this leg the branch above could swallow
  // every non-zero.
  const finding = driveStep(1);
  await check(() => {
    if (finding.status !== 1) throw new Error(`workflow leg 1: a finding did not fail the step (exit ${finding.status})`);
  });
  await check(() => {
    if (finding.output.includes('not_measured=true')) throw new Error('workflow leg 1: a finding was reported as NOT MEASURED');
  });
  await check(() => {
    if (!finding.stdout.includes('::error::')) throw new Error('workflow leg 1: a finding minted no error annotation');
  });

  // LEG 0 CONTROL -- the ordinary path is untouched: the step succeeds and sets
  // no skip flag, so the rest of the job runs.
  const ordinary = driveStep(0);
  await check(() => {
    if (ordinary.status !== 0) throw new Error(`workflow leg 0: the ordinary path failed (exit ${ordinary.status}): ${ordinary.stdout}`);
  });
  await check(() => {
    if (ordinary.output.includes('not_measured=true')) throw new Error('workflow leg 0: the ordinary path set the skip flag');
  });
  await check(() => {
    if (!ordinary.output.includes('select_exit=0')) throw new Error('workflow leg 0: the exit code was not recorded');
  });

  // The YAML half: the two steps that must not run on the NOT MEASURED reading
  // carry the guard. Everything after `compare` is already gated on
  // `steps.compare.outputs.changed`, which is '' when `compare` is skipped.
  for (const stepName of [
    'Regenerate the dataset, accumulating runs until the workspace is covered',
    'Compare against the committed dataset',
  ]) {
    await check(() => {
      const at = REFRESH_YAML.indexOf(`      - name: ${stepName}`);
      if (at === -1) throw new Error(`YAML half: no step named '${stepName}'`);
      const window = REFRESH_YAML.slice(at, at + 900);
      if (!window.includes("if: steps.select.outputs.not_measured != 'true'")) {
        throw new Error(`YAML half: '${stepName}' would still run on the NOT MEASURED reading`);
      }
    });
  }

  // -- The floor: every declared battery ran, and ran its cases. Evaluated
  //    before the verdict, so the success line can only be printed by a run in
  //    which the set of batteries that registered EQUALS the set declared.
  const floorFailures = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailures.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`
    );
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    floorFailures.push(`battery "${name}" registered ${count} case(s) but is not declared.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailures.push(
      count === 0
        ? `battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
        : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`
    );
  }
  if (floorFailures.length > 0) {
    throw new Error(
      `select-shard-timings-run self-test floor (${floorFailures.length} breach(es)):\n` +
        floorFailures.map((f) => `  - ${f}`).join('\n') +
        '\n  A battery at or below its floor means cases STOPPED RUNNING -- the battery is the bug, ' +
        'not the number.'
    );
  }

  console.log('select-shard-timings-run: self-test OK');
  return SELF_TEST_VERDICT;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    if ((await selfTest()) !== SELF_TEST_VERDICT) {
      console.error(
        '\nx select-shard-timings-run self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
          'finished as a self-test that passed.\n'
      );
      process.exit(1);
    }
    return;
  }

  if (argv.includes('--check-coverage')) {
    const value = (flag) => {
      const i = argv.indexOf(flag);
      return i === -1 ? null : argv[i + 1];
    };
    const exclude = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--exclude') exclude.push(argv[i + 1]);
    const committed = readJson(value('--committed'));
    const refreshed = readJson(value('--refreshed'));
    const workspace = workspaceNames(readJson(value('--workspace')));
    const report = coverageReport({ committed, refreshed, workspace, exclude });
    // Named whichever way the verdict goes: a package the partitioner estimates
    // must never be something a reader infers from an absence.
    if (report.neverMeasured.length > 0) {
      console.error(
        `select-shard-timings-run: ${report.neverMeasured.length} workspace package(s) have no measured ` +
          `weight before or after this refresh and are ESTIMATED by the partitioner from their ` +
          `test-file count: ${report.neverMeasured.join(', ')}. Not a regression — this refresh did not ` +
          'change their standing — but they are named rather than passed over, because an estimate that ' +
          'reads as a measurement is this dataset\'s signature hazard.'
      );
    }
    if (!report.ok) {
      console.error(
        `select-shard-timings-run: COVERAGE SHORTFALL -- ${report.lost.length} package(s) HAD a measured ` +
          'weight and this refresh neither re-measured them nor found a turbo cache HIT to witness that ' +
          `they are unchanged: ${report.lost.join(', ')}. Each would drop to the test-file-count ` +
          'ESTIMATE, which is the silent degradation this lane exists to prevent, so this is a refusal. ' +
          'Not a verdict on any one run: no single run measures everything, so the caller adds the next ' +
          'older run and asks again.'
      );
      process.exit(1);
    }
    console.error(
      `select-shard-timings-run: coverage OK -- ${report.measuredCount} package(s) covered ` +
        `(${report.freshCount} measured in these runs, ${report.carriedCount} carried on a cache-hit ` +
        `witness), ${report.requiredCount} required, ${report.gained.length} newly measured` +
        `${report.gained.length > 0 ? ` (${report.gained.join(', ')})` : ''}.`
    );
    return;
  }

  if (argv.includes('--candidates')) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!token || !repo) throw new Error('--candidates needs GITHUB_TOKEN and GITHUB_REPOSITORY in the environment');
    const limitAt = argv.indexOf('--limit');
    const limit = limitAt === -1 ? 12 : Number(argv[limitAt + 1]);
    const eventAt = argv.indexOf('--event');
    const event = eventAt === -1 ? DEFAULT_RUN_EVENT : String(argv[eventAt + 1]);
    const result = await runCandidates({ repo, token, limit, event });
    for (const note of result.notes) console.error(note);
    if (result.exitCode !== 0) {
      console.error(result.message);
      process.exit(result.exitCode);
    }
    console.log(JSON.stringify(result.eligible, null, 2));
    return;
  }

  console.error(
    'usage: select-shard-timings-run.mjs --candidates [--limit <n>] [--event <name>]\n' +
      '       select-shard-timings-run.mjs --check-coverage --committed <f> --refreshed <f> --workspace <f> [--exclude <pkg>]...\n' +
      '       select-shard-timings-run.mjs --self-test'
  );
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  await main();
}
