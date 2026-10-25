/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4507 — key ABSENCE must survive the pivot, or the framework#4033
 * guard is dead exactly where the defect it guards against lands.
 *
 * `hasNoCategoryKey` (plugin-charts' `AdvancedChartImpl`) catches a first
 * dimension that a dataset query GROUPED BY but never PROJECTED: no row carries
 * the category key, so instead of drawing an axis with no marks the renderer
 * names the missing key. Its whole signal is one expression over the rows it is
 * handed — and for a dataset-bound chart those rows are `buildChartSeries`'
 * OUTPUT:
 *
 *     !rows.some((row) => row != null && typeof row === 'object' && key in row)
 *
 * The pivot branch wrote `[xKey]` onto every bucket it created, so `key in row`
 * was unconditionally true downstream and the guard could not fire for a
 * 2-dimension/1-measure chart no matter what the query returned. Every row
 * collapsed into one unnamed bucket painting a blank tick — the silent shape
 * the placeholder exists to replace.
 *
 * ## The measurement the fix rests on (taken before it was written)
 *
 * How a dataset query actually reports an unprojected dimension in a 2-dim
 * grouping — the card's own binding precondition, because omitting `[xKey]`
 * only helps if key-ABSENCE is genuinely the shape that arrives:
 *
 *  - the ObjectQL strategy builds each result row from scratch and writes a
 *    dimension key ONLY when the engine returned that column
 *    (`if (shortName in row) mapped[dim] = row[shortName]`), so an unprojected
 *    dimension is OMITTED, never `null`-filled — pinned framework-side by
 *    `objectql-timedimension-projection.test.ts`
 *    (`expect(row).not.toHaveProperty('due_date')`) and measured live in
 *    framework#4033, where the rows read `[{ count: 2 }, { count: 8 }]`;
 *  - the native-SQL strategy returns driver rows, which carry only the columns
 *    the statement selected — same shape, different path;
 *  - JSON cannot transport `undefined` at all, so nothing between the server and
 *    a chart can turn "no column" into a present-but-undefined key;
 *  - `ObjectStackAdapter.queryDataset` hands `rows` through by reference.
 *
 * Measured end to end through that adapter with the server answering the
 * #4033 payload for `dimensions: ['status','priority']`: `'status' in rows[0]`
 * was `false`, and after `buildChartSeries` it was `true` with the value
 * `undefined`. An explicit `null` means something DIFFERENT and arrives only
 * when the column WAS projected — that is the `(None)` bucket's case
 * (objectui#4466 / objectui#4497), which this file must leave intact.
 *
 * ## Why `toEqual` cannot be the assertion here
 *
 * Both `JSON.stringify` and `toEqual` DROP an undefined-valued key, so
 * `{ status: undefined, Low: 3 }` and `{ Low: 3 }` read as identical
 * everywhere except in the one test that decides the placeholder — `key in
 * row`. That is why this defect survived four cards' worth of pins over the
 * same rows, and why the assertions below say `in` / `Object.keys` /
 * `toStrictEqual` out loud.
 */
import { describe, it, expect } from 'vitest';
import { buildChartSeries, NULL_CATEGORY_LABEL } from './chart-series.js';

/**
 * `hasNoCategoryKey`'s predicate, verbatim (plugin-charts'
 * `AdvancedChartImpl.tsx`), minus the chart-type gate it shares with nothing
 * here. Spelled rather than imported because `@object-ui/core` must not depend
 * on a plugin; the DOM half — key-absent rows render the explanatory
 * placeholder — is pinned in `AdvancedChartImpl.missingCategoryKey.test.tsx`,
 * and this file is what finally lets a PIVOTED chart reach it.
 */
const guardWouldFire = (rows: Array<Record<string, unknown>>, key: string): boolean =>
  rows.length > 0 && !rows.some((row) => row != null && typeof row === 'object' && key in row);

/** The framework#4033 shape in a 2-dim grouping: `status` never projected. */
const UNPROJECTED_X = [
  { priority: 'High', est_hours: 5 },
  { priority: 'Low', est_hours: 3 },
];

describe('buildChartSeries — an unprojected first dimension survives the pivot (objectui#4507)', () => {
  it('emits a bucket that does NOT carry the category key', () => {
    const r = buildChartSeries(UNPROJECTED_X, ['status', 'priority'], ['est_hours']);

    expect(r.data).toHaveLength(1);
    expect('status' in r.data[0]).toBe(false);
    expect(Object.keys(r.data[0])).toEqual(['High', 'Low']);
    // The measures still land — the numbers were never the broken part.
    expect(r.data[0]).toStrictEqual({ High: 5, Low: 3 });
  });

  it('reaches the framework#4033 guard, which the pivot used to defeat', () => {
    const r = buildChartSeries(UNPROJECTED_X, ['status', 'priority'], ['est_hours']);

    // Same question, asked of the raw rows and of the pivot's output. Before
    // this card the two answers disagreed, and the renderer only ever sees the
    // second one.
    expect(guardWouldFire(UNPROJECTED_X, 'status')).toBe(true);
    expect(guardWouldFire(r.data, r.xAxisKey!)).toBe(true);
  });

  it('does NOT relabel the key-absent bucket "(None)" — that would state something false', () => {
    // The other half of the doctrine, unchanged (objectui#4497): "this
    // dimension was never projected" and "these records have no value" are
    // different sentences, and only the second one is the bucket's.
    const r = buildChartSeries(UNPROJECTED_X, ['status', 'priority'], ['est_hours']);

    expect(Object.values(r.data[0])).not.toContain(NULL_CATEGORY_LABEL);
    expect(r.data[0].status).not.toBe(NULL_CATEGORY_LABEL);
  });

  it('still names the second dimension\'s series — only the axis key is withheld', () => {
    const r = buildChartSeries(UNPROJECTED_X, ['status', 'priority'], ['est_hours']);

    expect(r.xAxisKey).toBe('status');
    expect(r.series).toEqual([
      { dataKey: 'High', label: 'High' },
      { dataKey: 'Low', label: 'Low' },
    ]);
  });
});

describe('buildChartSeries — a bucket carries the key exactly when some row did (objectui#4507)', () => {
  it('a genuinely NULL category beside a key-absent row keeps its "(None)" label', () => {
    // `chartBucketId` encodes an absent value and a stored `null` identically
    // (`[null]`), so ONE bucket collects both. If ANY of its rows carried the
    // key, the bucket is "known to be empty" — it draws under the label, and
    // the guard must stay silent. Refusing here would tell the author their
    // query never projected a dimension that it demonstrably did.
    const rows = [
      { priority: 'High', est_hours: 5 },          // key absent
      { status: null, priority: 'Low', est_hours: 3 }, // key present, value null
    ];
    const r = buildChartSeries(rows, ['status', 'priority'], ['est_hours']);

    expect(r.data).toHaveLength(1);
    expect('status' in r.data[0]).toBe(true);
    expect(r.data[0].status).toBe(NULL_CATEGORY_LABEL);
    expect(guardWouldFire(r.data, r.xAxisKey!)).toBe(false);
  });

  it('order does not decide it — the null row first gives the same bucket', () => {
    const rows = [
      { status: null, priority: 'Low', est_hours: 3 },
      { priority: 'High', est_hours: 5 },
    ];
    const r = buildChartSeries(rows, ['status', 'priority'], ['est_hours']);

    expect(r.data).toStrictEqual([{ status: NULL_CATEGORY_LABEL, Low: 3, High: 5 }]);
  });

  it('a PARTIALLY projected first dimension draws what projected', () => {
    // The mirror of `hasNoCategoryKey`'s own `!rows.some(…)`: it refuses only
    // when NOT ONE row carries the key. Some rows carrying it means there is a
    // real axis to draw, so the guard stays silent and the key-less rows keep
    // their (blank-ticked) bucket — the shape they always had.
    const rows = [
      { status: 'Backlog', priority: 'High', est_hours: 5 },
      { priority: 'Low', est_hours: 3 },
    ];
    const r = buildChartSeries(rows, ['status', 'priority'], ['est_hours']);

    expect(r.data).toHaveLength(2);
    expect(r.data[0]).toStrictEqual({ status: 'Backlog', High: 5 });
    expect('status' in r.data[1]).toBe(false);
    expect(guardWouldFire(r.data, r.xAxisKey!)).toBe(false);
  });
});

describe('buildChartSeries — must-not-change (objectui#4507)', () => {
  it('an ordinary pivot is byte-identical, key ORDER included', () => {
    const rows = [
      { status: 'Backlog', priority: 'High', est_hours: 5 },
      { status: 'Backlog', priority: 'Low', est_hours: 3 },
      { status: 'Done', priority: 'High', est_hours: 24 },
    ];
    const r = buildChartSeries(rows, ['status', 'priority'], ['est_hours']);

    expect(r.data).toStrictEqual([
      { status: 'Backlog', High: 5, Low: 3 },
      { status: 'Done', High: 24 },
    ]);
    // The axis key is still written FIRST: a bucket's creating row carries it
    // whenever the dimension projected at all.
    expect(Object.keys(r.data[0])).toEqual(['status', 'High', 'Low']);
  });

  it('a null-valued category still becomes the bucket label (objectui#4497)', () => {
    const r = buildChartSeries(
      [{ status: null, priority: 'High', est_hours: 5 }],
      ['status', 'priority'],
      ['est_hours'],
    );

    expect(r.data).toStrictEqual([{ status: NULL_CATEGORY_LABEL, High: 5 }]);
  });

  it('an empty-string category is a VALUE and keeps it (objectui#4508)', () => {
    const r = buildChartSeries(
      [{ status: '', priority: 'High', est_hours: 5 }],
      ['status', 'priority'],
      ['est_hours'],
    );

    expect(r.data).toStrictEqual([{ status: '', High: 5 }]);
    expect(guardWouldFire(r.data, r.xAxisKey!)).toBe(false);
  });

  it('never mutates the caller rows', () => {
    const rows = [{ priority: 'High', est_hours: 5 }];
    buildChartSeries(rows, ['status', 'priority'], ['est_hours']);

    expect(rows).toStrictEqual([{ priority: 'High', est_hours: 5 }]);
  });
});
