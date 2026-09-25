// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `engine.aggregate({ aggregations: [{ …, filter }] })` — ENFORCED since
// #10576, the contract half of #10413's ruling (maintainer, 2026-08-21,
// verbatim 「其他接受」 accepting option A: 「给引擎聚合契约加逐聚合过滤,一次修
// 对所有驱动」).
//
// The defect being closed: the ObjectQL analytics path handed per-measure
// filters (`stage: 'closed_won'`) toward `engine.aggregate` and the contract
// had nowhere to put them, so "won deals" counted EVERY row — silently, with
// the dashboard door on the same deployment answering the filtered numbers
// (#10413's two-door disagreement). These tests reproduce that measurement's
// shape at the objectql level: the same dataset, the same three measures, and
// the numbers CHANGING once the filter is honoured.
//
// Execution model pinned here (the correct-first two-tier shape date bucketing
// and HAVING use):
//   * any aggregation carrying a non-empty `filter` forces the in-memory path
//     — no driver compiles a conditional aggregate today, and pushing the
//     entry down would aggregate the unfiltered rows;
//   * aggregations WITHOUT a filter keep the native pushdown path untouched
//     (the widening must not move the existing acceptance face);
//   * an unknown operator inside a per-aggregation filter REFUSES with the
//     ADR-0112 `INVALID_FILTER`/400 envelope, naming the aggregation position
//     — ignoring it would silently answer the unfiltered aggregate, which is
//     the very defect this key closes.
//   * [#20122] every such refusal is the FILTER's, not the data's: raised once,
//     before any driver is asked for a row, identically on an empty and on a
//     populated table (the last block of this file).

import { describe, it, expect } from 'vitest';
import { normalizeFilterComparandTypes, type EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { matchesAggregationFilter } from './having-filter.js';

// The #10413 measurement's dataset shape: opportunities with a stage and an
// amount. 6 rows, 2 closed_won worth 700 total.
const OPPORTUNITIES = [
  { stage: 'closed_won', amount: 500, region: 'east' },
  { stage: 'closed_won', amount: 200, region: 'west' },
  { stage: 'open', amount: 900, region: 'east' },
  { stage: 'open', amount: 300, region: 'west' },
  { stage: 'closed_lost', amount: 50, region: 'east' },
  { stage: 'closed_lost', amount: 20, region: 'west' },
];

/** A driver WITH native aggregate() — counts its calls so the fork is visible. */
function makeNativeDriver(rows: any[]) {
  let nativeAggregateCalls = 0;
  let findCalls = 0;
  const driver: any = {
    name: 'native-agg-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { findCalls += 1; return rows.slice(); },
    async findOne() { return rows[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
    async aggregate(_object: string, ast: any) {
      nativeAggregateCalls += 1;
      // A native driver that DROPS the per-aggregation filter — the pre-#10576
      // behaviour of every real driver. If the engine ever pushes a filtered
      // aggregation down here, the totals below come back unfiltered and the
      // reproduction test reads the wrong numbers.
      const out: Record<string, any> = {};
      for (const agg of ast.aggregations ?? []) {
        if (agg.function === 'count') out[agg.alias] = rows.length;
        if (agg.function === 'sum') out[agg.alias] = rows.reduce((a: number, r: any) => a + r[agg.field], 0);
      }
      return [out];
    },
  };
  return { driver, nativeCalls: () => nativeAggregateCalls, finds: () => findCalls };
}

/** A driver WITHOUT aggregate() — the engine's find() + in-memory lowering. */
function makeRawDriver(rows: any[]) {
  const driver: any = {
    name: 'raw-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return rows.slice(); },
    async findOne() { return rows[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

async function makeEngine(driver: any) {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  // Receiver-cast rather than argument-cast: `registerObject`'s later
  // parameters are irrelevant to these tests, and the argument-cast spelling
  // still bills the package's TEST_DEBT ratchet a TS2554 arity error.
  (engine.registry as any).registerObject({
    name: 'crm_opportunity',
    fields: {
      stage: { type: 'text' },
      amount: { type: 'number' },
      region: { type: 'text' },
    },
  });
  return engine;
}

// The #10413 reproduction's three measures, lowered to the contract this card
// widens: per-aggregation `filter` on the two "won" measures.
const REPRO_AGGREGATIONS: NonNullable<EngineAggregateOptions['aggregations']> = [
  { function: 'count', alias: 'opp_count' },
  { function: 'count', alias: 'won_count', filter: { stage: 'closed_won' } },
  { function: 'sum', field: 'amount', alias: 'won_amount', filter: { stage: 'closed_won' } },
];

describe('engine.aggregate — per-aggregation filter (#10576, the #10413 contract half)', () => {
  it('reproduces #10413: per-measure stage filters reach engine.aggregate and CHANGE the numbers', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: REPRO_AGGREGATIONS,
    } satisfies EngineAggregateOptions);

    // Pre-#10576 (the measured defect): won_count === opp_count === 6 and
    // won_amount summed every row (1970). Honoured, the numbers move.
    expect(rows).toEqual([{ opp_count: 6, won_count: 2, won_amount: 700 }]);
  });

  it('a filtered aggregation forces the in-memory lowering even on a native-aggregate driver', async () => {
    const { driver, nativeCalls, finds } = makeNativeDriver(OPPORTUNITIES);
    const engine = await makeEngine(driver);

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: REPRO_AGGREGATIONS,
    } satisfies EngineAggregateOptions);

    // The driver's own aggregate() drops the filter (as every real driver
    // did), so the ONLY way these numbers are right is that the engine never
    // called it: filtered aggregations take find() + in-memory.
    expect(nativeCalls()).toBe(0);
    expect(finds()).toBe(1);
    expect(rows).toEqual([{ opp_count: 6, won_count: 2, won_amount: 700 }]);
  });

  it('positive pin: aggregations WITHOUT filter keep the native pushdown path, results unchanged', async () => {
    const { driver, nativeCalls } = makeNativeDriver(OPPORTUNITIES);
    const engine = await makeEngine(driver);

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: [
        { function: 'count', alias: 'opp_count' },
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
    } satisfies EngineAggregateOptions);

    expect(nativeCalls()).toBe(1); // pushdown exactly as before the widening
    expect(rows).toEqual([{ opp_count: 6, total_amount: 1970 }]);
  });

  it('positive pin: an EMPTY filter object is vacuous (same convention as where/having) and does not break pushdown', async () => {
    const { driver, nativeCalls } = makeNativeDriver(OPPORTUNITIES);
    const engine = await makeEngine(driver);

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: [{ function: 'count', alias: 'opp_count', filter: {} }],
    } satisfies EngineAggregateOptions);

    expect(nativeCalls()).toBe(1);
    expect(rows).toEqual([{ opp_count: 6 }]);
  });

  it('composes with groupBy: the filter narrows each bucket for ITS aggregation only', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      groupBy: ['region'],
      aggregations: [
        { function: 'count', alias: 'opp_count' },
        { function: 'sum', field: 'amount', alias: 'won_amount', filter: { stage: 'closed_won' } },
      ],
    } satisfies EngineAggregateOptions);

    const byRegion = Object.fromEntries(rows.map((r: any) => [r.region, r]));
    expect(byRegion.east).toEqual({ region: 'east', opp_count: 3, won_amount: 500 });
    expect(byRegion.west).toEqual({ region: 'west', opp_count: 3, won_amount: 200 });
  });

  it('a group the filter empties answers the ruled empty-group values: count/sum 0, avg/min/max null', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      groupBy: ['region'],
      aggregations: [
        // No row has this stage, so every bucket's filtered set is empty.
        { function: 'count', alias: 'n', filter: { stage: 'no_such_stage' } },
        { function: 'sum', field: 'amount', alias: 'total', filter: { stage: 'no_such_stage' } },
        { function: 'avg', field: 'amount', alias: 'mean', filter: { stage: 'no_such_stage' } },
        { function: 'max', field: 'amount', alias: 'top', filter: { stage: 'no_such_stage' } },
      ],
    } satisfies EngineAggregateOptions);

    // `emptyGroupValueFor` (spec data/aggregation-policy.ts): counting or
    // summing no rows is a measured 0; averaging/maximising them has no answer.
    for (const row of rows) {
      expect(row.n).toBe(0);
      expect(row.total).toBe(0);
      expect(row.mean).toBeNull();
      expect(row.top).toBeNull();
    }
  });

  it('the filter composes the where vocabulary ($in, $gte, $and) over source rows', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: [{
        function: 'count',
        alias: 'big_closed',
        filter: { $and: [{ stage: { $in: ['closed_won', 'closed_lost'] } }, { amount: { $gte: 50 } }] },
      }],
    } satisfies EngineAggregateOptions);

    // closed_won 500, closed_won 200, closed_lost 50 — the 20 is excluded.
    expect(rows).toEqual([{ big_closed: 3 }]);
  });

  it('an unknown operator in a per-aggregation filter REFUSES with INVALID_FILTER/400, naming the position', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      await engine.aggregate('crm_opportunity', {
        aggregations: [
          { function: 'count', alias: 'opp_count' },
          { function: 'count', alias: 'bad', filter: { amount: { $median: 3 } } },
        ],
      } as unknown as EngineAggregateOptions);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }

    // The named envelope, not a bare throw (#6142/#6050: a suite that only
    // asserts THREW stays green while the envelope is missing).
    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('INVALID_FILTER');
    expect(thrown!.status).toBe(400);
    expect(thrown!.message).toMatch(/Unsupported operator '\$median' in `aggregations\[1\]\.filter`/);
    expect(thrown!.message).toMatch(/refused rather than ignored/);
  });

  it('a retired operator ($regex) in a per-aggregation filter gets the retirement prescription, same envelope', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      await engine.aggregate('crm_opportunity', {
        aggregations: [{ function: 'count', alias: 'bad', filter: { stage: { $regex: 'won' } } }],
      } as unknown as EngineAggregateOptions);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }

    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('INVALID_FILTER');
    expect(thrown!.status).toBe(400);
    expect(thrown!.message).toMatch(/Filter operator '\$regex' in `aggregations\[0\]\.filter` is RETIRED/);
  });

  it('the comparand-shape door covers the new filter position: a scalar $in is refused before any driver runs', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      await engine.aggregate('crm_opportunity', {
        aggregations: [{ function: 'count', alias: 'bad', filter: { stage: { $in: 'closed_won' } } }],
      } as unknown as EngineAggregateOptions);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }

    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('INVALID_FILTER');
    expect(thrown!.status).toBe(400);
    // The path names WHICH aggregation carries the offending comparand.
    expect(thrown!.message).toContain('aggregations[0].filter');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#20122] The verdict belongs to the filter, not to the data
// ───────────────────────────────────────────────────────────────────────────

/**
 * A driver that records every read, with or without a native `aggregate()`.
 * A per-aggregation filter forces the in-memory fallback on both kinds (the
 * #10576 fork), so a refusal raised AFTER a read shows up as `find: 1`.
 */
function makeCountingDriver(rows: ReadonlyArray<Record<string, unknown>>, native: boolean) {
  const calls = { aggregate: 0, find: 0 };
  const driver: any = {
    name: native ? 'native-agg-recorder' : 'raw-recorder',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { calls.find += 1; return rows.map((r) => ({ ...r })); },
    async findOne() { return rows[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (native) driver.aggregate = async () => { calls.aggregate += 1; return []; };
  return { driver, calls };
}

interface Refusal extends Error { code?: unknown; status?: unknown }

async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  let out: unknown;
  try {
    out = await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, but it answered ${JSON.stringify(out)}`);
}

function syncRefusalOf(run: () => unknown): Refusal | undefined {
  try {
    run();
  } catch (e) {
    return e as Refusal;
  }
  return undefined;
}

/**
 * The filter sits on the SECOND aggregation, so every refusal must name
 * `aggregations[1].filter` — which aggregation carries it, not merely that one
 * does.
 */
function withFilter(filter: unknown, groupBy?: string[]): EngineAggregateOptions {
  return {
    ...(groupBy ? { groupBy } : {}),
    aggregations: [
      { function: 'count', alias: 'opp_count' },
      { function: 'count', alias: 'picked', filter },
    ],
  } as unknown as EngineAggregateOptions;
}

const AT = 'aggregations[1].filter';

/**
 * Refused on both driver kinds, on an EMPTY and a populated table, grouped and
 * ungrouped, with one message and no driver read. Returns the message.
 *
 * Before: every empty-table cell answered — `[]` grouped, `[{ opp_count: 0,
 * picked: 0 }]` ungrouped — and the populated cells refused only after the
 * driver had been read (`find: 1`), when they refused at all.
 */
async function expectFilterRefusal(filter: () => unknown): Promise<string> {
  let message: string | undefined;
  for (const native of [true, false]) {
    for (const [population, rows] of [['empty', []], ['populated', OPPORTUNITIES]] as const) {
      for (const groupBy of [undefined, ['region']]) {
        const cell = `${native ? 'native-capable' : 'raw'} driver, ${population}, ${groupBy ? 'grouped' : 'ungrouped'}`;
        const { driver, calls } = makeCountingDriver(rows, native);
        const engine = await makeEngine(driver);
        const err = await refusalOf(() => engine.aggregate('crm_opportunity', withFilter(filter(), groupBy)));
        expect(err, cell).toBeInstanceOf(Error);
        expect(err.code, cell).toBe('INVALID_FILTER');
        expect(err.status, cell).toBe(400);
        expect(calls, cell).toEqual({ aggregate: 0, find: 0 });
        message ??= err.message;
        expect(err.message, cell).toBe(message);
      }
    }
  }
  return message!;
}

describe('[#20122] per-aggregation filter — the walker\'s refusals belong to the filter, not to the data', () => {
  // Each row: the filter, and a SOURCE row that walks the per-row evaluator
  // INTO the refused arm — the floor whose words the engine-level refusal
  // keeps. Before, measured through `engine.aggregate` on driver-memory and
  // driver-sql (and through `POST /data/:object/query`): the populated table
  // refused, the empty one answered; the column-absent row counted ZERO on a
  // populated table too (the no-value exit sat before the operator was read);
  // and the `$or` row counted EVERY row, its first branch having held.
  const WALKER_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, Record<string, unknown>]> = [
    ['an unknown condition operator (the triage shape)', () => ({ amount: { $median: 1 } }), { amount: 1 }],
    ['an unknown logical operator', () => ({ $nand: [{ amount: 1 }] }), { amount: 1 }],
    ['a retired operator', () => ({ stage: { $regex: 'won' } }), { stage: 'closed_won' }],
    ['a retired operator with its retired sibling', () => ({ stage: { $regex: 'won', $options: 'i' } }), { stage: 'closed_won' }],
    ['an operator of `where` this walker does not evaluate ($like)', () => ({ stage: { $like: 'closed%' } }), { stage: 'closed_won' }],
    ['a $like with a dangling escape', () => ({ stage: { $like: 'closed\\' } }), { stage: 'closed_won' }],
    ['an empty $icontains', () => ({ stage: { $icontains: '' } }), { stage: 'closed_won' }],
    ['a non-string $icontains', () => ({ stage: { $icontains: 5 } }), { stage: 'closed_won' }],
    ['a non-$ key beside an operator', () => ({ amount: { $gt: 1, foo: 2 } }), { amount: 5 }],
    ['an unknown operator on a column the row does not carry', () => ({ nope: { $median: 1 } }), { nope: 1 }],
    ['an unknown operator behind a $or branch that already held', () => ({ $or: [{ amount: { $gt: 0 } }, { amount: { $median: 1 } }] }), { amount: -1 }],
    ['an unknown operator under $not', () => ({ $not: { amount: { $median: 1 } } }), { amount: 1 }],
  ];

  for (const [name, filter, floorRow] of WALKER_REFUSED) {
    it(`${name}: refused on an empty and a populated table, in the walker's own words`, async () => {
      const floor = syncRefusalOf(() => matchesAggregationFilter(floorRow, filter() as never, 1));
      expect(floor, 'the per-row walker must refuse this row when it reaches it').toBeDefined();
      const message = await expectFilterRefusal(filter);
      expect(message).toBe(floor!.message);
      expect(message).toContain(AT);
    });
  }

  // Before: each row counted nothing in any group (`$nin` and `$exists`
  // counted every row), or — the bare form — was refused on a populated table
  // only, as an unsupported `$field` operator.
  const REFERENCE_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, string]> = [
    ['a bare reference with no operator', () => ({ amount: { $field: 'amount' } }), `${AT}.amount`],
    ['a reference as an $in member', () => ({ amount: { $in: [{ $field: 'amount' }] } }), `${AT}.amount.$in`],
    ['a reference as a $nin member', () => ({ amount: { $nin: [1, { $field: 'amount' }] } }), `${AT}.amount.$nin`],
    ['a reference as a $contains pattern', () => ({ stage: { $contains: { $field: 'region' } } }), `${AT}.stage.$contains`],
    ['a reference under $exists', () => ({ amount: { $exists: { $field: 'amount' } } }), `${AT}.amount.$exists`],
    ['a fractional addDays', () => ({ amount: { $lte: { $field: 'amount', addDays: 1.5 } } }), `${AT}.amount.$lte`],
    ['a string addDays', () => ({ amount: { $lte: { $field: 'amount', addDays: '7' } } }), `${AT}.amount.$lte`],
  ];

  for (const [name, filter, path] of REFERENCE_REFUSED) {
    it(`${name}: refused at ${path}, whatever the rows`, async () => {
      expect(await expectFilterRefusal(filter)).toContain(path);
    });
  }
});

describe('[#20122] per-aggregation filter — the comparand-TYPE door `where` takes', () => {
  // Before: each row counted no row (`$ne` every row) on a populated table, and
  // a Symbol under an ordering operator threw a raw `TypeError` with no `code`
  // and no `status` — populated tables only; an empty one answered.
  const TYPE_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>]> = [
    ['a plain object under $eq', () => ({ amount: { $eq: { v: 1 } } })],
    ['undefined in the implicit-equality slot', () => ({ amount: undefined })],
    ['a Map under $eq', () => ({ amount: { $eq: new Map() } })],
    ['a function under $gt', () => ({ amount: { $gt: () => 1 } })],
    ['a Symbol under $gt', () => ({ amount: { $gt: Symbol('x') } })],
    ['a Symbol under $ne', () => ({ amount: { $ne: Symbol('x') } })],
    ['an undefined $in member', () => ({ amount: { $in: [undefined] } })],
    ['a bigint beyond 2^53', () => ({ amount: { $gt: 2n ** 60n } })],
    ['a { $field } whose $field is not a string', () => ({ amount: { $gt: { $field: 5 } } })],
    ['a plain object nested in $or', () => ({ $or: [{ amount: 1 }, { amount: { $eq: { v: 1 } } }] })],
  ];

  for (const [name, filter] of TYPE_REFUSED) {
    it(`${name}: refused in the type door's own words, rooted at the aggregation, whatever the rows`, async () => {
      const door = syncRefusalOf(() => normalizeFilterComparandTypes(filter(), "aggregate('crm_opportunity')", AT));
      expect(door, 'the type door must refuse this row directly').toBeDefined();
      expect(await expectFilterRefusal(filter)).toBe(door!.message);
    });
  }

  it('an exact-range bigint is NARROWED, as it is in where — and the caller\'s entry is not edited', async () => {
    // Before: `{ $in: [500n, 200n] }` counted no row — `[500n].includes(500)`
    // is false — while the same list in `where` is narrowed to numbers first.
    for (const native of [true, false]) {
      const { driver } = makeCountingDriver(OPPORTUNITIES, native);
      const engine = await makeEngine(driver);
      const query = withFilter({ amount: { $in: [500n, 200n] } });
      const rows = await engine.aggregate('crm_opportunity', query);
      expect(rows).toEqual([{ opp_count: 6, picked: 2 }]);
      expect((query.aggregations![1] as { filter?: unknown }).filter).toEqual({ amount: { $in: [500n, 200n] } });
    }
  });
});

describe('[#20122] per-aggregation filter — what the walk leaves alone answers exactly as before', () => {
  // Measured identical at base and head through `engine.aggregate` on
  // driver-memory and driver-sql. Each answers on both driver kinds; the empty
  // table answers the ruled empty values.
  const PASSING: ReadonlyArray<readonly [string, () => Record<string, unknown>, number]> = [
    ['implicit equality', () => ({ stage: 'closed_won' }), 2],
    ['a scalar ordering bound', () => ({ amount: { $gt: 100 } }), 4],
    ['a list under $in', () => ({ amount: { $in: [500, 20] } }), 2],
    ['a list under $nin', () => ({ stage: { $nin: ['open'] } }), 4],
    ['a [min, max] pair under $between', () => ({ amount: { $between: [50, 300] } }), 3],
    ['a case-insensitive $icontains', () => ({ stage: { $icontains: 'WON' } }), 2],
    ['$startsWith', () => ({ stage: { $startsWith: 'closed' } }), 4],
    ['$ne: null', () => ({ region: { $ne: null } }), 6],
    ['$exists', () => ({ region: { $exists: true } }), 6],
    ['composed under $or / $not', () => ({ $or: [{ amount: { $gt: 800 } }, { $not: { stage: { $ne: 'closed_lost' } } }] }), 3],
    ['a { $field } reference in a scalar comparison', () => ({ amount: { $gte: { $field: 'amount' } } }), 6],
    ['the zero-row filter analytics lowers FALSE to', () => ({ $not: {} }), 0],
    ['an exact bigint in the implicit slot', () => ({ amount: 500n }), 1],
  ];

  for (const [name, filter, populatedCount] of PASSING) {
    it(`${name} counts ${populatedCount} of 6, and 0 on an empty table`, async () => {
      for (const native of [true, false]) {
        const { driver } = makeCountingDriver(OPPORTUNITIES, native);
        const populated = await makeEngine(driver);
        expect(await populated.aggregate('crm_opportunity', withFilter(filter()))).toEqual([{ opp_count: 6, picked: populatedCount }]);
        const { driver: emptyDriver } = makeCountingDriver([], native);
        const empty = await makeEngine(emptyDriver);
        expect(await empty.aggregate('crm_opportunity', withFilter(filter()))).toEqual([{ opp_count: 0, picked: 0 }]);
      }
    });
  }
});

describe('[#20122] per-aggregation filter — the shape gate `where` takes: a filter that is not a filter object is refused', () => {
  // Before, measured through `engine.aggregate` on driver-memory and
  // driver-sql: each shape was DROPPED — the aggregation counted every row of
  // its group, on a populated table, with no error (driver-sql's native
  // aggregate answered the non-empty string with NOT_IMPLEMENTED / 501). The
  // REST door refuses each one already, through `AggregationNodeSchema`.
  const SHAPE_REFUSED: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['a string', () => "stage = 'closed_won'", `received string "stage = 'closed_won'"`],
    ['a number', () => 42, 'received number 42'],
    ['a Map', () => new Map([['stage', 'closed_won']]), 'received Map'],
    ['true', () => true, 'received boolean true'],
    ['the empty string', () => '', 'received string ""'],
    ['a Date', () => new Date(0), 'received Date'],
  ];

  for (const [name, filter, received] of SHAPE_REFUSED) {
    it(`${name}: refused before any read, whatever the rows`, async () => {
      const message = await expectFilterRefusal(filter);
      expect(message).toContain(`aggregate('crm_opportunity'): '${AT}' must be a filter object, ${received}.`);
      expect(message).toContain('It was not applied');
    });
  }

  it('a filter object answers as before — a literal and a null-prototype one alike', async () => {
    for (const native of [true, false]) {
      for (const filter of [{ stage: 'closed_won' }, Object.assign(Object.create(null), { stage: 'closed_won' })]) {
        const { driver } = makeCountingDriver(OPPORTUNITIES, native);
        const engine = await makeEngine(driver);
        expect(await engine.aggregate('crm_opportunity', withFilter(filter))).toEqual([{ opp_count: 6, picked: 2 }]);
      }
    }
  });

  // [#20122, seat ruling A on the array question] An ARRAY is refused too, `[]`
  // included: the slot is declared `FilterConditionSchema`, which admits no
  // array form, and the REST door refuses every array there already
  // (`VALIDATION_FAILED`). Before, in-process, a condition array counted NO row
  // (the walker read its index positions as column names) and `[]` read as no
  // filter — neither is what the declaration allows.
  const ARRAY_REFUSED: ReadonlyArray<readonly [string, () => unknown, string]> = [
    ['an empty array', () => [], 'received an array ([])'],
    ['a condition array', () => [['amount', '>', 100]], 'received an array ([["amount",">",100]])'],
    ['a logical-group array', () => ['and', ['stage', '=', 'closed_won'], ['amount', '>', 100]], 'received an array (["and",'],
  ];

  for (const [name, filter, received] of ARRAY_REFUSED) {
    it(`${name}: refused before any read, whatever the rows, naming the object form`, async () => {
      const message = await expectFilterRefusal(filter);
      expect(message).toContain(`aggregate('crm_opportunity'): '${AT}' must be a filter object, ${received}`);
      expect(message).toContain('input-only sugar');
    });
  }
});
