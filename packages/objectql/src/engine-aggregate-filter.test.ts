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
    // [#20981] Refused at the same path, as a non-boolean flag first now — the
    // words are pinned in engine-aggregate-flag-comparand-refusal.test.ts.
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

// ───────────────────────────────────────────────────────────────────────────
// [#20148] The doors `where` has and the per-aggregation filter lacked
// ───────────────────────────────────────────────────────────────────────────

/**
 * An order ledger with every temporal class and a numeric pair, so each door
 * has a declared field to judge. `id` and `created_at` ride on every row, as a
 * driver's rows carry them, for the system-column reference controls.
 */
const ORDERS: ReadonlyArray<Record<string, unknown>> = [
  { id: 'o1', customer_id: 'c1', amount: 100, cap: 50, placed_on: '2026-01-10', due_on: '2026-01-05', grace: 3, opened_at: '2026-01-01T10:00:00.000Z', closed_at: '2026-01-03T10:00:00.000Z', slot: '09:00:00', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'o2', customer_id: 'c1', amount: 400, cap: 10, placed_on: '2026-01-02', due_on: '2026-01-20', grace: 10, opened_at: '2026-01-02T10:00:00.000Z', closed_at: '2026-01-02T12:00:00.000Z', slot: '10:30:00', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'o3', customer_id: 'c2', amount: 900, cap: 5000, placed_on: '2026-03-01', due_on: '2026-01-01', grace: 1, opened_at: '2026-02-01T10:00:00.000Z', closed_at: '2026-02-10T10:00:00.000Z', slot: '11:00:00', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'o4', customer_id: 'c2', amount: 300, cap: 1, placed_on: '2026-02-01', due_on: '2026-02-01', grace: 1, opened_at: '2026-02-05T10:00:00.000Z', closed_at: '2026-02-05T11:00:00.000Z', slot: '12:00:00', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'o5', customer_id: 'c2', amount: 50, cap: 2, placed_on: '2026-01-15', due_on: '2026-03-01', grace: 1, opened_at: '2026-02-06T10:00:00.000Z', closed_at: '2026-02-06T10:00:00.000Z', slot: '13:00:00', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'o6', customer_id: 'c3', amount: 20, cap: 20, placed_on: '2026-02-01', due_on: '2026-01-31', grace: 0, opened_at: '2026-03-01T10:00:00.000Z', closed_at: '2026-03-01T10:00:00.000Z', slot: '14:00:00', created_at: '2026-09-01T00:00:00.000Z' },
];

async function makeOrderEngine(driver: any) {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  (engine.registry as any).registerObject({
    name: 'crm_order',
    fields: {
      customer_id: { type: 'text' },
      amount: { type: 'number' },
      cap: { type: 'number' },
      placed_on: { type: 'date' },
      due_on: { type: 'date' },
      grace: { type: 'number' },
      opened_at: { type: 'datetime' },
      closed_at: { type: 'datetime' },
      slot: { type: 'time' },
    },
  });
  return engine;
}

/**
 * Refused on both driver kinds, on an EMPTY and a populated table, grouped and
 * ungrouped, with one message and no driver read — and the same filter as a
 * `where` on the same engine (the twin), with its own answer. Returns the
 * message and every `warn` line the engine logged while refusing.
 */
async function expectOrderFilterRefusal(filter: () => unknown): Promise<{ message: string; warnings: string[] }> {
  let message: string | undefined;
  const warnings: string[] = [];
  for (const native of [true, false]) {
    for (const [population, rows] of [['empty', []], ['populated', ORDERS]] as const) {
      for (const groupBy of [undefined, ['customer_id']]) {
        const cell = `${native ? 'native-capable' : 'raw'} driver, ${population}, ${groupBy ? 'grouped' : 'ungrouped'}`;
        const { driver, calls } = makeCountingDriver(rows, native);
        const engine = await makeOrderEngine(driver);
        const logger = (engine as any).logger;
        const warn = logger.warn;
        logger.warn = (line: unknown) => { warnings.push(String(line)); };
        try {
          const err = await refusalOf(() => engine.aggregate('crm_order', withFilter(filter(), groupBy)));
          expect(err, cell).toBeInstanceOf(Error);
          expect(err.code, cell).toBe('INVALID_FILTER');
          expect(err.status, cell).toBe(400);
          expect(calls, cell).toEqual({ aggregate: 0, find: 0 });
          message ??= err.message;
          expect(err.message, cell).toBe(message);
        } finally {
          logger.warn = warn;
        }
      }
    }
  }
  return { message: message!, warnings };
}

/** The same condition as the call's `where` (the twin), on a populated table. */
async function whereTwinOf(filter: unknown, native: boolean): Promise<{ answer?: unknown; err?: Refusal; calls: { aggregate: number; find: number } }> {
  const { driver, calls } = makeCountingDriver(ORDERS, native);
  const engine = await makeOrderEngine(driver);
  try {
    const answer = await engine.aggregate('crm_order', {
      where: filter,
      aggregations: [{ function: 'count', alias: 'n' }],
    } as unknown as EngineAggregateOptions);
    return { answer, calls };
  } catch (e) {
    return { err: e as Refusal, calls };
  }
}

describe('[#20148] per-aggregation filter — the temporal-comparand door `where` takes', () => {
  // Before, measured through `engine.aggregate` and `POST /data/:object/query`
  // on driver-memory and driver-sql: each counted NO row on a populated table
  // (the `$between` and the `$or` / `$not` rows counted EVERY row), and the
  // same condition as a `where` was refused 400 by this door.
  const TEMPORAL_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, string, string]> = [
    ['a bad date under $gt (the card\'s row 1)', () => ({ placed_on: { $gt: 'not-a-date' } }), 'placed_on', '"not-a-date"'],
    ['a bad date as an $in member', () => ({ placed_on: { $in: ['2026-01-10', 'not-a-date'] } }), 'placed_on', '"not-a-date"'],
    ['a bad date as a $between endpoint', () => ({ placed_on: { $between: ['2026-01-01', 'not-a-date'] } }), 'placed_on', '"not-a-date"'],
    ['a bad date in the implicit-equality slot', () => ({ placed_on: 'not-a-date' }), 'placed_on', '"not-a-date"'],
    ['a preset name on a datetime', () => ({ opened_at: { $gte: 'last_30_days' } }), 'opened_at', '"last_30_days"'],
    ['a bad wall clock on a time', () => ({ slot: { $gt: 'noon' } }), 'slot', '"noon"'],
    ['a bad date behind a $or branch that holds', () => ({ $or: [{ amount: { $gt: 0 } }, { placed_on: { $gt: 'not-a-date' } }] }), 'placed_on', '"not-a-date"'],
    ['a bad date under $not', () => ({ $not: { placed_on: { $gt: 'not-a-date' } } }), 'placed_on', '"not-a-date"'],
  ];

  for (const [name, filter, field, shown] of TEMPORAL_REFUSED) {
    it(`${name}: refused before any read, whatever the rows — as the where twin is`, async () => {
      await expectFilterRefusalNamed(filter, field, shown);
      for (const native of [true, false]) {
        const twin = await whereTwinOf(filter(), native);
        expect(twin.err?.code).toBe('INVALID_FILTER');
        expect(twin.err?.status).toBe(400);
        expect(twin.calls).toEqual({ aggregate: 0, find: 0 });
        // One door, one verdict: the twin's refusal names the same field and value.
        expect(twin.err?.message).toContain(`filter on '${field}'`);
        expect(twin.err?.message).toContain(shown);
      }
    });
  }

  it('a {placeholder} is stepped around, as in where: `{ $lte: "{today}" }` counts every row', async () => {
    for (const native of [true, false]) {
      const { driver } = makeCountingDriver(ORDERS, native);
      const engine = await makeOrderEngine(driver);
      expect(await engine.aggregate('crm_order', withFilter({ placed_on: { $lte: '{today}' } })))
        .toEqual([{ opp_count: 6, picked: 6 }]);
    }
  });
});

async function expectFilterRefusalNamed(filter: () => unknown, field: string, shown: string) {
  const out = await expectOrderFilterRefusal(filter);
  expect(out.message).toContain(`filter on '${field}'`);
  expect(out.message).toContain(shown);
  return out;
}

describe('[#20148] per-aggregation filter — a { $field } names a declared field, and addDays pairs two temporal fields of one class', () => {
  // Before, measured through `engine.aggregate` and `POST /data/:object/query`
  // on driver-memory and driver-sql: each counted NO row on a populated table
  // (every row under `$ne`, `$not`, or a `$or` branch that held; the
  // date / datetime pair counted 4 of 6 by coercion), while the same condition
  // as a `where` was refused 400 on driver-sql (its cross-field compiler) and
  // counted no row on driver-memory. The rule set is driver-sql's; the words
  // are its words for that refusal — the fields, the operator and the reason
  // withheld, the diagnostic in the server log.
  const REFERENCE_REFUSED: ReadonlyArray<readonly [string, () => Record<string, unknown>, string]> = [
    ['a referent the object does not declare (the card\'s row 3)', () => ({ amount: { $gt: { $field: 'nope' } } }), '"nope" is not a declared field of "crm_order"'],
    ['an undeclared referent under $ne', () => ({ amount: { $ne: { $field: 'nope' } } }), '"nope" is not a declared field'],
    ['an undeclared referent behind a $or branch that holds', () => ({ $or: [{ amount: { $gt: 0 } }, { amount: { $gt: { $field: 'nope' } } }] }), '"nope" is not a declared field'],
    ['an undeclared referent under $not', () => ({ $not: { amount: { $gt: { $field: 'nope' } } } }), '"nope" is not a declared field'],
    ['a dotted referent', () => ({ amount: { $gt: { $field: 'customer_id.name' } } }), '"customer_id.name" is not a declared field'],
    ['an addDays offset column the object does not declare', () => ({ placed_on: { $lte: { $field: 'due_on', addDays: { $field: 'nope' } } } }), 'the addDays offset "nope" is not a declared field'],
    ['addDays between two numeric fields (the card\'s row 2)', () => ({ amount: { $gt: { $field: 'cap', addDays: 1 } } }), 'addDays adds whole days to a date or datetime column, and "cap" is numeric'],
    ['addDays behind a $or branch that holds', () => ({ $or: [{ amount: { $gt: 0 } }, { amount: { $gt: { $field: 'cap', addDays: 1 } } }] }), 'and "cap" is numeric'],
    ['addDays from a date to a numeric field', () => ({ placed_on: { $lte: { $field: 'grace', addDays: 1 } } }), '"placed_on" is date but "grace" is numeric'],
    ['addDays between a date and a datetime', () => ({ placed_on: { $lte: { $field: 'closed_at', addDays: 1 } } }), '"placed_on" is date but "closed_at" is datetime'],
    ['addDays from a text to a date', () => ({ customer_id: { $lte: { $field: 'due_on', addDays: 1 } } }), '"customer_id" is text but "due_on" is date'],
    ['addDays between two time fields', () => ({ slot: { $gte: { $field: 'slot', addDays: 1 } } }), 'and "slot" is time'],
    ['an addDays offset read from a text field', () => ({ placed_on: { $lte: { $field: 'due_on', addDays: { $field: 'customer_id' } } } }), 'the addDays offset "customer_id" (text) is not a numeric column'],
    ['an addDays offset read from a date field', () => ({ placed_on: { $lte: { $field: 'due_on', addDays: { $field: 'placed_on' } } } }), 'the addDays offset "placed_on" (date) is not a numeric column'],
  ];

  for (const [name, filter, diagnostic] of REFERENCE_REFUSED) {
    it(`${name}: refused before any read, whatever the rows, the names withheld and logged`, async () => {
      const { message, warnings } = await expectOrderFilterRefusal(filter);
      expect(message).toContain(`\`${AT}\``);
      expect(message).toContain('withheld from the message');
      // The withheld half: no field this filter names reaches the message…
      for (const name of ['nope', 'cap', 'grace', 'closed_at', 'due_on', 'customer_id', 'placed_on', 'amount', 'slot']) {
        expect(message).not.toContain(`"${name}"`);
      }
      // …and every refusal put it in the server log, once per refusal.
      expect(warnings).toHaveLength(8);
      for (const line of warnings) expect(line).toContain(diagnostic);
    });
  }

  it('the where twin of the undeclared referent is not refused by the engine — it is driver-sql\'s compiler that refuses it', async () => {
    // The control that places the door: the engine judges `where`'s
    // references nowhere, so a mock driver answers the twin (a count of 0 here,
    // the reference never resolving) — the refusal `where` gets lives one layer
    // down, in the driver the REST pin runs (`aggregation-filter-where-doors`).
    for (const native of [true, false]) {
      const twin = await whereTwinOf({ amount: { $gt: { $field: 'nope' } } }, native);
      expect(twin.err).toBeUndefined();
    }
  });

  // Measured identical at base and head through `engine.aggregate` on
  // driver-memory and driver-sql: what the rules leave alone counts as before.
  const REFERENCE_PASSING: ReadonlyArray<readonly [string, () => Record<string, unknown>, number]> = [
    ['a numeric pair with no addDays', () => ({ amount: { $gt: { $field: 'cap' } } }), 4],
    ['addDays between two date fields', () => ({ placed_on: { $lte: { $field: 'due_on', addDays: 7 } } }), 5],
    ['addDays read from a numeric column', () => ({ placed_on: { $lte: { $field: 'due_on', addDays: { $field: 'grace' } } } }), 3],
    ['addDays between two datetime fields', () => ({ closed_at: { $gte: { $field: 'opened_at', addDays: 1 } } }), 2],
    ['a reference to created_at, a column every row carries', () => ({ opened_at: { $lte: { $field: 'created_at' } } }), 6],
    ['a reference to id, the primary key', () => ({ customer_id: { $ne: { $field: 'id' } } }), 6],
  ];

  for (const [name, filter, populatedCount] of REFERENCE_PASSING) {
    it(`${name} counts ${populatedCount} of 6, and 0 on an empty table`, async () => {
      for (const native of [true, false]) {
        const { driver } = makeCountingDriver(ORDERS, native);
        const populated = await makeOrderEngine(driver);
        expect(await populated.aggregate('crm_order', withFilter(filter()))).toEqual([{ opp_count: 6, picked: populatedCount }]);
        const { driver: emptyDriver } = makeCountingDriver([], native);
        const empty = await makeOrderEngine(emptyDriver);
        expect(await empty.aggregate('crm_order', withFilter(filter()))).toEqual([{ opp_count: 0, picked: 0 }]);
      }
    });
  }

  it('the walker\'s own refusals come first: an unknown operator beside an undeclared referent is the operator\'s refusal', async () => {
    const { message, warnings } = await expectOrderFilterRefusal(
      () => ({ $or: [{ amount: { $gt: { $field: 'nope' } } }, { amount: { $median: 1 } }] }),
    );
    expect(message).toContain("Unsupported operator '$median'");
    expect(warnings).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#21255] A plain { $field } takes the class rule `where` gives every reference
// ───────────────────────────────────────────────────────────────────────────

describe('[#21255] per-aggregation filter — a plain { $field } across two comparison classes is refused, as where refuses it', () => {
  // Before (2791138cbf), the class rule judged only an `addDays` pair, so the
  // card's query — `closed_at` (datetime) `$lte` `{ $field: 'due_on' }` (date)
  // — was answered by `@objectstack/formula`'s whole-day reading of the bare
  // day: 3 of these 6 rows (o1, o2, o5), measured here with the rule reverted,
  // and the same shape counted on `SqlDriver` over better-sqlite3 through
  // `engine.aggregate`, while its `where` twin was refused 400 by `driver-sql`'s
  // cross-field compiler. The twin itself runs in `packages/rest`
  // (`aggregation-filter-where-doors.test.ts`), where a real `SqlDriver`
  // refuses it; the engine judges no `where` reference (the #20148 control
  // above).
  const CROSS_CLASS: ReadonlyArray<readonly [string, () => Record<string, unknown>, string]> = [
    ['a datetime against a date (the card\'s measured query)', () => ({ closed_at: { $lte: { $field: 'due_on' } } }), '"closed_at" is datetime but "due_on" is date'],
    ['a date against a datetime', () => ({ due_on: { $gte: { $field: 'closed_at' } } }), '"due_on" is date but "closed_at" is datetime'],
    ['a text against a number', () => ({ customer_id: { $gt: { $field: 'amount' } } }), '"customer_id" is text but "amount" is numeric'],
    ['a time against a datetime', () => ({ slot: { $lt: { $field: 'opened_at' } } }), '"slot" is time but "opened_at" is datetime'],
    ['a datetime against a date under $ne', () => ({ closed_at: { $ne: { $field: 'due_on' } } }), '"closed_at" is datetime but "due_on" is date'],
    ['a datetime against a date behind a $or branch that holds', () => ({ $or: [{ amount: { $gt: 0 } }, { closed_at: { $lte: { $field: 'due_on' } } }] }), '"closed_at" is datetime but "due_on" is date'],
    ['a datetime against a date under $not', () => ({ $not: { closed_at: { $lte: { $field: 'due_on' } } } }), '"closed_at" is datetime but "due_on" is date'],
  ];

  for (const [name, filter, diagnostic] of CROSS_CLASS) {
    it(`${name}: refused before any read, whatever the rows, the names withheld and logged`, async () => {
      const { message, warnings } = await expectOrderFilterRefusal(filter);
      expect(message).toContain(`\`${AT}\``);
      expect(message).toContain('withheld from the message');
      for (const field of ['closed_at', 'due_on', 'customer_id', 'amount', 'slot', 'opened_at']) {
        expect(message).not.toContain(`"${field}"`);
      }
      // The withheld half names both fields and both classes, once per refusal.
      expect(warnings).toHaveLength(8);
      for (const line of warnings) expect(line).toContain(diagnostic);
    });
  }

  // Answered exactly as before, on both driver kinds: one class on both sides.
  const SAME_CLASS: ReadonlyArray<readonly [string, () => Record<string, unknown>, number]> = [
    ['a date against a date', () => ({ placed_on: { $lte: { $field: 'due_on' } } }), 3],
    ['a datetime against a datetime', () => ({ closed_at: { $gt: { $field: 'opened_at' } } }), 4],
    ['a number against a number', () => ({ cap: { $lt: { $field: 'amount' } } }), 4],
    ['a time against a time', () => ({ slot: { $lte: { $field: 'slot' } } }), 6],
    ['a text against a text', () => ({ customer_id: { $ne: { $field: 'customer_id' } } }), 0],
  ];

  for (const [name, filter, populatedCount] of SAME_CLASS) {
    it(`${name} counts ${populatedCount} of 6, and 0 on an empty table`, async () => {
      for (const native of [true, false]) {
        const { driver } = makeCountingDriver(ORDERS, native);
        const populated = await makeOrderEngine(driver);
        expect(await populated.aggregate('crm_order', withFilter(filter()))).toEqual([{ opp_count: 6, picked: populatedCount }]);
        const { driver: emptyDriver } = makeCountingDriver([], native);
        const empty = await makeOrderEngine(emptyDriver);
        expect(await empty.aggregate('crm_order', withFilter(filter()))).toEqual([{ opp_count: 0, picked: 0 }]);
      }
    });
  }

  it('an object the registry does not declare is not judged — the card\'s query is answered as before', async () => {
    // The fail-open direction an `addDays` pair already takes for a
    // registry-less host: no declaration, no class, no verdict.
    for (const native of [true, false]) {
      const { driver } = makeCountingDriver(ORDERS, native);
      const engine = new ObjectQL();
      engine.registerDriver(driver, true);
      await engine.init();
      expect(await engine.aggregate('crm_order', withFilter({ closed_at: { $lte: { $field: 'due_on' } } })))
        .toEqual([{ opp_count: 6, picked: 3 }]);
    }
  });
});

describe('[#20148] a Date bound is compared as an instant — as the same bound in a where is', () => {
  // Before, measured through `engine.aggregate` on driver-memory and
  // driver-sql: every Date row below counted NO row (`$ne` / `$nin` / the
  // `$between` counted every row), while the same bound in a `where` counted
  // what the ISO-text spelling counts here — each driver reads a Date by the
  // column's storage rule. The ISO spelling is the in-engine control: it
  // answered correctly before and is unchanged.
  const D = (s: string) => new Date(s);
  const DATE_ROWS: ReadonlyArray<readonly [string, () => Record<string, unknown>, () => Record<string, unknown>, number]> = [
    ['$gt (the card\'s row 5)', () => ({ opened_at: { $gt: D('2026-02-01T00:00:00.000Z') } }), () => ({ opened_at: { $gt: '2026-02-01T00:00:00.000Z' } }), 4],
    ['$gte, an equal instant stored', () => ({ opened_at: { $gte: D('2026-02-01T10:00:00.000Z') } }), () => ({ opened_at: { $gte: '2026-02-01T10:00:00.000Z' } }), 4],
    ['$lt', () => ({ opened_at: { $lt: D('2026-02-01T00:00:00.000Z') } }), () => ({ opened_at: { $lt: '2026-02-01T00:00:00.000Z' } }), 2],
    ['$lte', () => ({ opened_at: { $lte: D('2026-02-01T10:00:00.000Z') } }), () => ({ opened_at: { $lte: '2026-02-01T10:00:00.000Z' } }), 3],
    ['$eq', () => ({ opened_at: { $eq: D('2026-02-01T10:00:00.000Z') } }), () => ({ opened_at: { $eq: '2026-02-01T10:00:00.000Z' } }), 1],
    ['$ne', () => ({ opened_at: { $ne: D('2026-02-01T10:00:00.000Z') } }), () => ({ opened_at: { $ne: '2026-02-01T10:00:00.000Z' } }), 5],
    ['implicit equality', () => ({ opened_at: D('2026-02-01T10:00:00.000Z') }), () => ({ opened_at: '2026-02-01T10:00:00.000Z' }), 1],
    ['an $in member', () => ({ opened_at: { $in: [D('2026-02-01T10:00:00.000Z')] } }), () => ({ opened_at: { $in: ['2026-02-01T10:00:00.000Z'] } }), 1],
    ['a $nin member', () => ({ opened_at: { $nin: [D('2026-02-01T10:00:00.000Z')] } }), () => ({ opened_at: { $nin: ['2026-02-01T10:00:00.000Z'] } }), 5],
    ['$between two Dates', () => ({ opened_at: { $between: [D('2026-02-01T00:00:00.000Z'), D('2026-02-06T00:00:00.000Z')] } }), () => ({ opened_at: { $between: ['2026-02-01T00:00:00.000Z', '2026-02-06T00:00:00.000Z'] } }), 2],
    ['a UTC-midnight Date on a date field', () => ({ placed_on: { $gte: D('2026-02-01T00:00:00.000Z') } }), () => ({ placed_on: { $gte: '2026-02-01' } }), 3],
  ];

  for (const [name, dateFilter, isoFilter, populatedCount] of DATE_ROWS) {
    it(`${name}: counts ${populatedCount} of 6, as the ISO spelling does`, async () => {
      for (const native of [true, false]) {
        const { driver } = makeCountingDriver(ORDERS, native);
        const engine = await makeOrderEngine(driver);
        expect(await engine.aggregate('crm_order', withFilter(isoFilter()))).toEqual([{ opp_count: 6, picked: populatedCount }]);
        expect(await engine.aggregate('crm_order', withFilter(dateFilter()))).toEqual([{ opp_count: 6, picked: populatedCount }]);
      }
    });
  }

  it('having reads a Date bound the same way — the groups the ISO spelling keeps', async () => {
    const { driver } = makeCountingDriver(ORDERS, false);
    const engine = await makeOrderEngine(driver);
    const run = (having: Record<string, unknown>) => engine.aggregate('crm_order', {
      groupBy: ['customer_id'],
      aggregations: [{ function: 'min', field: 'opened_at', alias: 'first_opened' }],
      having,
    } as unknown as EngineAggregateOptions);
    const groups = (rows: any[]) => rows.map((r) => r.customer_id).sort();
    for (const [dateHaving, isoHaving, kept] of [
      [{ first_opened: { $gt: D('2026-02-01T00:00:00.000Z') } }, { first_opened: { $gt: '2026-02-01T00:00:00.000Z' } }, ['c2', 'c3']],
      [{ first_opened: { $eq: D('2026-02-01T10:00:00.000Z') } }, { first_opened: { $eq: '2026-02-01T10:00:00.000Z' } }, ['c2']],
      [{ first_opened: { $ne: D('2026-02-01T10:00:00.000Z') } }, { first_opened: { $ne: '2026-02-01T10:00:00.000Z' } }, ['c1', 'c3']],
    ] as const) {
      expect(groups(await run(isoHaving))).toEqual(kept);
      expect(groups(await run(dateHaving))).toEqual(kept);
    }
  });

  it('the walker compares every other pair exactly as before (the lift needs a Date on one side)', () => {
    // A wall clock is no instant, so a Date against one is left to `>` and
    // answers as it always did; two numbers and two strings never lift.
    expect(matchesAggregationFilter({ slot: '14:00:00' }, { slot: { $gt: D('2026-02-01T11:00:00.000Z') } } as never, 0)).toBe(false);
    expect(matchesAggregationFilter({ amount: 5 }, { amount: { $in: [5] } } as never, 0)).toBe(true);
    expect(matchesAggregationFilter({ note: '2026-02-01' }, { note: { $gte: '2026-02-01T00:00:00.000Z' } } as never, 0)).toBe(false);
  });
});
