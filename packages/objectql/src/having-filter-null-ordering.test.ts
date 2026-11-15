// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33698] A SQL NULL column fails an ordering operator (`$gt`, `$gte`, `$lt`,
 * `$lte`, `$between`) on every face of the walker, exactly as a column the row
 * does not carry does.
 *
 * Measured before the fix (the walker against `driver-sql`'s where compiler,
 * 119 filters on SQLite and PostgreSQL 16): every divergence on a NULL column
 * was one of these five operators. The value-less exit read `undefined` only,
 * so `null` reached the JS comparison and coerced to `0` — `null <= 0`,
 * `null >= 0`, `null > -5` are `true` — and `$between` failed neither bound
 * for any comparand type. "Count where amount ≤ 0" counted every row with no
 * amount. The spec says null is not ordered (`filter.zod.ts`), and SQL agrees.
 *
 * Three faces share the walker, and each is pinned: the per-measure filter
 * (`matchesAggregationFilter`), `having` over an aggregated row
 * (`applyHaving` — an empty group's `avg` / `min` / `max` is `null`), and the
 * in-memory `where` for plugin drivers (`matchesDriverWhere`).
 *
 * What does NOT move, pinned beside it: the equality family, `$in` / `$nin`,
 * `$exists` / `$null` / `$empty`, and a NULL comparand.
 */

import { describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { applyHaving, matchesAggregationFilter, matchesDriverWhere } from './having-filter.js';

/** `amount` NULL on r4 and absent on r5; `name`, `closed` and `t` NULL on r4. */
const ROWS: ReadonlyArray<Record<string, unknown>> = [
  { id: 'r1', amount: 5, name: 'Beta', closed: '2026-01-10', t: '09:00' },
  { id: 'r2', amount: 0, name: 'alpha', closed: '2026-01-20', t: '11:30' },
  { id: 'r3', amount: -2, name: 'Zed', closed: '2026-02-01', t: '18:00' },
  { id: 'r4', amount: null, name: null, closed: null, t: null },
  { id: 'r5' },
];

type Face = (filter: FilterCondition) => string[];

const FACES: Record<string, Face> = {
  'measure filter (matchesAggregationFilter)': (filter) =>
    ROWS.filter((row) => matchesAggregationFilter(row, filter, 0)).map((r) => String(r.id)),
  'having (applyHaving)': (filter) => applyHaving([...ROWS], filter).map((r) => String(r.id)),
  'plugin-driver where (matchesDriverWhere)': (filter) =>
    ROWS.filter((row) => matchesDriverWhere(row, filter)).map((r) => String(r.id)),
};

/** The ordering cases: what SQL selects, NULL and absent rows never among them. */
const ORDERING: ReadonlyArray<[FilterCondition, string[]]> = [
  [{ amount: { $lte: 0 } }, ['r2', 'r3']],
  [{ amount: { $lt: 1 } }, ['r2', 'r3']],
  [{ amount: { $gte: 0 } }, ['r1', 'r2']],
  [{ amount: { $gt: -5 } }, ['r1', 'r2', 'r3']],
  [{ amount: { $between: [-1, 1] } }, ['r2']],
  [{ name: { $between: ['A', 'z'] } }, ['r1', 'r2', 'r3']],
  [{ closed: { $between: ['2026-01-01', '2026-01-31'] } }, ['r1', 'r2']],
  [{ t: { $between: ['06:00', '12:00'] } }, ['r1', 'r2']],
  // Under a negation the NULL row comes back: `$not` inverts the walker's
  // answer for the row, as the in-memory path always has.
  [{ $not: { amount: { $lte: 0 } } } as FilterCondition, ['r1', 'r4', 'r5']],
];

/** Operators whose answer on a NULL column was already right, and stays. */
const UNCHANGED: ReadonlyArray<[FilterCondition, string[]]> = [
  [{ amount: 0 }, ['r2']],
  [{ amount: null } as FilterCondition, ['r4', 'r5']],
  [{ amount: { $eq: 0 } }, ['r2']],
  [{ amount: { $ne: 0 } }, ['r1', 'r3', 'r4', 'r5']],
  [{ amount: { $in: [0, 5] } }, ['r1', 'r2']],
  [{ amount: { $nin: [0] } }, ['r1', 'r3', 'r4', 'r5']],
  [{ amount: { $null: true } }, ['r4', 'r5']],
  [{ amount: { $exists: true } }, ['r1', 'r2', 'r3']],
];

for (const [face, ids] of Object.entries(FACES)) {
  describe(`[#33698] ${face}: a NULL column is not ordered`, () => {
    for (const [filter, expected] of ORDERING) {
      it(`${JSON.stringify(filter)} keeps ${expected.join(', ')}`, () => {
        expect(ids(filter)).toEqual(expected);
      });
    }
    for (const [filter, expected] of UNCHANGED) {
      it(`unchanged: ${JSON.stringify(filter)} keeps ${expected.join(', ')}`, () => {
        expect(ids(filter)).toEqual(expected);
      });
    }
  });
}

describe('[#33698] having over an empty group: avg / min / max are null and fail an ordering test', () => {
  it('an empty group\'s avg is not "≤ 0"', () => {
    const groups = [
      { region: 'north', avg_amount: -3, n: 2 },
      { region: 'south', avg_amount: null, n: 0 },
    ];
    expect(applyHaving(groups, { avg_amount: { $lte: 0 } }).map((g) => g.region)).toEqual(['north']);
    expect(applyHaving(groups, { avg_amount: { $null: true } }).map((g) => g.region)).toEqual(['south']);
  });
});

describe('[#33698] a NULL comparand answers as it did (the column, not the comparand, is not ordered)', () => {
  it('the walker\'s answers for a null comparand do not move', () => {
    const row = { amount: null };
    // `null >= null` is the JS comparison the walker always ran for these.
    expect(matchesDriverWhere(row, { amount: { $gte: null } } as FilterCondition)).toBe(true);
    expect(matchesDriverWhere(row, { amount: { $gt: null } } as FilterCondition)).toBe(false);
    expect(matchesDriverWhere(row, { amount: { $between: [null, 5] } } as FilterCondition)).toBe(true);
  });
});
