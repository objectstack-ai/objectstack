// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28172] A measure the dataset does not declare, through `queryDataset` on
 * the native strategy, the ObjectQL strategy and the draft preview.
 *
 * ## What these pins hold
 *
 * The dataset is a closed surface (ADR-0021, ADR-0149 D1): a selection
 * measure the dataset does not declare is refused by the closed-member rule
 * (`dataset-declared-members.ts`) before a strategy, the preview evaluator or
 * any gate behind them reads anything, so every face answers it the same way:
 * `INVALID_FIELD` / 400 naming the member, the declared measures and the
 * remedy. That covers every spelling the faces used to mint and then judge —
 * a field the object does not have (`nope`, `ghost_avg`), a suffix or bare
 * field over a real one (`amount_sum`, `amount`), a minted aggregate the
 * field-type table refuses (`region_sum`), a spelling that is not a column
 * reference (`amount + 1`), the ad-hoc `count`, and a minted `secret_sum`
 * over a field the caller may not read.
 *
 * - CONTROL: a declared measure serves the same values on every face.
 * - The evaluator refuses a measure the cube it is handed does not carry,
 *   instead of reading it as `count(*)`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28172_deal';

const ROWS = [
  { id: 'd1', region: 'amer', amount: 100 },
  { id: 'd2', region: 'amer', amount: 50 },
  { id: 'd3', region: 'emea', amount: 30 },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os28172_deals',
  label: 'Deals',
  object: OBJECT,
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [
    { name: 'total', aggregate: 'sum', field: 'amount' },
    { name: 'deals', aggregate: 'count' },
  ],
});

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; param?: string; field?: string; measure?: string; member?: string };

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

const byRegion = (result: AnalyticsResult, measure: string) =>
  Object.fromEntries((result.rows as Array<Record<string, unknown>>).map((r) => [r.region, r[measure]]));

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28172_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[#28172] an undeclared measure on the native, ObjectQL and draft-preview faces', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, measure: string) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      DATASET,
      { dimensions: ['region'], measures: [measure] } as never,
      undefined,
      face === 'preview' ? { previewDrafts: true } : undefined,
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

  for (const measure of ['nope', 'ghost_avg', 'amount_sum', 'amount', 'region_sum', 'amount + 1', 'count'] as const) {
    it(`refuses '${measure}', which the dataset does not declare, INVALID_FIELD / 400 with one message on every face`, async () => {
      const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, measure))));
      for (const err of refusals) {
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe('measures');
        expect(err.member).toBe(measure);
        expect(err.message).toContain(`The dataset "os28172_deals" does not declare the measure "${measure}".`);
        expect(err.message).toContain('Measures you may use: total, deals.');
      }
      const [native, objectql, preview] = refusals;
      expect(preview.message).toBe(native.message);
      expect(objectql.message).toBe(native.message);
    });
  }

  it('a stale DECLARED measure over a field the object does not have: one dataset-door remedy on every face, the draft preview included', async () => {
    // [ADR-0021, ADR-0149 D1] The source-field gate meets a dataset only
    // through a declared member, so its refusal points at the declared field
    // and never offers the cube door's suffix-inferred measures.
    const stale = DatasetSchema.parse({ ...DATASET, measures: [...DATASET.measures, { name: 'ghost_total', aggregate: 'sum', field: 'ghost' }] });
    const refusals = await Promise.all(
      FACES.map((face) =>
        refusalOf(
          services[face === 'preview' ? 'objectql' : face]!.queryDataset(
            stale,
            { dimensions: ['region'], measures: ['ghost_total'] } as never,
            undefined,
            face === 'preview' ? { previewDrafts: true } : undefined,
          ),
        ),
      ),
    );
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.field).toBe('ghost');
      expect(err.message).toContain("The dataset declares this measure over 'ghost': point its `field` at one of the object's fields, or remove the measure");
      expect(err.message).not.toMatch(/inferred from the object's OWN fields/);
    }
    const [native, objectql, preview] = refusals;
    expect(preview.message).toBe(native.message);
    expect(objectql.message).toBe(native.message);
  });

  it("CONTROL: 'total' serves the same values on every face", async () => {
    for (const face of FACES) {
      const result = await ask(face, 'total');
      expect(byRegion(result, 'total'), face).toEqual({ amer: 150, emea: 30 });
    }
  });

  it('the evaluator refuses a measure the cube it is handed does not carry, instead of counting rows', () => {
    const cube = {
      name: 'c',
      title: 'c',
      sql: OBJECT,
      measures: { total: { label: 'Total', type: 'sum', sql: 'amount' } },
      dimensions: { region: { label: 'Region', type: 'string', sql: 'region' } },
    } as unknown as Cube;
    const rows = ROWS.map((r) => ({ ...r }));
    let err: Refusal | undefined;
    try {
      evaluateAnalyticsQueryOverRows({ cube: 'c', measures: ['nope'], dimensions: ['region'] }, cube, rows);
    } catch (e) {
      err = e as Refusal;
    }
    expect(err?.code).toBe('INVALID_FIELD');
    expect(err?.status).toBe(400);
    expect(err?.member).toBe('nope');
    expect(err?.message).toContain('Valid measures: total.');
    const served = evaluateAnalyticsQueryOverRows({ cube: 'c', measures: ['total'], dimensions: ['region'] }, cube, rows);
    expect(byRegion(served, 'total')).toEqual({ amer: 150, emea: 30 });
  });
});

describe('[#28172] a measure over a field the caller may not read, undeclared, is refused before any gate reads it', () => {
  const CALLER = { userId: 'u_member', tenantId: 'org_a' } as ExecutionContext;
  const DEAL = 'os28172_secret_deal';
  const dataset = DatasetSchema.parse({
    name: 'os28172_secret',
    label: 'Secret',
    object: DEAL,
    dimensions: [{ name: 'region', field: 'region', type: 'string' }],
    measures: [{ name: 'deals', aggregate: 'count' }],
  });
  const service = (draft: boolean) =>
    new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      getObjectFieldNames: () => ['region', 'secret'],
      getReadableFields: () => ['id', 'region'],
      ...(draft ? { draftRowsResolver: async () => [{ id: 'd1', region: 'amer', secret: 7 }] } : {}),
      executeRawSql: async () => [],
      executeAggregate: async () => [],
    } as never);

  it("refuses 'secret_sum' INVALID_FIELD / 400 on the preview and on the live strategy, never minting it", async () => {
    for (const draft of [false, true]) {
      const err = await refusalOf(
        service(draft).queryDataset(
          dataset,
          { dimensions: ['region'], measures: ['secret_sum'] } as never,
          CALLER,
          draft ? { previewDrafts: true } : undefined,
        ),
      );
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.member).toBe('secret_sum');
      expect(err.message).toContain('The dataset "os28172_secret" does not declare the measure "secret_sum".');
    }
  });
});
