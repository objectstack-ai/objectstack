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
//   1. CANCELLED RUNS. `cancel-in-progress` kills a push run on main the moment
//      the next merge lands, and merges arrive faster than Test Core finishes:
//      36 of the last 60 push runs were censored that way. Such a run leaves
//      SOME artifacts, so "the artifacts exist" is not the test -- every one of
//      the six Test Core jobs must have concluded `success`.
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
// Usage:
//   node scripts/ci/select-shard-timings-run.mjs --candidates [--limit <n>]
//   node scripts/ci/select-shard-timings-run.mjs --check-coverage \
//     --committed <old.json> --refreshed <new.json> --workspace <turbo-ls.json> \
//     [--exclude <pkg>]...
//   node scripts/ci/select-shard-timings-run.mjs --self-test
//
// `--candidates` needs GITHUB_TOKEN and GITHUB_REPOSITORY in the environment and
// prints a JSON array, newest first. `--check-coverage` exits non-zero when the
// refreshed dataset lost a package the committed one measured and the workspace
// still contains.

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { isEntrypoint } from '../invoked-as.mjs';

// The Test Core shard count. Spelled here as the number of jobs and artifacts a
// complete run must present; partition-test-shards.mjs owns the split itself and
// its own self-test reads ci.yml back, so this is a reader's expectation rather
// than a second declaration of the split.
export const SHARD_COUNT = 6;

const API = 'https://api.github.com';

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
export function coverageReport({ committed, refreshed, workspace, exclude = [] }) {
  const excluded = new Set(exclude);
  const inWorkspace = new Set(workspace);
  const required = Object.keys(committed?.packages ?? {}).filter(
    (name) => inWorkspace.has(name) && !excluded.has(name)
  );
  const measured = new Set(Object.keys(refreshed?.packages ?? {}));
  const lost = required.filter((name) => !measured.has(name)).sort((a, b) => a.localeCompare(b, 'en'));
  const gained = [...measured]
    .filter((name) => !Object.hasOwn(committed?.packages ?? {}, name))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return {
    ok: lost.length === 0,
    lost,
    gained,
    requiredCount: required.length,
    measuredCount: measured.size,
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
  fetchImpl = fetch,
} = {}) {
  const runs = await api(
    `/repos/${repo}/actions/workflows/${workflow}/runs` +
      `?event=push&branch=main&status=completed&per_page=${limit}`,
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
// -- The self-test's own battery roster and floor ---------------------------
//
// Same shape as the two scripts this one serves: what is pinned is the
// registered NAMES, and the count is a FLOOR -- a battery below it means cases
// stopped running, and the remedy is to find what stopped registering, never to
// lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'select-shard-timings-run self-test': 30,
});
const SELF_TEST_BATTERY_FLOOR = 1;
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed, so a `return` that
// leaves the function early cannot report as a pass.
const SELF_TEST_VERDICT = 'select-shard-timings-run self-test reached its verdict';

function selfTest() {
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
    if (selfTest() !== SELF_TEST_VERDICT) {
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
    if (!report.ok) {
      console.error(
        `select-shard-timings-run: COVERAGE SHORTFALL -- ${report.lost.length} package(s) the committed ` +
          'dataset measured, and the workspace still contains, are NOT measured by the runs accumulated ' +
          `so far: ${report.lost.join(', ')}. Every one of them would silently fall back to the ` +
          'test-file-count ESTIMATE, so what has been read so far is a warm cache rather than the ' +
          'workspace. Not a verdict on any one run: no single run measures everything (turbo caches per ' +
          'shard, and the generator refuses hits), so the caller adds the next older run and asks again.'
      );
      process.exit(1);
    }
    console.error(
      `select-shard-timings-run: coverage OK -- ${report.measuredCount} package(s) measured, ` +
        `${report.requiredCount} required, ${report.gained.length} newly measured` +
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
    const examined = await listCandidates({ repo, token, limit });
    for (const run of examined) {
      console.error(
        run.eligible
          ? `  ELIGIBLE  ${run.run_id}  ${run.created_at}  ${String(run.head_sha).slice(0, 10)}`
          : `  rejected  ${run.run_id}  ${run.created_at}  ${run.reasons.join('; ')}`
      );
    }
    const eligible = examined.filter((r) => r.eligible);
    if (eligible.length === 0) {
      console.error(
        `select-shard-timings-run: NO ELIGIBLE RUN among the ${examined.length} most recent completed push ` +
          'runs on main. Every one was censored, failed, or has lost its run-summary artifacts to the ' +
          '1-day retention window. This is a refusal, not a no-op: nothing was regenerated.'
      );
      process.exit(1);
    }
    console.log(JSON.stringify(eligible, null, 2));
    return;
  }

  console.error(
    'usage: select-shard-timings-run.mjs --candidates [--limit <n>]\n' +
      '       select-shard-timings-run.mjs --check-coverage --committed <f> --refreshed <f> --workspace <f> [--exclude <pkg>]...\n' +
      '       select-shard-timings-run.mjs --self-test'
  );
  process.exit(1);
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  await main();
}
