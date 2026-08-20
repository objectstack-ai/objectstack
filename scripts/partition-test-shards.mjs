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
// Each package's weight is its test-file count. That is a deliberate proxy:
// suite wall-clock is dominated by fixed per-file cost (module-graph
// re-execution per file under isolation -- same measurement objectui's CI
// documents), so file count tracks duration far better than package count.
// Packages are placed heaviest-first into the lightest bin (LPT greedy), with
// all ties broken by name, so every shard computes the identical split from
// the same input without coordinating.
//
// HOW WELL THAT PROXY HOLDS, MEASURED (2026-08-20, queue builds, not a guess).
// Per-package durations read out of the turbo task groups in `merge_group` CI
// logs, against each package's weight in the same tree:
//
//   @objectstack/cli                135 files   548.6s / 474.4s   ~3.5-4.1 s/file
//   @objectstack/spec               414 files   496.4s            ~1.20 s/file
//   @objectstack/service-automation  83 files   118.9s            ~1.43 s/file
//   @objectstack/driver-turso        39 files    53.5s            ~1.37 s/file
//   @objectstack/client              24 files    34.7s            ~1.45 s/file
//   @objectstack/example-showcase    21 files    21.6s            ~1.03 s/file
//
// So the proxy tracks within roughly +-20% across the big packages and is off
// by ~2.8x on ONE of them (@objectstack/cli). The binning is not the problem:
// on the full package list a queue build hands this script, the three bins come
// out 783/783/782 -- a one-file spread across 2348, far inside LPT's <=4/3
// bound. Duration spread between shards in the same builds was up to 3.4x, and
// that gap is the proxy's, not the algorithm's.
//
// ⛔ THE HARD LIMIT, AND THE REASON RE-WEIGHTING ALONE CANNOT MEET #4859.
// Sharding is BY PACKAGE, so a shard can never finish faster than its single
// heaviest package. Two packages are already over #4859's "Test Core 最慢分片
// <= ~7min" threshold on their own: @objectstack/spec at 496s (8m16s) and
// @objectstack/cli at 548s (9m09s). Measured consequence -- in run
// 32352993803, Test Core shard 1 took 8m17.77s wall and @objectstack/spec's own
// suite accounted for 8m16.4s of it: the shard IS that one package. No weight
// function and no shard count changes that; only splitting those suites below
// package granularity, or moving the threshold, does. Anyone arriving here to
// swap the weight input should read that bound first (#10149).
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
//   node scripts/partition-test-shards.mjs --self-test
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function countTestFiles(dir) {
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

function selfTest() {
  const mk = (name, weight) => ({ name, weight });
  // Coverage + determinism: every package lands in exactly one bin, and two
  // runs over differently-ordered input agree.
  const items = [mk('e', 1), mk('a', 9), mk('c', 4), mk('b', 9), mk('d', 3)];
  const shuffled = [items[2], items[4], items[0], items[3], items[1]];
  const a = partition(items, 2);
  const b = partition(shuffled, 2);
  const flatA = a.flatMap((bin) => bin.names).sort();
  if (flatA.join() !== 'a,b,c,d,e') throw new Error(`coverage: got ${flatA.join()}`);
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('determinism: input order changed the split');
  // LPT balance bound: bin spread never exceeds the heaviest single weight.
  const totals = a.map((bin) => bin.total);
  if (Math.max(...totals) - Math.min(...totals) > 9) throw new Error(`balance: totals ${totals}`);
  // The two 9s must not share a bin.
  const binOfA = a.findIndex((bin) => bin.names.includes('a'));
  const binOfB = a.findIndex((bin) => bin.names.includes('b'));
  if (binOfA === binOfB) throw new Error('balance: both heaviest packages in one bin');
  // Degenerate inputs: empty list, more shards than packages.
  const empty = partition([], 2);
  if (empty.some((bin) => bin.names.length > 0)) throw new Error('empty input produced packages');
  const sparse = partition([mk('only', 5)], 3);
  if (sparse.flatMap((bin) => bin.names).join() !== 'only') throw new Error('sparse input lost the package');

  // Payload assertions. The document reaching this script has two writers --
  // `turbo ls` and `--union-into` in check-cross-package-test-inputs.mjs -- so
  // "count agrees with items" is a cross-script invariant; this is its reading
  // half (the writing half is that script's own `--self-test`).
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
  if (readPackageItems(doc({ count: 2, items: two }), 'f').length !== 2) throw new Error('payload: a consistent list was rejected');
  if (readPackageItems(doc({ items: two }), 'f').length !== 2) throw new Error('payload: a list with no count was rejected');
  if (readPackageItems(doc({ count: 0, items: [] }), 'f').length !== 0) throw new Error('payload: a legitimately empty list was rejected');
  // The exact document `--union-into` used to write: two items, count still 0.
  if (!threw(() => readPackageItems(doc({ count: 0, items: two }), 'f'))) throw new Error('payload: count 0 beside 2 items was accepted');
  if (!threw(() => readPackageItems(doc({ count: 3, items: two }), 'f'))) throw new Error('payload: an over-count was accepted');
  if (!threw(() => readPackageItems(doc({ count: '2', items: two }), 'f'))) throw new Error('payload: a non-numeric count was accepted');
  if (!threw(() => readPackageItems(doc({ count: 2 }), 'f'))) throw new Error('payload: a missing items array was accepted');
  if (!threw(() => readPackageItems(doc({ count: 0, items: {} }), 'f'))) throw new Error('payload: a non-array items was accepted');
  if (!threw(() => readPackageItems({}, 'f'))) throw new Error('payload: a document with no packages key was accepted');

  // Path resolution. `it.path` reaches this script in two conventions and the
  // weight it produces must not depend on where the process happens to stand.
  // The cwd leg is the one that matters: it is the exact measurement that made
  // this a defect rather than a style question, and it fails SILENTLY (weight 0,
  // package still assigned) rather than loudly, so nothing but an assertion can
  // hold it.
  if (packageDir('packages/spec') !== path.join(REPO_ROOT, 'packages', 'spec')) {
    throw new Error('path: a repo-relative entry did not resolve against the repo root');
  }
  const absolute = path.join(REPO_ROOT, 'packages', 'spec');
  if (packageDir(absolute) !== absolute) {
    throw new Error('path: an already-absolute entry was not left alone');
  }
  const hereWeight = countTestFiles(packageDir('packages/spec'));
  if (hereWeight === 0) throw new Error('path: fixture package `packages/spec` has no test files to weigh');
  const cwdBefore = process.cwd();
  try {
    process.chdir(path.parse(REPO_ROOT).root);
    if (packageDir('packages/spec') !== absolute) {
      throw new Error('path: resolution moved with the cwd');
    }
    if (countTestFiles(packageDir('packages/spec')) !== hereWeight) {
      throw new Error('path: weight changed with the cwd -- the silent weight-0 regression is back');
    }
  } finally {
    process.chdir(cwdBefore);
  }

  console.log('partition-test-shards: self-test OK');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest();
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
  const weighted = [];
  for (const it of items) {
    if (typeof it?.name !== 'string' || typeof it?.path !== 'string') {
      throw new Error(`${listPath}: package entry missing name/path: ${JSON.stringify(it)}`);
    }
    if (excluded.has(it.name)) continue;
    weighted.push({ name: it.name, weight: countTestFiles(packageDir(it.path)) });
  }
  const bins = partition(weighted, shardCount);
  const mine = bins[shardIndex - 1];
  console.error(
    `shard ${shardSpec}: ${mine.names.length}/${weighted.length} packages, ` +
      `weight ${mine.total} (all bins: ${bins.map((b) => b.total).join('/')})`
  );
  for (const name of mine.names) console.log(name);
}

main();
