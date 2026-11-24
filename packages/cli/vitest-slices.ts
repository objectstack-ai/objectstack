// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which of this package's test files run in which file-level slice, when
 * Test Core cuts the suite into `OS_TEST_SHARD=k/n` slices
 * (`FILE_SHARDED_PACKAGES` in `scripts/partition-test-shards.mjs`).
 *
 * `vitest.config.ts`'s `DeclarationReaderSequencer` calls `planSlices()` from
 * its `shard()`; `test/vitest-slices.test.ts` pins it. Pure, so the pin needs
 * no vitest context.
 *
 * ## Why the slices are balanced by weight, not cut into equal file counts
 *
 * The sequencer used to cut vitest's own sha1 order into equal-COUNT ranges.
 * A slice runs as its shard's serial leg after the whole-package leg, so the
 * heaviest slice sets that shard's wall, and on full merge_group runs that
 * shard is the job that ends the queue entry: `Test Core (9/10)`, the shard
 * carrying slice 2/3, ended last on 47 of the 63 slowest-decile green
 * merge_group runs of 2026-11-21..24, its job at a 32.6-minute median there,
 * 13.4-13.9 min whole leg plus 17.3-18.0 min of CLI slice on the three logs
 * read. Equal counts are not equal seconds: on five such runs' per-file
 * readings (45342138743, 45213635210, 45032942394, 45116811975, 45383396882)
 * the three slices summed 1171/2347/2164, 1748/2270/1638, 1786/2275/2115,
 * 1589/2253/1418 and 1373/2178/1692 seconds of file time -- the same files,
 * slice 2 the heaviest on all five, because a handful of files carry most of
 * the suite (one reads 532 s, the top 25 about half of it) and sha1 put more
 * of them into slice 2.
 *
 * ## The weight: the budget a heavy file already declares
 *
 * Every test file over the 10 s line declares its own budget in its header
 * (`// test-budget: SECONDS — CLASS: REASON`, ruling records 6181973363 and
 * 6212133431; `readTestBudget()` in `scripts/measure-test-shard-timings.mjs`
 * owns the grammar and refuses a malformed one). SECONDS is the measured CI
 * reading x 1.25, rounded up, so a file weighs SECONDS / BUDGET_HEADROOM, and
 * a file that declares none weighs UNDECLARED_FILE_WEIGHT_SECONDS. Over the
 * five runs, 103 files declared a budget and carried 4812 of 5683 seconds on
 * the first; the files without one averaged 1.53-1.74 s (median 0.11-0.12 s).
 *
 * Replayed on those five runs' readings, placing the files heaviest first into
 * the lightest slice (readers seeded into theirs first) moves the heaviest
 * slice's file time 2347 -> 2014, 2270 -> 2076, 2275 -> 2203, 2253 -> 1928 and
 * 2178 -> 1912 seconds: lower on every run, by 3.2-14.4%. A perfect split of the
 * same seconds would read 1894, 1885, 2059, 1753 and 1748 -- the budgets are
 * ceilings, not readings, so the split recovers part of that, never all.
 *
 * No table and no second artefact: the weight is read from the file the
 * slice runs, so nothing here can go stale apart from the files themselves.
 * This module reads only the number, leniently: a header line it cannot read
 * weighs as undeclared, which can cost balance and never decides WHETHER a file
 * runs. Every file lands in exactly one slice whatever the weights say.
 *
 * ## What does not change
 *
 *   - The declaration readers (`DECLARATION_READER_FILES`) all run in the
 *     reader slice, and only there (#25870): they are seeded into it before
 *     anything is placed, so ci.yml keeps declarations for that slice alone.
 *   - The split is deterministic. Every slice's own vitest process computes
 *     the whole plan from the same file set and the same file text, and keeps
 *     its own part; ties go to the lower path, then to the lower slice.
 *   - The partitioner still places each slice at the package's plain weight
 *     / n, and the shard-timings generator still decodes a slice from the
 *     sha256 of its `OS_TEST_SHARD` value: neither reads which files a slice
 *     holds.
 */

/** A declared budget is the measured CI reading x this, rounded up (`CEILING_HEADROOM`). */
export const BUDGET_HEADROOM = 1.25;

/**
 * What a file that declares no budget weighs: the mean file time of the
 * files without one, 1.53, 1.58 and 1.74 s on merge_group runs 45342138743,
 * 45213635210 and 45032942394.
 */
export const UNDECLARED_FILE_WEIGHT_SECONDS = 1.6;

const BUDGET_SECONDS = /^\/\/ test-budget: ([1-9]\d*) — /u;

/**
 * The declared budget's SECONDS, read from the file's header -- its leading
 * run of blank lines, `//` lines and block comments, up to the first line of
 * code -- or null when the header declares none this can read.
 */
export function declaredBudgetSeconds(text: string): number | null {
  let inBlock = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (inBlock) {
      inBlock = !t.includes('*/');
      continue;
    }
    if (t.startsWith('/*')) {
      inBlock = !t.slice(2).includes('*/');
      continue;
    }
    if (t === '' || (i === 0 && t.startsWith('#!'))) continue;
    if (!t.startsWith('//')) return null;
    const m = BUDGET_SECONDS.exec(lines[i]);
    if (m) return Number(m[1]);
  }
  return null;
}

/** What one test file weighs when the slices are balanced. */
export function fileWeight(text: string): number {
  const seconds = declaredBudgetSeconds(text);
  return seconds === null ? UNDECLARED_FILE_WEIGHT_SECONDS : seconds / BUDGET_HEADROOM;
}

export interface SliceEntry {
  /** The file's path below the package root, `/`-separated: the tie-break. */
  readonly path: string;
  readonly weight: number;
  /** A declaration reader: placed in the reader slice, whatever it weighs. */
  readonly reader: boolean;
}

/**
 * The slice (1-based) of every entry, in input order, for `count` slices.
 * Readers go into `readerSlice` first; every other entry is then placed
 * heaviest first into the slice with the least weight so far.
 */
export function planSlices(entries: readonly SliceEntry[], count: number, readerSlice: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`planSlices: slice count ${count} is not a positive integer`);
  if (!Number.isInteger(readerSlice) || readerSlice < 1 || readerSlice > count) {
    throw new Error(`planSlices: reader slice ${readerSlice} is not one of the ${count} slice(s)`);
  }
  for (const e of entries) {
    if (!Number.isFinite(e.weight) || e.weight < 0) throw new Error(`planSlices: ${e.path} weighs ${e.weight}`);
  }
  const totals = new Array<number>(count).fill(0);
  const slices = new Array<number>(entries.length).fill(0);
  const byPath = (a: number, b: number) => (entries[a].path < entries[b].path ? -1 : entries[a].path > entries[b].path ? 1 : a - b);
  const order = entries.map((_, i) => i);
  for (const i of order.filter((i) => entries[i].reader).sort(byPath)) {
    slices[i] = readerSlice;
    totals[readerSlice - 1] += entries[i].weight;
  }
  const rest = order.filter((i) => !entries[i].reader).sort((a, b) => entries[b].weight - entries[a].weight || byPath(a, b));
  for (const i of rest) {
    let lightest = 0;
    for (let s = 1; s < count; s++) if (totals[s] < totals[lightest]) lightest = s;
    slices[i] = lightest + 1;
    totals[lightest] += entries[i].weight;
  }
  return slices;
}
