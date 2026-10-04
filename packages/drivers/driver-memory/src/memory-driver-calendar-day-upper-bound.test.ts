// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Calendar-day upper bounds in the in-memory driver (#4042) — the
 * driver-memory half of #3777's rule: a bare `YYYY-MM-DD` used as an upper
 * bound (`$lte`, `<=`, a `between` max, a dateRange end) means "through that
 * whole day" and compiles half-open (`$lt` next day).
 *
 * Rows store ISO-string timestamps — the driver's OWN storage form (its
 * `created_at` default is `new Date().toISOString()`, and every REST/JSON
 * write arrives as a string). Mingo compares strings lexicographically, so
 * pre-fix `$lte: '2026-07-28'` cut the window at the midnight prefix and the
 * final day's rows vanished, exactly like the SQL drivers. (`Date`-object
 * rows are a separate storage-form problem — mingo compares cross-type as
 * never-equal for EVERY operator, `$gte` included — covered for the analytics
 * window below and tracked separately for `find()`.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { lowerFilterCondition, parseFilterAST, type FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import type { Cube } from '@objectstack/spec/data';

const ids = (rows: any[]) => rows.map((r: any) => r.id).sort();

/**
 * [#20822 · ADR-0053 D-D1 items 5, 7 and 9, as amended] Where the rule lives
 * now: the shared lowering (`lowerFilterCondition`), applied once at the seams,
 * never in this driver. The `find()` cases below hand the driver what a TYPED
 * seam hands it for a `task` object that declares `created_at` a `datetime`
 * (the engine's reading of a registered object's field map), and keep their
 * expected rows. What this driver does with a filter that passed NO seam is
 * pinned in `memory-driver-20822-comparison-as-written.test.ts`.
 */
const TASK_FIELDS: Record<string, { type: string }> = { title: { type: 'text' }, created_at: { type: 'datetime' } };
const seamed = <T,>(where: T): T =>
  lowerFilterCondition(where, { isDatetimeColumn: (column) => TASK_FIELDS[column]?.type === 'datetime' });

describe('InMemoryDriver — bare-day $lte covers the whole day (#4042)', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({
      initialData: {
        task: [
          { id: 't_midnight', title: 't_midnight', created_at: '2026-07-28T00:00:00.000Z' },
          { id: 't_morning', title: 't_morning', created_at: '2026-07-28T09:15:00.000Z' },
          { id: 't_evening', title: 't_evening', created_at: '2026-07-28T21:40:00.000Z' },
          { id: 't_yesterday', title: 't_yesterday', created_at: '2026-07-27T14:00:00.000Z' },
          { id: 't_old', title: 't_old', created_at: '2026-04-19T10:00:00.000Z' },
        ],
      },
    });
    await driver.connect();
  });

  it('keeps the whole final day — the dashboard default-config window', async () => {
    const found = await driver.find('task', {
      where: seamed({ created_at: { $gte: '2026-04-29', $lte: '2026-07-28' } }),
    } as any);
    // Pre-fix: only [t_midnight, t_yesterday] — the 09:15 / 21:40 rows fell
    // past the midnight-anchored string prefix.
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('a full-ISO $lte keeps instant semantics — only the bare day is widened', async () => {
    const found = await driver.find('task', {
      where: seamed({ created_at: { $lte: '2026-07-28T12:00:00.000Z' } }),
    } as any);
    expect(ids(found)).toEqual(['t_midnight', 't_morning', 't_old', 't_yesterday']);
  });

  it('$gte / $gt / $lt keep their midnight anchoring', async () => {
    const gte = await driver.find('task', { where: seamed({ created_at: { $gte: '2026-07-28' } }) });
    expect(ids(gte)).toEqual(['t_evening', 't_midnight', 't_morning']);

    const gt = await driver.find('task', { where: seamed({ created_at: { $gt: '2026-07-28' } }) });
    expect(ids(gt)).toEqual(['t_evening', 't_midnight', 't_morning']); // string '…T00:00' > '2026-07-28'

    const lt = await driver.find('task', { where: seamed({ created_at: { $lt: '2026-07-28' } }) });
    expect(ids(lt)).toEqual(['t_old', 't_yesterday']);
  });

  it('$between with a bare-day max covers the whole final day', async () => {
    const found = await driver.find('task', {
      where: seamed({ created_at: { $between: ['2026-04-29', '2026-07-28'] } }),
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });

  it('stays correct inside an $or branch', async () => {
    const found = await driver.find('task', {
      where: seamed({
        $or: [
          { created_at: { $gte: '2026-07-28', $lte: '2026-07-28' } }, // "today" preset
          { title: 't_old' },
        ],
      }),
    } as any);
    expect(ids(found)).toEqual(['t_evening', 't_midnight', 't_morning', 't_old']);
  });

  it('applies to the authored array spelling, lowered the declared way (#5158)', async () => {
    // The array form is input-only sugar lowered at the engine/protocol doors;
    // the driver no longer compiles it. Same authored filter, same rows. The
    // INFIX join has no lowering — the declared spelling is the prefix group.
    const lte = await driver.find('task', {
      where: seamed(parseFilterAST(
        ['and', ['created_at', '>=', '2026-04-29'], ['created_at', '<=', '2026-07-28']],
      )) as any,
    } as any);
    expect(ids(lte)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);

    const between = await driver.find('task', {
      where: seamed(parseFilterAST([['created_at', 'between', ['2026-04-29', '2026-07-28']]])) as any,
    } as any);
    expect(ids(between)).toEqual(['t_evening', 't_midnight', 't_morning', 't_yesterday']);
  });
});

describe('MemoryAnalyticsService — dateRange window (#4042)', () => {
  const CUBE: Cube = {
    name: 'tasks',
    title: 'Tasks',
    sql: 'task',
    measures: {
      count: { label: 'Count', type: 'count', sql: 'id' },
    },
    dimensions: {
      created_at: { label: 'Created', type: 'time', sql: 'created_at' },
    },
  } as unknown as Cube;

  it('keeps the final day for BOTH stored forms — ISO strings and Date objects', async () => {
    // One column, two writer forms: the driver's own ISO-string default and a
    // direct JS `Date`. The window must keep the final day's rows of each —
    // the $or-of-both-spellings that stands in for driver-sql's mixed-storage
    // CASE repair.
    const driver = new InMemoryDriver({
      initialData: {
        task: [
          { id: 's_final_day', created_at: '2026-07-28T21:40:00.000Z' },
          { id: 's_in_range', created_at: '2026-07-10T08:00:00.000Z' },
          { id: 's_next_day', created_at: '2026-07-29T00:00:00.000Z' },
          { id: 'd_final_day', created_at: new Date('2026-07-28T09:15:00Z') },
          { id: 'd_in_range', created_at: new Date('2026-07-10T12:00:00Z') },
          { id: 'd_next_day', created_at: new Date('2026-07-29T00:00:00Z') },
          { id: 'd_old', created_at: new Date('2026-04-19T10:00:00Z') },
        ],
      },
    });
    await driver.connect();
    const service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });

    const result = await service.query({
      cube: 'tasks',
      measures: ['count'],
      timeDimensions: [
        { dimension: 'created_at', dateRange: ['2026-04-29', '2026-07-28'] },
      ],
    } as any);

    // 4 rows inside the window (2 per storage form, both final-day rows kept);
    // the two next-day-midnight rows and the pre-window Date row are out.
    expect(result.rows[0]?.count).toBe(4);
  });
});

/**
 * [#20600] `9999-12-31`, the last supported day, has no next day: every
 * supported value is inside its whole-day bound, so the whole-day widening
 * compiles NO upper bound — `$lte` / `<=` ask only for a value (`$ne: null`), a
 * `$between` / `between` / `dateRange` keeps its minimum. The spec's helper
 * used to answer the five-digit `'10000-01-01'`, and every ISO-string row
 * sorts above it, so each of those answered no rows. `9999-12-30` is the
 * control: an ordinary bound.
 */
describe('[#20600] InMemoryDriver — a bare-day upper bound on the last supported day', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({
      initialData: {
        task: [
          { id: 'c26', title: 'c26', created_at: '2026-07-15T14:00:00.000Z' },
          { id: 'prev', title: 'prev', created_at: '9999-12-30T10:00:00.000Z' },
          { id: 'open', title: 'open', created_at: '9999-12-31T00:00:00.000Z' },
          { id: 'mid', title: 'mid', created_at: '9999-12-31T10:00:00.000Z' },
          { id: 'last', title: 'last', created_at: '9999-12-31T23:59:59.999Z' },
          { id: 'none', title: 'none', created_at: null },
        ],
      },
    });
    await driver.connect();
  });

  /** `where` · the ids it answers, sorted. */
  const CASES: ReadonlyArray<readonly [string, () => FilterCondition | undefined, readonly string[]]> = [
    ["$lte '9999-12-31'", () => ({ created_at: { $lte: '9999-12-31' } }), ['c26', 'last', 'mid', 'open', 'prev']],
    ["$between ['2026-01-01', '9999-12-31']", () => ({ created_at: { $between: ['2026-01-01', '9999-12-31'] } }), ['c26', 'last', 'mid', 'open', 'prev']],
    ["$between ['9999-12-31', '9999-12-31']", () => ({ created_at: { $between: ['9999-12-31', '9999-12-31'] } }), ['last', 'mid', 'open']],
    ["$not $lte '9999-12-31'", () => ({ $not: { created_at: { $lte: '9999-12-31' } } }), ['none']],
    // The lowered `$ne` shares a key an author can write: both constraints survive (#13524).
    ["$lte '9999-12-31' beside an author's $ne", () => ({ created_at: { $lte: '9999-12-31', $ne: '9999-12-31T10:00:00.000Z' } }), ['c26', 'last', 'open', 'prev']],
    ["the AST spelling <= '9999-12-31'", () => parseFilterAST([['created_at', '<=', '9999-12-31']]), ['c26', 'last', 'mid', 'open', 'prev']],
    ["the AST spelling between max '9999-12-31'", () => parseFilterAST([['created_at', 'between', ['9999-12-31', '9999-12-31']]]), ['last', 'mid', 'open']],
    ["$lte '9999-12-30' (control)", () => ({ created_at: { $lte: '9999-12-30' } }), ['c26', 'prev']],
    ["$between ['2026-01-01', '9999-12-30'] (control)", () => ({ created_at: { $between: ['2026-01-01', '9999-12-30'] } }), ['c26', 'prev']],
    ["$gte '9999-12-31' (unchanged)", () => ({ created_at: { $gte: '9999-12-31' } }), ['last', 'mid', 'open']],
    ["$lt '9999-12-31' (unchanged)", () => ({ created_at: { $lt: '9999-12-31' } }), ['c26', 'prev']],
  ];

  it('compiles no upper bound on 9999-12-31; 9999-12-30 is a bound; the lower-bound operators do not move', async () => {
    const got: Record<string, string[]> = {};
    for (const [name, where] of CASES) got[name] = ids(await driver.find('task', { where: seamed(where()) }));
    expect(got).toEqual(Object.fromEntries(CASES.map(([name, , want]) => [name, want])));
  });

  it('the analytics face: a dateRange ending 9999-12-31 keeps its start alone, for BOTH stored forms', async () => {
    const analytics = new InMemoryDriver({
      initialData: {
        task: [
          { id: 's_before', created_at: '2026-06-30T23:00:00.000Z' },
          { id: 's_in', created_at: '2026-07-10T08:00:00.000Z' },
          { id: 's_last_day', created_at: '9999-12-31T21:40:00.000Z' },
          { id: 'd_in', created_at: new Date('2026-07-10T12:00:00Z') },
          { id: 'd_last_day', created_at: new Date('9999-12-31T09:15:00Z') },
          { id: 'd_before', created_at: new Date('2026-04-19T10:00:00Z') },
        ],
      },
    });
    await analytics.connect();
    const service = new MemoryAnalyticsService({
      driver: analytics,
      cubes: [{
        name: 'tasks', title: 'Tasks', sql: 'task',
        measures: { count: { label: 'Count', type: 'count', sql: 'id' } },
        dimensions: { created_at: { label: 'Created', type: 'time', sql: 'created_at' } },
      } as unknown as Cube],
    });
    const count = async (dateRange: [string, string]) =>
      (await service.query({ cube: 'tasks', measures: ['count'], timeDimensions: [{ dimension: 'created_at', dateRange }] } as any)).rows[0]?.count;

    expect(await count(['2026-07-01', '9999-12-31'])).toBe(4); // s_in, s_last_day, d_in, d_last_day
    expect(await count(['2026-07-01', '9999-12-30'])).toBe(2); // the control: the last day is out
  });

  it('the analytics face: a cube-filter lte on 9999-12-31 asks only for a value, in the pipeline and the echo', async () => {
    const service = new MemoryAnalyticsService({
      driver,
      cubes: [{
        name: 'tasks', title: 'Tasks', sql: 'task',
        measures: { count: { label: 'Count', type: 'count', sql: 'id' } },
        dimensions: {
          id: { label: 'Id', type: 'string', sql: 'id' },
          created_at: { label: 'Created', type: 'time', sql: 'created_at' },
        },
      } as unknown as Cube],
    });
    const q = (day: string) => ({ cube: 'tasks', measures: ['count'], dimensions: ['id'], where: { created_at: { $lte: day } } } as any);

    expect(ids((await service.query(q('9999-12-31'))).rows)).toEqual(['c26', 'last', 'mid', 'open', 'prev']);
    expect(ids((await service.query(q('9999-12-30'))).rows)).toEqual(['c26', 'prev']);
    expect((await service.generateSql(q('9999-12-31'))).sql).toContain('created_at IS NOT NULL');
    expect((await service.generateSql(q('9999-12-30'))).sql).toContain("created_at < '9999-12-31'");
  });
});
