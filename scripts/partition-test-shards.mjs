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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';
import { maskCommentsAndLiterals } from './js-comment-mask.mjs';
import { samplesFromSummary } from './measure-test-shard-timings.mjs';
import { workspacePackages } from './workspace-enumerator.mjs';

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
// 1.5 is where the two populations actually separate, measured rather than
// picked. On run 34013842594 -- a GREEN merge_group build, so the full package
// list rather than a pull_request's --affected subset -- the six shards ran
// their `Run this shard's tests` step against the same 672s prediction:
//
//   shard 3  462s  0.69x     shard 6  776s  1.15x
//   shard 5  630s  0.94x     shard 4  793s  1.18x
//   shard 2  714s  1.06x     shard 1 1168s  1.74x   <- the one carrying the CLI
//
// Five healthy shards top out at 1.18x and the drifted one sits at 1.74x, on
// the same build, so the gap is not runner noise and one factor separates them
// cleanly. (Those step times include turbo scheduling and any uncached build
// tasks; this gate compares test-task windows only, which is the tighter and
// fairer reading of the same shards.)
//
// 1.5 also satisfies the two ends the bound is answerable to:
//
//   - it must fire well below the 2.69x measured above, or the gate would have
//     been green straight through the incident it exists to catch;
//   - it must sit ABOVE MAX_SHARD_OVER_MEAN, because a dataset accurate to
//     within the balance bound cannot be the thing that breaks balance. Gating
//     tighter than the split's own tolerance reds on drift the partitioner is
//     built to absorb, and a gate that reds on healthy input gets muted.
//
// ⛔ Raising this to absorb a red is the one move that cannot be right: the
// number it would be raised past is a measurement of the dataset being wrong.
export const MAX_MEASURED_OVER_PREDICTED = 1.5;

// ── SHARDING ONE PACKAGE BELOW PACKAGE GRANULARITY (#16173) ────────────────
//
// The floor argument at the top of this file is not a caveat, it is a wall: a
// shard can never finish faster than its single heaviest package, so once ONE
// package exceeds MAX_SHARD_OVER_MEAN x the mean, no shard count meets the
// bound and pin 3 says so by name. The remedy is to split that suite below
// package granularity, the shape the Dogfood job has run since #4859: vitest's
// own `--shard=k/n` applied to ONE named package (carried to it in
// `OS_TEST_SHARD` rather than as a passthrough since #19278 -- see SLICE_ENV
// below; the argument that follows is about vitest's shard, not the carrier).
// The objection this file records against passthrough is specific and it does
// not reach here -- `--shard` on a package with fewer test files than the shard
// count hard-fails on vitest 4, and `--passWithNoTests` converts that into
// running NOTHING. That is fatal WORKSPACE-WIDE, where three packages own one
// test file each. Applied to one package with hundreds of them it cannot arise,
// and `sliceCountFor` below refuses the configuration in which it could.
//
// HOW n IS DERIVED, AND WHAT HOLDS EACH HALF. n is the SMALLEST integer for
// which the split meets the acceptance bound against the mean the committed
// dataset produces. Meeting it is pins 2 and 3 below, on the configured split.
// Smallest is pin 3c: every slice past the first costs the shard that carries
// it a turbo leg of its own and a build of the package's whole closure (ci.yml,
// "Build the sliced package's dependency closure"), and buys nothing once the
// bound is met, so an n that n - 1 could replace is refused -- n = 2 that 1
// could replace means retire the entry.
//
// THE MAP IS EMPTY, BY THAT DERIVATION. `@objectstack/cli` was sliced at n = 2
// on a reading of 1231.52s (run 34009395649 attempt 2, job 101427282674)
// against a 458.15s dataset entry: the mean was then ~800s, the bound ~1041s,
// and the whole CLI stood at 1.54x of the mean. Until a refresh landed, pin 3c
// substituted that reading into the stale dataset.
//
// ⚠ THE ENTRY WAS FIRST RETIRED ON A FIGURE THAT WAS NOT THE CLI'S WHOLE COST
// (#21758). The refresh of run 36380128221 (72 packages, 7430.00s) recorded the
// CLI at 733.33s -- its two slice windows summed within that ONE run, the only
// sample that refresh had -- and this block solved the bound against it,
// C <= (1.3/6)(6696.67 + C), to "fits whole until ~1852s". Once the CLI ran
// whole, its windows read 1659.03s and 1667.97s (runs 37199214385 and
// 37212954836), 2.26-2.27x that entry. The conclusion survived, since both sit
// under ~1852s; the figure it was argued from did not.
//
// RE-DERIVED on the refresh that measured the CLI WHOLE (#21826): run
// 37262126122, 72 packages, 9781.33s, the CLI at 1702.69s and now the heaviest
// item. The other 71 packages total 8078.64s, so the mean is 1630.22s and the
// bound 2119.29s, and on that dataset
//
//   CLI whole, as measured there (1702.69s)   max/mean 1.044x   heaviest 1703s (cli)
//   CLI sliced at 2                           max/mean 1.002x   heaviest 1135s (spec)
//   CLI whole at its worst since (1753.66s)   max/mean 1.070x   heaviest 1754s (cli)
//
// -- all inside 1.3x. Whole, the CLI fills bin 1 alone and the other five bins
// sit at 1614.77-1616.73s. Slicing would lower the maximum, but the bound is
// already met at n = 1, which is exactly the refusal pin 3c makes of a
// `{ '@objectstack/cli': 2 }` entry ("Retire the entry"). Solving
// C <= (1.3/6)(8078.64 + C) for the CLI's whole cost C, it fits whole until it
// reaches ~2234s: 1.31x its dataset entry, 1.27x its worst reading since
// (run 37415122516). n = 1 is the derived answer, so the entry stays retired.
// The MECHANISM stays, and its pins run on fixtures: the item grammar,
// expandSlices, the vitest file-count floor, the OS_TEST_SHARD wiring judge and
// the generator's slice reassembly. The next package pin 3 names is one entry
// here, plus its own OS_TEST_SHARD wiring, away from being sliced.
//
// ⛔ Slicing is a SCHEDULING fact, not a measurement one: the dataset keeps
// holding each package's WHOLE cost, and the division by n happens here. That
// is what keeps a refresh comparable across a change to this map, and it is why
// measure-test-shard-timings.mjs has to reassemble a package's slices before it
// records one -- see `sliceOfCliArguments` there. A change to this map is also
// a change to what that generator can DECODE, which is why the map it replaced
// is kept below.
export const FILE_SHARDED_PACKAGES = Object.freeze({});

// THE MAP AS IT STOOD BEFORE ITS LAST CHANGE, read only by the generator's
// slice-digest matcher (measure-test-shard-timings.mjs `sliceOfEnvironment`).
//
// A run summary records a slice only as the sha256 of its `OS_TEST_SHARD`
// value, and the matcher decodes that digest against the slices the
// partitioner can emit, refusing the whole summary when nothing matches. So a
// run made BEFORE a change to the map above -- slices the map no longer emits
// -- is refused, and while every retained run predates the change, the
// refresh lane can measure nothing at all. That is not hypothetical: on the
// change that emptied the map, the lane's pull_request rehearsal (run
// 37074888579) refused all ten eligible hourly runs on main and regenerated
// nothing.
//
// With the outgoing map here, a pre-change slice decodes EXACTLY -- by hash
// equality, against this closed map, never by guessing a count -- and is then
// summed within its run like any slice, so a run that cannot assemble the
// package still contributes nothing (`skippedIncompleteSlices`). A digest
// matching neither map is refused as before.
//
// Set it to the OUTGOING map in the same PR that changes FILE_SHARDED_PACKAGES.
// Its only readers are run summaries, which ci.yml keeps for one day
// (`retention-days: 1` on `test-core-run-summary-*`), so a day after that PR
// lands no retained summary predates the change and this map decodes nothing.
export const PREVIOUS_FILE_SHARDED_PACKAGES = Object.freeze({
  '@objectstack/cli': 2,
});

// The item grammar. A shard item is a package (`@objectstack/cli`) or a SLICE
// of one (`@objectstack/cli 1/2`), and this pair of functions is the only place
// that spelling is written or read -- ci.yml builds the turbo invocation from
// it and check-test-completeness.mjs joins its scheduled list through it, so a
// second reader would be a second grammar.
//
// A space is the separator on purpose: npm package names cannot contain one
// (and `#` and `:` are both turbo task syntax, which `--filter` would try to
// interpret).
const SLICE_SPEC = /^(\S+)\s+([1-9]\d*)\/([1-9]\d*)$/;

export function formatShardItem(name, slice) {
  return slice ? `${name} ${slice.index}/${slice.count}` : name;
}

export function parseShardItem(line) {
  const text = String(line).trim();
  const m = SLICE_SPEC.exec(text);
  if (!m) return { name: text, slice: null };
  const [, name, index, count] = m;
  if (Number(index) > Number(count)) {
    throw new Error(`shard item ${JSON.stringify(text)}: slice index exceeds its count`);
  }
  return { name, slice: { index: Number(index), count: Number(count) } };
}

// How many file-level slices a package is split into, and the ONE place the map
// is consulted. `fileCount` is optional because the two callers know different
// things: weighItems() has the package directory and can enforce the vitest
// floor, while the dataset-level balancing pins have only names and weights.
//
// ⛔ The floor is a REFUSAL, not a clamp. Silently reducing n to the file count
// would hand back a split that balances a quantity CI cannot run, which is the
// #16173 failure shape one level up: a number that reads right and is not.
//
// `sliced` is the live map everywhere but the self-test, which hands in a
// fixture so the mechanism stays pinned while the live map slices nothing.
export function sliceCountFor(name, fileCount = null, sliced = FILE_SHARDED_PACKAGES) {
  const n = Object.hasOwn(sliced, name) ? sliced[name] : 1;
  if (n > 1 && fileCount !== null && fileCount < n) {
    throw new Error(
      `${name} is configured for ${n} file-level slices but owns ${fileCount} test file(s). ` +
        'vitest --shard hard-fails when the shard count exceeds the file count, and ' +
        '--passWithNoTests turns that failure into running NOTHING on every slice. ' +
        'Lower FILE_SHARDED_PACKAGES for this package, or stop slicing it.'
    );
  }
  return n;
}

// ── A SLICE MUST REACH THE SUITE IT SLICES (#19278) ────────────────────────
//
// Test Core hands a slice to its package as `OS_TEST_SHARD=k/n` in the
// environment of that slice's own turbo run -- no longer as a `-- --shard=k/n`
// passthrough, which turbo folds into the hash of every task in the run and
// which therefore needed `--only`, which in turn dropped the build closure out
// of the test task's hash (#18671). Two halves must both hold for the value to
// arrive, and missing either one is SILENT: the slice's run goes green having
// run the WHOLE suite, on every shard that carries a slice, because vitest
// never hears of a shard.
//
//   1. turbo.json declares it in the `env` of the package's `test` task. turbo
//      2.10 runs in strict env mode and strips an undeclared variable before
//      the task's shell sees it -- and the declaration is also what puts the
//      slice into the task hash, so `1/2` and `2/2` never share a cache entry.
//      A `<package>#test` entry REPLACES the generic `test` task for that
//      package, so the declaration is read from the one that applies.
//   2. the package's vitest config reads it into vitest's `shard`. vitest
//      4.1.11 reads no shard variable of its own.
//
// ⛔ A SPELLING check, the check-tier-file-adoption idiom: it proves both halves
// are wired, never that vitest honours them. That was measured on the change
// that introduced the variable (the same small file set under unset / 1/2 /
// 2/2: 6 files, then two disjoint 3s whose union is the 6). The read is looked
// for in code position only -- comments and literals are masked first -- so a
// config that merely MENTIONS the variable in prose does not satisfy it.
export const SLICE_ENV = 'OS_TEST_SHARD';
const SLICE_READ = new RegExp(`\\bshard\\s*:\\s*process\\.env\\.${SLICE_ENV}\\b`);
const VITEST_CONFIG_NAMES = Object.freeze([
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
]);

// The verdict for one sliced package, from what was read. Pure, so the
// self-test pins every direction without a tree to break. Returns the
// problems, empty when both halves are wired.
export function judgeSliceWiring(name, { configFile, configSource, turbo, packageTurboJson = false }) {
  const problems = [];
  if (packageTurboJson) {
    problems.push(
      `${name}: carries its own turbo.json, whose task merge this check does not model -- ` +
        'teach judgeSliceWiring() to read it before trusting a green here.'
    );
  }
  const tasks = turbo?.tasks ?? {};
  const own = `${name}#test`;
  const where = Object.hasOwn(tasks, own) ? `turbo.json tasks["${own}"]` : 'turbo.json tasks.test';
  const def = Object.hasOwn(tasks, own) ? tasks[own] : tasks.test;
  if (!def) {
    problems.push(`${name}: turbo.json defines no \`test\` task that applies to it.`);
  } else if (!Array.isArray(def.env) || !def.env.includes(SLICE_ENV)) {
    problems.push(
      `${name}: ${where}.env does not declare ${SLICE_ENV}. turbo's strict env mode strips it ` +
        'before vitest starts, so every slice of this package runs its WHOLE suite, green.'
    );
  }
  if (configSource == null) {
    problems.push(
      `${name}: no vitest config (${VITEST_CONFIG_NAMES.join(' / ')}) to read ${SLICE_ENV} -- ` +
        'vitest reads no shard variable itself, so every slice would run the WHOLE suite.'
    );
  } else if (!SLICE_READ.test(maskCommentsAndLiterals(configSource))) {
    problems.push(
      `${name}: ${configFile} never reads ${SLICE_ENV} into vitest's \`shard\` ` +
        `(\`shard: process.env.${SLICE_ENV}\`, in code rather than a comment) -- every slice ` +
        'of this package would run its WHOLE suite, green.'
    );
  }
  return problems;
}

// Both halves, read from the tree, for every package FILE_SHARDED_PACKAGES
// names. `judged` is returned beside the problems so a caller can tell "every
// sliced package is wired" apart from "no package was looked at".
export function sliceWiringProblems(root = REPO_ROOT, sliced = FILE_SHARDED_PACKAGES) {
  const turbo = JSON.parse(readFileSync(path.join(root, 'turbo.json'), 'utf8'));
  const dirOf = new Map(workspacePackages(root).map(({ dir, manifest }) => [manifest?.name, dir]));
  const problems = [];
  let judged = 0;
  for (const name of Object.keys(sliced)) {
    const dir = dirOf.get(name);
    if (dir === undefined) {
      problems.push(`${name}: named in FILE_SHARDED_PACKAGES, but no workspace package carries that name.`);
      continue;
    }
    const file = VITEST_CONFIG_NAMES.find((f) => existsSync(path.join(root, dir, f)));
    problems.push(
      ...judgeSliceWiring(name, {
        configFile: file ? `${dir}/${file}` : null,
        configSource: file ? readFileSync(path.join(root, dir, file), 'utf8') : null,
        turbo,
        packageTurboJson: existsSync(path.join(root, dir, 'turbo.json')),
      })
    );
    judged++;
  }
  return { problems, judged };
}

// Expand weighed packages into shard items, splitting a file-sharded package's
// WHOLE weight evenly across its slices. Every downstream consumer -- partition,
// balanceOf, the balancing pins -- sees one flat list of `{name, weight}` whose
// `name` is the item's printed label, so nothing below has to know that some
// items are slices.
export function expandSlices(items) {
  const out = [];
  for (const it of items) {
    const count = it.sliceCount ?? sliceCountFor(it.name);
    if (count === 1) {
      out.push({ name: it.name, weight: it.weight, pkg: it.name, slice: null });
      continue;
    }
    for (let index = 1; index <= count; index++) {
      const slice = { index, count };
      out.push({
        name: formatShardItem(it.name, slice),
        weight: it.weight / count,
        pkg: it.name,
        slice,
      });
    }
  }
  return out;
}

// Two slices of the same package must never share a bin, and this asserts it
// rather than assuming it. LPT gives it for free in every arrangement measured
// here -- equal-weight slices are placed consecutively into distinct lightest
// bins -- but "for free" is a property of the weights, not of the algorithm,
// and the day it stops holding the damage is silent in both directions: ci.yml
// would run one turbo invocation per slice against the SAME package on one
// runner (serialising what the split exists to spread), while the completeness
// join, which keys reported packages by name, could not tell the second slice
// from the first. A refusal here costs a red partition step naming the bin.
export function assertSlicesSpread(bins) {
  for (const [i, bin] of bins.entries()) {
    const seen = new Set();
    for (const label of bin.names) {
      const { name, slice } = parseShardItem(label);
      if (!slice) continue;
      if (seen.has(name)) {
        throw new Error(
          `bin ${i + 1} holds more than one slice of ${name} (${bin.names.join(', ')}) -- ` +
            'file-level slices of one package must land on different shards or the split ' +
            'spreads nothing. Refusing to shard.'
        );
      }
      seen.add(name);
    }
  }
  return bins;
}

// Whether a split of `items` meets the acceptance bound, in the two halves pins
// 2 and 3 grade on the committed dataset: the heaviest bin within
// MAX_SHARD_OVER_MEAN x the mean, and no single item heavier than that, because
// no split can put a bin below its heaviest item.
function meetsBound(items, shardCount, bound) {
  const b = balanceOf(partition(items, shardCount), items);
  return { ...b, meets: b.ratio <= bound && b.floor <= bound * b.mean };
}

// THE "SMALLEST" HALF OF THE SLICE-COUNT DERIVATION -- pin 3c. For every
// package `sliced` names, re-split the dataset with that package at n - 1
// slices (every other package at its configured count) and report the entry
// when that split ALSO meets the bound: n is then not the smallest count that
// works, and the slices past it cost legs and closure builds for nothing. The
// "meets" half is pins 2 and 3 on the configured split, so this judges
// minimality only.
//
// Two shapes are problems before any arithmetic, because nothing can derive
// the count they claim: a named package the dataset carries no weight for, and
// a count below 2 -- 1 is no slicing at all, and 0 would make expandSlices emit
// NO item for the package, a package no shard runs.
//
// `packages` is whole-package `{name, weight}` (the dataset as CI bins it).
// `judged` is returned beside the problems so a caller can tell "every sliced
// package is minimal" apart from "no package was looked at".
export function sliceCountProblems(
  packages,
  sliced = FILE_SHARDED_PACKAGES,
  shardCount = SHARD_COUNT,
  bound = MAX_SHARD_OVER_MEAN
) {
  const weights = new Map(packages.map((p) => [p.name, p.weight]));
  const problems = [];
  let judged = 0;
  for (const [name, n] of Object.entries(sliced)) {
    if (!Number.isInteger(n) || n < 2) {
      problems.push(
        `${name}: FILE_SHARDED_PACKAGES gives it ${JSON.stringify(n)} slices -- an entry slices at least 2 ways. ` +
          'Remove the entry to run the package whole.'
      );
      continue;
    }
    if (!weights.has(name)) {
      problems.push(
        `${name}: FILE_SHARDED_PACKAGES slices it ${n} ways, but the dataset carries no weight for it, ` +
          'so nothing derives that count.'
      );
      continue;
    }
    judged++;
    const fewer = n - 1;
    const items = expandSlices(
      packages.map((p) => ({
        name: p.name,
        weight: p.weight,
        sliceCount: p.name === name ? fewer : Object.hasOwn(sliced, p.name) ? sliced[p.name] : 1,
      }))
    );
    const at = meetsBound(items, shardCount, bound);
    if (at.meets) {
      problems.push(
        `${name}: sliced ${n} ways at ${weights.get(name)}s, but at ${fewer} the split already meets ` +
          `${bound}x (max/mean ${at.ratio.toFixed(2)}x, heaviest item ${at.floor.toFixed(0)}s against a ` +
          `${at.mean.toFixed(0)}s mean). ${fewer === 1 ? 'Retire the entry' : `Lower it to ${fewer}`}: ` +
          'a slice count a smaller one could replace is one no pin can hold.'
      );
    }
  }
  return { problems, judged };
}

// What a run was predicted to spend on a package it just ran. A shard runs
// exactly one slice of a file-sharded package -- the slices are placed in
// distinct bins, asserted in main() -- so the prediction to compare a measured
// window against is the dataset's whole-package entry divided by the slice
// count. Charging a slice the whole package's entry would read as a ~n x
// under-run and, worse, dilute a real overshoot elsewhere on the same shard
// into a ratio that stays under the bound.
//
// `sliceCount` is passed in by `--check-drift` from what the SUMMARY says the
// run actually was, not from FILE_SHARDED_PACKAGES. The two agree on a Test Core
// shard, and only the observed one is right anywhere else: a developer running
// the suite locally runs the CLI whole, and charging that whole run a half-sized
// prediction would report a 2x drift that is purely this function's arithmetic.
// The config remains the default for callers with no run in hand.
export function predictedSecondsFor(name, timings, sliceCount = sliceCountFor(name)) {
  return timings.packages[name] / sliceCount;
}

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
//
// `sliced` is the live map everywhere but the self-test (see sliceCountFor).
export function weighItems(items, excluded, timings, label = 'package list', sliced = FILE_SHARDED_PACKAGES) {
  const weighed = [];
  let estimated = 0;
  for (const it of items) {
    if (typeof it?.name !== 'string' || typeof it?.path !== 'string') {
      throw new Error(`${label}: package entry missing name/path: ${JSON.stringify(it)}`);
    }
    if (excluded.has(it.name)) continue;
    const dir = packageDir(it.path);
    const { seconds, measured } = weighPackage(it.name, dir, timings);
    if (!measured) estimated++;
    // The vitest file-count floor is checked HERE and only here, because this is
    // the one weighing path that knows where the package lives. `sliceCountFor`
    // throws rather than clamping -- see its header.
    const sliceCount = Object.hasOwn(sliced, it.name)
      ? sliceCountFor(it.name, countTestFiles(dir), sliced)
      : 1;
    weighed.push({ name: it.name, weight: seconds, sliceCount });
  }
  return { weighted: expandSlices(weighed), estimated, packages: weighed.length };
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
// `sliced` is the live map everywhere but the self-test (see sliceCountFor); it
// only answers for a package the caller observed nothing about.
export function driftReport(
  measured,
  timings,
  factor = MAX_MEASURED_OVER_PREDICTED,
  observedSlices = null,
  sliced = FILE_SHARDED_PACKAGES
) {
  const rows = [];
  const unpredicted = [];
  let predictedTotal = 0;
  let measuredTotal = 0;
  for (const [name, seconds] of measured) {
    if (!Object.hasOwn(timings.packages, name)) {
      unpredicted.push(name);
      continue;
    }
    // Through predictedSecondsFor, never the raw dataset entry: a shard that
    // ran one SLICE of a file-sharded package was predicted one slice's cost.
    // When the caller observed the run's own slice spec, that wins over the
    // configured one -- `observedSlices` present but silent about a package
    // means the summaries show it running WHOLE, which is a fact about the run.
    const predicted = observedSlices
      ? predictedSecondsFor(name, timings, observedSlices.get(name)?.count ?? 1)
      : predictedSecondsFor(name, timings, sliceCountFor(name, null, sliced));
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
  // 3 of these 25 are the end-to-end inversion pin, which runs only while the
  // dataset still carries both packages of its inversion pair. That guard is
  // silent today: drop either package in a timings refresh and the pin stops
  // testing anything. Flooring at the measured count makes that loud, and the
  // remedy is the one the pin itself names -- pick a new inversion pair from
  // the dataset -- never lowering this number.
  // 8 of these 25 are pins 3b and 3c, the file-level slicing's (#16173), and
  // every one of them runs unconditionally: 3c's fixtures and 3b's cut of the
  // heaviest package do not depend on what the live map slices.
  'the balancing pins (#10472)': 25,
  'predicted-vs-measured drift (#16173)': 9,
  'file-level slice items (#16173)': 20,
  'file-level slices reach vitest through OS_TEST_SHARD (#19278)': 11,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

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
  // WRONG quantity satisfies every one of those assertions. These pin the
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
  // Through expandSlices, because that is the item list CI bins. Reading the
  // dataset's packages straight into the pin would grade a shape no shard runs:
  // after #16173 the CLI reaches the partitioner as file-level slices, and a pin
  // that still weighs it whole would red on the refresh that fixes it and go
  // green on a revert that removes the slicing.
  const datasetPackages = Object.entries(timings.packages)
    .filter(([name]) => !ciExcludes.has(name))
    .map(([name, weight]) => mk(name, weight));
  const datasetItems = expandSlices(datasetPackages);
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

  // 3b. THE SLICES A SPLIT CARRIES ARE SPREAD (#16173). main() asserts it on
  //     every real run; the first case grades the committed dataset as CI
  //     splits it. While the live map slices nothing that case has no slice to
  //     look at, so the second cuts the dataset's heaviest package in two and
  //     grades THAT split -- real weights, a real slice pair, whatever the map
  //     says -- and first proves the pair is there to grade.
  check(() => {
    assertSlicesSpread(real);
  });
  const heaviest = datasetPackages.reduce((m, p) => (p.weight > m.weight ? p : m));
  const cutItems = expandSlices(
    datasetPackages.map((p) => ({ ...p, sliceCount: p === heaviest ? 2 : sliceCountFor(p.name) }))
  );
  check(() => {
    const cut = partition(cutItems, SHARD_COUNT);
    const halves = [1, 2].map((index) => formatShardItem(heaviest.name, { index, count: 2 }));
    const bins = halves.map((label) => cut.findIndex((bin) => bin.names.includes(label)));
    if (bins.includes(-1)) {
      throw new Error(`slice spread: cutting ${heaviest.name} in two produced no ${halves.join(' + ')} pair to grade`);
    }
    assertSlicesSpread(cut);
  });

  // 3c. THE SLICE COUNT IS DERIVED, NOT REMEMBERED (#16173). Pins 2 and 3
  //     prove the configured split meets the bound; neither can fail because a
  //     count is LARGER than the bound needs, and a count nothing can fail on
  //     is how a slicing outlives its reason. sliceCountProblems() re-splits
  //     with each sliced package at n - 1 and refuses an n that n - 1 could
  //     replace -- the counterfactual this pin used to hard-code for the CLI,
  //     now asked of the committed dataset for every entry.
  //
  //     The live map is EMPTY by this pin's own arithmetic (see
  //     FILE_SHARDED_PACKAGES), so the live case judges zero entries, and that
  //     zero is the true reading rather than a skipped one: the empty map's
  //     claim is that every package fits WHOLE, and pin 3 above is the case
  //     that fails the day one stops fitting, naming slicing as the remedy.
  //     The fixtures after it hold every refusal sliceCountProblems() makes, in
  //     both directions, on numbers that do not move with a refresh.
  const derivation = sliceCountProblems(datasetPackages);
  check(() => {
    const expected = Object.keys(FILE_SHARDED_PACKAGES).length;
    if (derivation.problems.length > 0 || derivation.judged !== expected) {
      throw new Error(
        `slice derivation, committed dataset (${derivation.judged} of ${expected} sliced package(s) judged):\n` +
          derivation.problems.map((p) => `  - ${p}`).join('\n')
      );
    }
  });
  // Six shards, ten 50s fillers and one `big` package; the bound is 1.3x the
  // mean. big = 300: mean 133.3s, bound 173.3s, so whole it breaches and one
  // 150s half fits -- 2 is the smallest count. big = 120: mean 103.3s, bound
  // 134.3s, so whole it already fits -- today's CLI, in miniature.
  const fixture = (big) => [mk('big', big), ...Array.from({ length: 10 }, (_, i) => mk(`filler${i}`, 50))];
  check(() => {
    const r = sliceCountProblems(fixture(300), { big: 2 });
    if (r.judged !== 1 || r.problems.length > 0) {
      throw new Error(
        `slice derivation: a count of 2 that 1 cannot replace was refused (judged ${r.judged}; ` +
          `${r.problems.join(' | ') || 'no problem named'})`
      );
    }
  });
  check(() => {
    const r = sliceCountProblems(fixture(120), { big: 2 });
    if (!r.problems.some((m) => m.includes('Retire the entry'))) {
      throw new Error('slice derivation: a package that fits whole kept its slicing with no refusal');
    }
  });
  check(() => {
    const r = sliceCountProblems(fixture(300), { big: 3 });
    if (!r.problems.some((m) => m.includes('Lower it to 2'))) {
      throw new Error('slice derivation: a count of 3 where 2 meets the bound was accepted');
    }
  });
  check(() => {
    const r = sliceCountProblems(fixture(300), { ghost: 2 });
    if (r.judged !== 0 || !r.problems.some((m) => m.includes('carries no weight'))) {
      throw new Error('slice derivation: an entry the dataset never measured was accepted');
    }
  });
  check(() => {
    const r = sliceCountProblems(fixture(300), { big: 1 });
    if (!r.problems.some((m) => m.includes('at least 2 ways'))) {
      throw new Error('slice derivation: an entry of fewer than 2 slices was accepted');
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
  //    makes it able to fail: @objectstack/plugin-pinyin-search runs LONGER
  //    than @objectstack/sdui-parser out of FEWER test files (2 vs 13).
  //    Whichever quantity is in force decides the order, and the two answers
  //    are opposite -- so this assertion cannot be satisfied by both. The pair
  //    holds on both datasets this file has been graded against (14.40s vs
  //    1.62s measured 2026-08-24; 38.77s vs 4.54s in run 36380128221), ~8.5x
  //    apart each time. The pair before it (example-todo over core) flipped in
  //    that refresh, 35.30s vs 57.09s, which is why the first guard below reads
  //    the DATASET's order as well as the file counts: a flipped pair is a
  //    fixture to replace, not a weighing defect, and must not red as one.
  const invA = '@objectstack/plugin-pinyin-search';
  const invB = '@objectstack/sdui-parser';
  const invAPath = 'packages/plugins/plugin-pinyin-search';
  const invBPath = 'packages/sdui-parser';
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
      if (!(timings.packages[invA] > timings.packages[invB])) {
        throw new Error(
          `inversion pin: the dataset no longer measures ${invA} slower than ${invB} ` +
            `(${timings.packages[invA]}s vs ${timings.packages[invB]}s), so this case can no longer tell ` +
            'duration from count. Pick a new inversion pair from the dataset.'
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

  // -- FILE-LEVEL SLICE ITEMS (#16173) ------------------------------------
  //
  // The grammar, its refusals, and the two joins that read it. The balancing
  // pins above prove the sliced split BALANCES; these prove a slice is a thing
  // the rest of the pipeline can carry -- printed, parsed back, charged the
  // right prediction, and never doubled onto one shard.
  //
  // The cases that need a SLICED package read `sliceFixture`, never the live
  // map: the live map slices whatever pin 3c derives, which today is nothing,
  // and a mechanism pin that read it would stop testing anything the day it
  // went empty. The CLI stands in for the sliced package because it is the one
  // whose OS_TEST_SHARD wiring is in the tree and whose directory holds real
  // test files for the vitest floor to count.
  battery('file-level slice items (#16173)');
  const sliceFixture = Object.freeze({ '@objectstack/cli': 2 });

  check(() => {
    const it = parseShardItem('@objectstack/spec');
    if (it.name !== '@objectstack/spec' || it.slice !== null) {
      throw new Error(`item grammar: a bare package name parsed as ${JSON.stringify(it)}`);
    }
  });
  check(() => {
    const it = parseShardItem('@objectstack/cli 2/3');
    if (it.name !== '@objectstack/cli' || it.slice.index !== 2 || it.slice.count !== 3) {
      throw new Error(`item grammar: a slice parsed as ${JSON.stringify(it)}`);
    }
  });
  check(() => {
    // Loud, not lenient: `3/2` is a caller bug, and a slice silently clamped or
    // read as a package name would schedule vitest to run nothing.
    let threw = false;
    try {
      parseShardItem('@objectstack/cli 3/2');
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('item grammar: an out-of-range slice index was accepted');
  });
  check(() => {
    const label = formatShardItem('@objectstack/cli', { index: 1, count: 2 });
    if (label !== '@objectstack/cli 1/2') throw new Error(`item grammar: formatted as ${JSON.stringify(label)}`);
    const back = parseShardItem(label);
    if (back.name !== '@objectstack/cli' || back.slice.index !== 1 || back.slice.count !== 2) {
      throw new Error('item grammar: format -> parse did not round-trip');
    }
  });
  check(() => {
    if (formatShardItem('@objectstack/spec', null) !== '@objectstack/spec') {
      throw new Error('item grammar: an unsliced item did not print as a bare package name');
    }
  });

  check(() => {
    if (sliceCountFor('@objectstack/spec', null, sliceFixture) !== 1) {
      throw new Error('slice count: a package outside the slice map was sliced');
    }
  });
  check(() => {
    if (sliceCountFor('@objectstack/cli', null, sliceFixture) !== 2) {
      throw new Error('slice count: the configured package did not read its configured count');
    }
  });
  check(() => {
    // A1: the ONE objection this file records against vitest --shard, made
    // unreachable by construction. Slicing below the file count is refused, not
    // clamped -- vitest hard-fails there and --passWithNoTests turns that into
    // every slice running nothing.
    let message = '';
    try {
      sliceCountFor('@objectstack/cli', 1, sliceFixture);
    } catch (err) {
      message = err.message;
    }
    if (!message.includes('owns 1 test file(s)')) {
      throw new Error(`slice floor: slicing below the test-file count was not refused (${message || 'no throw'})`);
    }
  });
  check(() => {
    if (sliceCountFor('@objectstack/cli', 500, sliceFixture) !== 2) {
      throw new Error('slice floor: a package with plenty of test files was refused');
    }
  });

  check(() => {
    const [only] = expandSlices([{ name: 'plain', weight: 12 }]);
    if (only.name !== 'plain' || only.slice !== null || only.pkg !== 'plain' || only.weight !== 12) {
      throw new Error(`expandSlices: an unsliced item came back as ${JSON.stringify(only)}`);
    }
  });
  check(() => {
    const out = expandSlices([{ name: '@objectstack/cli', weight: 1200, sliceCount: 3 }]);
    const labels = out.map((i) => i.name).join(', ');
    if (labels !== '@objectstack/cli 1/3, @objectstack/cli 2/3, @objectstack/cli 3/3') {
      throw new Error(`expandSlices: produced ${labels}`);
    }
    if (out.some((i) => i.weight !== 400 || i.pkg !== '@objectstack/cli')) {
      throw new Error('expandSlices: a slice did not carry an even share of the whole weight, or lost its package');
    }
  });
  check(() => {
    // The invariant that keeps the mean honest: slicing redistributes weight,
    // it never creates or destroys any. A split whose total moved would change
    // the bound every other pin is measured against.
    const before = [{ name: '@objectstack/cli', weight: 1231.52, sliceCount: 4 }, { name: 'x', weight: 7 }];
    const total = (list) => list.reduce((s, i) => s + i.weight, 0);
    if (Math.abs(total(expandSlices(before)) - total(before)) > 1e-9) {
      throw new Error('expandSlices: the total weight changed');
    }
  });

  check(() => {
    let threw = false;
    try {
      assertSlicesSpread([{ total: 0, names: ['@objectstack/cli 1/2', '@objectstack/cli 2/2'] }]);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('slice spread: two slices of one package shared a bin and were accepted');
  });
  check(() => {
    assertSlicesSpread([
      { total: 0, names: ['@objectstack/cli 1/2', '@objectstack/spec'] },
      { total: 0, names: ['@objectstack/cli 2/2'] },
    ]);
  });

  const sliceTimings = { packages: { '@objectstack/cli': 1200, other: 100 }, rate: 2 };
  check(() => {
    if (predictedSecondsFor('@objectstack/cli', sliceTimings, sliceCountFor('@objectstack/cli', null, sliceFixture)) !== 600) {
      throw new Error('prediction: a sliced package was charged its WHOLE dataset entry');
    }
  });
  check(() => {
    if (predictedSecondsFor('other', sliceTimings) !== 100) {
      throw new Error('prediction: an unsliced package was divided');
    }
  });
  check(() => {
    // END-TO-END, and the case that says why the two above matter. A shard that
    // ran one slice measured 1000s against a 600s slice prediction -- drift. Had
    // the slice been charged the whole 1200s entry the same reading would have
    // come back 0.83x, i.e. a real overshoot presented as a comfortable
    // under-run, and any genuine drift elsewhere on that shard diluted with it.
    const measured = measuredMap({ '@objectstack/cli': 1000 });
    const r = driftReport(measured, sliceTimings, undefined, null, sliceFixture);
    if (!r.drifted) {
      throw new Error(`drift: a sliced overshoot read ${r.ratio.toFixed(2)}x and was not reported as drift`);
    }
    if (Math.abs(r.predictedTotal - 600) > 1e-9) {
      throw new Error(`drift: the slice was predicted ${r.predictedTotal}s, not its slice share`);
    }
  });

  check(() => {
    // The run wins over the config. An OBSERVED whole run of a configured-sliced
    // package is predicted the WHOLE entry, so the same 1000s reading is a
    // comfortable under-run rather than the 1.67x above. Without this, anyone
    // running the suite locally (where the CLI runs whole) would get a drift red
    // that is purely predictedSecondsFor's arithmetic.
    const r = driftReport(measuredMap({ '@objectstack/cli': 1000 }), sliceTimings, undefined, new Map(), sliceFixture);
    if (r.drifted) {
      throw new Error(`drift: an observed WHOLE run was charged a slice-sized prediction (${r.ratio.toFixed(2)}x)`);
    }
    if (Math.abs(r.predictedTotal - 1200) > 1e-9) {
      throw new Error(`drift: an observed whole run was predicted ${r.predictedTotal}s, not the whole 1200s`);
    }
  });
  check(() => {
    // ...and an observed slice count that differs from the configured one is
    // honoured, because the summary is the record of what actually ran.
    const observed = new Map([['@objectstack/cli', { index: 1, count: 3 }]]);
    const r = driftReport(measuredMap({ '@objectstack/cli': 400 }), sliceTimings, undefined, observed, sliceFixture);
    if (Math.abs(r.predictedTotal - 400) > 1e-9) {
      throw new Error(`drift: an observed 1/3 slice was predicted ${r.predictedTotal}s, not 400s`);
    }
  });

  check(() => {
    // The REAL weighing path, on a REAL package: main() must hand partition()
    // slices, not one package-shaped lump. Pin 6 above proves weighItems reads
    // durations; this proves it splits a package the slice map names, with the
    // vitest floor counting that package's real test files on the way.
    const n = sliceFixture['@objectstack/cli'];
    const { weighted, packages } = weighItems(
      [{ name: '@objectstack/cli', path: 'packages/cli' }],
      new Set(),
      loadTimings(),
      'slice pin',
      sliceFixture
    );
    if (packages !== 1 || weighted.length !== n) {
      throw new Error(`weighItems: ${packages} package(s) produced ${weighted.length} item(s), expected ${n}`);
    }
    if (!weighted.every((i) => i.slice && i.pkg === '@objectstack/cli')) {
      throw new Error('weighItems: the CLI reached partition() unsliced');
    }
  });

  // -- A SLICE MUST REACH THE SUITE IT SLICES (#19278) --------------------
  //
  // The live tree first: every package this file slices declares
  // OS_TEST_SHARD on the `test` task that applies to it AND reads it into
  // vitest's `shard`. Then the judge on synthetic inputs, each half removed in
  // turn, so a judge that stopped looking at a half cannot stay green.
  battery('file-level slices reach vitest through OS_TEST_SHARD (#19278)');

  // Every live entry judged, and judged clean. The live map is empty today
  // (pin 3c), so this judges zero packages and that zero is exact: no slice
  // exists to reach vitest. What keeps the TREE-reading half measured either
  // way is the next case, which points the same reader at the CLI -- the one
  // package whose wiring is in the tree -- through a fixture map.
  check(() => {
    const { problems, judged } = sliceWiringProblems();
    const expected = Object.keys(FILE_SHARDED_PACKAGES).length;
    if (judged !== expected) {
      throw new Error(
        `slice wiring: judged ${judged} of ${expected} sliced package(s) -- an entry the reader ` +
          'skipped is one nothing vouches reaches vitest.'
      );
    }
    if (problems.length > 0) {
      throw new Error(`slice wiring, live tree:\n  - ${problems.join('\n  - ')}`);
    }
  });
  check(() => {
    const { problems, judged } = sliceWiringProblems(REPO_ROOT, sliceFixture);
    if (judged !== 1 || problems.length > 0) {
      throw new Error(
        `slice wiring, the tree read through a fixture map: judged ${judged} of 1 -- the CLI's ` +
          `OS_TEST_SHARD wiring is what re-slicing it would rely on:\n  - ${problems.join('\n  - ') || 'no problem named'}`
      );
    }
  });

  const wiredConfig = 'const s = { shard: process.env.OS_TEST_SHARD };\nexport default { test: { ...s } };\n';
  const genericOnly = { tasks: { test: { env: ['OS_TEST_TIERS', 'OS_TEST_SHARD'] } } };
  const judge = (over) =>
    judgeSliceWiring('@x/sliced', { configFile: 'x/vitest.config.ts', configSource: wiredConfig, turbo: genericOnly, ...over });

  check(() => {
    const p = judge({});
    if (p.length !== 0) throw new Error(`slice wiring: a fully wired package was refused: ${p.join(' | ')}`);
  });
  check(() => {
    const p = judge({ configSource: 'export default { test: {} };\n' });
    if (!p.some((m) => m.includes('never reads OS_TEST_SHARD'))) {
      throw new Error('slice wiring: a config that never reads the variable was accepted');
    }
  });
  check(() => {
    // Prose is not a read: the variable named only in a comment must not pass.
    const p = judge({ configSource: '// shard: process.env.OS_TEST_SHARD\nexport default { test: {} };\n' });
    if (!p.some((m) => m.includes('never reads OS_TEST_SHARD'))) {
      throw new Error('slice wiring: a config naming the variable only in a comment was accepted');
    }
  });
  check(() => {
    const p = judge({ configSource: null, configFile: null });
    if (!p.some((m) => m.includes('no vitest config'))) {
      throw new Error('slice wiring: a package with no vitest config was accepted');
    }
  });
  check(() => {
    const p = judge({ turbo: { tasks: { test: { env: ['OS_TEST_TIERS'] } } } });
    if (!p.some((m) => m.includes('tasks.test.env does not declare OS_TEST_SHARD'))) {
      throw new Error('slice wiring: a generic `test` task without the variable was accepted');
    }
  });
  check(() => {
    // A `<package>#test` entry REPLACES the generic task: declaring the
    // variable on the generic one does not reach a package that has its own.
    const p = judge({
      turbo: { tasks: { ...genericOnly.tasks, '@x/sliced#test': { env: ['OS_TEST_TIERS'] } } },
    });
    if (!p.some((m) => m.includes('tasks["@x/sliced#test"].env does not declare OS_TEST_SHARD'))) {
      throw new Error('slice wiring: a package-specific `test` task without the variable was accepted');
    }
  });
  check(() => {
    const p = judge({
      turbo: { tasks: { test: { env: [] }, '@x/sliced#test': { env: ['OS_TEST_SHARD'] } } },
    });
    if (p.length !== 0) {
      throw new Error(`slice wiring: a package-specific task that declares it was refused: ${p.join(' | ')}`);
    }
  });
  check(() => {
    const p = judge({ packageTurboJson: true });
    if (!p.some((m) => m.includes('carries its own turbo.json'))) {
      throw new Error('slice wiring: a package-level turbo.json this check does not model was accepted');
    }
  });
  check(() => {
    const { problems, judged } = sliceWiringProblems(REPO_ROOT, { '@objectstack/no-such-package': 2 });
    if (judged !== 0 || !problems.some((m) => m.includes('no workspace package carries that name'))) {
      throw new Error('slice wiring: a sliced name with no workspace package was accepted');
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
    `partition-test-shards: self-test OK (${datasetPackages.length} measured packages ` +
      `-> ${datasetItems.length} shard items, ${SHARD_COUNT} shards, ` +
      `max/mean ${balance.ratio.toFixed(2)}x <= ${MAX_SHARD_OVER_MEAN}x, floor ${balance.floor.toFixed(0)}s, ` +
      `bins ${balance.totals.map((t) => t.toFixed(0)).join('/')}s, file-level slices: ` +
      `${Object.entries(FILE_SHARDED_PACKAGES).map(([name, n]) => `${name} x${n}`).join(', ') || 'none'})`
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
  // What the summaries say each package was RUN as. A shard that carries a
  // file-level slice writes two summaries -- one per turbo invocation -- and
  // only the slice leg's tasks carry the slice (an `OS_TEST_SHARD` digest, or
  // `--shard=k/n` on a passthrough run), so this is per package and
  // comes from the run rather than from FILE_SHARDED_PACKAGES. A package absent
  // here ran whole; that is a reading, not a default.
  const observedSlices = new Map();
  for (const input of inputs) {
    const { samples, slices } = samplesFromSummary(JSON.parse(readFileSync(input, 'utf8')), input);
    for (const [name, seconds] of samples) {
      merged.set(name, Math.max(merged.get(name) ?? 0, seconds));
    }
    for (const [name, slice] of slices ?? []) observedSlices.set(name, slice);
  }
  const timings = loadTimings();
  const report = driftReport(merged, timings, MAX_MEASURED_OVER_PREDICTED, observedSlices);
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
  const { weighted, estimated, packages } = weighItems(items, excluded, timings, listPath);
  const bins = assertSlicesSpread(partition(weighted, shardCount));
  const mine = bins[shardIndex - 1];
  const { max, mean, ratio } = balanceOf(bins);
  // Printed on every shard, not just the imbalanced one, and printed as the
  // RATIO the acceptance bound is written in: the per-shard numbers alone never
  // said whether the split was balanced, which is why #10472's imbalance had to
  // be found by reading six job durations side by side after the fact.
  console.error(
    `shard ${shardSpec}: ${mine.names.length}/${weighted.length} items ` +
      `(${weighted.length - packages} of them file-level slices of ${packages} package(s)), ` +
      `${mine.total.toFixed(1)}s predicted (all bins: ${bins.map((b) => b.total.toFixed(0)).join('/')}s; ` +
      `max/mean ${ratio.toFixed(2)}x of the ${MAX_SHARD_OVER_MEAN}x bound, max ${max.toFixed(0)}s, mean ${mean.toFixed(0)}s; ` +
      `${packages - estimated} measured, ${estimated} estimated from test-file count)`
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
