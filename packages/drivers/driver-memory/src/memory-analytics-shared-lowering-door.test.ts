// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0053 D-D1, amended 2026-09-30 — #5930 step 3] The analytics (cube) face's
 * NEW door, at the entry of `normalizeFilters` — the one seam of the amendment's
 * item 2 that did not exist before it: the two shared comparand doors
 * (`assertListComparandShapes`, `normalizeFilterComparandTypes`) this face ran
 * without, then the shared `FilterCondition → FilterCondition` lowering
 * (`lowerFilterCondition`), then the face's own vocabulary gate and lowering.
 *
 * ## The doors (the face ran neither)
 *
 * Measured before this door, on the fixture below (`d` holds a value on rows 1
 * and 2, is null on row 3, and is absent on row 4), every other face behind its
 * production seam refused these shapes with `INVALID_FILTER` / 400, while this
 * one answered them:
 *
 *   | cube `where`                     | rows   |
 *   |----------------------------------|--------|
 *   | `{d: undefined}`                 | 3, 4 (as `{d: null}`) |
 *   | `{d: {$eq: undefined}}`          | 3, 4   |
 *   | `{d: {$ne: undefined}}`          | 1, 2   |
 *   | `{d: {$in: ['v1', undefined]}}`  | 1      |
 *
 * ## The lowering's column-type scope (item 7)
 *
 * This face cannot read declared types — the driver's declared temporal kinds
 * are private to it, and the face reaches them only as a storage-form
 * conversion — so the lowering applies type-blind, as the item rules for such a
 * seam. That is also the reading this face's own interim copy (`lteUpperBound`)
 * and the driver's `find()` give, so no answer moves by it.
 *
 * ## The vocabulary (design §3.4)
 *
 * The lowering emits `$and`, `$or`, `$lt`, `$gte`, `$lte` and `$null`. This face
 * compiled all of them but `$or` and `$null`; it now compiles those two, on both
 * exits, and nothing wider — `$not` is still refused. Its vocabulary gate judges
 * what the face compiles, the lowered condition, so a `$between` reaches it as
 * the two bounds it lowers to.
 */

import { describe, it, expect } from 'vitest';
import {
  FILTER_LOGIC_CASES,
  FILTER_LOGIC_ROWS,
  lowerFilterCondition,
  type Cube,
  type FilterCondition,
} from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const ids = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

/** The echo's WHERE clause alone. */
const whereOf = (sql: string) => /WHERE (.*?)(?: GROUP BY|$)/.exec(sql)?.[1];

/** One cube over the shared filter-logic fixture's columns. */
const LOGIC_CUBE = {
  name: 'logic',
  title: 'Logic',
  sql: 'logic_row',
  measures: { count: { label: 'Count', type: 'count', sql: 'id' } },
  dimensions: Object.fromEntries(
    ['id', 'a', 'b', 'c', 'd', 'owner', 'status', 'parent_object', 'parent_id', 'created_at'].map((n) => [
      n,
      { label: n, type: n === 'created_at' ? 'time' : 'string', sql: n },
    ]),
  ),
} as unknown as Cube;

/** `d`: a value on 1 and 2, null on 3, absent on 4 — the fixture the door's table was measured on. */
const DOOR_ROWS = [
  { id: '1', d: 'v1' },
  { id: '2', d: 'v2' },
  { id: '3', d: null },
  { id: '4' },
];

/** Consecutive 10:00Z instants on a column declared `datetime`. */
const DAY_ROWS = [
  { id: 'r27', created_at: '2026-07-27T10:00:00.000Z' },
  { id: 'r28', created_at: '2026-07-28T10:00:00.000Z' },
  { id: 'r29', created_at: '2026-07-29T10:00:00.000Z' },
];

/** The declared field map `logic_row` syncs — what the engine's typed seam reads. */
const LOGIC_ROW_FIELDS: Record<string, { type: string }> = { created_at: { type: 'datetime' } };

async function setup(rows: ReadonlyArray<object>) {
  const driver = new InMemoryDriver({});
  await driver.connect();
  await driver.syncSchema('logic_row', { name: 'logic_row', fields: LOGIC_ROW_FIELDS });
  for (const row of rows) await driver.create('logic_row', { ...(row as Record<string, unknown>) });
  const service = new MemoryAnalyticsService({ driver, cubes: [LOGIC_CUBE] });
  return { driver, service };
}

const cubeQuery = (where?: FilterCondition) =>
  ({ cube: 'logic', measures: ['count'], dimensions: ['id'], ...(where === undefined ? {} : { where }) }) as any;

/**
 * The live query path, the cube's rows and the echo's WHERE, for one `where`.
 *
 * [#20822 · ADR-0053 D-D1 items 5, 7 and 9, as amended] The live query path is
 * the engine's `where` seam and then this driver, which keeps no whole-day copy
 * of its own: so `find()` is handed what that TYPED seam hands it — the filter
 * through the shared lowering, reading {@link LOGIC_ROW_FIELDS}.
 */
async function answer(rows: ReadonlyArray<object>, where?: FilterCondition) {
  const { driver, service } = await setup(rows);
  const seamed = lowerFilterCondition(where, {
    isDatetimeColumn: (column) => LOGIC_ROW_FIELDS[column]?.type === 'datetime',
  });
  return {
    find: ids(await driver.find('logic_row', seamed === undefined ? {} : { where: seamed })),
    cube: ids((await service.query(cubeQuery(where))).rows),
    echo: whereOf((await service.generateSql(cubeQuery(where))).sql),
  };
}

/** Both exits refuse `where` in the ADR-0112 `INVALID_FILTER` / 400 envelope. */
async function expectRefusedOnBothExits(where: FilterCondition) {
  const { service } = await setup(DOOR_ROWS);
  for (const [exit, run] of [
    ['query', () => service.query(cubeQuery(where))],
    ['generateSql', () => service.generateSql(cubeQuery(where))],
  ] as const) {
    await expect(run(), `${exit}: ${JSON.stringify(where)} must be refused`).rejects.toMatchObject({
      code: 'INVALID_FILTER',
      status: 400,
    });
  }
}

describe('[ADR-0053 D-D1 amended — #5930 step 3] the cube face runs the two shared comparand doors', () => {
  it('CONTROLS: no where, a value and a null comparand answer as the live query path does', async () => {
    expect((await answer(DOOR_ROWS)).cube).toEqual(['1', '2', '3', '4']);
    const value = await answer(DOOR_ROWS, { d: 'v1' });
    expect(value.cube).toEqual(['1']);
    expect(value.cube).toEqual(value.find);
    const none = await answer(DOOR_ROWS, { d: null });
    expect(none.cube).toEqual(['3', '4']);
    expect(none.cube).toEqual(none.find);
  });

  const UNDEFINED_COMPARANDS: Array<[string, FilterCondition]> = [
    ['an implicit undefined', { d: undefined } as FilterCondition],
    ['undefined under $eq', { d: { $eq: undefined } } as FilterCondition],
    ['undefined under $ne', { d: { $ne: undefined } } as FilterCondition],
    ['an undefined $in member', { d: { $in: ['v1', undefined] } } as FilterCondition],
  ];
  for (const [label, where] of UNDEFINED_COMPARANDS) {
    it(`${label} is refused on both exits, as every other face refuses it`, async () => {
      await expectRefusedOnBothExits(where);
    });
  }
});

describe('[ADR-0053 D-D1 amended — #5930 step 3] the cube face compiles the lowered condition', () => {
  it('a $between reaches the face as its two bounds, and answers the live query path\'s rows', async () => {
    const got = await answer(DAY_ROWS, { created_at: { $between: ['2026-07-28', '2026-07-28'] } });
    expect(got.find).toEqual(['r28']);
    expect(got.cube).toEqual(['r28']);
    expect(got.echo).toBe("created_at >= '2026-07-28T00:00:00.000Z' AND created_at < '2026-07-29T00:00:00.000Z'");
  });

  it('a bare-day $lte keeps the whole named day, and the last supported day keeps every row with a value', async () => {
    const day = await answer(DAY_ROWS, { created_at: { $lte: '2026-07-28' } });
    expect(day.cube).toEqual(['r27', 'r28']);
    expect(day.cube).toEqual(day.find);
    expect(day.echo).toBe("created_at < '2026-07-29T00:00:00.000Z'");
    const last = await answer(DAY_ROWS, { created_at: { $lte: '9999-12-31' } });
    expect(last.cube).toEqual(['r27', 'r28', 'r29']);
    expect(last.echo).toBe('created_at IS NOT NULL');
  });

  it('a negative-polarity operator is compiled inside the NULL escape the lowering emits', async () => {
    const got = await answer(DOOR_ROWS, { d: { $ne: 'v1' } });
    expect(got.cube).toEqual(['2', '3', '4']);
    expect(got.cube).toEqual(got.find);
    // The outer disjunction is the lowering's; the inner guard is this face's
    // own interim copy (`notEquals`), idempotent in rows until its deletion card.
    expect(got.echo).toBe("(d IS NULL OR (d IS NULL OR d != 'v1'))");
  });
});

describe('[ADR-0053 D-D1 amended — #5930 step 3] the cube face compiles $or and $null, and nothing wider', () => {
  it('$null: true selects the rows with no value, false the rows with one, on both exits', async () => {
    const isNull = await answer(DOOR_ROWS, { d: { $null: true } });
    expect(isNull.cube).toEqual(['3', '4']);
    expect(isNull.cube).toEqual(isNull.find);
    expect(isNull.echo).toBe('d IS NULL');
    const hasValue = await answer(DOOR_ROWS, { d: { $null: false } });
    expect(hasValue.cube).toEqual(['1', '2']);
    expect(hasValue.echo).toBe('d IS NOT NULL');
  });

  it('$or: the boolean identities, on both exits', async () => {
    const none = await answer(FILTER_LOGIC_ROWS, { $or: [] });
    expect(none.cube).toEqual([]);
    expect(none.echo).toBe('1 = 0');
    const all = await answer(FILTER_LOGIC_ROWS, { $or: [{ a: 'x' }, {}] });
    expect(all.cube).toEqual(['1', '2', '3', '4']);
  });

  it('$or: a disjunction of conjunctions renders each branch in its own parentheses', async () => {
    const got = await answer(FILTER_LOGIC_ROWS, { $or: [{ a: 'x', b: 'y' }, { a: 'qq', b: 'zz' }] });
    expect(got.cube).toEqual(['1', '4']);
    expect(got.echo).toBe("((a = 'x' AND b = 'y') OR (a = 'qq' AND b = 'zz'))");
  });

  it('FILTER_LOGIC_CASES: every $or case is answered with the live query path\'s rows', async () => {
    const withOr = FILTER_LOGIC_CASES.filter((c) => /"\$or"/.test(JSON.stringify(c.filter)) && !/"\$(not|empty)"/.test(JSON.stringify(c.filter)));
    expect(withOr.length).toBeGreaterThan(0);
    for (const c of withOr) {
      const got = await answer(FILTER_LOGIC_ROWS, c.filter);
      expect(got.cube, `${c.name}: ${c.note ?? ''}`).toEqual(c.expected);
      expect(got.cube, `${c.name}: the cube face and find() disagree`).toEqual(got.find);
    }
  });

  it('$not is still refused on both exits', async () => {
    await expectRefusedOnBothExits({ $not: { d: 'v1' } });
  });
});
