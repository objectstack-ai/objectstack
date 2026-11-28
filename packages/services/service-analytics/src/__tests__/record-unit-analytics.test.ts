// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U7 R1, mirroring ADR-0144 D6] Analytics over a `unitMode: 'record'`
 * quantity, through the plugin's own composition over a real engine
 * (ObjectQL over SqlDriver / better-sqlite3), beside the record-currency pins
 * (`record-currency-analytics.test.ts`).
 *
 * ## What these pins hold
 *
 * - The cube door refuses a `sum` / `avg` / `min` / `max` over the quantity
 *   that does not group by its unit field: `INVALID_FIELD` / 400 with the
 *   member, the column, its object and the unit field, before anything is
 *   read. A `totals` grand total is such an aggregate too.
 * - Grouped by the unit field, each per-unit value is right; `count`,
 *   `count_distinct`, a `fixed`-unit quantity and a plain number are served
 *   ungrouped with their values.
 * - Each of the above on both strategies (`NativeSQLStrategy`;
 *   `ObjectQLStrategy`, narrowed to the engine aggregate), on the cube face,
 *   the inferred cube and the draft-preview path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os35491_stock';

const STOCK = {
  name: OBJECT,
  label: 'Stock',
  fields: {
    unit_code: { name: 'unit_code', type: 'text' as const },
    region: { name: 'region', type: 'text' as const },
    qty: { name: 'qty', type: 'number' as const, unitConfig: { unitMode: 'record' as const, unitField: 'unit_code' } },
    net_kg: { name: 'net_kg', type: 'number' as const, unitConfig: { unitMode: 'fixed' as const, unit: 'KGM' } },
    plain: { name: 'plain', type: 'number' as const },
  },
};

const ROWS = [
  { id: 's1', unit_code: 'KGM', region: 'amer', qty: 10, net_kg: 4, plain: 1 },
  { id: 's2', unit_code: 'LBR', region: 'amer', qty: 10, net_kg: 6, plain: 2 },
  { id: 's3', unit_code: 'KGM', region: 'emea', qty: 5, net_kg: 1, plain: 3 },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os35491_stock_by_unit',
  label: 'Stock by unit',
  object: OBJECT,
  dimensions: [
    { name: 'unit', field: 'unit_code', type: 'string' },
    { name: 'region', field: 'region', type: 'string' },
  ],
  measures: [
    { name: 'total', aggregate: 'sum', field: 'qty' },
    { name: 'mean', aggregate: 'avg', field: 'qty' },
    { name: 'least', aggregate: 'min', field: 'qty' },
    { name: 'largest', aggregate: 'max', field: 'qty' },
    { name: 'lines', aggregate: 'count' },
    { name: 'counted', aggregate: 'count', field: 'qty' },
    { name: 'distinct_qty', aggregate: 'count_distinct', field: 'qty' },
    { name: 'kg', aggregate: 'sum', field: 'net_kg' },
    { name: 'plain_total', aggregate: 'sum', field: 'plain' },
  ],
});

const CTX = {} as ExecutionContext;

type Face = 'native' | 'objectql';
const FACES: readonly Face[] = ['native', 'objectql'];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & {
  code?: string; status?: number; member?: string; param?: string; field?: string; object?: string; unitField?: string;
};

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

const expectUnitRefusal = (err: Refusal, member: string) => {
  expect(err.code, err.message).toBe('INVALID_FIELD');
  expect(err.status).toBe(400);
  expect(err.member).toBe(member);
  expect(err.param).toBe('measures');
  expect(err.field).toBe('qty');
  expect(err.object).toBe(OBJECT);
  expect(err.unitField).toBe('unit_code');
  expect(err.message).toContain("field 'qty', a quantity whose unit is each record's 'unit_code'");
  expect(err.message).toContain("Add the dimension over 'unit_code'");
};

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os35491_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[ADR-0158 U7 R1] analytics over a record-unit quantity', () => {
  let engine: ObjectQL;
  /** Raw-SQL statements and engine aggregates that read THIS object. */
  const reads = { rawSql: 0, aggregate: 0 };
  const services: Partial<Record<Face, AnalyticsService>> = {};

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(STOCK as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never);

    const realExecute = (engine as any).execute.bind(engine);
    (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
      if (opts?.object === OBJECT) reads.rawSql += 1;
      return realExecute(sql, opts);
    };
    const realAggregate = engine.aggregate.bind(engine);
    (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
      if (object === OBJECT) reads.aggregate += 1;
      return (realAggregate as any)(object, ...rest);
    };

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      const provided: Record<string, unknown> = { data: engine, protocol: pendingSeedProtocol };
      await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
        getService: (name: string) => provided[name] ?? registered[name],
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      services[face] = registered.analytics as AnalyticsService;
    }
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  for (const face of FACES) {
    describe(`${face} strategy`, () => {
      it('grouped by the unit field: each raw aggregate answers one right value per unit', async () => {
        const result = await services[face]!.queryDataset(
          DATASET,
          { dimensions: ['unit'], measures: ['total', 'mean', 'least', 'largest'] },
          CTX,
        );
        const byUnit = Object.fromEntries(
          (result.rows as Array<Record<string, unknown>>).map((r) => [
            r.unit,
            [Number(r.total), Number(r.mean), Number(r.least), Number(r.largest)],
          ]),
        );
        expect(byUnit).toEqual({ KGM: [15, 7.5, 5, 10], LBR: [10, 10, 10, 10] });
      });

      it('grouped by the unit field and another dimension, with a totals grouping that keeps the unit: served', async () => {
        const result = await services[face]!.queryDataset(
          DATASET,
          { dimensions: ['unit', 'region'], measures: ['total'], totals: { groupings: [['unit']] } },
          CTX,
        );
        const totals = Object.fromEntries(
          (result.totals?.[0]?.rows as Array<Record<string, unknown>>).map((r) => [r.unit, Number(r.total)]),
        );
        expect(totals).toEqual({ KGM: 15, LBR: 10 });
      });

      for (const [label, selection, member] of [
        ['grouped by another dimension only', { dimensions: ['region'], measures: ['total'] }, 'total'],
        ['not grouped at all: sum', { measures: ['total'] }, 'total'],
        ['not grouped at all: avg', { measures: ['mean'] }, 'mean'],
        ['not grouped at all: min', { measures: ['least'] }, 'least'],
        ['not grouped at all: max', { measures: ['largest'] }, 'largest'],
        ['a totals grand total over the quantity', { dimensions: ['unit'], measures: ['total'], totals: { groupings: [[]] } }, 'total'],
      ] as const) {
        it(`${label}: refused INVALID_FIELD / 400, naming the quantity and its unit field`, async () => {
          const before = { ...reads };
          const err = await refusalOf(services[face]!.queryDataset(DATASET, selection as never, CTX));
          expectUnitRefusal(err, member);
          if (label !== 'a totals grand total over the quantity') {
            expect(reads.rawSql - before.rawSql).toBe(0);
            expect(reads.aggregate - before.aggregate).toBe(0);
          }
        });
      }

      it('count, count_distinct, a fixed-unit quantity and a plain number are served ungrouped, with their values', async () => {
        const result = await services[face]!.queryDataset(
          DATASET,
          { measures: ['lines', 'counted', 'distinct_qty', 'kg', 'plain_total'] },
          CTX,
        );
        const row = result.rows[0] as Record<string, unknown>;
        expect({
          lines: Number(row.lines),
          counted: Number(row.counted),
          distinct_qty: Number(row.distinct_qty),
          kg: Number(row.kg),
          plain_total: Number(row.plain_total),
        }).toEqual({ lines: 3, counted: 3, distinct_qty: 2, kg: 11, plain_total: 6 });
      });

      it('the cube face refuses the same ungrouped aggregate', async () => {
        services[face]!.registerDataset(DATASET);
        const err = await refusalOf(services[face]!.query({ cube: DATASET.name, measures: ['total'] } as never, CTX));
        expectUnitRefusal(err, 'total');
      });

      it('the inferred cube (the `${field}_${fn}` members) refuses the ungrouped quantity and serves it grouped', async () => {
        const before = { ...reads };
        const err = await refusalOf(services[face]!.query({ cube: OBJECT, measures: ['qty_sum'] } as never, CTX));
        expectUnitRefusal(err, 'qty_sum');
        expect(reads.rawSql - before.rawSql).toBe(0);
        expect(reads.aggregate - before.aggregate).toBe(0);

        const grouped = await services[face]!.query(
          { cube: OBJECT, measures: ['qty_sum'], dimensions: ['unit_code'] } as never,
          CTX,
        );
        const byUnit = Object.fromEntries(
          (grouped.rows as Array<Record<string, unknown>>).map((r) => [r.unit_code, Number(r.qty_sum)]),
        );
        expect(byUnit).toEqual({ KGM: 15, LBR: 10 });
      });
    });
  }

  it('the draft-preview path refuses the ungrouped quantity aggregate the published path refuses, and serves it grouped', async () => {
    const err = await refusalOf(
      services.objectql!.queryDataset(DATASET, { measures: ['largest'] }, CTX, { previewDrafts: true }),
    );
    expectUnitRefusal(err, 'largest');

    const result = await services.objectql!.queryDataset(
      DATASET,
      { dimensions: ['unit'], measures: ['total'] },
      CTX,
      { previewDrafts: true },
    );
    const byUnit = Object.fromEntries(
      (result.rows as Array<Record<string, unknown>>).map((r) => [r.unit, Number(r.total)]),
    );
    expect(byUnit).toEqual({ KGM: 15, LBR: 10 });
  });
});
