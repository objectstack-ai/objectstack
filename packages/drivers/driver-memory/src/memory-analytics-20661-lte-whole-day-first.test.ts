// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20661] The analytics (cube) face widens a bare-day `lte` BEFORE it puts the
 * bound into the field's storage form — ADR-0053 D-E3's order, the one `find()`
 * already follows (`memory-driver.ts` widens `val`, then converts `nextDay`).
 *
 * Both `lte` rows (the mingo `$match` and the SQL echo) used to ask
 * `nextUtcCalendarDay` about the comparand AFTER the conversion. On an
 * undeclared field the storage form is the authored string, so the day
 * widened. On a DECLARED `datetime` field it is the instant
 * `2026-07-28T00:00:00.000Z`, which the helper correctly refuses to widen, so
 * the cube compiled `<= '2026-07-28T00:00:00.000Z'` and dropped the rest of the
 * named day — one row where `find()` on the same filter answers two.
 *
 * Every case drives both exits and `find()` on the same data, for an
 * undeclared field and for the same field declared through `syncSchema`.
 */

import { describe, it, expect } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const ids = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

/** The card's two rows: the named day's morning, and the day before. */
const CARD_ROWS = [
  { id: 'r28', created_at: '2026-07-28T10:00:00.000Z', made_on: '2026-07-28' },
  { id: 'r27', created_at: '2026-07-27T10:00:00.000Z', made_on: '2026-07-27' },
] as const;

const CUBE = {
  name: 'tasks',
  title: 'Tasks',
  sql: 'task',
  measures: { count: { label: 'Count', type: 'count', sql: 'id' } },
  dimensions: {
    id: { label: 'Id', type: 'string', sql: 'id' },
    created_at: { label: 'Created', type: 'time', sql: 'created_at' },
    made_on: { label: 'Made on', type: 'time', sql: 'made_on' },
  },
} as unknown as Cube;

type Declaration = 'undeclared' | 'declared';

async function setup(declaration: Declaration, rows: ReadonlyArray<Record<string, unknown>> = CARD_ROWS) {
  const driver = new InMemoryDriver({});
  await driver.connect();
  if (declaration === 'declared') {
    await driver.syncSchema('task', {
      name: 'task',
      fields: { created_at: { type: 'datetime' }, made_on: { type: 'date' } },
    });
  }
  for (const row of rows) await driver.create('task', { ...row });
  const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
  return { driver, service };
}

const cubeQuery = (where: FilterCondition) =>
  ({ cube: 'tasks', measures: ['count'], dimensions: ['id'], where }) as any;

/** The echo's WHERE clause alone. */
const whereOf = (sql: string) => /WHERE (.*?)(?: GROUP BY|$)/.exec(sql)?.[1];

/**
 * One `where` on all three readings: `find()`, the cube's rows, and the echo.
 * The ids are asserted twice on purpose — equal to `find()` (the invariant) and
 * equal to the literal list (so the two cannot be wrong together).
 */
async function answer(declaration: Declaration, where: FilterCondition, rows?: ReadonlyArray<Record<string, unknown>>) {
  const { driver, service } = await setup(declaration, rows);
  return {
    find: ids(await driver.find('task', { where })),
    cube: ids((await service.query(cubeQuery(where))).rows),
    echo: whereOf((await service.generateSql(cubeQuery(where))).sql),
  };
}

describe('[#20661] cube `lte` on a bare day widens the authored day, then converts the bound', () => {
  const where: FilterCondition = { created_at: { $lte: '2026-07-28' } };

  it('undeclared `created_at`: both rows, the half-open bound at the next day', async () => {
    const got = await answer('undeclared', where);
    expect(got.cube).toEqual(got.find);
    expect(got.cube).toEqual(['r27', 'r28']);
    expect(got.echo).toBe("created_at < '2026-07-29'");
  });

  it('declared `datetime` `created_at`: the same rows as find(), the bound in storage form', async () => {
    const got = await answer('declared', where);
    expect(got.cube).toEqual(got.find);
    // Before the fix: ['r27'], echoed as `created_at <= '2026-07-28T00:00:00.000Z'`.
    expect(got.cube).toEqual(['r27', 'r28']);
    expect(got.echo).toBe("created_at < '2026-07-29T00:00:00.000Z'");
  });

  it('a full timestamp keeps instant semantics: inclusive, in storage form, not widened', async () => {
    const instant: FilterCondition = { created_at: { $lte: '2026-07-28T10:00:00Z' } };
    const got = await answer('declared', instant);
    expect(got.cube).toEqual(got.find);
    expect(got.cube).toEqual(['r27', 'r28']);
    expect(got.echo).toBe("created_at <= '2026-07-28T10:00:00.000Z'");
  });

  it('declared `date` control: a bare day is its own storage form, so nothing moves', async () => {
    const dateWhere: FilterCondition = { made_on: { $lte: '2026-07-28' } };
    for (const declaration of ['undeclared', 'declared'] as const) {
      const got = await answer(declaration, dateWhere);
      expect(got.cube, declaration).toEqual(got.find);
      expect(got.cube, declaration).toEqual(['r27', 'r28']);
      expect(got.echo, declaration).toBe("made_on < '2026-07-29'");
    }
  });

  it('declared `datetime` on the last supported day asks only for a value; the day before is a bound', async () => {
    const rows = [
      { id: 'c26', created_at: '2026-07-15T14:00:00.000Z' },
      { id: 'prev', created_at: '9999-12-30T10:00:00.000Z' },
      { id: 'mid', created_at: '9999-12-31T10:00:00.000Z' },
      { id: 'last', created_at: '9999-12-31T23:59:59.999Z' },
    ];
    const lastDay = await answer('declared', { created_at: { $lte: '9999-12-31' } }, rows);
    expect(lastDay.cube).toEqual(lastDay.find);
    // Before the fix: ['c26', 'prev'], echoed as `created_at <= '9999-12-31T00:00:00.000Z'`.
    expect(lastDay.cube).toEqual(['c26', 'last', 'mid', 'prev']);
    expect(lastDay.echo).toBe('created_at IS NOT NULL');

    const dayBefore = await answer('declared', { created_at: { $lte: '9999-12-30' } }, rows);
    expect(dayBefore.cube).toEqual(dayBefore.find);
    expect(dayBefore.cube).toEqual(['c26', 'prev']);
    expect(dayBefore.echo).toBe("created_at < '9999-12-31T00:00:00.000Z'");
  });
});

describe('[#20661] the siblings on this face', () => {
  it('a `dateRange` bare-day end already widens the authored end: declared `datetime` keeps the whole day', async () => {
    const { driver, service } = await setup('declared');
    const result = await service.query({
      cube: 'tasks',
      measures: ['count'],
      dimensions: ['id'],
      timeDimensions: [{ dimension: 'created_at', dateRange: ['2026-07-01', '2026-07-28'] }],
    } as any);
    const found = ids(await driver.find('task', { where: { created_at: { $gte: '2026-07-01', $lte: '2026-07-28' } } }));
    expect(ids(result.rows)).toEqual(found);
    expect(ids(result.rows)).toEqual(['r27', 'r28']);
  });

  it('`$between` reaches the face as its two bounds, and its maximum is widened BEFORE it is converted', async () => {
    // [ADR-0053 D-D1, amended — #5930 step 3] This row used to pin `$between`
    // refused on both exits, and said what widening it would owe: the same
    // whole-day order as the `lte` rows. The face's door now runs the shared
    // lowering first, which splits the range and widens the AUTHORED maximum
    // in the calendar-string domain (`$lt: '2026-07-29'`); the exit converts
    // that bound to the storage form like any comparand. D-E3's order holds by
    // construction, declared or not.
    for (const declaration of ['undeclared', 'declared'] as const) {
      const got = await answer(declaration, { created_at: { $between: ['2026-07-01', '2026-07-28'] } });
      expect(got.cube, declaration).toEqual(got.find);
      expect(got.cube, declaration).toEqual(['r27', 'r28']);
    }
    expect((await answer('declared', { created_at: { $between: ['2026-07-01', '2026-07-28'] } })).echo)
      .toBe("created_at >= '2026-07-01T00:00:00.000Z' AND created_at < '2026-07-29T00:00:00.000Z'");
  });
});
