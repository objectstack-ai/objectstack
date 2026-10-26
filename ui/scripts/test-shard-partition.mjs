// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * test-shard-partition -- which test files run on which `--shard=N/M` leg,
 * decided by measured per-file duration (objectui#12208, ruling 6121816480,
 * letter B; objectui#12256 for the coverage lane).
 *
 * Pure: no vitest, no clock, no disk. `scripts/test-shard-sequencer.mjs` is the
 * thin vitest adapter that calls `planShards()` from its `shard()`;
 * `scripts/test-shard-timings.json` is the measured input;
 * `scripts/test-file-timings.mjs` is what writes that input. Everything that
 * decides a partition lives here, so the test file can drive it without
 * starting vitest.
 *
 * ## Why not vitest's own split
 *
 * Vitest's `BaseSequencer.shard()` sorts the files by a sha1 of their path and
 * cuts the sorted list into M slices of EQUAL FILE COUNT. Equal counts are not
 * equal walls: a file in the `dom-heavy` project pays a registry setup that a
 * `unit` file never sees, and a repo-sweeping script test walks the whole
 * tree. Which shard draws the heavy files is decided by the hash, so one leg
 * runs long by luck, and that leg is the one the job's `timeout-minutes`
 * cancels. Both `ci.yml` matrices had grown into their caps that way
 * (objectui#9499, objectui#12208, objectui#12256).
 *
 * ## The partition
 *
 * Greedy longest-processing-time first: the files are taken heaviest first and
 * each goes to the leg whose running total is lowest. Ties break on the path,
 * then the project, then the lowest leg index, so the plan is a pure function
 * of (the file list, the dataset, M). That is load-bearing, not tidiness:
 * every leg of a matrix computes the WHOLE plan independently and keeps only
 * its own bin, so two legs that disagreed by one file would run it twice or
 * not at all. Every leg reads the same checkout, so the same file list and the
 * same committed dataset reach every one of them.
 *
 * A file the dataset does not name (new since the last refresh) is weighed at
 * the dataset's MEDIAN. That keeps the plan whole and makes staleness cost
 * balance rather than correctness: an old dataset spreads new files by count,
 * which is what the hash did, and the headroom reading in the `Test`
 * aggregators (`scripts/shard-headroom.mjs`) is where that shows.
 *
 * Every weight is at least 1 ms, so with M or more files every leg receives at
 * least one: an empty leg has nothing to run, and vitest's own `--shard` guard
 * (`count` greater than the file count) is the one that refuses the opposite
 * case before this code is reached.
 */

import { createHash } from 'node:crypto';

/** The dataset schema this module reads. Any other tag is refused, never guessed at. */
export const TIMINGS_SCHEMA = 'objectui.test-shard-timings/2';

/**
 * The dataset's key for a test file: the first 16 hex digits of the sha1 of
 * its repository-relative posix path. NOT the path itself, and that is
 * measured, not taste: a tracked file listing every test path puts every
 * test's own file name into the tree, and this repository's retired-spelling
 * pins sweep the tracked tree with `git grep` excluding only their OWN file --
 * so a pin named after the spelling it retires finds that spelling in the
 * dataset. Run 38271639400 failed exactly so, on objectui#8800's pin -- the
 * first full run with a path-keyed dataset. (The spelling is not written
 * here, for the same reason.) A hash carries no spelling, so no such pin, present or future, can
 * meet one here. 64 bits over a few thousand paths makes a collision
 * negligible, and a collision would cost balance, never correctness.
 *
 * @param {string} path
 */
export function pathKey(path) {
  return createHash('sha1').update(path).digest('hex').slice(0, 16);
}

/** The floor every weight is lifted to, in ms. */
export const MIN_WEIGHT_MS = 1;

/**
 * The per-file weights of a dataset, keyed by `pathKey()`, checked. Throws on
 * a dataset this module cannot read: a plan built from a misread dataset is a
 * silently wrong split.
 *
 * @param {unknown} dataset
 * @returns {Map<string, number>}
 */
export function datasetWeights(dataset) {
  if (!dataset || typeof dataset !== 'object') throw new Error('test-shard timings: the dataset is not an object');
  const { schema, files } = /** @type {{ schema?: unknown, files?: unknown }} */ (dataset);
  if (schema !== TIMINGS_SCHEMA) {
    throw new Error(`test-shard timings: schema ${JSON.stringify(schema)} is not ${JSON.stringify(TIMINGS_SCHEMA)}`);
  }
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('test-shard timings: `files` is not an object of key -> ms');
  }
  /** @type {Map<string, number>} */
  const weights = new Map();
  for (const [key, ms] of Object.entries(files)) {
    if (!/^[0-9a-f]{16}$/.test(key)) {
      throw new Error(`test-shard timings: ${JSON.stringify(key)} is not a pathKey() -- 16 hex digits, never a path`);
    }
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
      throw new Error(`test-shard timings: ${key} carries ${JSON.stringify(ms)}, not a non-negative number of ms`);
    }
    weights.set(key, ms);
  }
  return weights;
}

/**
 * The median of the dataset's weights, or the floor when it holds none.
 *
 * @param {Map<string, number>} weights
 */
export function medianWeight(weights) {
  const values = [...weights.values()].sort((a, b) => a - b);
  if (values.length === 0) return MIN_WEIGHT_MS;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return Math.max(MIN_WEIGHT_MS, median);
}

/**
 * Longest-processing-time-first bin packing over `count` bins.
 *
 * @param {Array<{ key: string, tie?: string, weight: number }>} items
 * @param {number} count
 * @returns {{ bins: number[][], loads: number[] }} item indices per bin, in placement order
 */
export function partition(items, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`partition: count must be a positive integer, got ${count}`);
  const order = items.map((_, i) => i);
  const cmp = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);
  order.sort(
    (a, b) =>
      items[b].weight - items[a].weight ||
      cmp(items[a].key, items[b].key) ||
      cmp(items[a].tie ?? '', items[b].tie ?? '') ||
      a - b,
  );
  /** @type {number[][]} */
  const bins = Array.from({ length: count }, () => []);
  const loads = Array.from({ length: count }, () => 0);
  for (const i of order) {
    let best = 0;
    for (let b = 1; b < count; b += 1) if (loads[b] < loads[best]) best = b;
    bins[best].push(i);
    loads[best] += items[i].weight;
  }
  return { bins, loads };
}

/**
 * The whole plan for one `--shard=*`/`count` run.
 *
 * @param {Array<{ path: string, project?: string }>} specs  one per test specification, path repository-relative and posix
 * @param {unknown} dataset  `scripts/test-shard-timings.json`
 * @param {number} count
 */
export function planShards(specs, dataset, count) {
  const weights = datasetWeights(dataset);
  const median = medianWeight(weights);
  // A path that is a specification of two projects runs twice; its measured
  // cost is split between the two so the file is not counted double.
  /** @type {Map<string, number>} */
  const multiplicity = new Map();
  for (const spec of specs) multiplicity.set(spec.path, (multiplicity.get(spec.path) ?? 0) + 1);
  /** @type {string[]} */
  const unknown = [];
  const items = specs.map((spec) => {
    const measured = weights.get(pathKey(spec.path));
    if (measured === undefined) unknown.push(spec.path);
    const weight = Math.max(MIN_WEIGHT_MS, (measured ?? median) / (multiplicity.get(spec.path) ?? 1));
    return { key: spec.path, tie: spec.project ?? '', weight };
  });
  const { bins, loads } = partition(items, count);
  return { bins, loads, total: loads.reduce((a, b) => a + b, 0), unknown: [...new Set(unknown)].sort(), median };
}

/**
 * The one line a leg prints about its own bin, so a long leg's log says what
 * it was handed and how much of that was a guess.
 *
 * @param {ReturnType<typeof planShards>} plan
 * @param {number} index 1-based
 * @param {unknown} dataset
 */
export function describePlan(plan, index, dataset) {
  const count = plan.bins.length;
  const files = plan.bins.reduce((n, bin) => n + bin.length, 0);
  const secs = (/** @type {number} */ ms) => `${(ms / 1000).toFixed(1)} s`;
  const measured = /** @type {{ measured?: { at?: unknown } }} */ (dataset)?.measured?.at;
  return (
    `test-shard-sequencer: shard ${index}/${count} runs ${plan.bins[index - 1].length} of ${files} files, ` +
    `${secs(plan.loads[index - 1])} of ${secs(plan.total)} by the per-file timings` +
    (typeof measured === 'string' ? ` measured ${measured}` : '') +
    `; ${plan.unknown.length} file(s) not in the timings, weighed at the median ${secs(plan.median)}`
  );
}
