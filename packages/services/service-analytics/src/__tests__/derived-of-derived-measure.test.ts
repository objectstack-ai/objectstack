// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28127] A derived measure whose `of` names ANOTHER derived measure, through
 * `queryDataset` on both strategies and on the draft preview.
 *
 * ## What these pins hold
 *
 * - Served with its value on the native strategy and on the ObjectQL one:
 *   `DatasetExecutor` follows `of` until it reaches aggregated measures and
 *   computes the derived ones dependencies first. Before, the derived operand
 *   was handed to the cube as a base measure and both strategies refused it
 *   (`INVALID_FIELD`, "aggregates field 'total_twice', which object … does not
 *   have").
 * - The draft preview answers the same value. It runs the same executor over
 *   seed rows, and before it answered the derived operand as a row COUNT
 *   (`total_twice` = 2 for two deals), so `twice_per_deal` read 1 instead of 150.
 * - A cycle (`loop_a` → `loop_b` → `loop_a`) is refused `DATASET_INVALID` /
 *   400 with its path, before anything is read, on every face. Before, the
 *   live faces refused it as an unknown field and the preview served a number.
 * - CONTROL: a plain derived measure keeps its value and its columns.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsResult } from '@objectstack/spec/contracts';
import type { AnalyticsService } from '../analytics-service.js';
import { expandSelectedMeasures } from '../dataset-executor.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28127_deal';

const ROWS = [
  { id: 'd1', region: 'amer', amount: 100 },
  { id: 'd2', region: 'amer', amount: 50 },
  { id: 'd3', region: 'emea', amount: 30 },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os28127_deals',
  label: 'Deals',
  object: OBJECT,
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [
    { name: 'total', aggregate: 'sum', field: 'amount' },
    { name: 'deals', aggregate: 'count' },
    { name: 'per_deal', derived: { op: 'ratio', of: ['total', 'deals'] } },
    { name: 'total_twice', derived: { op: 'sum', of: ['total', 'total'] } },
    { name: 'twice_per_deal', derived: { op: 'ratio', of: ['total_twice', 'deals'] } },
    { name: 'twice_per_deal_over_total', derived: { op: 'difference', of: ['twice_per_deal', 'total'] } },
  ],
});

const CYCLE = DatasetSchema.parse({
  name: 'os28127_cycle',
  label: 'Cycle',
  object: OBJECT,
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [
    { name: 'total', aggregate: 'sum', field: 'amount' },
    { name: 'loop_a', derived: { op: 'sum', of: ['loop_b', 'total'] } },
    { name: 'loop_b', derived: { op: 'sum', of: ['loop_a', 'total'] } },
    { name: 'on_loop', derived: { op: 'sum', of: ['total', 'loop_a'] } },
  ],
});

type Path = 'native' | 'objectql' | 'preview';
const PATHS: readonly Path[] = ['native', 'objectql', 'preview'];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number };

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

const byRegion = (result: AnalyticsResult, measure: string) =>
  Object.fromEntries((result.rows as Array<Record<string, unknown>>).map((r) => [r.region, Number(r[measure])]));

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28127_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[#28127] a derived measure over a derived measure', () => {
  let engine: ObjectQL;
  /** Raw-SQL statements and engine aggregates that read THIS object. */
  const reads = { rawSql: 0, aggregate: 0 };
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (path: Path, dataset: typeof DATASET, selection: Record<string, unknown>) =>
    services[path === 'preview' ? 'objectql' : path]!.queryDataset(
      dataset,
      selection as never,
      undefined,
      path === 'preview' ? { previewDrafts: true } : undefined,
    );

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
      },
    } as never);
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

  for (const path of PATHS) {
    describe(`${path} path`, () => {
      it('serves a derived measure over a derived one with its value', async () => {
        const result = await ask(path, DATASET, { dimensions: ['region'], measures: ['twice_per_deal'] });
        // amer: (150 + 150) / 2 deals; emea: (30 + 30) / 1 deal.
        expect(byRegion(result, 'twice_per_deal')).toEqual({ amer: 150, emea: 60 });
        expect(byRegion(result, 'total_twice')).toEqual({ amer: 300, emea: 60 });
      });

      it('serves three levels, and a totals grand total over them', async () => {
        const result = await ask(path, DATASET, {
          dimensions: ['region'],
          measures: ['twice_per_deal_over_total'],
          totals: { groupings: [[]] },
        });
        // twice_per_deal − total: amer 150 − 150, emea 60 − 30.
        expect(byRegion(result, 'twice_per_deal_over_total')).toEqual({ amer: 0, emea: 30 });
        // Grand total: 360 / 3 deals − 180.
        expect(Number((result.totals?.[0]?.rows[0] as Record<string, unknown>).twice_per_deal_over_total)).toBe(-60);
      });

      for (const [label, measure] of [['the cycle itself', 'loop_a'], ['a measure on the cycle', 'on_loop']] as const) {
        it(`refuses ${label} DATASET_INVALID / 400 with the cycle's path, before anything is read`, async () => {
          const before = { ...reads };
          const err = await refusalOf(ask(path, CYCLE, { dimensions: ['region'], measures: [measure] }));
          expect(err.code, err.message).toBe('DATASET_INVALID');
          expect(err.status).toBe(400);
          expect(err.message).toContain('loop_a → loop_b → loop_a');
          expect(reads.rawSql - before.rawSql).toBe(0);
          expect(reads.aggregate - before.aggregate).toBe(0);
        });
      }

      it('CONTROL: a plain derived measure keeps its value and its columns', async () => {
        const result = await ask(path, DATASET, { dimensions: ['region'], measures: ['per_deal'] });
        expect(byRegion(result, 'per_deal')).toEqual({ amer: 75, emea: 30 });
        expect((result.fields ?? []).map((f) => f.name)).toEqual(['region', 'total', 'deals', 'per_deal']);
      });
    });
  }

  it('expandSelectedMeasures: dependencies first, a shared operand once, base measures in selection order', () => {
    const derived = [
      { name: 'c', op: 'sum' as const, of: ['b', 'a'] },
      { name: 'b', op: 'sum' as const, of: ['a', 'x'] },
      { name: 'a', op: 'sum' as const, of: ['x', 'y'] },
    ];
    const { base, derived: ordered } = expandSelectedMeasures(['z', 'c', 'b'], derived);
    expect([...base]).toEqual(['z', 'x', 'y']);
    expect(ordered.map((d) => d.name)).toEqual(['a', 'b', 'c']);
  });
});
