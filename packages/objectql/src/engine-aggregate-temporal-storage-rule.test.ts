// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20176] A per-aggregation `filter` and `having` read a temporal comparand by
// the COLUMN's storage rule — `@objectstack/core`'s `temporalStorageForm`, the
// one function both drivers' `where` applies to the same comparand — instead of
// comparing it as written.
//
// Measured on the base (`cfe2387a3b`) through `engine.aggregate` and
// `POST /api/v1/data/:object/query`, on a real `InMemoryDriver` and a real
// `SqlDriver`, populated and empty: every row of the card counted differently
// from its `where` twin on both drivers —
//
// | # | per-aggregation `filter` (or `having`) | base | `where` twin |
// |:--|:--|:--|:--|
// | 1 | an ISO instant `$gte` on a `date` field | 1 | 3 |
// | 2 | an ISO instant `$eq` on a `date` field | 0 | 2 |
// | 3 | a bare day as the `$lte` of a `datetime` | 2 | 3 |
// | 4 | a bare day as the `$between` max of a `datetime` | 2 | 3 |
// | 5 | an epoch-ms bound on a `datetime` | 0 | 3 |
// | 6 | a `Date` with a time of day on a `date` field (`$gte` / `$lt` / `$eq`) | 1 / 5 / 0 | 3 / 3 / 2 |
// | 7 | a `Date` on a `time` field | 0 | 3 |
// | 8 | `having` on `max(date)` with an ISO bound | keeps c2 | keeps c2, c3 |
//
// and a zone-naive datetime string counted 4 on both sides (the control). The
// `where` counts are pinned on each driver in its own package
// (`driver-memory`'s `memory-temporal-storage-form.test.ts`; `driver-sql`'s
// through the REST door, `packages/rest/src/aggregation-filter-temporal-storage-rule.test.ts`).
// Here the per-aggregation position and `having` are held to them, on rows in
// the storage form both drivers present, and to the shared temporal
// conformance kit (`@objectstack/spec/data`'s `TEMPORAL_CASES` /
// `TEMPORAL_TIME_CASES`) every `where` backend is already held to.

import { describe, it, expect } from 'vitest';
import {
  TEMPORAL_CASES,
  TEMPORAL_NOW,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
  lowerFilterCondition,
  type EngineAggregateOptions,
} from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';
import {
  aggregatedRowColumnClasses,
  aggregatedRowColumnTypes,
  applyHaving,
  declaredFieldClasses,
  matchesAggregationFilter,
} from './having-filter.js';

const OBJECT = 'ledger_order';

const FIELDS = {
  customer_id: { type: 'text' },
  amount: { type: 'number' },
  placed_on: { type: 'date' },
  due_on: { type: 'date' },
  opened_at: { type: 'datetime' },
  slot: { type: 'time' },
  note: { type: 'text' },
};

// The card's fixture, in the storage form both drivers present a row in
// (ADR-0053: `YYYY-MM-DD`, canonical UTC ISO, `HH:MM:SS`).
const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100, placed_on: '2026-01-10', due_on: '2026-01-05', opened_at: '2026-01-01T10:00:00.000Z', slot: '09:00:00', note: 'a' },
  { id: 'o2', customer_id: 'c1', amount: 400, placed_on: '2026-01-02', due_on: '2026-01-20', opened_at: '2026-01-02T10:00:00.000Z', slot: '10:30:00', note: null },
  { id: 'o3', customer_id: 'c2', amount: 900, placed_on: '2026-03-01', due_on: '2026-01-01', opened_at: '2026-02-01T10:00:00.000Z', slot: '11:00:00', note: 'b' },
  { id: 'o4', customer_id: 'c2', amount: 300, placed_on: '2026-02-01', due_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z', slot: '12:00:00', note: 'c' },
  { id: 'o5', customer_id: 'c2', amount: 50, placed_on: '2026-01-15', due_on: '2026-03-01', opened_at: '2026-02-06T10:00:00.000Z', slot: '13:00:00', note: null },
  { id: 'o6', customer_id: 'c3', amount: 20, placed_on: '2026-02-01', due_on: '2026-01-31', opened_at: '2026-03-01T10:00:00.000Z', slot: '14:00:00', note: 'd' },
];

const DRIVER_BASE = {
  version: '0.0.0',
  supports: {},
  async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
  async findOne() { return null; },
  async create(_o: string, d: any) { return d; },
  async update(_o: string, _id: string, d: any) { return d; },
  async delete() { return true; },
  async count() { return 0; },
  async bulkCreate(_o: string, r: any[]) { return r; },
  async bulkUpdate() { return []; }, async bulkDelete() {},
  async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
  async commit() {}, async rollback() {},
};

/**
 * Two driver shapes: one the engine asks for ROWS (`find()` + the in-memory
 * lowering, where the per-aggregation filter is evaluated), and one with a
 * native `aggregate()` (the other `having` door). Neither reads the query's
 * `where`; none of these tests carries one.
 */
function makeDriver(kind: 'rows' | 'native', rows: any[]) {
  const driver: any = { ...DRIVER_BASE, name: `${kind}-mock`, async find() { return rows.slice(); } };
  if (kind === 'native') driver.aggregate = async (_o: string, ast: any) => applyInMemoryAggregation(rows, ast);
  return driver;
}

async function makeEngine(kind: 'rows' | 'native', rows: any[], object = OBJECT, fields: Record<string, unknown> = FIELDS) {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(kind, rows), true);
  await engine.init();
  (engine.registry as any).registerObject({ name: object, fields });
  return engine;
}

type Shape = readonly [name: string, filter: () => Record<string, unknown>, whereCount: number];

const D = (iso: string) => new Date(iso);

/** The card's rows, with the count the same condition as a `where` answers on both drivers. */
const CARD_ROWS: readonly Shape[] = [
  ['row 1 — an ISO instant $gte on a date field', () => ({ placed_on: { $gte: '2026-02-01T00:00:00.000Z' } }), 3],
  ['row 2 — an ISO instant $eq on a date field', () => ({ placed_on: { $eq: '2026-02-01T00:00:00.000Z' } }), 2],
  ['row 3 — a bare day as the $lte of a datetime', () => ({ opened_at: { $lte: '2026-02-01' } }), 3],
  ['row 4 — a bare day as the $between max of a datetime', () => ({ opened_at: { $between: ['2026-01-01', '2026-02-01'] } }), 3],
  ['row 5 — an epoch-ms bound on a datetime', () => ({ opened_at: { $gt: 1769940000000 } }), 3],
  ['row 6 — a Date with a time of day, $gte on a date field', () => ({ placed_on: { $gte: D('2026-02-01T10:00:00.000Z') } }), 3],
  ['row 6 — the same Date, $lt', () => ({ placed_on: { $lt: D('2026-02-01T10:00:00.000Z') } }), 3],
  ['row 6 — the same Date, $eq', () => ({ placed_on: { $eq: D('2026-02-01T10:00:00.000Z') } }), 2],
  ['row 7 — a Date on a time field', () => ({ slot: { $gt: D('2026-02-01T11:00:00.000Z') } }), 3],
  ['control — a zone-naive datetime string', () => ({ opened_at: { $gt: '2026-02-01 09:00' } }), 4],
];

/** The family's other members — every comparison operator, both list operators, composition. */
const FAMILY_ROWS: readonly Shape[] = [
  ['an ISO instant $ne on a date field', () => ({ placed_on: { $ne: '2026-02-01T00:00:00.000Z' } }), 4],
  ['an ISO instant as implicit equality on a date field', () => ({ placed_on: '2026-02-01T00:00:00.000Z' }), 2],
  ['ISO instants as $in members on a date field', () => ({ placed_on: { $in: ['2026-02-01T00:00:00.000Z', '2026-01-10T05:00:00Z'] } }), 3],
  ['ISO instants as $nin members on a date field', () => ({ placed_on: { $nin: ['2026-02-01T00:00:00.000Z', '2026-01-10T05:00:00Z'] } }), 3],
  ['ISO instants as $between endpoints on a date field', () => ({ placed_on: { $between: ['2026-01-10T00:00:00Z', '2026-02-01T23:00:00Z'] } }), 4],
  ['an ISO instant $lt on a date field', () => ({ placed_on: { $lt: '2026-02-01T10:00:00.000Z' } }), 3],
  ['bare days as both $between endpoints on a datetime', () => ({ opened_at: { $between: ['2026-02-01', '2026-02-05'] } }), 2],
  ['an epoch-ms $lte on a datetime', () => ({ opened_at: { $lte: 1769940000000 } }), 3],
  ['an epoch-ms $eq on a datetime', () => ({ opened_at: { $eq: 1769940000000 } }), 1],
  ['an offset instant $gte on a datetime', () => ({ opened_at: { $gte: '2026-02-01T18:00:00+08:00' } }), 4],
  ['a zone-naive T spelling $eq on a datetime', () => ({ opened_at: { $eq: '2026-02-01T10:00' } }), 1],
  ['an ISO instant without milliseconds $nin on a datetime', () => ({ opened_at: { $nin: ['2026-02-01T10:00:00Z'] } }), 5],
  ['an ISO instant $gt on a time field', () => ({ slot: { $gt: '2026-02-01T11:00:00.000Z' } }), 3],
  ['a short wall clock $eq on a time field', () => ({ slot: { $eq: '11:00' } }), 1],
  ['a short wall clock $lte on a time field', () => ({ slot: { $lte: '11:00' } }), 3],
  ['short wall clocks as $in members on a time field', () => ({ slot: { $in: ['09:00', '11:00'] } }), 2],
  ['short wall clocks as $between endpoints on a time field', () => ({ slot: { $between: ['09:00', '11:00'] } }), 3],
  ['a bare day $lte on a time field — no whole-day widening', () => ({ slot: { $lte: '2026-02-01' } }), 0],
  ['a Date as implicit equality on a time field', () => ({ slot: D('2026-02-01T11:00:00.000Z') }), 1],
  ['a Date as a $nin member on a date field', () => ({ placed_on: { $nin: [D('2026-02-01T10:00:00.000Z')] } }), 4],
  ['Dates as $between endpoints on a date field', () => ({ placed_on: { $between: [D('2026-01-10T10:00:00.000Z'), D('2026-02-01T10:00:00.000Z')] } }), 4],
  ['under $or', () => ({ $or: [{ placed_on: { $gte: '2026-02-01T00:00:00.000Z' } }, { amount: { $gt: 800 } }] }), 3],
  ['under $not', () => ({ $not: { placed_on: { $gte: '2026-02-01T00:00:00.000Z' } } }), 3],
  ['under $and', () => ({ $and: [{ placed_on: { $gte: '2026-02-01T00:00:00.000Z' } }, { amount: { $lt: 800 } }] }), 2],
  ['a bare-day $lte beside an author $lt on the same datetime', () => ({ opened_at: { $lte: '2026-02-05', $lt: '2026-02-05T12:00:00.000Z' } }), 4],
];

/** Positions no storage rule reaches — compared exactly as before. */
const UNMOVED_ROWS: readonly Shape[] = [
  ['an ISO-looking string on a TEXT field', () => ({ note: { $gte: '2026-02-01T00:00:00.000Z' } }), 4],
  ['an epoch-ms number on a NUMBER field', () => ({ amount: { $gt: 1769940000000 } }), 0],
  ['presence on a date field', () => ({ placed_on: { $exists: true } }), 6],
  ['a null $eq on a date field', () => ({ placed_on: { $eq: null } }), 0],
];

const perAggregation = (filter: Record<string, unknown>): EngineAggregateOptions => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: filter as any }],
});

describe('[#20176] a per-aggregation filter counts a temporal comparand by the column\'s storage rule', () => {
  for (const [group, shapes] of [['the card', CARD_ROWS], ['the family', FAMILY_ROWS], ['unmoved', UNMOVED_ROWS]] as const) {
    for (const [name, filter, whereCount] of shapes) {
      it(`${group}: ${name} — counts ${whereCount}, as its where twin; 0 on an empty object`, async () => {
        for (const kind of ['rows', 'native'] as const) {
          const populated = await makeEngine(kind, ROWS);
          expect(await populated.aggregate(OBJECT, perAggregation(filter())), `${kind}, populated`)
            .toEqual([{ n: 6, m: whereCount }]);
          const empty = await makeEngine(kind, []);
          expect(await empty.aggregate(OBJECT, perAggregation(filter())), `${kind}, empty`)
            .toEqual([{ n: 0, m: 0 }]);
        }
      });
    }
  }

  it('grouped: each bucket counts by the same rule (row 1, per customer)', async () => {
    const engine = await makeEngine('rows', ROWS);
    const rows = await engine.aggregate(OBJECT, {
      groupBy: ['customer_id'],
      aggregations: [{ function: 'count', alias: 'm', filter: { placed_on: { $gte: '2026-02-01T00:00:00.000Z' } } }],
    });
    expect(Object.fromEntries(rows.map((r: any) => [r.customer_id, r.m]))).toEqual({ c1: 0, c2: 2, c3: 1 });
  });
});

// [#20549] The family's epoch-ms STRING row counted 3 here, as its where twin
// did. It is refused at both positions now, with every other bare integer
// string: the storage rule reads one as epoch milliseconds, so `"2026"` meant
// 1970-01-01T00:00:02.026Z and matched every later row, and the record
// validator already refused it as a written value. Epoch milliseconds keep
// counting as a NUMBER — row 5, and the family's `$lte` / `$eq` rows above.
describe('[#20549] an epoch-ms STRING on a datetime is refused at the per-aggregation position, as on where', () => {
  const refusal = (p: Promise<unknown>) => p.then(() => null, (e: any) => e);
  for (const value of ['1769940000000', '2026']) {
    it(`${JSON.stringify(value)}: INVALID_FILTER / 400 at both positions; the number of the same instant counts 3`, async () => {
      for (const kind of ['rows', 'native'] as const) {
        const engine = await makeEngine(kind, ROWS);
        const agg = await refusal(engine.aggregate(OBJECT, perAggregation({ opened_at: { $gt: value } })));
        expect(agg?.code, `${kind}, per-aggregation`).toBe('INVALID_FILTER');
        expect(agg?.status, `${kind}, per-aggregation`).toBe(400);
        const where = await refusal(engine.find(OBJECT, { where: { opened_at: { $gt: value } } }));
        expect(where?.code, `${kind}, where`).toBe('INVALID_FILTER');
        expect(where?.status, `${kind}, where`).toBe(400);
      }
      const engine = await makeEngine('rows', ROWS);
      expect(await engine.aggregate(OBJECT, perAggregation({ opened_at: { $gt: 1769940000000 } }))).toEqual([{ n: 6, m: 3 }]);
    });
  }
});

/** `having` over customer groups: the aggregated columns the rows below name. */
const HAVING_AGGREGATIONS: NonNullable<EngineAggregateOptions['aggregations']> = [
  { function: 'sum', field: 'amount', alias: 'total' },
  { function: 'max', field: 'placed_on', alias: 'last_placed' },
  { function: 'min', field: 'due_on', alias: 'first_due' },
  { function: 'min', field: 'opened_at', alias: 'first_opened' },
  { function: 'max', field: 'slot', alias: 'last_slot' },
];
// c1: last_placed 2026-01-10, first_due 2026-01-05, first_opened 2026-01-01T10:00Z, last_slot 10:30:00
// c2: last_placed 2026-03-01, first_due 2026-01-01, first_opened 2026-02-01T10:00Z, last_slot 13:00:00
// c3: last_placed 2026-02-01, first_due 2026-01-31, first_opened 2026-03-01T10:00Z, last_slot 14:00:00

const HAVING_ROWS: ReadonlyArray<readonly [string, () => Record<string, unknown>, string[]]> = [
  ['row 8 — an ISO instant $gte on max(date)', () => ({ last_placed: { $gte: '2026-02-01T00:00:00.000Z' } }), ['c2', 'c3']],
  ['an ISO instant $eq on max(date)', () => ({ last_placed: { $eq: '2026-03-01T00:00:00.000Z' } }), ['c2']],
  ['an ISO instant $lt on min(date)', () => ({ first_due: { $lt: '2026-01-05T10:00:00.000Z' } }), ['c2']],
  ['ISO instants as $in members on max(date)', () => ({ last_placed: { $in: ['2026-03-01T00:00:00Z', '2026-02-01T05:00:00Z'] } }), ['c2', 'c3']],
  ['an ISO instant $ne on max(date)', () => ({ last_placed: { $ne: '2026-03-01T00:00:00Z' } }), ['c1', 'c3']],
  ['a Date with a time of day $gte on max(date)', () => ({ last_placed: { $gte: D('2026-02-01T10:00:00.000Z') } }), ['c2', 'c3']],
  ['a bare day as the $lte of min(datetime)', () => ({ first_opened: { $lte: '2026-02-01' } }), ['c1', 'c2']],
  ['a bare day as the $between max of min(datetime)', () => ({ first_opened: { $between: ['2026-01-01', '2026-02-01'] } }), ['c1', 'c2']],
  ['an epoch-ms $gte on min(datetime)', () => ({ first_opened: { $gte: 1769940000000 } }), ['c2', 'c3']],
  ['an offset instant $gte on min(datetime)', () => ({ first_opened: { $gte: '2026-02-01T18:00:00+08:00' } }), ['c2', 'c3']],
  ['a short wall clock $eq on max(time)', () => ({ last_slot: { $eq: '14:00' } }), ['c3']],
  ['an ISO instant $gte on max(time)', () => ({ last_slot: { $gte: '2026-01-01T13:00:00.000Z' } }), ['c2', 'c3']],
  ['control — a zone-naive $gt on min(datetime)', () => ({ first_opened: { $gt: '2026-02-01 09:00' } }), ['c2', 'c3']],
  ['control — a numeric column', () => ({ total: { $gt: 1000 } }), ['c2']],
];

describe('[#20176] having reads a temporal comparand by the aggregated column\'s storage rule — both doors', () => {
  for (const [name, having, kept] of HAVING_ROWS) {
    it(`${name}: keeps ${kept.join(', ')}; nothing on an empty object`, async () => {
      // `native`: the driver aggregates, the engine applies `having` after it.
      // `rows`: the engine aggregates in memory (a filtered aggregation forces
      // that door), then applies `having`.
      for (const kind of ['native', 'rows'] as const) {
        const aggregations = kind === 'native'
          ? HAVING_AGGREGATIONS
          : [...HAVING_AGGREGATIONS, { function: 'count' as const, alias: 'fb', filter: { customer_id: { $ne: '' } } }];
        const query: EngineAggregateOptions = { groupBy: ['customer_id'], aggregations, having: having() as any };
        const populated = await makeEngine(kind, ROWS);
        const got = (await populated.aggregate(OBJECT, query)).map((r: any) => r.customer_id).sort();
        expect(got, kind).toEqual(kept);
        const empty = await makeEngine(kind, []);
        expect(await empty.aggregate(OBJECT, query), `${kind}, empty`).toEqual([]);
      }
    });
  }

  it('a groupBy projection of a date field, and a day bucket, are dates', async () => {
    const engine = await makeEngine('native', ROWS);
    const byDay = await engine.aggregate(OBJECT, {
      groupBy: ['placed_on'],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { placed_on: { $gte: '2026-02-01T00:00:00.000Z' } },
    });
    expect(byDay.map((r: any) => r.placed_on).sort()).toEqual(['2026-02-01', '2026-03-01']);
    const bucketed = await engine.aggregate(OBJECT, {
      groupBy: [{ field: 'opened_at', dateGranularity: 'day', alias: 'd' }],
      aggregations: [{ function: 'count', alias: 'n' }],
      having: { d: { $gte: '2026-02-01T00:00:00.000Z' } },
    });
    expect(bucketed.map((r: any) => r.d).sort()).toEqual(['2026-02-01', '2026-02-05', '2026-02-06', '2026-03-01']);
  });
});

// ── The shared kit: every `where` backend is held to these; now these two positions too ──

const resolveTokens = <T,>(filter: T): T => resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });

async function idsKeptByFilter(kind: 'rows' | 'native', object: string, fields: Record<string, unknown>, rows: any[], filter: unknown) {
  const engine = await makeEngine(kind, rows, object, fields);
  const out = await engine.aggregate(object, {
    groupBy: ['id'],
    aggregations: [{ function: 'count', alias: 'm', filter: filter as any }],
  });
  return out.filter((r: any) => r.m === 1).map((r: any) => r.id).sort();
}

async function idsKeptByHaving(kind: 'rows' | 'native', object: string, fields: Record<string, unknown>, rows: any[], column: string, having: unknown) {
  const engine = await makeEngine(kind, rows, object, fields);
  const aggregations: NonNullable<EngineAggregateOptions['aggregations']> = [{ function: 'max', field: column, alias: column }];
  if (kind === 'rows') aggregations.push({ function: 'count', alias: 'fb', filter: { id: { $ne: '' } } });
  const out = await engine.aggregate(object, { groupBy: ['id'], aggregations, having: having as any });
  return out.map((r: any) => r.id).sort();
}

describe('[#20176] the temporal conformance kit, through a per-aggregation filter and having', () => {
  const fields = { at: { type: 'datetime' }, on: { type: 'date' } };
  const rows = TEMPORAL_ROWS.map((r) => ({ id: r.id, at: r.at, on: r.on }));
  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const expected = [...c.expected].sort();
      const spellings = c.tokenFilter ? [c.filter, resolveTokens(c.tokenFilter)] : [c.filter];
      for (const filter of spellings) {
        for (const kind of ['rows', 'native'] as const) {
          expect(await idsKeptByFilter(kind, 'kit', fields, rows, filter), `filter, ${kind} — ${c.note ?? ''}`).toEqual(expected);
          expect(await idsKeptByHaving(kind, 'kit', fields, rows, c.field, filter), `having, ${kind} — ${c.note ?? ''}`).toEqual(expected);
        }
      }
    });
  }

  const timeFields = { at: { type: 'time' } };
  const timeRows = TEMPORAL_TIME_ROWS.map((r) => ({ id: r.id, at: r.at }));
  for (const c of TEMPORAL_TIME_CASES) {
    it(c.name, async () => {
      const expected = [...c.expected].sort();
      for (const kind of ['rows', 'native'] as const) {
        expect(await idsKeptByFilter(kind, 'kit_time', timeFields, timeRows, c.filter), `filter, ${kind}`).toEqual(expected);
        expect(await idsKeptByHaving(kind, 'kit_time', timeFields, timeRows, 'at', c.filter), `having, ${kind}`).toEqual(expected);
      }
    });
  }
});

describe('[#20176] where no class is known, a comparand is compared as written', () => {
  const row = { placed_on: '2026-02-01', stamp: '2026-02-01T10:00:00.000Z' };
  const iso = { placed_on: { $gte: '2026-02-01T00:00:00.000Z' } };

  it('the walker with the declaration reads the storage rule; without it, the text', () => {
    expect(matchesAggregationFilter(row, iso, 0, declaredFieldClasses(FIELDS))).toBe(true);
    expect(matchesAggregationFilter(row, iso, 0)).toBe(false);
  });

  it('applyInMemoryAggregation keeps its published default: no field map, no rule', () => {
    const ast = { aggregations: [{ function: 'count' as const, alias: 'm', filter: iso }] };
    expect(applyInMemoryAggregation(ROWS, ast)).toEqual([{ m: 1 }]);
    expect(applyInMemoryAggregation(ROWS, ast, undefined, FIELDS)).toEqual([{ m: 3 }]);
  });

  it('an undeclared column keeps the #20148 instant reading of a Date', () => {
    const bound = { stamp: { $gte: D('2026-02-01T10:00:00.000Z') } };
    expect(matchesAggregationFilter(row, bound, 0, declaredFieldClasses(FIELDS))).toBe(true);
  });
});

// [ADR-0053 D-D1 items 5 and 9, as amended] Neither position's walker applies
// the whole-day upper bound of its own any more. The engine's seam lowers both
// before the walker sees them (`lowerFilterCondition`, by the object's declared
// `datetime` columns for the per-aggregation `filter` and by the aggregated
// column's type for `having`): the `engine.aggregate` rows above — the card's
// rows 3 and 4, the `having` rows on `min(datetime)` and the conformance kit —
// hold that half. A caller that evaluates rows without the seam, such as
// `applyInMemoryAggregation`, the package's public direct door, gets the
// comparison it wrote: a bare day as an upper bound is that day's midnight.
describe('[ADR-0053 D-D1 item 5] the walker compares a bare-day upper bound as written; the seam lowers it to the whole day', () => {
  const classes = declaredFieldClasses(FIELDS);
  const isDatetimeField = (column: string): boolean =>
    (FIELDS as Record<string, { type: string } | undefined>)[column]?.type === 'datetime';
  const counted = (filter: Record<string, unknown>): number =>
    ROWS.filter((row) => matchesAggregationFilter(row, filter as any, 0, classes)).length;

  const BOUNDS: ReadonlyArray<readonly [string, Record<string, unknown>, number, number]> = [
    ['a bare day as the $lte of a datetime', { opened_at: { $lte: '2026-02-01' } }, 2, 3],
    ['a bare day as the $between max of a datetime', { opened_at: { $between: ['2026-01-01', '2026-02-01'] } }, 2, 3],
  ];
  for (const [name, filter, asWritten, lowered] of BOUNDS) {
    it(`per-aggregation filter, ${name}: ${asWritten} as written, ${lowered} once the seam lowers it`, () => {
      expect(counted(filter), 'as written').toBe(asWritten);
      expect(counted(lowerFilterCondition(filter, { isDatetimeColumn: isDatetimeField })), 'lowered').toBe(lowered);
    });
  }

  it('applyInMemoryAggregation, called directly with the field map, counts the bound as written', () => {
    const ast = { aggregations: [{ function: 'count' as const, alias: 'm', filter: { opened_at: { $lte: '2026-02-01' } } }] };
    expect(applyInMemoryAggregation(ROWS, ast, undefined, FIELDS)).toEqual([{ m: 2 }]);
  });

  it('having on min(datetime): c1 as written; c1 and c2 once lowered by the aggregated column type', () => {
    const groupBy = ['customer_id'];
    const groups = applyInMemoryAggregation(ROWS, { groupBy, aggregations: HAVING_AGGREGATIONS }, undefined, FIELDS);
    const having = { first_opened: { $lte: '2026-02-01' } };
    const columnClasses = aggregatedRowColumnClasses(groupBy, HAVING_AGGREGATIONS, FIELDS);
    const columnTypes = aggregatedRowColumnTypes(groupBy, HAVING_AGGREGATIONS, FIELDS);
    const kept = (h: Record<string, unknown>) =>
      applyHaving(groups, h as any, columnClasses).map((r: any) => r.customer_id).sort();
    expect(kept(having), 'as written').toEqual(['c1']);
    expect(kept(lowerFilterCondition(having, { isDatetimeColumn: (c) => columnTypes.get(c) === 'datetime' })), 'lowered')
      .toEqual(['c1', 'c2']);
  });
});
