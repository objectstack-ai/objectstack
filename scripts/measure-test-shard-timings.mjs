#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// measure-test-shard-timings -- turn `turbo run test --summarize` run summaries
// into scripts/test-shard-timings.json, the per-package duration dataset that
// scripts/partition-test-shards.mjs bins the Test Core shards from.
//
// WHY THIS SCRIPT EXISTS AT ALL, AND WHY THE DATASET IS NOT HAND-WRITTEN.
//
// The partitioner used to weigh each package by its TEST-FILE COUNT, on the
// stated theory that per-file fixed cost dominates so file count tracks
// duration. Measured against real queue builds, that proxy holds to about
// +-20% on most packages and is off by ~2.8x on @objectstack/cli (~4.1 s/file
// against a ~1.2-1.4 s/file workspace norm). LPT binning cannot correct an
// input that wrong: in run 32428961038 the six file-count-balanced bins came
// out 5.0/6.2/6.3/13.6/6.3/9.0 minutes -- a 2.7x spread with the algorithm
// working exactly as designed. Balance the right quantity and the spread
// collapses; the bins were never the defect, the weights were.
//
// A hand-written duration table would fix that once and then rot silently, in
// the direction nobody notices: suites only get slower, the table stays put,
// and the shard that drifted heavy looks balanced on paper. So the dataset is
// GENERATED, from data every CI test run already produces, and regenerating it
// is one command against artifacts a green run leaves behind.
//
// THE TWO REFRESH PATHS (both documented in the dataset's own `provenance`):
//
//   From CI, no special run needed. Every Test Core shard passes --summarize
//   and, on merge_group builds, uploads `.turbo/runs/` as the
//   `test-core-run-summary-<shard>-of-6` artifact.
//
//   ⚠ ONE RUN IS NOT ENOUGH, AND THIS SENTENCE USED TO SAY IT WAS. It read
//   "download all six from any green queue build and re-run the generator",
//   which is optimistic in a way nobody had measured until the refresh lane ran
//   for real: a single green run yields between 2 and 52 of the ~71 measurable
//   packages, depending on nothing but how warm that run's turbo cache was, and
//   the union of every retained green run converges around 57. The rest are
//   cache HITs, which this file refuses (see the CACHED TASKS rule below). So
//   the honest procedure is:
//
//     node scripts/measure-test-shard-timings.mjs \
//       --run <run-a-id> <run-a-dir>/*.json \
//       --run <run-b-id> <run-b-dir>/*.json \
//       --merge-into scripts/test-shard-timings.json \
//       --out scripts/test-shard-timings.json
//
//   `--run` fences each run: slices are summed within a run and the per-run sums
//   medianed across runs, so a file-sharded package gets the same median
//   treatment as every other package (#16473); undeclared multi-run input is
//   REFUSED rather than resolved by guessing.
//
//   `--merge-into` is what makes a partial measurement sound. A package this
//   pass did not measure keeps its previous weight -- but ONLY when a cache HIT
//   witnesses that its inputs are unchanged, which is the evidence that the old
//   number still describes it. Those packages are named in `carriedOver`.
//   Anything absent for any other reason is simply not in the output, so the
//   caller can name it rather than estimate it.
//
//   `.github/workflows/shard-timings-refresh.yml` does all of this on a weekly
//   timer and opens the PR.
//
//   Locally, on a 4-vCPU box (the hosted runner's shape):
//     pnpm exec turbo run build
//     pnpm exec turbo run test --concurrency=4 --summarize \
//       --filter=!@objectstack/dogfood
//     node scripts/measure-test-shard-timings.mjs .turbo/runs/*.json \
//       --out scripts/test-shard-timings.json
//
// ⛔ CACHED TASKS ARE REFUSED, NOT RECORDED. A `turbo run test` that hits the
// cache replays a stored log in milliseconds and still reports an execution
// window. Recording that window as the suite's cost writes a ~0.1s weight for
// a 6-minute suite -- a wrong number that reads exactly like a right one, and
// the resulting shard is the imbalance this whole file exists to remove. Every
// sample therefore has to carry `cache.status === "MISS"`; a HIT is skipped
// with a named warning, and a run in which NOTHING was a miss exits non-zero
// rather than emitting a dataset built from replays.
//
// Usage:
//   node scripts/measure-test-shard-timings.mjs <summary.json>... [--out <path>]
//   node scripts/measure-test-shard-timings.mjs --run <id> <summary.json>... \
//     --run <id> <summary.json>... [--merge-into <dataset>] [--out <path>]
//   node scripts/measure-test-shard-timings.mjs --self-test

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { countTestFiles } from './partition-test-shards.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'scripts', 'test-shard-timings.json');

// Median, not mean and not max, when a package was sampled more than once.
//
// Mean lets one pathological leg (a runner that lost its CPU to a noisy
// neighbour) drag a package's weight permanently. Max does the same thing
// harder and never comes back down, so the dataset ratchets upward across
// refreshes and the split slowly re-imbalances toward whatever package had the
// unluckiest run. Median needs half the samples to move before the weight
// does, which is the property a balancing input wants.
export function median(values) {
  if (values.length === 0) throw new Error('median: no values');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Which file-level slice a summary's tasks were run as, or null for a whole
// package (#16173).
//
// turbo records the run's passthrough argv on EVERY task record as
// `cliArguments` -- verified on turbo 2.10.10 against a real executed summary,
// not only a `--dry=json` plan: `pnpm turbo run test --filter=<pkg> --summarize
// -- --shard=1/2` writes `"cliArguments": ["--shard=1/2"]` and the child really
// receives `pnpm run test --shard=1/2`. It is a RUN-level field replicated per
// task, which is exactly the granularity this needs: ci.yml runs the sliced
// package in its own turbo invocation, so a summary is either a whole-package
// run or one slice's, never a mix.
//
// ⛔ WHY THIS CANNOT BE SKIPPED. The dataset stores each package's WHOLE cost.
// Once the CLI is sharded k/n, a green queue build leaves n summaries each
// holding ~1/n of it, and the median rule -- correct for repeat measurements of
// one package -- would write one slice's duration as the whole package's
// weight. That is the #16173 defect exactly, re-created by the fix for it, in
// the same silent direction: a number that reads right and is n times too
// small.
export function sliceOfCliArguments(args) {
  if (!Array.isArray(args)) return null;
  for (const arg of args) {
    const m = /^--shard[= ](\d+)\/(\d+)$/.exec(String(arg));
    if (!m) continue;
    const [index, count] = [Number(m[1]), Number(m[2])];
    if (index < 1 || count < 1 || index > count) {
      throw new Error(`a run summary carries an impossible slice spec ${JSON.stringify(arg)}`);
    }
    return { index, count };
  }
  return null;
}

// The task names whose windows this file counts as a package's test cost.
// #16550: since #16466, six packages (core, objectql, rest, runtime, spec,
// types) split their suite into `test` and `test:repo` (the repo-scanning
// tests, hashed on the wide inputs) -- TWO task records per package in the
// same run summary, both genuinely part of the suite's cost. `ci.yml` runs
// them together (`turbo run test test:repo`), so a package that has a
// `test:repo` task always has it in the SAME summary as its `test` task.
const SAMPLED_TASKS = ['test', 'test:repo'];

// Pull every genuinely-executed `test` (and, for split packages, `test:repo`)
// task out of one parsed run summary, folded per package into ONE window.
//
// The shape assertions are loud for the same reason the partitioner's are:
// `--summarize` is stable but not contractual, and the failure this script can
// cause is a dataset that looks fine and balances nothing. A summary that
// carries no `tasks` array is a refusal, never an empty result.
//
// `slices` rides alongside `samples` rather than changing its shape: the drift
// gate in partition-test-shards.mjs reads `samples` as name -> seconds and does
// not need it (a shard runs exactly one slice, so its prediction follows from
// the slice map, not from the summary), while buildDataset below cannot record
// a correct weight without it.
//
// #16550: a package's `test` and `test:repo` legs are folded by SUMMING their
// execution windows -- the whole-package cost is both halves together, not
// either alone. The rejection rule composes across the fold rather than being
// re-derived per leg: EVERY leg present for a package must be a cache MISS
// with exit 0, or the WHOLE package is skipped -- one cached or failed leg is
// exactly as disqualifying as a cached or failed `test` used to be on its own.
// Recording one leg's seconds alone (because the other was cached or failed)
// would write a partial suite's cost as the package's whole cost, a reading
// worse than today's undercount by #16466's own defect this card fixes.
export function samplesFromSummary(parsed, label) {
  const tasks = parsed?.tasks;
  if (!Array.isArray(tasks)) {
    throw new Error(
      `${label}: expected a \`turbo run --summarize\` summary with a {tasks:[...]} array -- ` +
        'is this a run summary at all?'
    );
  }
  // One entry per package, holding whichever of its sampled tasks this
  // summary carries (almost always just `test`; `test` + `test:repo` for a
  // split package). Each leg is recorded as EITHER a seconds+cliArguments
  // reading, OR a `cached`/`failed` flag -- never both -- so the fold below
  // can tell "this leg disqualifies the package" from "this leg is a real
  // measurement" without re-reading the raw task.
  const legsByPackage = new Map();
  for (const task of tasks) {
    const taskName = task?.task;
    if (!SAMPLED_TASKS.includes(taskName)) continue;
    const name = task.package;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`${label}: a ${taskName} task carries no package name: ${JSON.stringify(task.taskId)}`);
    }
    if (!legsByPackage.has(name)) legsByPackage.set(name, new Map());
    const legs = legsByPackage.get(name);
    if (task?.cache?.status !== 'MISS') {
      legs.set(taskName, { cached: true });
      continue;
    }
    const { startTime, endTime, exitCode } = task.execution ?? {};
    if (typeof startTime !== 'number' || typeof endTime !== 'number') {
      throw new Error(`${label}: ${name}#${taskName} has no execution window to measure`);
    }
    // A failed suite stops early, so its duration is not this package's cost.
    if (exitCode !== 0) {
      legs.set(taskName, { failed: true });
      continue;
    }
    const seconds = (endTime - startTime) / 1000;
    if (!(seconds >= 0)) throw new Error(`${label}: ${name}#${taskName} measured ${seconds}s`);
    legs.set(taskName, { seconds, cliArguments: task.cliArguments });
  }

  const samples = new Map();
  const skippedCached = [];
  const slices = new Map();
  for (const [name, legs] of legsByPackage) {
    const readings = [...legs.values()];
    // Cache wins over failure when both are present: either alone already
    // disqualifies the whole package, and `skippedCached` is what the merge
    // rule in buildDataset() reads as the witness for carrying a prior weight
    // forward -- a package skipped here for ANY reason including a failed
    // sibling leg still needs that witness if one of its legs was a HIT.
    if (readings.some((leg) => leg.cached)) {
      skippedCached.push(name);
      continue;
    }
    if (readings.some((leg) => leg.failed)) continue;
    let seconds = 0;
    let cliArguments;
    for (const leg of readings) {
      seconds += leg.seconds;
      cliArguments ??= leg.cliArguments;
    }
    samples.set(name, seconds);
    const slice = sliceOfCliArguments(cliArguments);
    if (slice) slices.set(name, slice);
  }
  return { samples, skippedCached, slices };
}

// The weight an unmeasured package gets: its test-file count times this rate.
//
// Re-derived from the dataset on every refresh rather than pinned, so the one
// number the partitioner falls back on cannot age independently of the numbers
// it was derived from. Median s/file over packages substantial enough for the
// ratio to mean something -- a 0.3s package with one test file would otherwise
// vote on the rate with pure startup noise.
export function fallbackRate(measured, fileCounts) {
  const rates = [];
  for (const [name, seconds] of measured) {
    const files = fileCounts.get(name) ?? 0;
    if (files >= 3 && seconds >= 1) rates.push(seconds / files);
  }
  if (rates.length === 0) {
    throw new Error(
      'fallback rate: no package had both >=3 test files and >=1s measured, so there is ' +
        'nothing to derive a per-file rate from. Refusing to guess one.'
    );
  }
  return Math.round(median(rates) * 1000) / 1000;
}

export function buildDataset({ perSummary, fileCounts, provenance, carryFrom = null }) {
  const bySample = new Map();
  const cachedNames = new Set();
  const push = (name, seconds) => {
    if (!bySample.has(name)) bySample.set(name, []);
    bySample.get(name).push(seconds);
  };

  // A file-sharded package (#16173) arrives as n partial windows across n
  // summaries, and the whole-package cost this dataset records is their SUM --
  // not their median, which is the rule for repeat measurements of one package
  // and would write 1/n of the truth here. So slices are held back and summed
  // per (run, package, slice count) set; the sum then enters the median pool as
  // ONE sample per run, which is exactly what an unsliced package contributes
  // per run, so the two rules compose instead of competing.
  //
  // ⛔ THE SUM IS ONLY MEANINGFUL WITHIN ONE RUN (#16473). The order is
  // load-bearing and there is only one correct one: SUM the slices a single run
  // produced, then MEDIAN those per-run sums across runs. Keyed by (package,
  // slice count, index) ALONE -- which is what this ledger used to be -- every
  // run collapses into one entry and BOTH halves break at once, silently:
  //
  //   * the innermost value is overwritten by each successive summary carrying
  //     that index, so the package takes whichever run was read LAST no matter
  //     how many are fed. Measured on three runs giving 400/600/1000s: 1000
  //     recorded, median 600. Every OTHER package in the same refresh gets its
  //     median, so the one package the slicing machinery exists for -- the
  //     heaviest suite in the workspace -- is the single least robust reading
  //     in the file, with no line of output saying so.
  //   * a set completed from slices of DIFFERENT runs is summed as though it
  //     were one measurement. Run B's 1/2=300 and 2/2=300 with run C's 1/2=500
  //     recorded 800s -- a duration no run observed -- and
  //     `skippedIncompleteSlices` stayed EMPTY, because from that ledger's point
  //     of view the set IS complete. It just is not from one run.
  //
  // Both are this file's own signature hazard (a wrong number that reads exactly
  // like a right one) surviving on the axis of WHICH RUN, on the package whose
  // mis-weighting killed a shard twelve times in a day.
  //
  // The grouping key comes from the CALLER, because a run summary carries no run
  // identifier to infer one from: the six artifacts of one CI run are named and
  // fetched together, so the caller is the only actor that knows which is which.
  // An entry with no `run` joins one implicit group -- correct for the ordinary
  // single-run refresh, which is what the scheduled workflow feeds -- and the
  // duplicate refusal below is what keeps that default honest when more than one
  // run is fed without declaring itself.
  const sliceLedger = new Map();
  for (const { samples, skippedCached, slices, run = null } of perSummary) {
    for (const n of skippedCached) cachedNames.add(n);
    for (const [name, seconds] of samples) {
      const slice = slices?.get(name) ?? null;
      if (!slice) {
        push(name, seconds);
        continue;
      }
      if (!sliceLedger.has(run)) sliceLedger.set(run, new Map());
      const byName = sliceLedger.get(run);
      if (!byName.has(name)) byName.set(name, new Map());
      const byCount = byName.get(name);
      if (!byCount.has(slice.count)) byCount.set(slice.count, new Map());
      const seen = byCount.get(slice.count);
      // ⛔ REFUSE, never take the last. One run runs each slice exactly once, so
      // a second window for the same (package, slice) means these summaries come
      // from different runs sharing one group -- which is the ambiguity that
      // produced both numbers above. Taking either value, or their sum, records
      // a weight assembled from runs that never happened together.
      if (seen.has(slice.index)) {
        throw new Error(
          `${name} slice ${slice.index}/${slice.count} was measured twice in ` +
            `${run === null ? 'this summary set' : `run ${run}`} (${seen.get(slice.index)}s and ` +
            `${seconds}s). A run runs each slice exactly once, so these summaries come from ` +
            'DIFFERENT runs. Group them with `--run <id>` before each run\'s summaries: slices ' +
            'are summed WITHIN a run and the per-run sums are medianed ACROSS runs. Refusing to ' +
            'pick one, which would record the last run read rather than a median (#16473).'
        );
      }
      seen.set(slice.index, seconds);
    }
  }

  // ⛔ An INCOMPLETE slice set is not summed, and completeness is judged WITHIN
  // ONE RUN. Summing 1 of 2 slices would record half a suite as the whole of it
  // -- a wrong number that reads exactly like a right one, which is the hazard
  // this file's cache rule already refuses in the other direction. Borrowing the
  // missing slice from ANOTHER run to complete the set is the same wrong number
  // wearing a complete set's clothes (#16473), so a run that cannot assemble the
  // package on its own contributes nothing rather than something spliced. The
  // package drops out of that run's sample and, if no run could assemble it, out
  // of `packages` entirely -- ESTIMATED from its test-file count like any
  // unmeasured package -- and every partial set is named, with its run, so a
  // refresh built on a partial artifact set is visible in the file rather than
  // inferred from the split going strange three weeks later.
  const incompleteSlices = [];
  for (const [run, byName] of sliceLedger) {
    for (const [name, byCount] of byName) {
      for (const [count, seen] of byCount) {
        if (seen.size === count) {
          push(name, [...seen.values()].reduce((a, b) => a + b, 0));
          continue;
        }
        const missing = [];
        for (let i = 1; i <= count; i++) if (!seen.has(i)) missing.push(`${i}/${count}`);
        incompleteSlices.push(
          run === null
            ? `${name} (missing ${missing.join(', ')})`
            : `${name} in run ${run} (missing ${missing.join(', ')})`
        );
      }
    }
  }
  incompleteSlices.sort((a, b) => a.localeCompare(b, 'en'));

  if (bySample.size === 0) {
    throw new Error(
      'every `test` task in these summaries was a cache hit, a failure or an incomplete slice ' +
        'set, so there is no measurement here -- re-run with a cold cache (or `--force`) before ' +
        'regenerating.'
    );
  }
  const measured = new Map(
    [...bySample.entries()].map(([name, values]) => [name, Math.round(median(values) * 100) / 100])
  );

  // ⛔ A CARRIED WEIGHT NEEDS A CACHE HIT AS ITS WITNESS. NOTHING ELSE CARRIES.
  //
  // Measured on the first two live runs of the refresh lane: NO set of retained
  // green runs measures the whole workspace. The best single run covered 52 of
  // the 71 packages the dataset holds, the accumulation of all seven converged
  // at 57, and the last 14 were turbo cache HITs in every one of them. That is
  // the cache design rather than luck -- the key is namespaced per shard and
  // only main pushes write it, so a package whose inputs have not changed is a
  // HIT, and this file refuses hits rather than recording a replayed ~0.1s
  // window as a suite's cost.
  //
  // So "regenerate" cannot mean "replace". It means MERGE, and the merge is
  // sound for one specific reason: a cache HIT is not missing data, it is
  // POSITIVE EVIDENCE that the package's inputs are unchanged since the run
  // whose output was replayed. Its last measured weight therefore still
  // describes it -- the number is not stale, and turbo is the witness. Carrying
  // it forward preserves this file's whole invariant: every number in it is a
  // real measurement of code as it stands, never an estimate.
  //
  // The witness requirement is what keeps that from becoming a licence to keep
  // anything. A package absent from the summaries for ANY OTHER reason -- it
  // never ran, its suite failed, its slices could not be assembled -- has no
  // evidence behind it, so it is NOT carried. It drops out and the caller's
  // coverage check names it. `skippedAsCached` is exactly the witnessed set, so
  // the carry reads it rather than inventing a second classification.
  const carriedOver = [];
  if (carryFrom) {
    for (const name of Object.keys(carryFrom).sort((a, b) => a.localeCompare(b, 'en'))) {
      if (measured.has(name)) continue;
      if (!cachedNames.has(name)) continue;
      const seconds = carryFrom[name];
      if (typeof seconds !== 'number' || !(seconds >= 0)) continue;
      measured.set(name, seconds);
      carriedOver.push(name);
    }
  }

  const packages = {};
  for (const name of [...measured.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
    packages[name] = measured.get(name);
  }
  return {
    note:
      'GENERATED by scripts/measure-test-shard-timings.mjs -- do not hand-edit. Per-package ' +
      '`turbo run test` durations in seconds, the balancing input for the Test Core shard ' +
      'split (scripts/partition-test-shards.mjs). See `provenance.refresh` to regenerate. ' +
      'Every weight is a real measurement: the ones in `carriedOver` were measured by an earlier ' +
      'refresh and re-confirmed unchanged by a turbo cache HIT in this one.',
    provenance,
    secondsPerTestFileFallback: fallbackRate(measured, fileCounts),
    packages,
    skippedAsCached: [...cachedNames].sort((a, b) => a.localeCompare(b, 'en')),
    skippedIncompleteSlices: incompleteSlices,
    // Beside `skippedAsCached` rather than folded into a per-package
    // `measuredAt`, and the choice is forced by the reader: partition-test-
    // shards.mjs reads `packages` as name -> NUMBER (`timings.packages[name] /
    // sliceCount`) and never opens `provenance` at all, so per-package dates
    // would mean changing that shape and every consumer of it. A single
    // `provenance.measuredAt` paired with this list carries the same
    // information and needs no change in the partitioner.
    carriedOver,
  };
}

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// `--self-test` reaching its verdict used to be this self-test's ONLY success
// condition, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number.
//
// This file's assertions are bare `throw`s rather than calls to an assertion
// helper, so they are counted by the `check(() => { ... })` THUNK PR #15198
// measured: the existing `if (...) throw ...` is carried into the thunk
// VERBATIM and the condition is never touched. Routing these through a boolean
// helper instead would mean inverting 22 failure conditions by hand, and a
// dropped `!` yields an assertion that still registers its case and still
// passes -- invisible to the very floor being installed here. The throw still
// propagates: this file fails fast on the FIRST broken assertion, as it always
// has.
//
// This file declares ONE battery, opened at the top of the self-test body. Its
// blocks are headed by unmarked prose comments -- it carries ZERO named section
// banners, fewer than the two the sectioning criterion needs, and a comment is
// NOT promoted to a section head (that is a judgement per comment this
// transplant does not make). The hoisted single battery is the shape PR #14896,
// PR #15003 and PR #15217 landed for exactly this case.
//
// The count is a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering, never to lower the number.
const SELF_TEST_BATTERIES = Object.freeze({
  'measure-test-shard-timings self-test': 56,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'measure-test-shard-timings self-test reached its verdict';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('measure-test-shard-timings self-test');
  // The thunk: it registers the case and then runs the existing site VERBATIM,
  // so no assertion condition is inverted or rewritten and the sink keeps its
  // own semantics. Registration happens whether or not the site fires, which is
  // what makes the count a floor on cases RUN rather than a count of failures.
  const check = (fn) => {
    registerCase();
    fn();
  };
  const summary = (tasks) => ({ tasks });
  const testTask = (pkg, start, end, status = 'MISS', exitCode = 0) => ({
    taskId: `${pkg}#test`,
    task: 'test',
    package: pkg,
    cache: { status },
    execution: { startTime: start, endTime: end, exitCode },
  });
  const testRepoTask = (pkg, start, end, status = 'MISS', exitCode = 0) => ({
    taskId: `${pkg}#test:repo`,
    task: 'test:repo',
    package: pkg,
    cache: { status },
    execution: { startTime: start, endTime: end, exitCode },
  });

  check(() => {
    if (median([3]) !== 3) throw new Error('median: single value');
  });
  check(() => {
    if (median([5, 1, 3]) !== 3) throw new Error('median: odd length is not order-dependent');
  });
  check(() => {
    if (median([1, 2, 3, 4]) !== 2.5) throw new Error('median: even length averages the middle pair');
  });

  // A build task in the same summary must not be read as a test duration.
  const mixed = samplesFromSummary(
    summary([
      testTask('a', 0, 2000),
      { taskId: 'a#build', task: 'build', package: 'a', cache: { status: 'MISS' }, execution: { startTime: 0, endTime: 9_000_000, exitCode: 0 } },
    ]),
    'f'
  );
  check(() => {
    if (mixed.samples.get('a') !== 2) throw new Error(`task filter: got ${mixed.samples.get('a')}`);
  });
  check(() => {
    if (mixed.samples.size !== 1) throw new Error('task filter: a non-test task was sampled');
  });

  // THE ONE THAT MATTERS: a cache HIT is skipped, never recorded as ~0s.
  // The control leg first -- a genuine 40ms MISS is a legitimate measurement,
  // so only the HIT/MISS pair below proves the skip is about the cache status
  // and not about the window being short.
  const shortMiss = samplesFromSummary(summary([testTask('a', 0, 40)]), 'f');
  check(() => {
    if (shortMiss.samples.get('a') !== 0.04) throw new Error('cache: a short MISS was not recorded');
  });
  const withHit = samplesFromSummary(summary([testTask('a', 0, 40, 'HIT'), testTask('b', 0, 60_000)]), 'f');
  check(() => {
    if (withHit.samples.has('a')) throw new Error('cache: a HIT was recorded as a measurement');
  });
  check(() => {
    if (!withHit.skippedCached.includes('a')) throw new Error('cache: a HIT was not reported as skipped');
  });
  check(() => {
    if (withHit.samples.get('b') !== 60) throw new Error('cache: the MISS beside it was lost');
  });

  // A failed suite stopped early; its window is not the package's cost.
  const failed = samplesFromSummary(summary([testTask('a', 0, 500, 'MISS', 1)]), 'f');
  check(() => {
    if (failed.samples.has('a')) throw new Error('exit: a failed suite was recorded as a duration');
  });

  // #16550: a two-task summary -- a split package's `test` and `test:repo`
  // legs are SUMMED into one whole-package reading, not either leg alone. The
  // un-split control (`ctl`, a plain `test`-only package in the SAME summary)
  // rides alongside it and must read exactly as it always has -- the
  // discriminating half of this case, since a probe that reads the same
  // before and after the fold would not catch a fold that leaked onto
  // packages it was never meant to touch.
  const twoTask = samplesFromSummary(
    summary([testTask('spec', 0, 400_000), testRepoTask('spec', 0, 53_900), testTask('ctl', 0, 12_000)]),
    'f'
  );
  check(() => {
    if (twoTask.samples.get('spec') !== 453.9) {
      throw new Error(`test:repo fold: expected the sum 453.9, got ${twoTask.samples.get('spec')}`);
    }
  });
  check(() => {
    if (twoTask.samples.get('ctl') !== 12) {
      throw new Error(`test:repo fold: the un-split control was disturbed (got ${twoTask.samples.get('ctl')})`);
    }
  });

  // Either leg cached skips the WHOLE package -- recording the other leg's
  // seconds alone would be a reading worse than the pre-#16550 undercount.
  const repoCached = samplesFromSummary(
    summary([testTask('spec', 0, 400_000), testRepoTask('spec', 0, 53_900, 'HIT')]),
    'f'
  );
  check(() => {
    if (repoCached.samples.has('spec')) {
      throw new Error(`test:repo fold: a cached test:repo leg did not skip the whole package (got ${repoCached.samples.get('spec')})`);
    }
  });
  check(() => {
    if (!repoCached.skippedCached.includes('spec')) {
      throw new Error('test:repo fold: a package with a cached test:repo leg was not reported as skipped');
    }
  });
  const testCached = samplesFromSummary(
    summary([testTask('spec', 0, 400_000, 'HIT'), testRepoTask('spec', 0, 53_900)]),
    'f'
  );
  check(() => {
    if (testCached.samples.has('spec')) {
      throw new Error(`test:repo fold: a cached test leg did not skip the whole package (got ${testCached.samples.get('spec')})`);
    }
  });

  // Either leg failed skips the WHOLE package, same as a lone `test` failure.
  const repoFailed = samplesFromSummary(
    summary([testTask('spec', 0, 400_000), testRepoTask('spec', 0, 53_900, 'MISS', 1)]),
    'f'
  );
  check(() => {
    if (repoFailed.samples.has('spec')) {
      throw new Error('test:repo fold: a failed test:repo leg did not skip the whole package');
    }
  });

  const threw = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  check(() => {
    if (!threw(() => samplesFromSummary({}, 'f'))) throw new Error('shape: a non-summary was accepted');
  });
  check(() => {
    if (!threw(() => samplesFromSummary(summary([{ task: 'test', package: '', cache: { status: 'MISS' } }]), 'f'))) {
      throw new Error('shape: a nameless test task was accepted');
    }
  });
  check(() => {
    if (!threw(() => samplesFromSummary(summary([{ task: 'test', package: 'a', cache: { status: 'MISS' } }]), 'f'))) {
      throw new Error('shape: a test task with no execution window was accepted');
    }
  });

  // Merging: the same package sampled by several shards collapses to its median.
  const merged = buildDataset({
    perSummary: [
      samplesFromSummary(summary([testTask('a', 0, 10_000), testTask('big', 0, 100_000)]), 'f'),
      samplesFromSummary(summary([testTask('a', 0, 30_000)]), 'g'),
      samplesFromSummary(summary([testTask('a', 0, 20_000)]), 'h'),
    ],
    fileCounts: new Map([['a', 10], ['big', 50]]),
    provenance: { measuredAt: 'test' },
  });
  check(() => {
    if (merged.packages.a !== 20) throw new Error(`merge: expected the median 20, got ${merged.packages.a}`);
  });
  // rates: a -> 20/10 = 2, big -> 100/50 = 2  => 2
  check(() => {
    if (merged.secondsPerTestFileFallback !== 2) {
      throw new Error(`fallback rate: got ${merged.secondsPerTestFileFallback}`);
    }
  });
  // Packages too small to vote on the rate are excluded from it but still kept.
  const tiny = buildDataset({
    perSummary: [samplesFromSummary(summary([testTask('a', 0, 10_000), testTask('t', 0, 300)]), 'f')],
    fileCounts: new Map([['a', 5], ['t', 1]]),
    provenance: {},
  });
  check(() => {
    if (tiny.secondsPerTestFileFallback !== 2) throw new Error(`rate: a 0.3s/1-file package voted (${tiny.secondsPerTestFileFallback})`);
  });
  check(() => {
    if (tiny.packages.t !== 0.3) throw new Error('rate: the small package was dropped from the dataset');
  });

  check(() => {
    if (!threw(() =>
      buildDataset({
        perSummary: [samplesFromSummary(summary([testTask('a', 0, 40, 'HIT')]), 'f')],
        fileCounts: new Map(),
        provenance: {},
      })
    )) {
      throw new Error('an all-cached run produced a dataset instead of refusing');
    }
  });

  // File-level slices (#16173): a package the Test Core matrix shards below
  // package granularity arrives as n partial windows, and the WHOLE cost this
  // dataset records is their sum. Every case below fails in the same direction
  // if the reassembly is dropped -- the heaviest package in the workspace
  // recorded at 1/n of its real weight, which is #16173 again.
  const slicedTask = (pkg, start, end, index, count) => ({
    ...testTask(pkg, start, end),
    cliArguments: [`--shard=${index}/${count}`],
  });

  check(() => {
    if (sliceOfCliArguments(undefined) !== null || sliceOfCliArguments([]) !== null) {
      throw new Error('slice: a run with no passthrough argv was read as a slice');
    }
  });
  check(() => {
    if (sliceOfCliArguments(['--log-order=stream']) !== null) {
      throw new Error('slice: an unrelated passthrough argument was read as a slice');
    }
  });
  check(() => {
    const s = sliceOfCliArguments(['--shard=2/3']);
    if (!s || s.index !== 2 || s.count !== 3) throw new Error(`slice: parsed as ${JSON.stringify(s)}`);
  });
  check(() => {
    if (!threw(() => sliceOfCliArguments(['--shard=3/2']))) {
      throw new Error('slice: an impossible slice spec was accepted');
    }
  });
  check(() => {
    const { slices } = samplesFromSummary(summary([slicedTask('cli', 0, 400_000, 1, 3)]), 'f');
    const s = slices.get('cli');
    if (!s || s.index !== 1 || s.count !== 3) throw new Error('slice: samplesFromSummary did not record the slice');
  });
  check(() => {
    const { slices } = samplesFromSummary(summary([testTask('a', 0, 10_000)]), 'f');
    if (slices.size !== 0) throw new Error('slice: a whole-package task was recorded as a slice');
  });

  // The load-bearing case: three slices of 400s are ONE 1200s package, not a
  // 400s one. Median across the three windows -- the rule for repeat
  // measurements -- would answer 400.
  const sliced = buildDataset({
    perSummary: [
      samplesFromSummary(summary([slicedTask('cli', 0, 400_000, 1, 3)]), 'f'),
      samplesFromSummary(summary([slicedTask('cli', 0, 380_000, 2, 3)]), 'g'),
      samplesFromSummary(summary([slicedTask('cli', 0, 420_000, 3, 3), testTask('a', 0, 10_000)]), 'h'),
    ],
    fileCounts: new Map([['cli', 300], ['a', 5]]),
    provenance: {},
  });
  check(() => {
    if (sliced.packages.cli !== 1200) {
      throw new Error(`slice: three 400s-ish slices summed to ${sliced.packages.cli}, expected 1200`);
    }
  });
  check(() => {
    if (sliced.skippedIncompleteSlices.length !== 0) {
      throw new Error(`slice: a complete set was reported incomplete (${sliced.skippedIncompleteSlices.join('; ')})`);
    }
  });
  check(() => {
    if (sliced.packages.a !== 10) throw new Error('slice: an unsliced package in the same set was disturbed');
  });

  // A partial artifact set -- one shard's summary missing, or its slice a cache
  // hit -- must NOT be summed. The package drops out and says so.
  const partial = buildDataset({
    perSummary: [
      samplesFromSummary(summary([slicedTask('cli', 0, 400_000, 1, 3)]), 'f'),
      samplesFromSummary(summary([slicedTask('cli', 0, 420_000, 3, 3), testTask('a', 0, 10_000)]), 'h'),
    ],
    fileCounts: new Map([['cli', 300], ['a', 5]]),
    provenance: {},
  });
  check(() => {
    if (Object.hasOwn(partial.packages, 'cli')) {
      throw new Error(`slice: 2 of 3 slices were recorded as a weight (${partial.packages.cli})`);
    }
  });
  check(() => {
    if (!partial.skippedIncompleteSlices.some((s) => s.includes('cli') && s.includes('2/3'))) {
      throw new Error(`slice: the incomplete set was not named (${partial.skippedIncompleteSlices.join('; ')})`);
    }
  });

  // One run's two slices sum to the whole package. This is the SUM half only --
  // it says nothing about the median half, which is what the block below pins.
  const oneRunTwoSlices = buildDataset({
    perSummary: [
      samplesFromSummary(summary([slicedTask('cli', 0, 500_000, 1, 2)]), 'r1a'),
      samplesFromSummary(summary([slicedTask('cli', 0, 500_000, 2, 2)]), 'r1b'),
      samplesFromSummary(summary([testTask('a', 0, 10_000)]), 'r1c'),
    ],
    fileCounts: new Map([['cli', 300], ['a', 5]]),
    provenance: {},
  });
  check(() => {
    if (oneRunTwoSlices.packages.cli !== 1000) {
      throw new Error(`slice: a 2-slice set summed to ${oneRunTwoSlices.packages.cli}, expected 1000`);
    }
  });

  // The two merge rules COMPOSE, and in one order only (#16473): sum the slices
  // WITHIN a run, then median those per-run sums ACROSS runs. Every case below
  // failed before the ledger was keyed by run, and each fails in a different
  // direction, so none of them can be satisfied by accident:
  //
  //   * the sliced median: last-wins answered 1000 where the median is 600
  //   * the control: proves the median rule was alive the whole time, so the
  //     sliced path alone was bypassing it -- without this leg a broken median
  //     would look like a broken slice rule
  //   * the splice: 800s assembled from two different runs, with the file's own
  //     `skippedIncompleteSlices` guard silent because the set looked complete
  //   * the refusal: the guard that makes the UNDECLARED default safe, so the
  //     ordinary single-run call needs no ceremony and a multi-run one cannot
  //     quietly do the wrong thing
  const fromRun = (run, tasks, label) => ({ ...samplesFromSummary(summary(tasks), label), run });

  // Three runs of a 2-way sliced package: 200+200, 300+300, 500+500 -> the runs
  // measured 400, 600 and 1000s, so the package's weight is the median 600. The
  // unsliced control rides in the same dataset, fed 100/300/500 across the same
  // three runs, and must answer its own median 300.
  const threeRuns = buildDataset({
    perSummary: [
      fromRun('A', [slicedTask('cli', 0, 200_000, 1, 2)], 'a1'),
      fromRun('A', [slicedTask('cli', 0, 200_000, 2, 2), testTask('ctl', 0, 100_000)], 'a2'),
      fromRun('B', [slicedTask('cli', 0, 300_000, 1, 2)], 'b1'),
      fromRun('B', [slicedTask('cli', 0, 300_000, 2, 2), testTask('ctl', 0, 300_000)], 'b2'),
      fromRun('C', [slicedTask('cli', 0, 500_000, 1, 2)], 'c1'),
      fromRun('C', [slicedTask('cli', 0, 500_000, 2, 2), testTask('ctl', 0, 500_000)], 'c2'),
    ],
    fileCounts: new Map([['cli', 300], ['ctl', 100]]),
    provenance: {},
  });
  check(() => {
    if (threeRuns.packages.cli !== 600) {
      throw new Error(
        `slice: three runs measuring 400/600/1000s recorded ${threeRuns.packages.cli}, expected the ` +
          'median 600 (1000 is the last run read -- the #16473 last-wins ledger)'
      );
    }
  });
  check(() => {
    if (threeRuns.packages.ctl !== 300) {
      throw new Error(
        `slice: the unsliced control recorded ${threeRuns.packages.ctl}, expected its median 300 -- ` +
          'the median rule itself is broken, not just the sliced path'
      );
    }
  });
  check(() => {
    if (threeRuns.skippedIncompleteSlices.length !== 0) {
      throw new Error(
        `slice: every run assembled a complete set, but ${threeRuns.skippedIncompleteSlices.join('; ')} ` +
          'was reported incomplete'
      );
    }
  });

  // The cross-run splice. Run B is complete (300+300); run C fed only 1/2. The
  // ledger must NOT reach into run B for run C's missing slice: the answer is
  // run B's 600 alone, and run C is named as the partial set it is. Keyed
  // without a run this recorded 800s -- a duration no run observed -- and named
  // nothing.
  const spliced = buildDataset({
    perSummary: [
      fromRun('B', [slicedTask('cli', 0, 300_000, 1, 2)], 'b1'),
      fromRun('B', [slicedTask('cli', 0, 300_000, 2, 2)], 'b2'),
      fromRun('C', [slicedTask('cli', 0, 500_000, 1, 2), testTask('ctl', 0, 10_000)], 'c1'),
    ],
    fileCounts: new Map([['cli', 300], ['ctl', 100]]),
    provenance: {},
  });
  check(() => {
    if (spliced.packages.cli !== 600) {
      throw new Error(
        `slice: a set completed ACROSS runs recorded ${spliced.packages.cli}, expected run B's own 600 ` +
          '(800 is B 1/2 + B 2/2 + C 1/2 spliced -- a weight no run measured)'
      );
    }
  });
  check(() => {
    if (!spliced.skippedIncompleteSlices.some((s) => s.includes('cli') && s.includes('run C') && s.includes('2/2'))) {
      throw new Error(
        'slice: run C could not assemble the package and was not named in skippedIncompleteSlices ' +
          `(${spliced.skippedIncompleteSlices.join('; ') || 'empty'})`
      );
    }
  });

  // The refusal that makes the undeclared default honest. Two runs' slices fed
  // as one group is not resolvable -- the summaries carry no run id of their own
  // -- so it is a named error, never the last value read.
  check(() => {
    if (!threw(() =>
      buildDataset({
        perSummary: [
          samplesFromSummary(summary([slicedTask('cli', 0, 300_000, 1, 2)]), 'x1'),
          samplesFromSummary(summary([slicedTask('cli', 0, 500_000, 1, 2)]), 'x2'),
        ],
        fileCounts: new Map([['cli', 300]]),
        provenance: {},
      })
    )) {
      throw new Error('slice: two runs fed as one group were resolved by last-wins instead of refused');
    }
  });
  check(() => {
    let message = '';
    try {
      buildDataset({
        perSummary: [
          samplesFromSummary(summary([slicedTask('cli', 0, 300_000, 2, 2)]), 'x1'),
          samplesFromSummary(summary([slicedTask('cli', 0, 500_000, 2, 2)]), 'x2'),
        ],
        fileCounts: new Map([['cli', 300]]),
        provenance: {},
      });
    } catch (error) {
      message = String(error?.message ?? '');
    }
    // The remedy has to be IN the refusal: a caller who hits this is holding
    // several runs' artifacts and needs to be told the flag, not just told no.
    if (!message.includes('--run') || !message.includes('cli slice 2/2')) {
      throw new Error(`slice: the duplicate-slice refusal does not name the slice and the remedy (${message})`);
    }
  });

  // The MERGE, and the witness rule that bounds it (#16464). No retained run set
  // measures the whole workspace, so a refresh that REPLACED the dataset would
  // demote every cache-hit package to a test-file-count estimate. Carrying is
  // sound only because a cache HIT is evidence the package is unchanged, so the
  // cases below pin the carry AND its boundary: what has a witness carries, what
  // does not is simply absent for the caller to name.
  const priorDataset = { a: 10, cached: 500, vanished: 700 };
  const mergeSummary = summary([
    testTask('a', 0, 12_000),
    { taskId: 'cached#test', task: 'test', package: 'cached', cache: { status: 'HIT' }, execution: { startTime: 0, endTime: 90, exitCode: 0 } },
  ]);
  const mergedSet = buildDataset({
    perSummary: [samplesFromSummary(mergeSummary, 'm')],
    fileCounts: new Map([['a', 6], ['cached', 250], ['vanished', 300]]),
    provenance: {},
    carryFrom: priorDataset,
  });

  // 1. A CARRIED package: weight unchanged, and named.
  check(() => {
    if (mergedSet.packages.cached !== 500) {
      throw new Error(`merge: a cache-hit package was not carried at its previous weight (got ${mergedSet.packages.cached}, expected 500)`);
    }
  });
  check(() => {
    if (!mergedSet.carriedOver.includes('cached')) {
      throw new Error(`merge: the carried package was not named in carriedOver (${mergedSet.carriedOver.join(', ') || 'empty'})`);
    }
  });
  // 2. A freshly MEASURED package takes the new number, and is NOT called carried.
  check(() => {
    if (mergedSet.packages.a !== 12) throw new Error(`merge: a measured package did not take its new weight (${mergedSet.packages.a})`);
  });
  check(() => {
    if (mergedSet.carriedOver.includes('a')) throw new Error('merge: a package measured in this pass was reported as carried');
  });
  // 3. HIT-WITNESSED CARRY versus ABSENT: `vanished` is in the prior dataset but
  //    appears in NO summary, so nothing witnesses that it is unchanged. It must
  //    NOT be carried — this is the case that separates a merge from "keep
  //    whatever was there", and without it the carry would launder a stale
  //    number for a package that may have been deleted, renamed, or gone red.
  check(() => {
    if (Object.hasOwn(mergedSet.packages, 'vanished')) {
      throw new Error(`merge: a package with no cache-hit witness was carried anyway (${mergedSet.packages.vanished})`);
    }
  });
  check(() => {
    if (mergedSet.carriedOver.includes('vanished')) throw new Error('merge: an unwitnessed package was named as carried');
  });
  // 4. No carryFrom at all is the plain replace, and reports an empty list
  //    rather than omitting the field — an absent key and "nothing was carried"
  //    must not read the same way to the caller's coverage check.
  check(() => {
    const plain = buildDataset({
      perSummary: [samplesFromSummary(mergeSummary, 'm')],
      fileCounts: new Map([['a', 6]]),
      provenance: {},
    });
    if (!Array.isArray(plain.carriedOver) || plain.carriedOver.length !== 0) {
      throw new Error(`merge: a run with no --merge-into did not report an empty carriedOver (${JSON.stringify(plain.carriedOver)})`);
    }
  });
  // 5. The merge does NOT rescue a run that measured nothing: an all-cached pass
  //    still refuses, so "everything carried" can never masquerade as a refresh.
  check(() => {
    if (!threw(() =>
      buildDataset({
        perSummary: [samplesFromSummary(summary([testTask('a', 0, 40, 'HIT')]), 'f')],
        fileCounts: new Map([['a', 6]]),
        provenance: {},
        carryFrom: priorDataset,
      })
    )) {
      throw new Error('merge: a pass that measured NOTHING produced a dataset out of carried weights alone');
    }
  });
  // 6. MONOTONE ACCUMULATION: feeding a second run measures more, and a package
  //    measured by the newer run stops being carried and takes its real number.
  check(() => {
    const oneRun = buildDataset({
      perSummary: [{ ...samplesFromSummary(mergeSummary, 'm'), run: 'r1' }],
      fileCounts: new Map([['a', 6], ['cached', 250]]),
      provenance: {},
      carryFrom: priorDataset,
    });
    const twoRuns = buildDataset({
      perSummary: [
        { ...samplesFromSummary(mergeSummary, 'm'), run: 'r1' },
        { ...samplesFromSummary(summary([testTask('cached', 0, 480_000)]), 'n'), run: 'r2' },
      ],
      fileCounts: new Map([['a', 6], ['cached', 250]]),
      provenance: {},
      carryFrom: priorDataset,
    });
    if (oneRun.carriedOver.length !== 1 || twoRuns.carriedOver.length !== 0) {
      throw new Error(
        `merge: accumulation is not monotone — one run carried ${oneRun.carriedOver.length}, two carried ${twoRuns.carriedOver.length} (expected 1 then 0)`
      );
    }
    if (twoRuns.packages.cached !== 480) {
      throw new Error(`merge: the second run measured the package but it kept its carried weight (${twoRuns.packages.cached})`);
    }
  });

  // Workspace resolution, at the depth that actually caught a defect. A
  // one-level scan resolves `packages/*` and returns null for the ~60% of the
  // workspace that lives under `packages/drivers/*`, `packages/services/*` and
  // seven more roots -- silently, as "this package has no test files", which
  // then skews the fallback rate toward whichever half sits at depth 1.
  const nested = packageDirForName('@objectstack/driver-turso');
  check(() => {
    if (nested === null) throw new Error('workspace: a package nested under packages/drivers/ did not resolve');
  });
  check(() => {
    if (path.relative(REPO_ROOT, nested).split(path.sep).length < 3) {
      throw new Error(`workspace: expected a nested path, got ${nested}`);
    }
  });
  check(() => {
    if (countTestFiles(nested) === 0) throw new Error('workspace: the resolved nested package reports no test files');
  });
  const flat = packageDirForName('@objectstack/spec');
  check(() => {
    if (flat === null || path.basename(flat) !== 'spec') throw new Error('workspace: a depth-1 package stopped resolving');
  });

  // -- The floor: every declared battery RAN, and ran its cases (#13489) ----
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered cases EQUALS the set declared. A set difference
  // names WHICH battery stopped; a count says only that something did.
  //
  // It THROWS rather than collecting into a `failures` array because that is
  // how every other assertion in this file reports: the dispatch below turns an
  // unfinished self-test into a non-zero exit, and a floor breach is exactly
  // that -- a self-test that did not run what it claims to run.
  const floorFailures = [];
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} -- a battery deleted from the roster takes its own floor with it.`
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorFailures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES -- a case attributed to no declared battery is one nothing floors.'
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} -- cases that used to run no longer do.`
    );
  }
  if (floorFailures.length > 0) {
    throw new Error(
      `measure-test-shard-timings self-test floor (${floorFailures.length} breach(es)):\n` +
        floorFailures.map((f) => `  - ${f}`).join('\n') +
        '\n  A battery at or below its floor means cases STOPPED RUNNING -- the battery is the bug, ' +
        'not the number. Find what stopped registering (an early return, a deleted block, a guard ' +
        'that now skips) and restore it.'
    );
  }

  console.log('measure-test-shard-timings: self-test OK');

  return SELF_TEST_VERDICT;
}

// Resolve a package name to its directory, so the fallback rate can be derived
// from a run summary alone -- no `turbo ls` document alongside, and no
// dependency on the cwd the script is called from.
//
// The scan RECURSES rather than reading one level under each root, because the
// workspace is two deep in most of it: pnpm-workspace.yaml lists `packages/*`
// alongside `packages/drivers/*`, `packages/services/*`, `packages/plugins/*`
// and six more. A one-level scan finds 28 of the ~75 packages and silently
// resolves the rest to null -- which here means "no test-file count", which
// means those packages drop out of the median the fallback rate is derived
// from. Wrong rate, no error, and it would skew toward whichever half of the
// workspace happens to sit at depth 1.
const SCAN_SKIP = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next', 'templates']);
let workspaceDirs = null;
function indexWorkspace(dir, into, depth = 0) {
  if (depth > 3) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const pkgJson = path.join(dir, 'package.json');
  if (depth > 0 && existsSync(pkgJson)) {
    try {
      const parsed = JSON.parse(readFileSync(pkgJson, 'utf8'));
      if (typeof parsed.name === 'string' && !into.has(parsed.name)) into.set(parsed.name, dir);
    } catch {
      // a package.json we cannot parse simply contributes no directory
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !SCAN_SKIP.has(entry.name) && !entry.name.startsWith('.')) {
      indexWorkspace(path.join(dir, entry.name), into, depth + 1);
    }
  }
}
function packageDirForName(name) {
  if (workspaceDirs === null) {
    workspaceDirs = new Map();
    for (const root of ['packages', 'apps', 'examples']) {
      indexWorkspace(path.join(REPO_ROOT, root), workspaceDirs);
    }
  }
  return workspaceDirs.get(name) ?? null;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ measure-test-shard-timings self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }
  let out = DEFAULT_OUT;
  let mergeInto = null;
  // Each input carries the run it belongs to (#16473). `--run <id>` opens a
  // group and every summary AFTER it belongs to that run, so one CI run's six
  // artifacts are named together the way they are fetched together. Summaries
  // before any `--run` share one implicit group, which is the ordinary
  // single-run refresh; feeding two runs that way is not silently averaged or
  // last-won, it is refused by buildDataset with `--run` named as the remedy.
  const inputs = [];
  let currentRun = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = path.resolve(argv[++i]);
    else if (argv[i] === '--merge-into') {
      const value = argv[++i];
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
        throw new Error('--merge-into needs the path of the dataset to carry unchanged weights from');
      }
      mergeInto = path.resolve(value);
    } else if (argv[i] === '--run') {
      const value = argv[++i];
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
        throw new Error('--run needs a run identifier (the id of the CI run whose summaries follow it)');
      }
      currentRun = value;
    } else if (argv[i].startsWith('--')) throw new Error(`unrecognized argument: ${argv[i]}`);
    else inputs.push({ file: argv[i], run: currentRun });
  }
  if (inputs.length === 0) {
    console.error(
      'usage: measure-test-shard-timings.mjs [--run <id>] <run-summary.json>... ' +
        '[--merge-into <dataset>] [--out <path>]'
    );
    process.exit(1);
  }

  const perSummary = [];
  for (const { file, run } of inputs) {
    perSummary.push({ ...samplesFromSummary(JSON.parse(readFileSync(file, 'utf8')), file), run });
  }

  // The prior dataset, when a merge was asked for. Read before the file counts,
  // because a carried package needs a count too -- it votes on the fallback rate
  // exactly like a freshly measured one, which is what keeps that rate derived
  // from the numbers actually in the file rather than from a subset of them.
  let carryFrom = null;
  if (mergeInto !== null) {
    const prior = JSON.parse(readFileSync(mergeInto, 'utf8'));
    if (!prior || typeof prior.packages !== 'object' || prior.packages === null) {
      throw new Error(
        `--merge-into ${path.relative(REPO_ROOT, mergeInto)}: expected a dataset with a {packages:{...}} ` +
          'map to carry unchanged weights from. Refusing to merge into a shape this did not write.'
      );
    }
    carryFrom = prior.packages;
  }

  const fileCounts = new Map();
  const needCount = new Set();
  for (const { samples } of perSummary) for (const name of samples.keys()) needCount.add(name);
  if (carryFrom) for (const name of Object.keys(carryFrom)) needCount.add(name);
  for (const name of needCount) {
    const dir = packageDirForName(name);
    fileCounts.set(name, dir ? countTestFiles(dir) : 0);
  }

  const declaredRuns = [...new Set(inputs.map((i) => i.run).filter((r) => r !== null))];
  const dataset = buildDataset({
    perSummary,
    fileCounts,
    carryFrom,
    provenance: {
      measuredAt: new Date().toISOString().slice(0, 10),
      summaries: inputs.map((i) => path.basename(i.file)),
      ...(declaredRuns.length > 0 ? { runs: declaredRuns } : {}),
      // Stated as the two composed rules it actually is (#16473). "median across
      // summaries" was true only of unsliced packages: a file-sharded package's
      // summaries are PARTS of one measurement, not repeats of it, so they are
      // summed within their run first and only the per-run sums are medianed.
      mergeRule:
        'median across runs; a file-sharded package is summed from its slices WITHIN one run ' +
        'first, and a run that cannot assemble every slice contributes no sample for it; a package ' +
        'not measured in this pass keeps its previous weight ONLY when a turbo cache HIT witnesses ' +
        'that its inputs are unchanged, and every such package is named in `carriedOver`',
      // `measuredAt` is the date of THIS pass, and it dates the measured
      // weights. The carried ones were measured earlier and re-confirmed
      // unchanged by a cache HIT today; `carriedOver` names them, which is why a
      // single date is enough and per-package dates are not needed. See the note
      // on `carriedOver` in buildDataset for why the reader forces that choice.
      refresh:
        'node scripts/measure-test-shard-timings.mjs [--run <id>] <run-summary.json>... ' +
        '--merge-into scripts/test-shard-timings.json --out scripts/test-shard-timings.json ' +
        '(summaries: the `test-core-run-summary-<n>-of-6` artifacts of any green run, or a local ' +
        '`pnpm exec turbo run test --concurrency=4 --summarize`. ⚠ ONE RUN COVERS ONLY 2-52 of ~71 ' +
        'packages depending on cache warmth, so feed SEVERAL runs -- a `--run <id>` before each ' +
        'run\'s summaries is REQUIRED, so a sliced package is assembled per run and then medianed ' +
        'like every other package -- and `--merge-into` to carry the cache-hit remainder. ' +
        '`.github/workflows/shard-timings-refresh.yml` does all of this weekly.)',
    },
  });
  writeFileSync(out, `${JSON.stringify(dataset, null, 2)}\n`);
  const n = Object.keys(dataset.packages).length;
  const total = Object.values(dataset.packages).reduce((a, b) => a + b, 0);
  console.error(
    `measure-test-shard-timings: ${n} package(s), ${total.toFixed(1)}s total, ` +
      `fallback ${dataset.secondsPerTestFileFallback}s/test-file, ` +
      `${dataset.skippedAsCached.length} skipped as cached -> ${path.relative(REPO_ROOT, out)}`
  );
  // Loud, and on stderr beside the summary line: a file-sharded package that
  // lost a slice is now ESTIMATED rather than measured, and it is the heaviest
  // package in the workspace that this can happen to. Silence here would let a
  // refresh built on five of six artifacts read like a complete one.
  if (dataset.skippedIncompleteSlices.length > 0) {
    console.error(
      `measure-test-shard-timings: ⚠ ${dataset.skippedIncompleteSlices.length} package(s) reported an ` +
        'INCOMPLETE set of file-level slices and were left unmeasured (they fall back to the ' +
        `test-file-count estimate): ${dataset.skippedIncompleteSlices.join('; ')}. Feed every shard's ` +
        'summary from ONE green run before trusting this dataset.'
    );
  }
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
