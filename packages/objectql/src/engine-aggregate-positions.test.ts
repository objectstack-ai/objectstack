// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20334] Two `where` behaviours the other filter positions of
// `engine.aggregate` lacked.
//
// 1. `having` resolves `{placeholder}` tokens through the resolver `where`
//    uses (`ObjectQL.resolveWhereTokens`, parameterised by the AST slot). It
//    resolved none: a relative-date token compared as its own text and an
//    unknown one kept no group with a 200, where `where` answers
//    `FILTER_TOKEN_UNKNOWN` / 400.
// 2. The per-aggregation `filter`'s temporal and text-operator refusals are
//    rooted at `aggregations[i].filter`, as its list-shape and comparand-type
//    refusals already were. They said `at where.…`, a `where` the author did
//    not write.
//
// Measured on the base (`26daf0b036`) and the head through `engine.aggregate`
// and `POST /api/v1/data/:object/query`, on InMemoryDriver, SqlDriver on
// SQLite and SqlDriver on PostgreSQL 16, on both `having` paths, four groups
// c1–c4 (the three drivers and both doors agree on every cell below):
//
// | position · input | base | head | `where` twin |
// |:--|:--|:--|:--|
// | `having` `{ last_placed: { $gt: '{current_year_start}' } }` | 200, no group | 200, c1–c4 (as `'2026-01-01'`) | resolves |
// | `having` `{ last_placed: { $gte: '{not_a_token}' } }` | 200, no group | 400 `FILTER_TOKEN_UNKNOWN` | 400 `FILTER_TOKEN_UNKNOWN` |
// | `having` `{ customer_id: '{current_user_id}' }`, no user | 200, no group | 400 `FILTER_TOKEN_UNRESOLVED` | 400 `FILTER_TOKEN_UNRESOLVED` |
// | `aggregations[1].filter` `{ placed_on: { $gt: 'not-a-date' } }` | 400, `at where.placed_on.$gt` | 400, `at aggregations[1].filter.placed_on.$gt` | 400, `at where.placed_on.$gt` |
// | `aggregations[1].filter` `{ amount: { $contains: '5' } }` | 400, `at where.amount.$contains` | 400, `at aggregations[1].filter.amount.$contains` | 400, `at where.amount.$contains` |
//
// No driver reads `having` and every refusal precedes the driver, so this
// file holds the engine to it with a counting driver of each `having` path's
// shape; the REST door is held over a real SqlDriver in
// `packages/rest/src/rest-aggregate-positions.test.ts`.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { EngineAggregateOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

const OBJECT = 'ledger_order';

const FIELDS = {
  customer_id: { type: 'text' },
  amount: { type: 'number' },
  placed_on: { type: 'date' },
  opened_at: { type: 'datetime' },
};

// In the storage form every driver presents a row in (ADR-0053).
const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100, placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z' },
  { id: 'o2', customer_id: 'c1', amount: 400, placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z' },
  { id: 'o3', customer_id: 'c2', amount: 900, placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z' },
  { id: 'o4', customer_id: 'c2', amount: 300, placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z' },
  { id: 'o5', customer_id: 'c3', amount: 50, placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z' },
  { id: 'o6', customer_id: 'c4', amount: 20, placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z' },
];

// c1: last_placed 2026-01-10 · first_opened 2026-01-01T10:00Z · total 500
// c2: last_placed 2026-03-01 · first_opened 2026-02-01T10:00Z · total 1200
// c3: last_placed 2026-01-15 · first_opened 2026-02-06T10:00Z · total 50
// c4: last_placed 2026-02-01 · first_opened 2026-03-01T10:00Z · total 20
const AGGREGATIONS: NonNullable<EngineAggregateOptions['aggregations']> = [
  { function: 'max', field: 'placed_on', alias: 'last_placed' },
  { function: 'min', field: 'opened_at', alias: 'first_opened' },
  { function: 'sum', field: 'amount', alias: 'total' },
  { function: 'count', alias: 'n' },
];

// The resolver's reference instant, pinned: `{today}` is 2026-02-20,
// `{current_month_start}` 2026-02-01, `{current_year_start}` 2026-01-01,
// `{30_days_ago}` 2026-01-21 (UTC; the context carries no timezone).
const PINNED_NOW = new Date('2026-02-20T12:00:00.000Z');
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PINNED_NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

type Path = 'native' | 'rows';

/**
 * The two `having` paths. `native`: the driver aggregates and the engine
 * applies `having` to what it returns. `rows`: the engine asks for rows and
 * aggregates them itself (a filtered aggregation forces that path). Both count
 * every read of the object.
 */
function makeDriver(path: Path, rows: ReadonlyArray<Record<string, unknown>>) {
  const reads = { aggregate: 0, find: 0 };
  const driver: any = {
    name: `${path}-recorder`,
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { reads.find += 1; return rows.map((r) => ({ ...r })); },
    async findOne() { return null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (path === 'native') {
    driver.aggregate = async (_o: string, ast: any) => { reads.aggregate += 1; return applyInMemoryAggregation([...rows], ast); };
  }
  return { driver, reads };
}

async function makeEngine(path: Path, rows: ReadonlyArray<Record<string, unknown>> = ROWS) {
  const { driver, reads } = makeDriver(path, rows);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  (engine.registry as any).registerObject({ name: OBJECT, fields: FIELDS });
  return { engine, reads };
}

type Context = EngineAggregateOptions['context'];

function havingQuery(path: Path, having: unknown, context?: Context): EngineAggregateOptions {
  const aggregations = path === 'native'
    ? AGGREGATIONS
    : [...AGGREGATIONS, { function: 'count' as const, alias: 'fb', filter: { customer_id: { $ne: '' } } }];
  return { groupBy: ['customer_id'], aggregations, having: having as FilterCondition, ...(context ? { context } : {}) };
}

interface Refusal extends Error { code?: unknown; status?: unknown }

async function outcome(run: () => Promise<unknown>): Promise<{ rows?: any[]; err?: Refusal }> {
  try {
    return { rows: (await run()) as any[] };
  } catch (e) {
    return { err: e as Refusal };
  }
}

/** The groups a `having` keeps: identical on both paths, one read each. */
async function keptGroups(having: unknown, context?: Context): Promise<string[]> {
  let kept: string[] | undefined;
  for (const path of ['native', 'rows'] as const) {
    const { engine, reads } = await makeEngine(path);
    const rows = await engine.aggregate(OBJECT, havingQuery(path, having, context));
    expect(reads.aggregate + reads.find, path).toBe(1);
    const got = rows.map((r: any) => String(r.customer_id)).sort();
    kept ??= got;
    expect(got, path).toEqual(kept);
  }
  return kept!;
}

/**
 * Refused on both paths, on an empty and a populated object, with no read of
 * the object and one message per path — one message across the two paths as
 * well unless `acrossPaths` is false (a refusal that lists the aggregated
 * row's columns names the rows path's extra aggregation). Returns the native
 * path's refusal.
 */
async function expectHavingRefusal(having: () => unknown, acrossPaths = true): Promise<Refusal> {
  const first: Partial<Record<Path, Refusal>> = {};
  for (const path of ['native', 'rows'] as const) {
    for (const [population, rows] of [['empty', []], ['populated', ROWS]] as const) {
      const cell = `${path}, ${population}`;
      const { engine, reads } = await makeEngine(path, rows);
      const { err } = await outcome(() => engine.aggregate(OBJECT, havingQuery(path, having())));
      expect(err, cell).toBeInstanceOf(Error);
      expect(reads, cell).toEqual({ aggregate: 0, find: 0 });
      first[path] ??= err!;
      expect(err!.code, cell).toBe(first[path]!.code);
      expect(err!.status, cell).toBe(first[path]!.status);
      expect(err!.message, cell).toBe(first[path]!.message);
    }
  }
  expect(first.rows!.code).toBe(first.native!.code);
  expect(first.rows!.status).toBe(first.native!.status);
  if (acrossPaths) expect(first.rows!.message).toBe(first.native!.message);
  return first.native!;
}

/** The same condition as a `where` on the object's fields — the twin. */
async function whereTwinOf(where: Record<string, unknown>, context?: Context): Promise<{ err?: Refusal; reads: number }> {
  const { engine, reads } = await makeEngine('rows');
  const { err } = await outcome(() => engine.find(OBJECT, { where: where as FilterCondition, ...(context ? { context } : {}) }));
  return { err, reads: reads.find };
}

describe('[#20334] having — a known placeholder resolves, and compares as the value it names', () => {
  // name · having with a token · the same having with the token's value written out · groups kept
  const RESOLVED: ReadonlyArray<readonly [string, unknown, unknown, string[]]> = [
    ['{current_year_start} $gt on max(date) — kept no group, by text order',
      { last_placed: { $gt: '{current_year_start}' } }, { last_placed: { $gt: '2026-01-01' } }, ['c1', 'c2', 'c3', 'c4']],
    ['{current_month_start} $gte on max(date)',
      { last_placed: { $gte: '{current_month_start}' } }, { last_placed: { $gte: '2026-02-01' } }, ['c2', 'c4']],
    ['{today} $lt on max(date) — kept every group, by text order',
      { last_placed: { $lt: '{today}' } }, { last_placed: { $lt: '2026-02-20' } }, ['c1', 'c3', 'c4']],
    ['{30_days_ago} $gt on max(date)',
      { last_placed: { $gt: '{30_days_ago}' } }, { last_placed: { $gt: '2026-01-21' } }, ['c2', 'c4']],
    ['both $between endpoints',
      { last_placed: { $between: ['{current_year_start}', '{current_month_start}'] } },
      { last_placed: { $between: ['2026-01-01', '2026-02-01'] } }, ['c1', 'c3', 'c4']],
    ['an $in member',
      { last_placed: { $in: ['{current_month_start}', '2026-03-01'] } }, { last_placed: { $in: ['2026-02-01', '2026-03-01'] } }, ['c2', 'c4']],
    ['a bare-day token on min(datetime)',
      { first_opened: { $gte: '{current_month_start}' } }, { first_opened: { $gte: '2026-02-01' } }, ['c2', 'c3', 'c4']],
    ['under $or, beside a numeric arm',
      { $or: [{ total: { $gt: 1000 } }, { last_placed: { $lt: '{current_month_start}' } }] },
      { $or: [{ total: { $gt: 1000 } }, { last_placed: { $lt: '2026-02-01' } }] }, ['c1', 'c2', 'c3']],
    ['under $and',
      { $and: [{ total: { $gt: 30 } }, { last_placed: { $gte: '{current_year_start}' } }] },
      { $and: [{ total: { $gt: 30 } }, { last_placed: { $gte: '2026-01-01' } }] }, ['c1', 'c2', 'c3']],
    ['under $not',
      { $not: { last_placed: { $gte: '{current_month_start}' } } }, { $not: { last_placed: { $gte: '2026-02-01' } } }, ['c1', 'c3']],
  ];

  for (const [name, having, literal, kept] of RESOLVED) {
    it(`${name}: keeps ${kept.join(', ') || 'no group'} on both paths, exactly as the value written out does`, async () => {
      expect(await keptGroups(having)).toEqual(kept);
      expect(await keptGroups(literal)).toEqual(kept);
    });
  }

  it('{current_user_id} resolves from the execution context, on a groupBy key', async () => {
    expect(await keptGroups({ customer_id: '{current_user_id}' }, { userId: 'c2' })).toEqual(['c2']);
    expect(await keptGroups({ customer_id: 'c2' }, { userId: 'c2' })).toEqual(['c2']);
  });

  it("resolves on the engine's copy: the caller's having keeps its placeholder", async () => {
    const having = { last_placed: { $gt: '{current_year_start}' } };
    for (const path of ['native', 'rows'] as const) {
      const { engine } = await makeEngine(path);
      await engine.aggregate(OBJECT, havingQuery(path, having));
      expect(having).toEqual({ last_placed: { $gt: '{current_year_start}' } });
    }
  });
});

describe('[#20334] having — a placeholder the resolver cannot resolve is refused before any read, as its where twin is', () => {
  // name · having · its `where` twin · code
  const REFUSED: ReadonlyArray<readonly [string, () => unknown, Record<string, unknown>, string]> = [
    ["the card's row: an unknown token on max(date), which kept no group",
      () => ({ last_placed: { $gte: '{not_a_token}' } }), { placed_on: { $gte: '{not_a_token}' } }, 'FILTER_TOKEN_UNKNOWN'],
    // [#20351] On a text column: a NUMERIC column (`n`, a count) is now the
    // number-comparand door's, which refuses a placeholder unresolved — no
    // filter token resolves to a number.
    ['an unknown token on a text groupBy column, which neither the temporal nor the number door judges',
      () => ({ customer_id: { $gte: '{not_a_token}' } }), { customer_id: { $gte: '{not_a_token}' } }, 'FILTER_TOKEN_UNKNOWN'],
    ['a near-miss spelling ({TODAY})',
      () => ({ last_placed: { $gte: '{TODAY}' } }), { placed_on: { $gte: '{TODAY}' } }, 'FILTER_TOKEN_UNKNOWN'],
    ['an unknown token under $and, beside an arm that holds',
      () => ({ $and: [{ total: { $gt: 0 } }, { last_placed: { $gte: '{not_a_token}' } }] }),
      { $and: [{ amount: { $gt: 0 } }, { placed_on: { $gte: '{not_a_token}' } }] }, 'FILTER_TOKEN_UNKNOWN'],
    ['an unknown token as an $in member under $not',
      () => ({ $not: { last_placed: { $in: ['2026-01-10', '{not_a_token}'] } } }),
      { $not: { placed_on: { $in: ['2026-01-10', '{not_a_token}'] } } }, 'FILTER_TOKEN_UNKNOWN'],
    ['{current_user_id} with no user in the context',
      () => ({ customer_id: '{current_user_id}' }), { customer_id: '{current_user_id}' }, 'FILTER_TOKEN_UNRESOLVED'],
    ['{record_id}, which no server path can resolve',
      () => ({ customer_id: '{record_id}' }), { customer_id: '{record_id}' }, 'FILTER_TOKEN_UNRESOLVED'],
  ];

  for (const [name, having, where, code] of REFUSED) {
    it(`${name}: ${code} / 400 on both paths, empty or populated, no read — the where twin's refusal`, async () => {
      const err = await expectHavingRefusal(having);
      expect(err.code).toBe(code);
      expect(err.status).toBe(400);
      const twin = await whereTwinOf(where);
      expect(twin.reads).toBe(0);
      expect(twin.err?.code).toBe(code);
      expect(twin.err?.status).toBe(400);
      expect(err.message).toBe(twin.err?.message);
    });
  }
});

describe('[#20334] having — the doors in front of the resolver keep their verdicts', () => {
  it('an earlier having door answers first, in its own words (#20123, a key naming no column)', async () => {
    const err = await expectHavingRefusal(() => ({ totl: { $gt: 1 }, last_placed: { $gte: '{not_a_token}' } }), false);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain("`having` filters on 'totl' at having.totl");
  });

  it('the temporal-comparand door answers before the resolver, as on where (#20263)', async () => {
    const err = await expectHavingRefusal(() => ({ last_placed: { $lt: 'not-a-date' }, first_opened: { $gte: '{not_a_token}' } }));
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('at having.last_placed.$lt');
  });

  it('a string that only contains braces is not a placeholder, and compares as written', async () => {
    expect(await keptGroups({ customer_id: { $ne: 'a{b}c' } })).toEqual(['c1', 'c2', 'c3', 'c4']);
  });
});

describe('[#20334] per-aggregation filter — the temporal and text-operator refusals name the position they sit in', () => {
  /** A filter in aggregation `index`, and its `where` twin through the same verb. */
  async function perAggregationAndWhere(filter: Record<string, unknown>, index = 1) {
    const aggregations: NonNullable<EngineAggregateOptions['aggregations']> = [
      { function: 'count', alias: 'n' },
      ...(index === 2 ? [{ function: 'sum' as const, field: 'amount', alias: 'total' }] : []),
      { function: 'count', alias: 'm', filter: filter as FilterCondition },
    ];
    const { engine, reads } = await makeEngine('native');
    const perAgg = await outcome(() => engine.aggregate(OBJECT, { groupBy: ['customer_id'], aggregations }));
    const twin = await outcome(() => engine.aggregate(OBJECT, {
      where: filter as FilterCondition, groupBy: ['customer_id'], aggregations: [{ function: 'count', alias: 'n' }],
    }));
    expect(reads, 'every refusal precedes the driver').toEqual({ aggregate: 0, find: 0 });
    return { perAgg: perAgg.err!, twin: twin.err! };
  }

  // name · filter · the path the refusal names under `aggregations[i].filter`
  const REFUSED: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
    ["the card's row: a bad date under $gt (temporal door)", { placed_on: { $gt: 'not-a-date' } }, '.placed_on.$gt'],
    ['a bad date behind a $or branch (temporal door)', { $or: [{ amount: { $gt: 0 } }, { placed_on: { $lt: 'not-a-date' } }] }, '.$or[1].placed_on.$lt'],
    ['the number for 10000-01-01 on a date (temporal door, year class)', { placed_on: { $gt: 253402300800000 } }, '.placed_on.$gt'],
    ['$contains on a number field (text-operator door)', { amount: { $contains: '5' } }, '.amount.$contains'],
    ['$startsWith on a date field (text-operator door)', { placed_on: { $startsWith: '2026' } }, '.placed_on.$startsWith'],
  ];

  for (const [name, filter, at] of REFUSED) {
    it(`${name}: at aggregations[1].filter${at}, the where twin's refusal with only its root moved`, async () => {
      const { perAgg, twin } = await perAggregationAndWhere(filter);
      expect(perAgg.code).toBe('INVALID_FILTER');
      expect(perAgg.status).toBe(400);
      expect(perAgg.message).toContain(`at aggregations[1].filter${at}`);
      expect(perAgg.message).not.toContain(' at where.');
      // The control: `where` keeps its own root, and the two refusals differ in that root alone.
      expect(twin.code).toBe('INVALID_FILTER');
      expect(twin.status).toBe(400);
      expect(twin.message).toContain(`at where${at}`);
      expect(perAgg.message).toBe(twin.message.replace(` at where${at}`, ` at aggregations[1].filter${at}`));
    });
  }

  it('the index is the aggregation that carries the filter', async () => {
    const { perAgg } = await perAggregationAndWhere({ placed_on: { $gt: 'not-a-date' } }, 2);
    expect(perAgg.message).toContain('at aggregations[2].filter.placed_on.$gt');
  });
});
