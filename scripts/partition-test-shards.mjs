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
// Usage:
//   node scripts/partition-test-shards.mjs <turbo-ls.json> --shard N/M \
//     [--exclude <pkg>]...
//   node scripts/partition-test-shards.mjs --self-test
//
// <turbo-ls.json> is the output of `turbo ls [--affected] --output=json`
// (shape: {packages:{items:[{name,path}]}}; `turbo ls` is marked experimental,
// so the shape is asserted loudly below rather than defaulted around).
// Prints the selected shard's package names, one per line -- possibly zero
// lines, which the caller must treat as "nothing to run", NOT as "no filter":
// a `turbo run test` with no --filter args runs the entire workspace.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
  const items = parsed?.packages?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      `${listPath}: expected \`turbo ls --output=json\` shape {packages:{items:[...]}} -- ` +
        'did an experimental-command upgrade change the output?'
    );
  }
  const weighted = [];
  for (const it of items) {
    if (typeof it?.name !== 'string' || typeof it?.path !== 'string') {
      throw new Error(`${listPath}: package entry missing name/path: ${JSON.stringify(it)}`);
    }
    if (excluded.has(it.name)) continue;
    weighted.push({ name: it.name, weight: countTestFiles(it.path) });
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
