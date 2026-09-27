// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19975] The read-scope compiler never binds a LIST into an equality — in
 * either spelling of the equality slot, at any depth.
 *
 * Ruling 乙 on #19757 refuses a list in the equality slot at the shared
 * comparand-shape face, for every driver at once. `compileScopedFilterToSql`
 * never meets that face (a read scope arrives through `getReadScope`), so the
 * ruling is pushed down to it here:
 *
 *   - the EXPLICIT spelling, `{ f: { $eq: [...] } }`, used to compile to
 *     `col = ?` with the whole list bound as one parameter, and what that
 *     predicate selected was the executing engine's reading of a list. It is
 *     now refused ({@link assertNoListInEqualitySlot} in `read-scope-sql.ts`);
 *   - the IMPLICIT spelling, `{ f: [...] }` — the shape a CEL `field == <list>`
 *     policy lowers to — was already refused; the depth pins below hold it.
 *
 * Both refusals carry this module's envelope, `READ_SCOPE_COMPILE_FAILED` / 500
 * (the #5367 ruling), never the shared face's `INVALID_FILTER` / 400: the
 * producer is a policy the caller cannot author.
 *
 * Four blocks: the explicit spelling at every depth, the implicit spelling at
 * every depth, the neighbouring shapes that must keep compiling exactly as
 * before, and the two strategy faces that reach this compiler, driven over a
 * real engine — where the refusal must land before any statement runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';

interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

function refusalOf(scope: unknown): Refusal {
  try {
    const out = compileScopedFilterToSql(scope as FilterCondition, 't');
    throw new Error(`expected a refusal, but the scope compiled to ${JSON.stringify(out)}`);
  } catch (e) {
    return e as Refusal;
  }
}

function expectEnvelope(err: Refusal): void {
  expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
  expect(err.status).toBe(500);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#19975] a list under $eq is refused, never bound', () => {
  const CASES: Array<[string, unknown]> = [
    ['two members', { status: { $eq: ['open', 'pending'] } }],
    ['one member', { status: { $eq: ['open'] } }],
    ['the empty list', { status: { $eq: [] } }],
    ['beside another operator, listed first', { status: { $eq: ['open'], $ne: 'closed' } }],
    ['beside another operator, listed last', { status: { $ne: 'closed', $eq: ['open'] } }],
    ['under $and', { $and: [{ team_id: 't1' }, { status: { $eq: ['open'] } }] }],
    ['under $or', { $or: [{ team_id: 't1' }, { status: { $eq: ['open'] } }] }],
    // The widening direction: a negated equality that can never hold is
    // constant TRUE, so this is the spelling that used to admit every row.
    ['under $not', { $not: { status: { $eq: ['open'] } } }],
    ['under $not over $or', { $not: { $or: [{ team_id: 't1' }, { status: { $eq: ['open'] } }] } }],
  ];

  for (const [name, scope] of CASES) {
    it(`${name}: READ_SCOPE_COMPILE_FAILED / 500, naming the field and $eq`, () => {
      const err = refusalOf(scope);
      expectEnvelope(err);
      expect(err.message).toContain('"status".$eq');
    });
  }

  it('a list is diagnosed as the list, not by one of its members', () => {
    // The member gates (#6125's undefined comparand, #7598's field reference)
    // would otherwise answer first and send the operator to the wrong repair.
    for (const scope of [
      { status: { $eq: [undefined] } },
      { status: { $eq: [{ $field: 'prior_status' }] } },
    ]) {
      const err = refusalOf(scope);
      expectEnvelope(err);
      expect(err.message).toContain('"status".$eq');
      expect(err.message).not.toMatch(/is undefined|field reference/);
    }
  });
});

describe('[#19975] the implicit spelling — what a CEL `field == <list>` lowers to — stays refused at every depth', () => {
  const CASES: Array<[string, unknown]> = [
    ['top level', { status: ['open', 'pending'] }],
    ['the empty list', { status: [] }],
    ['under $and', { $and: [{ team_id: 't1' }, { status: ['open'] }] }],
    ['under $or', { $or: [{ team_id: 't1' }, { status: ['open'] }] }],
    ['under $not', { $not: { status: ['open'] } }],
  ];

  for (const [name, scope] of CASES) {
    it(`${name}: READ_SCOPE_COMPILE_FAILED / 500, as a bare array`, () => {
      const err = refusalOf(scope);
      expectEnvelope(err);
      expect(err.message).toContain('bare array value for "status"');
    });
  }
});

describe('[#19975] the neighbouring shapes keep compiling exactly as before', () => {
  const ACCEPTED: Array<[string, unknown, string, unknown[]]> = [
    ['a scalar under $eq', { status: { $eq: 'open' } }, '"t"."status" = ?', ['open']],
    ['a number under $eq', { amount: { $eq: 0 } }, '"t"."amount" = ?', [0]],
    ['null under $eq — the has-no-value predicate', { status: { $eq: null } }, '"t"."status" IS NULL', []],
    ['the implicit scalar', { status: 'open' }, '"t"."status" = ?', ['open']],
    ['a list under $in — the prescribed spelling', { status: { $in: ['open', 'pending'] } }, '"t"."status" IN (?, ?)', ['open', 'pending']],
    ['the empty $in — the FALSE constant (#5243)', { status: { $in: [] } }, '1 = 0', []],
  ];

  for (const [name, scope, sql, params] of ACCEPTED) {
    it(name, () => {
      const out = compileScopedFilterToSql(scope as FilterCondition, 't');
      expect(out.sql).toBe(sql);
      expect(out.params).toEqual(params);
    });
  }

  it('a Date under $eq still binds', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const out = compileScopedFilterToSql({ created_at: { $eq: at } } as FilterCondition, 't');
    expect(out.sql).toBe('"t"."created_at" = ?');
    expect(out.params).toEqual([at]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const OBJECT = 'ticket';
const ROWS = [
  { id: 'r1', status: 'open' },
  { id: 'r2', status: 'pending' },
  { id: 'r3', status: 'closed' },
  { id: 'r4', status: null },
];
const CUBE: Cube = {
  name: 'tickets',
  sql: OBJECT,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(
    ['id', 'status'].map((n) => [n, { name: n, label: n, type: 'string', sql: n }]),
  ),
  public: false,
} as unknown as Cube;
const QUERY = { cube: 'tickets', dimensions: ['id'], measures: ['n'] } as AnalyticsQuery;

describe('[#19975] both faces that reach the compiler refuse before any statement runs (real engine)', () => {
  let driver: SqliteWasmDriver;
  let statements = 0;

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    statements++;
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };

  const ctxFor = (scope: unknown, nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'tickets' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      getReadScope: () => (scope ?? undefined) as FilterCondition | undefined,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      sqlDialect: () => 'sqlite',
    }) as unknown as StrategyContext;

  /** NativeSQL EXECUTE: `applyReadScope` → `ctx.executeRawSql`. */
  const nativeIds = async (scope: unknown): Promise<string[]> => {
    const result = await new NativeSQLStrategy().execute(QUERY, ctxFor(scope, true));
    return result.rows.map((r) => String(r.id)).sort();
  };

  /** The `/analytics/sql` echo, its SQL then run on the same engine. */
  const echoIds = async (scope: unknown): Promise<string[]> => {
    const { sql, params } = await new ObjectQLStrategy().generateSql(QUERY, ctxFor(scope, false));
    const rows = await runRawSql(sql, params);
    return rows.map((r) => String(r.id)).sort();
  };

  const FACES = [
    ['native execute', nativeIds],
    ['echo', echoIds],
  ] as const;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      {
        name: OBJECT,
        fields: { id: { type: 'text', name: 'id' }, status: { type: 'text', name: 'status' } },
      } as never,
    ]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('CONTROL: no scope serves every row, and the prescribed $in serves exactly the named rows', async () => {
    // Without this, the refusals below could pass on a harness that serves nothing.
    for (const [face, run] of FACES) {
      expect(await run(null), `${face}: no scope`).toEqual(['r1', 'r2', 'r3', 'r4']);
      expect(await run({ status: { $in: ['open', 'pending'] } }), `${face}: $in`).toEqual(['r1', 'r2']);
    }
  });

  for (const [name, scope] of [
    ['a list under $eq', { status: { $eq: ['open', 'pending'] } }],
    ['a list under $eq, negated', { $not: { status: { $eq: ['open'] } } }],
    ['the implicit list', { status: ['open', 'pending'] }],
  ] as const) {
    for (const [face, run] of FACES) {
      it(`${face}: ${name} is refused, and no statement reaches the engine`, async () => {
        statements = 0;
        let err: Refusal | undefined;
        let served: string[] | undefined;
        try {
          served = await run(scope);
        } catch (e) {
          err = e as Refusal;
        }
        expect(served, `${face}: expected a refusal, got rows`).toBeUndefined();
        expect(err).toBeInstanceOf(Error);
        expectEnvelope(err as Refusal);
        expect(statements).toBe(0);
      });
    }
  }
});
