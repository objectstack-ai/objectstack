#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// partition-test-shards -- deterministic, load-balanced split of a `turbo ls`
// package list across the Test Core shard matrix (ci.yml).
//
// Test Core shards BY PACKAGE, not by vitest --shard passthrough, on purpose.
// The dogfood job's file-level sharding works because dogfood is ONE package
// with ~60 test files; applied across the whole workspace it breaks on every
// package with fewer test files than the shard count. Verified on vitest
// 4.1.10 with a 1-file package: `--shard=1/2` AND `--shard=2/2` both fail with
// "--shard <count> must be a smaller than count of test files" -- and adding
// `--passWithNoTests` converts that error into exit 0 with NO files run on
// EITHER shard. Three workspace packages have exactly one test file today, so
// the passthrough route is a silent-coverage-loss machine, not an option.
//
// Each package's weight is its MEASURED `turbo run test` duration, in seconds,
// read from scripts/test-shard-timings.json. Packages are placed heaviest-first
// into the lightest bin (LPT greedy), with all ties broken by name, so every
// shard computes the identical split from the same input without coordinating.
//
// ── WHY NOT TEST-FILE COUNT, WHICH THIS USED TO WEIGH (#10472) ─────────────
//
// The old weight was each package's test-file count, on the theory that fixed
// per-file cost dominates so file count tracks duration. Measured against real
// queue builds, that proxy holds to about +-20% on most packages and is off by
// ~2.8x on ONE of them:
//
//   @objectstack/cli                135 files   548.6s / 474.4s   ~3.5-4.1 s/file
//   @objectstack/spec               414 files   496.4s            ~1.20 s/file
//   @objectstack/service-automation  83 files   118.9s            ~1.43 s/file
//   @objectstack/driver-turso        39 files    53.5s            ~1.37 s/file
//   @objectstack/client              24 files    34.7s            ~1.45 s/file
//   @objectstack/example-showcase    21 files    21.6s            ~1.03 s/file
//
// LPT cannot correct an input that wrong, and the bins were never the defect:
// on a full package list the six file-count bins came out within a file or two
// of each other, and the SAME six shards ran 5.0/6.2/6.3/13.6/6.3/9.0 minutes
// in run 32428961038 -- a 2.7x spread, with one shard setting the whole
// workflow's 14.7-minute wall. An algorithm that balances perfectly is exactly
// as unbalanced as the quantity it is handed.
//
// So the quantity handed to it is now the duration itself. The dataset is
// GENERATED, never hand-written -- see scripts/measure-test-shard-timings.mjs
// for the two refresh paths and for why a cached (replayed) task is refused
// rather than recorded as a ~0s weight.
//
// ⛔ THE HARD LIMIT THAT SURVIVES THE RE-WEIGHTING, AND BOUNDS THE SHARD COUNT.
// Sharding is BY PACKAGE, so a shard can never finish faster than its single
// heaviest package. That floor does not move when the weights get better; what
// moves is that the split now RESPECTS it instead of blundering into it.
// Measured, so it is not a theoretical bound: in run 32352993803 Test Core
// shard 1 took 8m17.77s wall and @objectstack/spec's own suite accounted for
// 8m16.4s of it -- the shard IS that one package. Only splitting such a suite
// below package granularity moves that number (#10149, and #4859's "slowest
// shard <= ~7min" line is still under it for exactly this reason). Raising the
// shard count lowers the mean while that floor stays exactly where it is, so
// past a point MORE shards make the max/mean ratio WORSE, not better. And the
// ratio is what the acceptance bound is written in, so "add shards until it
// balances" is not merely ineffective here -- it moves the number the wrong
// way while looking like progress. #10472 asked for 6 -> 8
// to be considered and the measured answer was no -- see SHARD_COUNT below,
// where the self-test now pins that arithmetic so the next person gets the
// answer from a failing assertion instead of from a CI run.
//
// Run-to-run variance is a SEPARATE and equally large effect, and it is not
// placement: this job's Turbo cache key is namespaced per shard
// (`...-turbo-<job>-<matrix.shard>-...`) and only main `push` runs write it, so
// each shard's cache ages independently. Measured legs of the same shard index
// ranged from 79/79 tasks cached (866ms, ">>> FULL TURBO") to 0/85 cached
// (10m08s). A single build's shard spread therefore says nothing about
// placement on its own -- compare legs at the same cache state or not at all.
//
// Usage:
//   node scripts/partition-test-shards.mjs <turbo-ls.json> --shard N/M \
//     [--exclude <pkg>]...
//   node scripts/partition-test-shards.mjs --check-drift <run-summary.json>... \
//     [--label <text>]
//   node scripts/partition-test-shards.mjs --self-test
//
// `--check-drift` is the half that keeps the dataset honest AFTER it is
// written (#16173). Every Test Core shard already passes `--summarize`, so the
// run it just finished has written the measured truth to `.turbo/runs/`; this
// mode reads that back, compares it to what this script PREDICTED for the same
// packages, and reds past MAX_MEASURED_OVER_PREDICTED. Without it the dataset
// rots silently in one direction and the only instrument that notices is a
// shard killed by the job timeout -- which is a shard that produced NO reading
// while the rollup read green.
//
// The weight dataset is scripts/test-shard-timings.json, regenerated by
// scripts/measure-test-shard-timings.mjs. It is required, not optional: this
// script refuses to shard rather than fall back to the old file-count proxy.
//
// <turbo-ls.json> is the output of `turbo ls [--affected] --output=json`
// (shape: {packages:{count,items:[{name,path}]}}; `turbo ls` is marked
// experimental, so the payload is asserted loudly in readPackageItems() below
// rather than defaulted around).
// Prints the selected shard's package names, one per line -- possibly zero
// lines, which the caller must treat as "nothing to run", NOT as "no filter":
// a `turbo run test` with no --filter args runs the entire workspace.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';
import { samplesFromSummary } from './measure-test-shard-timings.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMINGS_PATH = path.join(REPO_ROOT, 'scripts', 'test-shard-timings.json');

// The Test Core shard count, and the ONLY place it is reasoned about.
// ci.yml spells it three more times (the matrix, the `name:`, and `--shard
// N/6`); the self-test below reads that workflow back and fails on drift,
// because a partitioner splitting into a different number of bins than the
// matrix declares is not a red step anywhere -- it is packages that no shard
// runs.
export const SHARD_COUNT = 6;

// The acceptance bound #10472 set: the slowest shard within ~1.3x the mean.
// It is a RATIO, not a wall-clock target, which is what makes it stable as the
// suite grows -- and what makes "just add more shards" the wrong reflex, since
// more shards shrink the denominator while the heaviest package holds the
// numerator up.
export const MAX_SHARD_OVER_MEAN = 1.3;

// The factor a shard's MEASURED test total may exceed its PREDICTED total by
// before `--check-drift` reds. The durable half of #16173.
//
// Everything above balances a GENERATED dataset, and a generated file that
// nothing re-measures rots in one direction only: suites get slower, the
// numbers stay put, and the shard that drifted heavy reads as perfectly
// balanced on paper right up until the job timeout kills it. That is not a
// hypothesis. The reading this bound is written against, from run 34009395649
// attempt 2 (job 101422473016 is the attempt-1 leg that was killed):
//
//   @objectstack/cli   predicted 458.15s   measured 1231.52s   = 2.69x
//
// -- one package, 68% of a 30-minute wall, on a shard the previous attempt had
// already lost at 30m05s. Every step was green; the split's own max/mean read
// 1.00x, because a perfectly balanced split of stale numbers is still perfectly
// balanced. Nothing in this repo compared a prediction to an outcome, so the
// only instrument that ever noticed was a killed job.
//
// 1.5 is the smallest round factor satisfying both ends:
//
//   - it must fire well below the 2.69x measured above, or the gate would have
//     been green straight through the incident it exists to catch;
//   - it must sit ABOVE MAX_SHARD_OVER_MEAN, because a dataset accurate to
//     within the balance bound cannot be the thing that breaks balance. Gating
//     tighter than the split's own tolerance reds on drift the partitioner is
//     built to absorb, and a gate that reds on healthy input gets muted.
export const MAX_MEASURED_OVER_PREDICTED = 1.5;

// Where a `packages.items[].path` actually points.
//
// The document has two writers -- `turbo ls`, which emits repo-relative paths,
// and `--union-into` in check-cross-package-test-inputs.mjs -- so the base this
// resolves against must be stated, not inherited. `process.cwd()` is the base
// you get by saying nothing, and it is the one base that can be wrong: CI runs
// this from the repo root, so a relative entry happens to land on the right
// directory, and the day something runs it from anywhere else countTestFiles()
// reads nothing, returns 0, and the partitioner absorbs the zero without
// complaint. Measured before this was pinned -- same document, same tree, cwd
// `/`: `shard 1/1: 1/1 packages, weight 0`. That failure mode is not a red
// step, it is a shard matrix that quietly stops balancing.
//
// `path.resolve` is also the reason this stays correct for both conventions:
// given an already-absolute entry it returns that entry unchanged, so an old
// document written by the previous absolute-path union step still resolves to
// the same directory it always did.
export function packageDir(itemPath) {
  return path.resolve(REPO_ROOT, itemPath);
}

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next']);

export function countTestFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // package path missing locally -- weight 0, still assigned
  }
  let n = 0;
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) n += countTestFiles(path.join(dir, e.name));
    } else if (TEST_FILE.test(e.name)) {
      n++;
    }
  }
  return n;
}

// The measured dataset, read once. Absent or unreadable is a REFUSAL, not a
// fallback to the old file-count weighting: a partitioner that silently
// reverted to the proxy would re-open #10472's imbalance while every step
// stayed green, which is precisely the failure class this file is built
// against. A missing dataset is a five-second fix; an invisible re-imbalance
// cost a 14.7-minute critical path for as long as nobody measured it.
let timingsCache = null;
export function loadTimings(timingsPath = TIMINGS_PATH) {
  if (timingsCache && timingsCache.path === timingsPath) return timingsCache.value;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(timingsPath, 'utf8'));
  } catch (cause) {
    throw new Error(
      `${timingsPath}: the measured per-package test durations could not be read (${cause.message}). ` +
        'Regenerate with scripts/measure-test-shard-timings.mjs -- see its header for the two ' +
        'refresh paths. Refusing to shard on an unmeasured weight.'
    );
  }
  const packages = parsed?.packages;
  const rate = parsed?.secondsPerTestFileFallback;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error(`${timingsPath}: expected {packages:{"<name>":<seconds>}} -- got ${JSON.stringify(packages)}`);
  }
  if (typeof rate !== 'number' || !(rate > 0)) {
    throw new Error(`${timingsPath}: secondsPerTestFileFallback must be a positive number, got ${JSON.stringify(rate)}`);
  }
  for (const [name, seconds] of Object.entries(packages)) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`${timingsPath}: ${name} is weighed ${JSON.stringify(seconds)}, which is not a duration`);
    }
  }
  timingsCache = { path: timingsPath, value: { packages, rate } };
  return timingsCache.value;
}

// One package's weight, in seconds, and the ONE place the measured/estimated
// distinction is made.
//
// A package the dataset has never seen -- a brand new one, or one added since
// the last refresh -- is ESTIMATED from its test-file count at the dataset's
// own median seconds-per-file, not dropped and not weighed zero. Zero is the
// dangerous answer here: it is a real weight for a package with no tests, so a
// weight-0 unmeasured package is indistinguishable from a correctly-empty one,
// and a new heavy suite would pile onto whichever bin happened to be lightest
// while reading as free. The estimate is the old proxy, used only where there
// is nothing better, and `report` counts how often that happens so a dataset
// drifting out of date is visible in the CI log rather than inferred later.
export function weighPackage(name, dir, timings) {
  if (Object.hasOwn(timings.packages, name)) {
    return { seconds: timings.packages[name], measured: true };
  }
  return { seconds: countTestFiles(dir) * timings.rate, measured: false };
}

// Turn `turbo ls` items into weighted items, and the ONLY path that decides
// what a package weighs in a real run.
//
// It is exported and factored out of main() for one reason: the self-test can
// then assert on the SAME code the shards run. The pins that only exercised
// partition() could not see a revert of the weight SOURCE -- partition is
// handed weights and respects them faithfully whatever they mean, so a main()
// that went back to passing test-file counts would satisfy every one of them
// while re-opening #10472 exactly. The end-to-end pin in selfTest() below
// calls THIS function, which is why it can tell duration from count.
export function weighItems(items, excluded, timings, label = 'package list') {
  const weighted = [];
  let estimated = 0;
  for (const it of items) {
    if (typeof it?.name !== 'string' || typeof it?.path !== 'string') {
      throw new Error(`${label}: package entry missing name/path: ${JSON.stringify(it)}`);
    }
    if (excluded.has(it.name)) continue;
    const { seconds, measured } = weighPackage(it.name, packageDir(it.path), timings);
    if (!measured) estimated++;
    weighted.push({ name: it.name, weight: seconds });
  }
  return { weighted, estimated };
}

// LPT greedy: heaviest package into the currently lightest bin. Deterministic:
// input order never matters because both the package sort and the bin choice
// break ties explicitly (by name / by lowest bin index).
export function partition(items, shardCount) {
  const sorted = [...items].sort(
    (a, b) => b.weight - a.weight || a.name.localeCompare(b.name, 'en')
  );
  const bins = Array.from({ length: shardCount }, () => ({ total: 0, names: [] }));
  for (const it of sorted) {
    let best = 0;
    for (let i = 1; i < bins.length; i++) {
      if (bins[i].total < bins[best].total) best = i;
    }
    bins[best].names.push(it.name);
    bins[best].total += it.weight;
  }
  return bins;
}

// The one summary statistic #10472's acceptance criterion is written in.
// `floor` is the heaviest single package: sharding is BY PACKAGE, so no split
// at any shard count can put max below it, and comparing it to the mean says
// whether the bound is even reachable before anyone tries to reach it.
export function balanceOf(bins, items = null) {
  const totals = bins.map((b) => b.total);
  const sum = totals.reduce((a, b) => a + b, 0);
  const mean = sum / bins.length;
  const max = Math.max(...totals);
  const floor = items ? Math.max(0, ...items.map((i) => i.weight)) : null;
  return { totals, sum, mean, max, min: Math.min(...totals), ratio: mean === 0 ? 1 : max / mean, floor };
}

// Compare what a shard was PREDICTED to cost against what it actually cost.
//
// The comparison is over the INTERSECTION of two sets, and both restrictions
// are load-bearing:
//
//   - a package measured on this shard but absent from the dataset contributes
//     to NEITHER total. Its weight came from the test-file-count estimate in
//     weighPackage(), so calling the estimate wrong would red on a brand-new
//     package rather than on a rotted dataset entry. It is named in
//     `unpredicted` instead, because a shard full of estimates is its own
//     (quieter) signal that a refresh is due.
//   - a package in the dataset but not in this summary contributes to neither
//     either. A shard runs a subset -- of the six bins, and on a pull_request
//     of `turbo ls --affected` on top of that -- so charging a shard for
//     packages it never ran would make the ratio a function of the diff.
//
// Cache hits and failed suites never reach here: the measurements come from
// samplesFromSummary(), which drops both. That is deliberate reuse rather than
// a second reader -- the generator's ~0s-for-a-replayed-suite hazard is the
// same hazard here, pointing the other way (a cached shard would read as
// enormously FASTER than predicted and quietly vouch for a rotted dataset).
export function driftReport(measured, timings, factor = MAX_MEASURED_OVER_PREDICTED) {
  const rows = [];
  const unpredicted = [];
  let predictedTotal = 0;
  let measuredTotal = 0;
  for (const [name, seconds] of measured) {
    if (!Object.hasOwn(timings.packages, name)) {
      unpredicted.push(name);
      continue;
    }
    const predicted = timings.packages[name];
    predictedTotal += predicted;
    measuredTotal += seconds;
    rows.push({ name, predicted, measured: seconds, overshoot: seconds - predicted });
  }
  unpredicted.sort((a, b) => a.localeCompare(b, 'en'));
  // Sorted by ABSOLUTE overshoot, not by ratio: the reader of a red verdict
  // wants the package that cost the shard its minutes, and a 0.1s package that
  // came in at 5x its 0.02s entry is noise wearing the biggest ratio.
  rows.sort((a, b) => b.overshoot - a.overshoot || a.name.localeCompare(b.name, 'en'));
  // `predictedTotal > 0` is the guard against a verdict of Infinity, which is
  // what a shard carrying only zero-weight entries would otherwise produce --
  // a red naming no cause. Zero measured packages is the same state and reads
  // the same way: NOT MEASURED is not a pass, and it is not a failure either.
  const measurable = rows.length > 0 && predictedTotal > 0;
  const ratio = measurable ? measuredTotal / predictedTotal : null;
  return {
    rows,
    unpredicted,
    predictedTotal,
    measuredTotal,
    ratio,
    measurable,
    drifted: measurable && ratio > factor,
  };
}

// Reads the package list out of a `turbo ls --output=json` payload, asserting
// two independent properties. They fail for different reasons and both are
// loud, because the failure this whole file guards against is the quiet one --
// a shard that tested nothing and went green.
//
//   SHAPE -- `packages.items` must be an array. `turbo ls` is experimental, so
//            an upgrade that renames or restructures this becomes a red step
//            naming the cause rather than an empty shard.
//   SIZE  -- when the payload carries turbo's own `packages.count`, it must
//            equal `items.length`. turbo never breaks this itself (measured on
//            2.10.10: the bare, `--filter` and `--affected` forms all agree),
//            so a payload that DOES has been hand-mutated or truncated between
//            turbo and here and is not trustworthy about how many packages
//            this shard is meant to see. There is exactly one such mutator in
//            this repo -- `--union-into` in check-cross-package-test-inputs.mjs,
//            which appends the cross-package scans the dependency graph cannot
//            reach -- and it maintains `count`. This assertion is what makes
//            that a checked fact instead of a convention: it wrote a `count: 0`
//            document alongside two items for as long as nobody looked.
//
// A payload carrying NO `count` is accepted on purpose. The field is redundant
// with the array, so its ABSENCE cannot mis-shard anything, while its
// DISAGREEMENT can; requiring it would turn a turbo upgrade that merely dropped
// a field nobody reads into a red Test Core on every PR. Note this is a
// redundancy check, not lenient parsing -- a `count` that is present and wrong
// is rejected, never repaired.
export function readPackageItems(parsed, listPath) {
  const items = parsed?.packages?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      `${listPath}: expected \`turbo ls --output=json\` shape {packages:{items:[...]}} -- ` +
        'did an experimental-command upgrade change the output?'
    );
  }
  const count = parsed.packages.count;
  if (count !== undefined && count !== items.length) {
    throw new Error(
      `${listPath}: packages.count is ${JSON.stringify(count)} but packages.items holds ` +
        `${items.length} -- the payload contradicts itself about its own size, so it has ` +
        'been hand-mutated or truncated since `turbo ls` wrote it. Refusing to shard it.'
    );
  }
  return items;
}

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// `--self-test` reaching its verdict used to be this self-test's ONLY success
// condition, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// This file's assertions are bare `throw`s rather than calls to an assertion
// helper, so they are counted by the `check(() => { ... })` THUNK: the existing
// `if (...) throw ...` is carried into the thunk verbatim and the condition is
// never touched. Routing these through a boolean helper instead would mean
// inverting 36 failure conditions by hand, and a dropped `!` yields an
// assertion that still registers its case and still passes -- invisible to the
// very floor being installed here.
//
// The counts are a FLOOR, not an equality -- adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'coverage + determinism': 2,
  'LPT balance bound': 1,
  'the two heaviest packages must not share a bin': 1,
  'degenerate inputs': 2,
  'payload assertions: the cross-writer count/items invariant': 9,
  'path resolution: the silent weight-0 cwd defect': 5,
  // 2 of these 16 are the end-to-end inversion pin, which runs only while the
  // dataset still carries both packages of its inversion pair. That guard is
  // silent today: drop either package in a timings refresh and the pin stops
  // testing anything. Flooring at the measured 16 makes that loud, and the
  // remedy is the one the pin itself names -- pick a new inversion pair from
  // the dataset -- never lowering this number.
  'the balancing pins (#10472)': 16,
  'predicted-vs-measured drift (#16173)': 9,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 8;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'partition-test-shards self-test reached its verdict';

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
  // The thunk every assertion in this body now runs inside. It COUNTS a case
  // and then runs the case unchanged: the `if (...) throw ...` inside each
  // thunk is the one that was already there, carried in verbatim modulo
  // indentation. Nothing inverts a condition, so the failure mode a boolean
  // helper would have introduced here -- a dropped `!`, an assertion that still
  // registers and still passes -- cannot arise. The throw still propagates:
  // this file fails fast on the FIRST broken assertion, as it always has.
  const check = (fn) => {
    registerCase();
    fn();
  };
  const mk = (name, weight) => ({ name, weight });
  // Coverage + determinism: every package lands in exactly one bin, and two
  // runs over differently-ordered input agree.
  battery('coverage + determinism');
  const items = [mk('e', 1), mk('a', 9), mk('c', 4), mk('b', 9), mk('d', 3)];
  const shuffled = [items[2], items[4], items[0], items[3], items[1]];
  const a = partition(items, 2);
  const b = partition(shuffled, 2);
  const flatA = a.flatMap((bin) => bin.names).sort();
  check(() => {
    if (flatA.join() !== 'a,b,c,d,e') throw new Error(`coverage: got ${flatA.join()}`);
  });
  check(() => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('determinism: input order changed the split');
  });
  // LPT balance bound: bin spread never exceeds the heaviest single weight.
  battery('LPT balance bound');
  const totals = a.map((bin) => bin.total);
  check(() => {
    if (Math.max(...totals) - Math.min(...totals) > 9) throw new Error(`balance: totals ${totals}`);
  });
  // The two 9s must not share a bin.
  battery('the two heaviest packages must not share a bin');
  const binOfA = a.findIndex((bin) => bin.names.includes('a'));
  const binOfB = a.findIndex((bin) => bin.names.includes('b'));
  check(() => {
    if (binOfA === binOfB) throw new Error('balance: both heaviest packages in one bin');
  });
  // Degenerate inputs: empty list, more shards than packages.
  battery('degenerate inputs');
  const empty = partition([], 2);
  check(() => {
    if (empty.some((bin) => bin.names.length > 0)) throw new Error('empty input produced packages');
  });
  const sparse = partition([mk('only', 5)], 3);
  check(() => {
    if (sparse.flatMap((bin) => bin.names).join() !== 'only') throw new Error('sparse input lost the package');
  });

  // Payload assertions. The document reaching this script has two writers --
  // `turbo ls` and `--union-into` in check-cross-package-test-inputs.mjs -- so
  // "count agrees with items" is a cross-script invariant; this is its reading
  // half (the writing half is that script's own `--self-test`).
  battery('payload assertions: the cross-writer count/items invariant');
  const threw = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  const doc = (packages) => ({ packageManager: 'pnpm9', packages });
  const two = [{ name: 'a', path: 'p' }, { name: 'b', path: 'q' }];
  check(() => {
    if (readPackageItems(doc({ count: 2, items: two }), 'f').length !== 2) throw new Error('payload: a consistent list was rejected');
  });
  check(() => {
    if (readPackageItems(doc({ items: two }), 'f').length !== 2) throw new Error('payload: a list with no count was rejected');
  });
  check(() => {
    if (readPackageItems(doc({ count: 0, items: [] }), 'f').length !== 0) throw new Error('payload: a legitimately empty list was rejected');
  });
  // The exact document `--union-into` used to write: two items, count still 0.
  check(() => {
    if (!threw(() => readPackageItems(doc({ count: 0, items: two }), 'f'))) throw new Error('payload: count 0 beside 2 items was accepted');
  });
  check(() => {
    if (!threw(() => readPackageItems(doc({ count: 3, items: two }), 'f'))) throw new Error('payload: an over-count was accepted');
  });
  check(() => {
    if (!threw(() => readPackageItems(doc({ count: '2', items: two }), 'f'))) throw new Error('payload: a non-numeric count was accepted');
  });
  check(() => {
    if (!threw(() => readPackageItems(doc({ count: 2 }), 'f'))) throw new Error('payload: a missing items array was accepted');
  });
  check(() => {
    if (!threw(() => readPackageItems(doc({ count: 0, items: {} }), 'f'))) throw new Error('payload: a non-array items was accepted');
  });
  check(() => {
    if (!threw(() => readPackageItems({}, 'f'))) throw new Error('payload: a document with no packages key was accepted');
  });

  // Path resolution. `it.path` reaches this script in two conventions and the
  // weight it produces must not depend on where the process happens to stand.
  // The cwd leg is the one that matters: it is the exact measurement that made
  // this a defect rather than a style question, and it fails SILENTLY (weight 0,
  // package still assigned) rather than loudly, so nothing but an assertion can
  // hold it.
  battery('path resolution: the silent weight-0 cwd defect');
  check(() => {
    if (packageDir('packages/spec') !== path.join(REPO_ROOT, 'packages', 'spec')) {
      throw new Error('path: a repo-relative entry did not resolve against the repo root');
    }
  });
  const absolute = path.join(REPO_ROOT, 'packages', 'spec');
  check(() => {
    if (packageDir(absolute) !== absolute) {
      throw new Error('path: an already-absolute entry was not left alone');
    }
  });
  const hereWeight = countTestFiles(packageDir('packages/spec'));
  check(() => {
    if (hereWeight === 0) throw new Error('path: fixture package `packages/spec` has no test files to weigh');
  });
  const cwdBefore = process.cwd();
  try {
    process.chdir(path.parse(REPO_ROOT).root);
    check(() => {
      if (packageDir('packages/spec') !== absolute) {
        throw new Error('path: resolution moved with the cwd');
      }
    });
    check(() => {
      if (countTestFiles(packageDir('packages/spec')) !== hereWeight) {
        throw new Error('path: weight changed with the cwd -- the silent weight-0 regression is back');
      }
    });
  } finally {
    process.chdir(cwdBefore);
  }

  // ── THE BALANCING PINS (#10472) ─────────────────────────────────────────
  //
  // Everything above pins that the split is a correct, deterministic, total
  // cover of its input. None of it noticed that the six bins it produced ran
  // 5.0/6.2/6.3/13.6/6.3/9.0 minutes, because a perfectly-balanced split of the
  // WRONG quantity satisfies every one of those assertions. These five pin the
  // quantity and the outcome.
  battery('the balancing pins (#10472)');

  // 1. The weight is TIME, not file count -- stated as a case where the two
  //    answers DIFFER, which is the only kind of case that can catch a revert.
  //    Read the four items as four packages with the same test-file count, one
  //    of them 6x slower per file. Weighed by count they are four equal items,
  //    so any balanced split puts two in each bin and `slow` shares one.
  //    Weighed by time, `slow` outweighs the other three together and lands
  //    alone. Asserting it is alone asserts the weight is duration.
  const byTime = partition(
    [mk('slow', 600), mk('x', 100), mk('y', 100), mk('z', 100)],
    2
  );
  const slowBin = byTime.find((bin) => bin.names.includes('slow'));
  check(() => {
    if (slowBin.names.length !== 1) {
      throw new Error(`weight: the 600s package was co-scheduled with ${slowBin.names.join('+')} -- is the weight a count again?`);
    }
  });

  // 2. The committed dataset, split at the shard count CI actually uses, meets
  //    the acceptance bound. This is the pin that fails when a suite grows
  //    heavy enough to re-imbalance the matrix, and it fails on the PR that
  //    refreshes the timings rather than three weeks later in a queue build.
  const ciYml = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  // The pin has to bin what CI actually bins, so the exclusions come from the
  // workflow rather than from a second list here. Without this the pin has a
  // live trap in it: @objectstack/dogfood is a ~7.5-minute suite that Test Core
  // never runs (the dedicated Dogfood job does), and the day someone refreshes
  // the dataset from a local run that forgot `--filter=!@objectstack/dogfood`,
  // the balance assertion would fail over a package no shard was ever going to
  // execute.
  const ciExcludes = new Set([...ciYml.matchAll(/--exclude\s+(@[\w./-]+)/g)].map((m) => m[1]));
  check(() => {
    if (ciExcludes.size === 0) throw new Error('ci.yml: no --exclude found for the partitioner invocation');
  });
  const timings = loadTimings();
  const datasetItems = Object.entries(timings.packages)
    .filter(([name]) => !ciExcludes.has(name))
    .map(([name, weight]) => mk(name, weight));
  check(() => {
    if (datasetItems.length < 20) {
      throw new Error(`dataset: only ${datasetItems.length} package(s) measured -- that is not the workspace`);
    }
  });
  const real = partition(datasetItems, SHARD_COUNT);
  const balance = balanceOf(real, datasetItems);
  check(() => {
    if (balance.ratio > MAX_SHARD_OVER_MEAN) {
      throw new Error(
        `balance: at ${SHARD_COUNT} shards the heaviest bin is ${balance.ratio.toFixed(2)}x the mean ` +
          `(${balance.max.toFixed(0)}s vs ${balance.mean.toFixed(0)}s), past the ${MAX_SHARD_OVER_MEAN}x bound. ` +
          'Bins: ' + balance.totals.map((t) => t.toFixed(0)).join('/') + 's.'
      );
    }
  });

  // 3. The bound is REACHABLE at this shard count -- the arithmetic #10472
  //    asked about when it floated 6 -> 8. No split can put the heaviest bin
  //    below the heaviest single package, so once that package exceeds
  //    1.3x the mean, raising the shard count cannot help and every further
  //    shard makes it worse by shrinking the mean. Pinning it here means the
  //    next person to reach for more shards gets the answer from a failing
  //    assertion naming the floor, not from a CI run that quietly misses the
  //    target.
  check(() => {
    if (balance.floor > MAX_SHARD_OVER_MEAN * balance.mean) {
      throw new Error(
        `balance: the heaviest single package is ${balance.floor.toFixed(0)}s against a ${balance.mean.toFixed(0)}s mean, ` +
          `so NO split at ${SHARD_COUNT} shards can meet ${MAX_SHARD_OVER_MEAN}x. Splitting that suite below package ` +
          'granularity, not a different shard count, is the only thing that moves this.'
      );
    }
  });

  // 4. The shard count is spelled in ci.yml too, and drift there is silent:
  //    a partitioner cutting six bins for a five-job matrix simply loses a
  //    sixth of the workspace, with every step green. Read it back.
  const declaredMatrix = /^\s*shard:\s*\[([^\]]*)\]/m.exec(ciYml);
  check(() => {
    if (!declaredMatrix) throw new Error('ci.yml: could not find the Test Core shard matrix to compare against');
  });
  const matrixSize = declaredMatrix[1].split(',').filter((s) => s.trim() !== '').length;
  check(() => {
    if (matrixSize !== SHARD_COUNT) {
      throw new Error(`ci.yml: the shard matrix declares ${matrixSize} shards, this script splits into ${SHARD_COUNT}`);
    }
  });
  check(() => {
    if (!ciYml.includes(`--shard \${{ matrix.shard }}/${SHARD_COUNT}`)) {
      throw new Error(`ci.yml: the partitioner is not invoked with --shard <n>/${SHARD_COUNT}`);
    }
  });
  check(() => {
    if (!ciYml.includes(`--total ${SHARD_COUNT}`)) {
      throw new Error(`ci.yml: the shard attestation does not declare --total ${SHARD_COUNT}`);
    }
  });

  // 5. An unmeasured package is ESTIMATED, never silently free. A new package
  //    with real tests and no dataset entry must still carry weight, or the
  //    first shard to receive it absorbs it invisibly.
  const fakeTimings = { packages: { known: 42 }, rate: 2 };
  const specDir = packageDir('packages/spec');
  check(() => {
    if (weighPackage('known', specDir, fakeTimings).seconds !== 42) throw new Error('weight: a measured package was re-estimated');
  });
  check(() => {
    if (!weighPackage('known', specDir, fakeTimings).measured) throw new Error('weight: a measured package was not reported as measured');
  });
  const estimate = weighPackage('brand-new', specDir, fakeTimings);
  check(() => {
    if (estimate.measured) throw new Error('weight: an unmeasured package claimed to be measured');
  });
  check(() => {
    if (estimate.seconds !== hereWeight * 2) throw new Error(`weight: estimate was ${estimate.seconds}, expected ${hereWeight * 2}`);
  });
  check(() => {
    if (weighPackage('measured-empty', specDir, { packages: { 'measured-empty': 0 }, rate: 2 }).seconds !== 0) {
      throw new Error('weight: a package measured at 0s was re-estimated instead of trusted');
    }
  });

  // 6. END-TO-END: the weight a REAL RUN gives a REAL package is its measured
  //    duration, not its test-file count. Pins 1 and 5 each cover half of this
  //    and neither covers the join: pin 1 proves partition() respects the
  //    magnitudes it is handed, pin 5 proves weighPackage() reads the dataset
  //    -- but a main() that simply stopped calling weighPackage and passed
  //    countTestFiles again would keep both of them green while restoring
  //    #10472's imbalance in full. So this asserts through weighItems(), the
  //    single path main() weighs by.
  //
  //    The case is an INVERSION measured in this very dataset, which is what
  //    makes it able to fail: @objectstack/example-todo runs LONGER than
  //    @objectstack/core (33.77s vs 16.40s) out of FEWER test files (4 vs 36).
  //    Whichever quantity is in force decides the order, and the two answers
  //    are opposite -- so this assertion cannot be satisfied by both.
  const invA = '@objectstack/example-todo';
  const invB = '@objectstack/core';
  const invAPath = 'examples/app-todo';
  const invBPath = 'packages/core';
  if (Object.hasOwn(timings.packages, invA) && Object.hasOwn(timings.packages, invB)) {
    const inv = weighItems(
      [
        { name: invA, path: invAPath },
        { name: invB, path: invBPath },
      ],
      new Set(),
      timings,
      'inversion pin'
    ).weighted;
    const [wA, wB] = [inv.find((i) => i.name === invA), inv.find((i) => i.name === invB)];
    const [fA, fB] = [countTestFiles(packageDir(invAPath)), countTestFiles(packageDir(invBPath))];
    // Guard the fixture itself: if the inversion ever stops being an inversion
    // (files rebalance, a suite is split), this pin silently stops testing
    // anything, so say so rather than passing vacuously.
    check(() => {
      if (!(fA < fB)) {
        throw new Error(
          `inversion pin: ${invA} no longer has fewer test files than ${invB} (${fA} vs ${fB}), ` +
            'so this case can no longer tell duration from count. Pick a new inversion pair from the dataset.'
        );
      }
    });
    check(() => {
      if (!(wA.weight > wB.weight)) {
        throw new Error(
          `weight: ${invA} weighed ${wA.weight} and ${invB} weighed ${wB.weight}, but ${invA} is the ` +
            `SLOWER suite (${timings.packages[invA]}s vs ${timings.packages[invB]}s) with FEWER test files ` +
            `(${fA} vs ${fB}). The run is weighing test-file count again -- that is #10472.`
        );
      }
    });
  }

  // -- PREDICTED VS MEASURED (#16173) -------------------------------------
  //
  // The balancing pins above all read the dataset as GIVEN. None of them can
  // fail because a number in it is wrong: a perfectly balanced split of stale
  // weights satisfies every one of them, and did, at 1.00x max/mean, on the
  // very build whose shard 1 was killed by the 30-minute wall. These pin the
  // one comparison that can tell a good dataset from a rotted one.
  battery('predicted-vs-measured drift (#16173)');
  const driftTimings = { packages: { slow: 100, fine: 50, zero: 0 }, rate: 2 };
  const measuredMap = (o) => new Map(Object.entries(o));

  // The card's own reading, to scale: 100s predicted, 269s measured = 2.69x.
  const drifted = driftReport(measuredMap({ slow: 269 }), driftTimings);
  check(() => {
    if (!drifted.drifted) {
      throw new Error(`drift: a ${drifted.ratio?.toFixed(2)}x gap was not reported as drift`);
    }
  });
  check(() => {
    if (Math.abs(drifted.ratio - 2.69) > 1e-9) throw new Error(`drift: ratio was ${drifted.ratio}`);
  });

  // A suite that ran a little long is NOT drift -- the bound sits above
  // MAX_SHARD_OVER_MEAN precisely so ordinary runner variance stays green.
  check(() => {
    if (driftReport(measuredMap({ slow: 140 }), driftTimings).drifted) {
      throw new Error('drift: a 1.4x reading red under a 1.5x bound');
    }
  });
  // The boundary itself: `>` not `>=`, so exactly at the bound is still green.
  check(() => {
    if (driftReport(measuredMap({ slow: 150 }), driftTimings).drifted) {
      throw new Error('drift: a reading exactly AT the bound was called a breach');
    }
  });

  // A package the dataset has never seen is weighed by ESTIMATE in
  // weighPackage(), so charging the estimate to the dataset would red on a new
  // package instead of on a rotted entry. Excluded from both totals, named.
  const withNew = driftReport(measuredMap({ slow: 100, 'brand-new': 900 }), driftTimings);
  check(() => {
    if (withNew.drifted) throw new Error('drift: an UNMEASURED package was charged to the dataset');
  });
  check(() => {
    if (withNew.unpredicted.join() !== 'brand-new') {
      throw new Error(`drift: unpredicted was ${withNew.unpredicted.join()}`);
    }
  });

  // The mirror restriction: a dataset entry this shard never ran must not
  // inflate the predicted side. `fine` and `zero` are in driftTimings and not
  // in the summary; if they counted, 100/150 would read as a fast shard and
  // vouch for the dataset.
  check(() => {
    if (driftReport(measuredMap({ slow: 269 }), driftTimings).predictedTotal !== 100) {
      throw new Error('drift: a package this shard never ran inflated the predicted total');
    }
  });

  // Infinity is a red naming no cause. A shard carrying only zero-weight
  // entries -- and a shard carrying nothing at all -- is NOT MEASURED, which is
  // neither a pass nor a failure.
  check(() => {
    const z = driftReport(measuredMap({ zero: 30 }), driftTimings);
    if (z.measurable || z.drifted || z.ratio !== null) {
      throw new Error(`drift: a zero predicted total produced ratio ${z.ratio}`);
    }
  });

  // THE ONE THAT MATTERS FOR THE READING, and the reason this reuses the
  // generator's extractor instead of parsing summaries a second time: a cache
  // HIT replays a stored log in milliseconds. Read as a measurement it says the
  // suite got ~1000x FASTER than predicted -- a shard that would vouch, loudly
  // and in the wrong direction, for whatever the dataset happens to say. Both
  // legs go through samplesFromSummary(), which drops replays and failures.
  const replayed = samplesFromSummary(
    { tasks: [
      { taskId: 'slow#test', task: 'test', package: 'slow', cache: { status: 'HIT' },
        execution: { startTime: 0, endTime: 40, exitCode: 0 } },
      { taskId: 'fine#test', task: 'test', package: 'fine', cache: { status: 'MISS' },
        execution: { startTime: 0, endTime: 200_000, exitCode: 1 } },
    ] },
    'drift pin'
  );
  check(() => {
    const r = driftReport(replayed.samples, driftTimings);
    if (r.measurable) {
      throw new Error('drift: a summary of one replay and one failure was read as a measurement');
    }
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
      `partition-test-shards self-test floor (${floorFailures.length} breach(es)):\n` +
        floorFailures.map((f) => `  - ${f}`).join('\n') +
        '\n  A battery at or below its floor means cases STOPPED RUNNING -- the battery is the bug, ' +
        'not the number. Find what stopped registering (an early return, a deleted block, a guard ' +
        'that now skips) and restore it.'
    );
  }

  console.log(
    `partition-test-shards: self-test OK (${datasetItems.length} measured packages, ${SHARD_COUNT} shards, ` +
      `max/mean ${balance.ratio.toFixed(2)}x <= ${MAX_SHARD_OVER_MEAN}x, floor ${balance.floor.toFixed(0)}s, ` +
      `bins ${balance.totals.map((t) => t.toFixed(0)).join('/')}s)`
  );

  return SELF_TEST_VERDICT;
}

// `--check-drift`: the shard just measured itself, so read that back.
//
// Every verdict this prints is one of exactly three, and NOT MEASURED is a
// first-class one rather than a quiet pass. A shard whose test tasks were all
// cache replays has said nothing about the dataset, and reporting that as OK is
// the #4690 shape -- a check that read nothing reporting as a check that found
// nothing wrong.
function checkDrift(argv) {
  const inputs = [];
  let label = 'this shard';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check-drift') continue;
    else if (arg === '--label') label = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unrecognized argument: ${arg}`);
    else inputs.push(arg);
  }
  if (inputs.length === 0) {
    console.error(
      'usage: partition-test-shards.mjs --check-drift <run-summary.json>... [--label <text>]'
    );
    process.exit(1);
  }
  // A package normally appears in exactly one summary -- it runs on exactly one
  // shard -- so this merge is for the case where it does not (a directory
  // holding several runs, or every shard's summary handed over at once). The
  // LONGEST window wins, deliberately unlike the generator's median: the
  // generator is choosing a weight to balance FUTURE splits with, where one
  // unlucky leg must not ratchet the dataset upward forever, while this is
  // asking whether a shard fits inside a wall, and the leg that answers that is
  // the slow one.
  const merged = new Map();
  for (const input of inputs) {
    const { samples } = samplesFromSummary(JSON.parse(readFileSync(input, 'utf8')), input);
    for (const [name, seconds] of samples) {
      merged.set(name, Math.max(merged.get(name) ?? 0, seconds));
    }
  }
  const timings = loadTimings();
  const report = driftReport(merged, timings);
  const skipped =
    report.unpredicted.length === 0
      ? ''
      : ` ${report.unpredicted.length} package(s) carry no dataset entry and were excluded ` +
        `(estimated, not predicted): ${report.unpredicted.join(', ')}.`;

  if (!report.measurable) {
    console.error(
      `shard-timing-drift: NOT MEASURED -- ${label} finished no test task that was both a cache ` +
        'MISS and carried a dataset entry, so this run says nothing about whether ' +
        `scripts/test-shard-timings.json is still true.${skipped}`
    );
    return;
  }

  const head =
    `${report.measuredTotal.toFixed(1)}s measured vs ${report.predictedTotal.toFixed(1)}s predicted ` +
    `across ${report.rows.length} package(s) = ${report.ratio.toFixed(2)}x ` +
    `(bound ${MAX_MEASURED_OVER_PREDICTED}x)`;
  const worst = report.rows
    .slice(0, 5)
    .map(
      (r) =>
        `    ${r.name}: predicted ${r.predicted.toFixed(1)}s, measured ${r.measured.toFixed(1)}s ` +
        `(${r.predicted > 0 ? `${(r.measured / r.predicted).toFixed(2)}x, ` : ''}` +
        `${r.overshoot >= 0 ? '+' : ''}${r.overshoot.toFixed(1)}s)`
    )
    .join('\n');

  if (!report.drifted) {
    console.error(`shard-timing-drift: OK -- ${label}, ${head}.${skipped}`);
    return;
  }
  console.error(
    `shard-timing-drift: DRIFT -- ${label}, ${head}.${skipped}\n` +
      '  Heaviest overshoots:\n' +
      `${worst}\n` +
      '  scripts/test-shard-timings.json no longer describes this workspace, so the shard split\n' +
      '  is balancing a quantity that is not the runtime. Refresh it -- see\n' +
      '  scripts/measure-test-shard-timings.mjs for the two refresh paths -- and ⛔ do NOT\n' +
      '  hand-edit the dataset or raise this bound to absorb the gap. Expect the refresh to red\n' +
      "  this script's own balance pins if a single suite has outgrown the acceptance bound:\n" +
      '  that is those pins working, and the remedy they name is splitting that suite below\n' +
      '  package granularity, never a different shard count.'
  );
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ partition-test-shards self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }
  if (argv.includes('--check-drift')) {
    checkDrift(argv);
    return;
  }

  let listPath = null;
  let shardSpec = null;
  const excluded = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--shard') shardSpec = argv[++i];
    else if (arg === '--exclude') excluded.add(argv[++i]);
    else if (!arg.startsWith('--') && listPath === null) listPath = arg;
    else throw new Error(`unrecognized argument: ${arg}`);
  }
  const shardMatch = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shardSpec ?? '');
  if (!listPath || !shardMatch) {
    console.error('usage: partition-test-shards.mjs <turbo-ls.json> --shard N/M [--exclude <pkg>]...');
    process.exit(1);
  }
  const shardIndex = Number(shardMatch[1]);
  const shardCount = Number(shardMatch[2]);
  if (shardIndex > shardCount) throw new Error(`--shard ${shardSpec}: index exceeds count`);

  const parsed = JSON.parse(readFileSync(listPath, 'utf8'));
  const items = readPackageItems(parsed, listPath);
  const timings = loadTimings();
  const { weighted, estimated } = weighItems(items, excluded, timings, listPath);
  const bins = partition(weighted, shardCount);
  const mine = bins[shardIndex - 1];
  const { max, mean, ratio } = balanceOf(bins);
  // Printed on every shard, not just the imbalanced one, and printed as the
  // RATIO the acceptance bound is written in: the per-shard numbers alone never
  // said whether the split was balanced, which is why #10472's imbalance had to
  // be found by reading six job durations side by side after the fact.
  console.error(
    `shard ${shardSpec}: ${mine.names.length}/${weighted.length} packages, ` +
      `${mine.total.toFixed(1)}s predicted (all bins: ${bins.map((b) => b.total.toFixed(0)).join('/')}s; ` +
      `max/mean ${ratio.toFixed(2)}x of the ${MAX_SHARD_OVER_MEAN}x bound, max ${max.toFixed(0)}s, mean ${mean.toFixed(0)}s; ` +
      `${weighted.length - estimated} measured, ${estimated} estimated from test-file count)`
  );
  for (const name of mine.names) console.log(name);
}

// Entry-point guard, not decoration: scripts/measure-test-shard-timings.mjs
// imports countTestFiles from here, and an unguarded `main()` would run the
// argument parser (and exit 1 on "no shard given") on that import.
//
// Through `isEntrypoint`, never a hand-typed `process.argv[1]` comparison:
// node resolves symlinks for the module graph but leaves `argv[1]` as typed,
// so the hand-rolled form answers `false` through a symlink and this script
// does NOTHING -- exit 0, no output, which here means a shard that printed no
// package list. `check:entry-guard` enforces the single spelling; see
// scripts/invoked-as.mjs for the measured failure modes.
if (isEntrypoint(import.meta.url)) {
  main();
}
