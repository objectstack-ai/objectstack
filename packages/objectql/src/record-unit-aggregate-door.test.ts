// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0158 U7 R1, mirroring ADR-0144 D6] The two record-unit doors, through
// the engine and the registry, beside their currency twins
// (`record-currency-guards.test.ts`):
//
//  - `sum` / `avg` / `min` / `max` over a `record`-mode quantity is refused
//    `INVALID_FIELD` / 400 unless the query groups by its unit field;
//  - a `summary` roll-up reading one is refused `INVALID_METADATA` / 422 at
//    registration, whichever end registers second (L3: always refused in R1).
//
// Each admitted shape asserts its value: grouped by the unit field, a `fixed`
// quantity, a plain number, `count` and `count_distinct`. Every refusal here
// precedes the driver, so the driver is a rows-shaped double whose `find` is
// the engine's own in-memory reading of a driver query; the analytics faces
// over SqlDriver are service-analytics' `record-unit-analytics.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';

function makeDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let n = 0;
  const select = (object: string, ast: any) =>
    applyDriverQueryInMemory(Array.from(storeFor(object).values()), {
      where: ast?.where, orderBy: ast?.orderBy, limit: ast?.limit, offset: ast?.offset,
    });
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) { return select(object, ast).map((r) => ({ ...r })); },
    async findOne(object: string, ast: any) {
      const [hit] = select(object, { ...ast, limit: 1 });
      return hit ? { ...hit } : null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany() { return 0; },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async deleteMany() { return 0; },
    async count(object: string, ast: any) { return select(object, ast).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

type Thrown = (Error & {
  code?: string; status?: number; httpStatus?: number; field?: string; fields?: string[]; unitField?: string;
  object?: string; param?: string; objectName?: string; fieldName?: string; childObject?: string; childField?: string;
}) | null;

const refusalOf = async (p: Promise<unknown> | (() => unknown)): Promise<Thrown> => {
  try {
    await (typeof p === 'function' ? p() : p);
    return null;
  } catch (e) {
    return e as Thrown;
  }
};
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status, httpStatus: err?.httpStatus });

const INVALID_FIELD = { code: 'INVALID_FIELD', status: 400, httpStatus: 400 };
const INVALID_METADATA = { code: 'INVALID_METADATA', status: 422, httpStatus: 422 };
const RAW = ['sum', 'avg', 'min', 'max'] as const;

/** Typed at the call, never asserted (`check:query-options-erasure`). */
const aggregateQuery = (query: EngineAggregateOptions): EngineAggregateOptions => query;
const CTX = { context: { isSystem: true, tenantId: 'org_a' } } as const;

const RECORD = { unitMode: 'record', unitField: 'unit_code' } as const;

const UOM_STOCK = {
  name: 'uom_stock',
  fields: {
    title: { type: 'text' },
    unit_code: { type: 'text' },
    qty: { type: 'number', unitConfig: RECORD },
    net_kg: { type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
    plain: { type: 'number' },
  },
};

async function bootEngine() {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  return { engine, storeFor: d.storeFor };
}

describe('a raw aggregate over a record-mode quantity groups by its unit field (ADR-0158 U7 R1)', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    ({ engine } = await bootEngine());
    engine.registry.registerObject(UOM_STOCK as any);
    await engine.insert('uom_stock', { title: 's1', unit_code: 'KGM', qty: 10, net_kg: 4, plain: 1 }, CTX as never);
    await engine.insert('uom_stock', { title: 's2', unit_code: 'LBR', qty: 10, net_kg: 6, plain: 2 }, CTX as never);
    await engine.insert('uom_stock', { title: 's3', unit_code: 'KGM', qty: 5, net_kg: 1, plain: 3 }, CTX as never);
  });

  it('sum / avg / min / max ungrouped is refused INVALID_FIELD / 400, naming the quantity, its unit field and the grouping', async () => {
    for (const fn of RAW) {
      const err = await refusalOf(engine.aggregate('uom_stock', aggregateQuery({
        aggregations: [{ function: fn, field: 'qty', alias: 'v' }],
      })));
      expect(envelopeOf(err), fn).toEqual(INVALID_FIELD);
      expect(err?.field).toBe('qty');
      expect(err?.unitField).toBe('unit_code');
      expect(err?.object).toBe('uom_stock');
      expect(err?.param).toBe('aggregations');
      expect(err?.message).toContain("'qty', a quantity in each record's own unit");
      expect(err?.message).toContain("does not group by 'unit_code'");
      expect(err?.message.indexOf("Add 'unit_code' to groupBy")).toBeGreaterThan(-1);
      expect(err?.message.indexOf("Add 'unit_code' to groupBy")).toBeLessThan(500);
    }
  });

  it('grouped by a field other than the unit field is still refused, every ungrouped quantity named', async () => {
    const err = await refusalOf(engine.aggregate('uom_stock', aggregateQuery({
      groupBy: ['title'],
      aggregations: [
        { function: 'sum', field: 'qty', alias: 'a' },
        { function: 'max', field: 'qty', alias: 'b' },
      ],
    })));
    expect(envelopeOf(err)).toEqual(INVALID_FIELD);
    expect(err?.fields).toEqual(['qty', 'qty']);
  });

  it('grouped by the unit field answers one correct value per unit, for each raw aggregate', async () => {
    const groupings: Array<EngineAggregateOptions['groupBy']> = [['unit_code'], [{ field: 'unit_code' }]];
    for (const groupBy of groupings) {
      const rows = await engine.aggregate('uom_stock', aggregateQuery({
        groupBy,
        aggregations: [
          { function: 'sum', field: 'qty', alias: 'total' },
          { function: 'avg', field: 'qty', alias: 'mean' },
          { function: 'min', field: 'qty', alias: 'least' },
          { function: 'max', field: 'qty', alias: 'most' },
        ],
      }));
      const byUnit = Object.fromEntries(rows.map((r: any) => [r.unit_code, [r.total, r.mean, r.least, r.most]]));
      expect(byUnit).toEqual({ KGM: [15, 7.5, 5, 10], LBR: [10, 10, 10, 10] });
    }
  });

  it('count and count_distinct over the quantity, a fixed-unit quantity and a plain number are not judged, and answer their values', async () => {
    const rows = await engine.aggregate('uom_stock', aggregateQuery({
      aggregations: [
        { function: 'count', field: 'qty', alias: 'n' },
        { function: 'count_distinct', field: 'qty', alias: 'distinct' },
        { function: 'sum', field: 'net_kg', alias: 'kg' },
        { function: 'max', field: 'net_kg', alias: 'kg_max' },
        { function: 'sum', field: 'plain', alias: 'p' },
        { function: 'avg', field: 'plain', alias: 'p_avg' },
      ],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ n: 3, distinct: 2, kg: 11, kg_max: 6, p: 6, p_avg: 2 });
  });
});

describe('a summary roll-up over a record-mode quantity is refused at registration (ADR-0158 U7 R1, L3)', () => {
  const LINE = {
    name: 'uom_line',
    fields: {
      unit_code: { type: 'text' },
      qty: { type: 'number', unitConfig: RECORD },
      net_kg: { type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
      plain: { type: 'number' },
      shipment: { type: 'master_detail', reference: 'uom_shipment' },
    },
  };
  const parentWith = (fn: string, field = 'qty') => ({
    name: 'uom_shipment',
    fields: {
      title: { type: 'text' },
      rolled: { type: 'summary', summaryOperations: { object: 'uom_line', field, function: fn } },
    },
  });

  it('the parent registering after the child is refused, naming the roll-up, the quantity and its unit field', async () => {
    for (const fn of RAW) {
      const { engine } = await bootEngine();
      engine.registry.registerObject(LINE as any);
      const err = await refusalOf(() => engine.registry.registerObject(parentWith(fn) as any));
      expect(envelopeOf(err), fn).toEqual(INVALID_METADATA);
      expect(err?.name).toBe('RecordUnitSummaryRefusedError');
      expect(err?.objectName).toBe('uom_shipment');
      expect(err?.fieldName).toBe('rolled');
      expect(err?.childObject).toBe('uom_line');
      expect(err?.childField).toBe('qty');
      expect(err?.unitField).toBe('unit_code');
      expect(err?.message).toContain(`rolls up ${fn}(uom_line.qty)`);
      expect(err?.message).toContain("the unit code in 'unit_code'");
      expect(err?.message).toContain("groups by 'unit_code'");
      expect(engine.registry.getObject('uom_shipment')).toBeUndefined();
    }
  });

  it('the child registering after the parent is refused, naming the same roll-up', async () => {
    const { engine } = await bootEngine();
    engine.registry.registerObject(parentWith('sum') as any);
    const err = await refusalOf(() => engine.registry.registerObject(LINE as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.name).toBe('RecordUnitSummaryRefusedError');
    expect(err?.objectName).toBe('uom_shipment');
    expect(err?.message).toContain('rolls up sum(uom_line.qty)');
    expect(engine.registry.getObject('uom_line')).toBeUndefined();
  });

  it('a roll-up over the object itself is refused', async () => {
    const { engine } = await bootEngine();
    const SELF = {
      name: 'uom_self',
      fields: {
        unit_code: { type: 'text' },
        qty: { type: 'number', unitConfig: RECORD },
        parent: { type: 'lookup', reference: 'uom_self' },
        rolled: { type: 'summary', summaryOperations: { object: 'uom_self', field: 'qty', function: 'sum' } },
      },
    };
    const err = await refusalOf(() => engine.registry.registerObject(SELF as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.name).toBe('RecordUnitSummaryRefusedError');
    expect(engine.registry.getObject('uom_self')).toBeUndefined();
  });

  it('a count roll-up over the quantity, and sums over a fixed-unit quantity and a plain number, register and total their rows', async () => {
    for (const [fn, field, expected] of [['count', 'qty', 2], ['sum', 'net_kg', 9], ['sum', 'plain', 5]] as const) {
      for (const parentFirst of [true, false]) {
        const { engine, storeFor } = await bootEngine();
        const order = parentFirst ? [parentWith(fn, field), LINE] : [LINE, parentWith(fn, field)];
        for (const o of order) engine.registry.registerObject(o as any);
        expect(engine.registry.getObject('uom_shipment'), `${fn}(${field})`).toBeDefined();
        await engine.insert('uom_shipment', { id: 'sh1', title: 'one' }, CTX as never);
        await engine.insert('uom_line', { shipment: 'sh1', unit_code: 'KGM', qty: 10, net_kg: 4, plain: 2 }, CTX as never);
        await engine.insert('uom_line', { shipment: 'sh1', unit_code: 'LBR', qty: 10, net_kg: 5, plain: 3 }, CTX as never);
        expect(storeFor('uom_shipment').get('sh1')?.rolled, `${fn}(${field}) parentFirst=${parentFirst}`).toBe(expected);
      }
    }
  });
});
