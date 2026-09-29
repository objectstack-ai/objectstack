// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20489] The rows path's `sum` / `avg` add with Kahan-Babuska-Neumaier
 * compensation (`in-memory-aggregation.ts`, `compensatedSum`), the summation
 * SQLite 3.43+ uses for its own `sum` / `avg`.
 *
 * The expected values below are SQLite's own answers, measured with
 * better-sqlite3 (SQLite 3.53.4), sql.js (3.49.1) and @libsql/client (3.45.1)
 * over a `REAL` and a `NUMERIC` column holding the same values. All three
 * engines agreed on every fixture. The naive fold the rows path used before is
 * shown beside each one:
 *
 * | fixture | naive `sum` / `avg` (before) | SQLite native = compensated (after) |
 * |:--|:--|:--|
 * | `0.1, 0.2, 0.3` | `0.6000000000000001` / `0.20000000000000004` | `0.6` / `0.19999999999999998` |
 * | `1e16, 1, -1e16` | `0` / `0` | `1` / `0.3333333333333333` |
 * | `1e16, 0.5, -1e16` | `0` / `0` | `0.5` / `0.16666666666666666` |
 * | `0.1, 0.2` (two addends) | `0.30000000000000004` / `0.15000000000000002` | the same |
 * | `1, 2, 3, 40, 500` (integers) | `546` / `109.2` | the same |
 *
 * `engine.aggregate` and REST on SQLite are pinned in `packages/rest`
 * (`rest-aggregate-compensated-sum.test.ts`): the rows path and the native
 * path answer the same double there.
 */

import { describe, it, expect } from 'vitest';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

/** The fold the rows path used before #20489: in order, one addition at a time. */
const naiveSum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** `sum` and `avg` of `w` over `values`, one group, through the rows path. */
function sumAvg(values: readonly unknown[]): { s: unknown; a: unknown } {
  const rows = values.map((w, i) => ({ id: `r${i}`, w }));
  const [out] = applyInMemoryAggregation(rows, {
    aggregations: [
      { function: 'sum', field: 'w', alias: 's' },
      { function: 'avg', field: 'w', alias: 'a' },
    ],
  });
  return out as { s: unknown; a: unknown };
}

describe('[#20489] rows path — sum / avg add with compensation, as SQLite does', () => {
  it("the card's fixture: 0.1 + 0.2 + 0.3 answers SQLite's 0.6, and avg its 0.19999999999999998", () => {
    const values = [0.1, 0.2, 0.3];
    // The fixture discriminates: the naive fold answers another double.
    expect(naiveSum(values)).toBe(0.6000000000000001);
    expect(sumAvg(values)).toStrictEqual({ s: 0.6, a: 0.19999999999999998 });
    // So `having { s: { $eq: 0.6 } }` now keeps the group on this path too.
    expect(sumAvg(values).s === 0.6).toBe(true);
  });

  it('a mixed-sign set with large cancellation keeps the small addend', () => {
    expect(naiveSum([1e16, 1, -1e16])).toBe(0);
    expect(sumAvg([1e16, 1, -1e16])).toStrictEqual({ s: 1, a: 1 / 3 });
    expect(naiveSum([1e16, 0.5, -1e16])).toBe(0);
    expect(sumAvg([1e16, 0.5, -1e16])).toStrictEqual({ s: 0.5, a: 0.5 / 3 });
  });

  it('two addends are unchanged: the compensated a + b is the naive one', () => {
    for (const pair of [[0.1, 0.2], [0.7, 0.1], [1e16, 1], [-0.3, 0.1]]) {
      const n = naiveSum(pair);
      expect(sumAvg(pair), `${pair}`).toStrictEqual({ s: n, a: n / 2 });
    }
    expect(sumAvg([0.1, 0.2])).toStrictEqual({ s: 0.30000000000000004, a: 0.15000000000000002 });
  });

  it('integers whose partial sums stay within 2^53 are unchanged, and stay integers', () => {
    const values = [1, 2, 3, 40, 500];
    const { s, a } = sumAvg(values);
    expect(s).toBe(naiveSum(values));
    expect(s).toBe(546);
    expect(Number.isInteger(s)).toBe(true);
    expect(a).toBe(109.2);
    expect(sumAvg([-7, 3, 12, 0, 9_000_000_000])).toStrictEqual({ s: 9_000_000_008, a: 9_000_000_008 / 5 });
  });

  it('above 2^53 the compensated total is the exact one SQLite answers, where the naive fold lost the 1s', () => {
    // SQLite 3.53.4 answers 9007199254740994 over a REAL and over a NUMERIC column.
    expect(naiveSum([2 ** 53, 1, 1])).toBe(2 ** 53);
    expect(sumAvg([2 ** 53, 1, 1])).toStrictEqual({ s: 9007199254740994, a: 3002399751580331.5 });
  });

  it('under groupBy and a per-aggregation filter, every bucket takes the same fold', () => {
    const rows = [
      { g: 'x', k: 'in', w: 0.1 },
      { g: 'x', k: 'in', w: 0.2 },
      { g: 'x', k: 'out', w: 100 },
      { g: 'x', k: 'in', w: 0.3 },
      { g: 'y', k: 'in', w: 1e16 },
      { g: 'y', k: 'in', w: 1 },
      { g: 'y', k: 'in', w: -1e16 },
    ];
    const out = applyInMemoryAggregation(rows, {
      groupBy: ['g'],
      aggregations: [
        { function: 'sum', field: 'w', alias: 's', filter: { k: 'in' } },
        { function: 'avg', field: 'w', alias: 'a', filter: { k: 'in' } },
        { function: 'sum', field: 'w', alias: 'all' },
      ],
    } as any).sort((p, q) => String(p.g).localeCompare(String(q.g)));
    expect(out).toStrictEqual([
      { g: 'x', s: 0.6, a: 0.19999999999999998, all: 100.6 },
      { g: 'y', s: 1, a: 1 / 3, all: 1 },
    ]);
  });
});

describe('[#20489] rows path — what the compensated fold leaves as it was', () => {
  it('null: sum adds nothing for it, avg leaves it out of the count', () => {
    expect(sumAvg([0.1, null, 0.2, undefined, 0.3])).toStrictEqual({ s: 0.6, a: 0.19999999999999998 });
    expect(sumAvg([10, null, 20])).toStrictEqual({ s: 30, a: 15 });
  });

  it('a non-numeric cell reads as 0 in both, and counts in avg; a numeric string reads as its number', () => {
    expect(sumAvg([10, 'abc', 20])).toStrictEqual({ s: 30, a: 10 });
    expect(sumAvg(['0.1', '0.2', '0.3'])).toStrictEqual({ s: 0.6, a: 0.19999999999999998 });
    expect(sumAvg([true, false, true])).toStrictEqual({ s: 2, a: 2 / 3 });
  });

  it('an empty group: sum 0, avg null — with no rows, and with only nulls', () => {
    expect(sumAvg([])).toStrictEqual({ s: 0, a: null });
    expect(sumAvg([null, undefined])).toStrictEqual({ s: 0, a: null });
  });

  it('a non-finite total is the naive one, as SQLite returns its running sum when the error term overflows', () => {
    for (const values of [
      [Infinity, 1, 2],
      [1, -Infinity, 0.3],
      [1e308, 1e308, -1e308],
      [Infinity, -Infinity, 1],
      [NaN, 0.1, 0.2],
    ]) {
      const n = naiveSum(values);
      const { s, a } = sumAvg(values);
      expect(Object.is(s, n), `sum of ${values}: ${s} vs naive ${n}`).toBe(true);
      expect(Object.is(a, n / values.length), `avg of ${values}`).toBe(true);
    }
  });

  it('the answer is a JS number on every arm, never a string', () => {
    const { s, a } = sumAvg(['0.1', 0.2, '0.3']);
    expect(typeof s).toBe('number');
    expect(typeof a).toBe('number');
  });
});
