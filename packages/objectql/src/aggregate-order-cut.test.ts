// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [aggregate order and cut] `engine.aggregate` with the order-cut-count read
 * option (`aggregate-order-cut.ts`): served only as the driver's own
 * statement, judged before the driver is asked.
 *
 * A recording driver stands in for the SQL family: it is named as one, answers
 * the rows a test sets and records the AST it was handed. What `driver-sql`
 * compiles from the directive is pinned in
 * `driver-sql/src/sql-driver-aggregate-order-cut.test.ts`; end to end over a
 * real SQLite database and the MCP tool, in
 * `runtime/src/mcp-aggregate-order-cut.test.ts`.
 *
 * Pinned here: the directive the driver receives (the request's keys, then
 * the group keys it does not name, ascending; the limit; the count column);
 * the count taken off the rows into the request's outcome; an order key that
 * names no column of the aggregated row refused `INVALID_SORT`, naming the
 * columns; every driver and path that is not the driver's own statement
 * refused `INVALID_QUERY` with the driver never asked (the in-memory driver,
 * an unnamed driver, a `having`, a reference zone bucketed in memory); and
 * rows that come back without the count refused as a fault, never served.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  AGGREGATE_TOTAL_GROUPS_COLUMN,
  AGGREGATE_ORDER_CUT,
  AGGREGATE_ORDER_CUT_DIRECTIVE,
  type AggregateOrderCutRequest,
} from './aggregate-order-cut.js';

const ORDER = 'oc_order';
const ORDER_OBJECT = {
  name: ORDER,
  label: 'Order',
  fields: {
    amount: { name: 'amount', type: 'number' },
    customer: { name: 'customer', type: 'text' },
    region: { name: 'region', type: 'text' },
    closed_on: { name: 'closed_on', type: 'date' },
  },
};

interface SeenCall { verb: string; ast: any }

function makeRecordingDriver(name: string, supports: Record<string, unknown> = {}) {
  const calls: SeenCall[] = [];
  let answer: Array<Record<string, unknown>> = [];
  const driver: any = {
    name, version: '0.0.0', supports,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) { calls.push({ verb: 'find', ast }); return []; },
    async findOne(_o: string, ast: any) { calls.push({ verb: 'findOne', ast }); return null; },
    async count(_o: string, ast: any) { calls.push({ verb: 'count', ast }); return 0; },
    async aggregate(_o: string, ast: any) { calls.push({ verb: 'aggregate', ast }); return answer.map((r) => ({ ...r })); },
    async create(_o: string, data: Record<string, unknown>) { return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async delete() { return true; },
    async beginTransaction() { return {}; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls, answer: (rows: Array<Record<string, unknown>>) => { answer = rows; } };
}

async function makeEngine(driverName: string, supports?: Record<string, unknown>) {
  const rec = makeRecordingDriver(driverName, supports);
  const engine = new ObjectQL();
  engine.registerDriver(rec.driver, true);
  await engine.init();
  engine.registry.registerObject(ORDER_OBJECT as any, 'test');
  return { engine, rec };
}

type Thrown = (Error & { code?: string; status?: number; httpStatus?: number }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);

const BY_CUSTOMER = {
  groupBy: ['customer', { field: 'region', alias: 'area' }],
  aggregations: [{ function: 'sum' as const, field: 'amount', alias: 'revenue' }, { function: 'count' as const, alias: 'n' }],
};
const TOP_TWO = (): AggregateOrderCutRequest => ({ orderBy: [{ field: 'revenue', order: 'desc' }], limit: 2 });
const withCut = (request: AggregateOrderCutRequest) => ({ [AGGREGATE_ORDER_CUT]: request }) as any;

describe('[aggregate order and cut] engine.aggregate — served as the driver\'s own statement', () => {
  let engine: ObjectQL;
  let rec: ReturnType<typeof makeRecordingDriver>;

  beforeEach(async () => {
    ({ engine, rec } = await makeEngine('com.objectstack.driver.sql'));
  });

  it('hands the driver the order (the request\'s keys, then the unnamed group keys ascending), the limit and the count column; takes the count off the rows', async () => {
    rec.answer([
      { customer: 'c9', area: 'west', revenue: 90, n: 3, [AGGREGATE_TOTAL_GROUPS_COLUMN]: 7 },
      { customer: 'c8', area: 'east', revenue: 80, n: 2, [AGGREGATE_TOTAL_GROUPS_COLUMN]: 7 },
    ]);
    const request = TOP_TWO();
    const rows = await engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(request));
    expect(rows).toEqual([
      { customer: 'c9', area: 'west', revenue: 90, n: 3 },
      { customer: 'c8', area: 'east', revenue: 80, n: 2 },
    ]);
    expect(request.outcome).toEqual({ kind: 'served', totalGroups: 7 });
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0].ast[AGGREGATE_ORDER_CUT_DIRECTIVE]).toEqual({
      orderBy: [
        { column: 'revenue', order: 'desc' },
        { column: 'customer', order: 'asc' },
        { column: 'area', order: 'asc' },
      ],
      limit: 2,
      totalGroupsColumn: AGGREGATE_TOTAL_GROUPS_COLUMN,
    });
  });

  it('orders by a group key under its alias; no limit orders and counts every group; zero rows is zero groups', async () => {
    rec.answer([]);
    const request: AggregateOrderCutRequest = { orderBy: [{ field: 'area', order: 'desc' }] };
    expect(await engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(request))).toEqual([]);
    expect(request.outcome).toEqual({ kind: 'served', totalGroups: 0 });
    const directive = rec.calls[0].ast[AGGREGATE_ORDER_CUT_DIRECTIVE];
    expect(directive.orderBy[0]).toEqual({ column: 'area', order: 'desc' });
    expect(directive).not.toHaveProperty('limit');
  });

  it('an order key that names no column of the aggregated row is INVALID_SORT, naming the columns, and the driver is never asked', async () => {
    for (const field of ['amount', 'region', 'nope']) {
      const err = await refusalOf(engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut({ orderBy: [{ field, order: 'desc' }] })));
      expect(err?.code, field).toBe('INVALID_SORT');
      expect(err?.status).toBe(400);
      expect(err?.message).toContain(`'${field}'`);
      expect(err?.message).toContain('customer, area, revenue, n');
    }
    expect(rec.calls).toEqual([]);
  });

  it('a rank orders a key by its listed values\' positions: handed to the driver as named, the ranked column kept among the trailing keys', async () => {
    rec.answer([]);
    const request: AggregateOrderCutRequest = { orderBy: [{ field: 'area', order: 'asc', rank: ['west', 'east'] }], limit: 3 };
    await engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(request));
    // Every value the rank does not list shares one rank, so the column's own
    // ascending order stays among the trailing keys to tell those groups apart.
    expect(rec.calls[0].ast[AGGREGATE_ORDER_CUT_DIRECTIVE].orderBy).toEqual([
      { column: 'area', order: 'asc', rank: ['west', 'east'] },
      { column: 'customer', order: 'asc' },
      { column: 'area', order: 'asc' },
    ]);
    expect(request.outcome).toEqual({ kind: 'served', totalGroups: 0 });
  });

  it('a malformed request is INVALID_QUERY, and the driver is never asked', async () => {
    for (const bad of [
      { orderBy: 'revenue' },
      { orderBy: [{ field: 'revenue', order: 'down' }] },
      { orderBy: [], limit: 0 },
      { orderBy: [], limit: 2.5 },
      { orderBy: [{ field: 'revenue', order: 'asc' }, { field: 'revenue', order: 'desc' }] },
      { orderBy: [{ field: 'area', order: 'asc', rank: [] }] },
      { orderBy: [{ field: 'area', order: 'asc', rank: ['west', 'west'] }] },
      { orderBy: [{ field: 'area', order: 'asc', rank: [{ v: 1 }] }] },
      { orderBy: [{ field: 'area', order: 'asc', rank: 'west' }] },
    ]) {
      const err = await refusalOf(engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(bad as any)));
      expect(err?.code, JSON.stringify(bad)).toBe('INVALID_QUERY');
      expect(err?.status).toBe(400);
    }
    expect(rec.calls).toEqual([]);
  });

  it('a having is refused: it is applied after the driver, so a cut in the statement would cut before it', async () => {
    const err = await refusalOf(engine.aggregate(ORDER, { ...BY_CUSTOMER, having: { revenue: { $gt: 10 } } }, withCut(TOP_TWO())));
    expect(err?.code).toBe('INVALID_QUERY');
    expect(err?.message).toMatch(/having/);
    expect(rec.calls).toEqual([]);
  });

  it('an aggregate the engine computes in memory (a zone the driver does not bucket) is refused, never sorted in memory', async () => {
    const err = await refusalOf(engine.aggregate(ORDER, {
      groupBy: [{ field: 'closed_on', dateGranularity: 'month' }],
      aggregations: [{ function: 'count', alias: 'n' }],
      timezone: 'Asia/Shanghai',
    }, withCut({ orderBy: [{ field: 'n', order: 'desc' }], limit: 3 })));
    expect(err?.code).toBe('INVALID_QUERY');
    expect(err?.message).toMatch(/computed in the application/);
    expect(rec.calls).toEqual([]);
  });

  it('rows that come back without the group count are a fault, never served', async () => {
    rec.answer([{ customer: 'c9', area: 'west', revenue: 90, n: 3 }]);
    const request = TOP_TWO();
    const err = await refusalOf(engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(request)));
    expect(err?.code).toBe('INTERNAL_ERROR');
    expect(err?.status).toBe(500);
    expect(request.outcome).toBeUndefined();
  });

  it('CONTROL — no request: the aggregate reaches the driver with no directive, exactly as before', async () => {
    rec.answer([{ customer: 'c9', area: 'west', revenue: 90, n: 3 }]);
    expect(await engine.aggregate(ORDER, { ...BY_CUSTOMER })).toEqual([{ customer: 'c9', area: 'west', revenue: 90, n: 3 }]);
    expect(rec.calls[0].ast[AGGREGATE_ORDER_CUT_DIRECTIVE]).toBeUndefined();
  });
});

describe('[aggregate order and cut] engine.aggregate — refused on every driver that does not compile it', () => {
  for (const [name, mode] of [
    ['com.objectstack.driver.memory', undefined],
    ['com.objectstack.driver.mongodb', undefined],
    ['com.objectstack.driver.turso', 'remote'],
    ['some.unnamed.driver', undefined],
  ] as const) {
    it(`${name}${mode ? ` (${mode})` : ''}: INVALID_QUERY / 400, the driver never asked`, async () => {
      const { engine, rec } = await makeEngine(name);
      if (mode) rec.driver.transportMode = mode;
      const err = await refusalOf(engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(TOP_TWO())));
      expect(err?.code).toBe('INVALID_QUERY');
      expect(err?.status).toBe(400);
      expect(err?.httpStatus).toBe(400);
      expect(err?.message).toContain(`'${name}'`);
      expect(rec.calls).toEqual([]);
    });
  }

  it('the Turso driver\'s local face and the WASM SQLite driver are served', async () => {
    for (const [name, mode] of [['com.objectstack.driver.turso', 'local'], ['com.objectstack.driver.sqlite-wasm', undefined]] as const) {
      const { engine, rec } = await makeEngine(name);
      if (mode) rec.driver.transportMode = mode;
      rec.answer([]);
      const request = TOP_TWO();
      await engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(request));
      expect(request.outcome, name).toEqual({ kind: 'served', totalGroups: 0 });
    }
  });
});

describe('[aggregate order and cut] a declinable request is DECLINED where it cannot be served — nothing read, no refusal', () => {
  const declinable = (): AggregateOrderCutRequest => ({ ...TOP_TWO(), declinable: true });

  for (const name of ['com.objectstack.driver.memory', 'com.objectstack.driver.mongodb', 'com.objectstack.driver.odata']) {
    it(`${name}: answers [] with the outcome declined, the driver never asked`, async () => {
      const { engine, rec } = await makeEngine(name);
      const request = declinable();
      expect(await engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(request))).toEqual([]);
      expect(request.outcome?.kind).toBe('declined');
      expect(request.outcome?.kind === 'declined' && request.outcome.reason).toContain(`'${name}'`);
      expect(rec.calls).toEqual([]);
    });
  }

  it('a having, and an aggregate computed in memory (a zone the driver does not bucket), decline on a compiling driver', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    const having = declinable();
    expect(await engine.aggregate(ORDER, { ...BY_CUSTOMER, having: { revenue: { $gt: 10 } } }, withCut(having))).toEqual([]);
    expect(having.outcome?.kind === 'declined' && having.outcome.reason).toMatch(/having/);
    const zoned: AggregateOrderCutRequest = { orderBy: [{ field: 'n', order: 'desc' }], limit: 3, declinable: true };
    expect(await engine.aggregate(ORDER, {
      groupBy: [{ field: 'closed_on', dateGranularity: 'month' }],
      aggregations: [{ function: 'count', alias: 'n' }],
      timezone: 'Asia/Shanghai',
    }, withCut(zoned))).toEqual([]);
    expect(zoned.outcome?.kind === 'declined' && zoned.outcome.reason).toMatch(/computed in the application/);
    expect(rec.calls).toEqual([]);
  });

  it('on a compiling driver it is served exactly as an undeclinable one', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    rec.answer([{ customer: 'c9', area: 'west', revenue: 90, n: 3, [AGGREGATE_TOTAL_GROUPS_COLUMN]: 4 }]);
    const request = declinable();
    expect(await engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut(request))).toEqual([{ customer: 'c9', area: 'west', revenue: 90, n: 3 }]);
    expect(request.outcome).toEqual({ kind: 'served', totalGroups: 4 });
  });

  it('a request the caller built wrong is still refused: an order key naming no column of the row is INVALID_SORT', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.memory');
    const err = await refusalOf(engine.aggregate(ORDER, { ...BY_CUSTOMER }, withCut({ orderBy: [{ field: 'nope', order: 'asc' }], limit: 2, declinable: true })));
    expect(err?.code).toBe('INVALID_SORT');
    expect(err?.status).toBe(400);
    expect(rec.calls).toEqual([]);
  });
});
