// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0053 D-D1, amended 2026-09-30 — #5930 step 3] The analytics READ SCOPE's
 * placement of the shared `FilterCondition → FilterCondition` lowering
 * (`lowerFilterCondition`, `@objectstack/spec/data`): run once at the entry of
 * `compileScopedFilterToSql`, right after the scope's placeholders resolve and
 * before a single clause is compiled — the amendment's item 2 names this
 * position.
 *
 * The table this file holds is the one filed as the read scope's divergence:
 * one bare-day upper bound, on a column declared `datetime`, answered by the
 * read scope with the named day's rows dropped, while `SqlDriver.find` on the
 * same column kept them. Measured before this seam existed, on the fixture
 * below (ISO-text rows at 10:00Z on 07-27, 07-28 and 07-29, and one row with
 * no value):
 *
 *   | face                                        | rows kept for `$lte: '2026-07-28'` |
 *   |---------------------------------------------|-----------------------------------|
 *   | read scope (`compileScopedFilterToSql`)     | c27                               |
 *   | `SqlDriver.find`, column declared `datetime` | c27, c28                          |
 *
 * Every row below asks each face that binds a read scope into SQL — the
 * published export executed on the same database, and `NativeSQLStrategy`'s
 * `applyReadScope` — for the rows `SqlDriver.find` answers on the same filter.
 *
 * ## The two halves of a read scope's filter
 *
 * - **A caller filter** — whatever a `getReadScope` producer hands the
 *   compiler, or a direct caller of the export. It reaches this seam as
 *   written, so this seam is the only place its bound is lowered.
 * - **An RLS `using` bound** — the RLS compile seam (`judgeCompiledComparands`,
 *   step 2) lowers every compiled policy filter before `getReadFilter` returns
 *   it. The half is pinned in BOTH spellings the read scope can be handed: the
 *   policy as that seam lowers it on a typed guard, and the policy as written
 *   (what a guard without types, or any producer that skipped that seam,
 *   hands over). Both answer `find()`'s rows, so this face's answer does not
 *   depend on which one reached it.
 *
 * ## Column-type scope (the amendment's item 7)
 *
 * The read scope can read declared types — both of its consumers hand it
 * `declaredValueShape` — so the whole-day rule rewrites a declared `datetime`
 * column only, the scope `SqlDriver` holds. A `date` column compiles
 * byte-identical to before (`<= day` orders exactly as `< next-day` on date
 * text). A caller that hands no declarations reads NO column as `datetime`:
 * the step-2 RLS seam's choice for a guard without types, for the same reason
 * — it moves no answer.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { lowerFilterCondition, type Cube, type FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

const OBJECT = 'contract';
const ALIAS = 't';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  signed_at: { type: 'datetime', name: 'signed_at' },
  due_on: { type: 'date', name: 'due_on' },
  stage: { type: 'text', name: 'stage' },
};

/** Three ISO instants at 10:00Z on consecutive days, and one row with no value. */
const ROWS = [
  { id: 'c27', signed_at: '2026-07-27T10:00:00.000Z', due_on: '2026-07-27', stage: 'won' },
  { id: 'c28', signed_at: '2026-07-28T10:00:00.000Z', due_on: '2026-07-28', stage: 'lost' },
  { id: 'c29', signed_at: '2026-07-29T10:00:00.000Z', due_on: '2026-07-29', stage: null },
  { id: 'cnull', signed_at: null, due_on: null, stage: 'won' },
];

const CUBE: Cube = {
  name: 'contracts',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: { id: { label: 'id', type: 'string', sql: 'id' } },
  public: true,
} as unknown as Cube;

const QUERY = { cube: 'contracts', dimensions: ['id'], measures: ['n'] } as AnalyticsQuery;

/** What both production consumers hand the compiler: the object's declared value shapes. */
const declaredValueShape = (field: string) => {
  const def = FIELDS[field];
  return def ? { type: String(def.type) } : undefined;
};

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return quiet;
  },
};

describe('[ADR-0053 D-D1 amended — #5930 step 3] the read scope lowers its filter at the entry of compileScopedFilterToSql', () => {
  let driver: SqliteWasmDriver;
  let readScope: FilterCondition | undefined;

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };

  const ids = (rows: ReadonlyArray<Record<string, unknown>>): string[] => rows.map((r) => String(r.id)).sort();

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields: FIELDS }] as never);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  /**
   * `SqlDriver.find` as the engine drives it — the answer every other face is
   * held to. [#20822 · ADR-0053 D-D1 items 5 and 9, as amended] The engine's
   * `where` seam hands the driver the filter through the shared lowering,
   * reading the declared field map (`datetime` columns only for the whole-day
   * rule; the NULL-polarity guards on every column); `SqlDriver` keeps no copy
   * of either rule any more, so this face reads what the seam hands it.
   */
  const findFace = async (scope: FilterCondition) =>
    ids(
      (await driver.find(OBJECT, {
        where: lowerFilterCondition(scope, { isDatetimeColumn: (column) => FIELDS[column]?.type === 'datetime' }),
      } as never)) as never,
    );

  /** The published export, its SQL executed on the same database. */
  const compiledFace = async (scope: FilterCondition, withTypes = true) => {
    const { sql, params } = compileScopedFilterToSql(scope, ALIAS, withTypes ? { declaredValueShape } : {});
    return ids(await runRawSql(`SELECT "${ALIAS}"."id" AS "id" FROM "${OBJECT}" AS "${ALIAS}" WHERE ${sql}`, params));
  };

  /** `NativeSQLStrategy.applyReadScope` — the merge site that turns a scope into an executed statement. */
  const nativeFace = async (scope: FilterCondition) => {
    readScope = scope;
    const ctx = {
      getCube: (name: string) => (name === 'contracts' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      getReadScope: () => readScope,
      declaredValueShape: (object: string, field: string) => (object === OBJECT ? declaredValueShape(field) : undefined),
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
    } as unknown as StrategyContext;
    return ids((await new NativeSQLStrategy().execute(QUERY, ctx)).rows);
  };

  /** Every read-scope face against `find()`, and against the literal list, so the two cannot be wrong together. */
  const expectSameRows = async (scope: FilterCondition, rows: string[]) => {
    expect(await findFace(scope), 'find() — the fixture is not what this table assumes').toEqual(rows);
    expect(await compiledFace(scope), 'compileScopedFilterToSql — the published export').toEqual(rows);
    expect(await nativeFace(scope), 'NativeSQLStrategy.applyReadScope').toEqual(rows);
  };

  it('CONTROL: an unconstrained scope admits every row on every face', async () => {
    await expectSameRows({ id: { $in: ['c27', 'c28', 'c29', 'cnull'] } }, ['c27', 'c28', 'c29', 'cnull']);
  });

  // ── The caller-filter half: this seam is the only place its bound is lowered ─

  it('caller filter: a bare-day $lte on a declared datetime keeps the whole named day, as find() does', async () => {
    await expectSameRows({ signed_at: { $lte: '2026-07-28' } }, ['c27', 'c28']);
  });

  it('caller filter: a bare-day $between on a declared datetime keeps the whole named day', async () => {
    await expectSameRows({ signed_at: { $between: ['2026-07-28', '2026-07-28'] } }, ['c28']);
  });

  it('caller filter: the last supported day bounds nothing and keeps every row with a value', async () => {
    await expectSameRows({ signed_at: { $lte: '9999-12-31' } }, ['c27', 'c28', 'c29']);
  });

  // ── The RLS `using` half, in both spellings the read scope can be handed ─────

  it('RLS using, as the RLS seam lowers it on a typed guard: the whole named day', async () => {
    // `record.signed_at <= '2026-07-28'` compiled and lowered by
    // `judgeCompiledComparands` with `signed_at` in the guard's datetime set.
    await expectSameRows({ signed_at: { $lt: '2026-07-29' } }, ['c27', 'c28']);
  });

  it('RLS using, as written (a guard without types): the whole named day all the same', async () => {
    await expectSameRows({ signed_at: { $lte: '2026-07-28' } }, ['c27', 'c28']);
  });

  it('RLS using on the last supported day, as the RLS seam lowers it: every row with a value', async () => {
    await expectSameRows({ signed_at: { $null: false } }, ['c27', 'c28', 'c29']);
  });

  // ── The declared `date` control ────────────────────────────────────────────

  it('a declared date column keeps its bound as written, and answers the same rows as find()', async () => {
    await expectSameRows({ due_on: { $lte: '2026-07-28' } }, ['c27', 'c28']);
    const { sql, params } = compileScopedFilterToSql({ due_on: { $lte: '2026-07-28' } }, ALIAS, { declaredValueShape });
    expect(sql).toBe('"t"."due_on" <= ?');
    expect(params).toEqual(['2026-07-28']);
  });

  // ── The typed scope, as SQL ────────────────────────────────────────────────

  it('a declared datetime compiles half-open against the next day, in the calendar-string domain', () => {
    const { sql, params } = compileScopedFilterToSql({ signed_at: { $lte: '2026-07-28' } }, ALIAS, { declaredValueShape });
    expect(sql).toBe('"t"."signed_at" < ?');
    expect(params).toEqual(['2026-07-29']);
  });

  it('a date macro resolves first, and the lowering widens the day it resolved to (item 3)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-03-15T23:30:00.000Z'));
      const scope = { signed_at: { $lte: '{today}' } } as FilterCondition;
      expect(compileScopedFilterToSql(scope, ALIAS, { declaredValueShape })).toEqual({
        sql: '"t"."signed_at" < ?',
        params: ['2026-03-16'],
      });
      // The caller's calendar decides the day, and the bound is the day after it.
      const shanghai = { timezone: 'Asia/Shanghai' } as ExecutionContext;
      expect(compileScopedFilterToSql(scope, ALIAS, { declaredValueShape, context: shanghai }).params).toEqual(['2026-03-17']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('with no declarations handed in, no column reads as datetime and the bound compiles as written', () => {
    const { sql, params } = compileScopedFilterToSql({ signed_at: { $lte: '2026-07-28' } }, ALIAS);
    expect(sql).toBe('"t"."signed_at" <= ?');
    expect(params).toEqual(['2026-07-28']);
  });

  it('the NULL-polarity guards apply whatever the type, and the rows stay find()\'s', async () => {
    await expectSameRows({ stage: { $ne: 'won' } }, ['c28', 'c29']);
    await expectSameRows({ $not: { stage: { $eq: 'lost' } } }, ['c27', 'c29', 'cnull']);
  });
});
