// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28172] A measure the dataset does not declare, through `queryDataset` on
 * the native strategy, the ObjectQL strategy and the draft preview.
 *
 * ## What these pins hold
 *
 * The live faces mint an undeclared measure (`mintableMeasureKey` +
 * `inferMeasure`: `amount_sum` is `SUM(amount)`, a bare `amount` is
 * `SUM(amount)`) and judge it before a strategy reads anything. The draft
 * preview now mints and judges it the same way:
 *
 * - A spelling whose field the object does not have (`nope`, `ghost_avg`) is
 *   refused `INVALID_FIELD` / 400 on every face, with the same message naming
 *   the member and the valid measures. Before, the preview served a row count
 *   per group under the misspelled name.
 * - A spelling over a real field (`amount_sum`, `amount`) serves the live value
 *   on every face. Before, the preview served the row count.
 * - A minted aggregate the field-type table refuses (`region_sum` over text)
 *   and a spelling that is not a column reference (`amount + 1`) get the live
 *   faces' refusals on the preview too, rather than `0` or a sum of nothing.
 * - CONTROL: a declared measure and the undeclared `count` serve the same
 *   values on every face.
 * - The evaluator refuses a measure the cube it is handed does not carry,
 *   instead of reading it as `count(*)`.
 * - A minted measure is judged by the field it aggregates: the field-level read
 *   gate refuses `secret_sum` on the preview, as on a live strategy, when the
 *   caller may not read `secret`. Without that, minting on the preview would
 *   sum a field the caller may not read.
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

  for (const [measure, field] of [['nope', 'nope'], ['ghost_avg', 'ghost']] as const) {
    it(`refuses '${measure}' INVALID_FIELD / 400 with one message on every face`, async () => {
      const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, measure))));
      for (const err of refusals) {
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe('measures');
        expect(err.field).toBe(field);
        expect(err.measure).toBe(measure);
        expect(err.message).toContain(`Measure '${measure}' on cube 'os28172_deals' aggregates field '${field}'`);
        expect(err.message).toContain('Valid measures: total, deals.');
      }
      const [native, objectql, preview] = refusals;
      expect(preview.message).toBe(native.message);
      expect(objectql.message).toBe(native.message);
    });
  }

  for (const measure of ['amount_sum', 'amount'] as const) {
    it(`serves '${measure}' as SUM(amount) on every face`, async () => {
      for (const face of FACES) {
        const result = await ask(face, measure);
        expect(byRegion(result, measure), face).toEqual({ amer: 150, emea: 30 });
      }
    });
  }

  it("refuses 'region_sum' over a text field INVALID_FIELD / 400 with one message on every face", async () => {
    const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, 'region_sum'))));
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
    }
    expect(refusals[2].message).toBe(refusals[0].message);
  });

  it("refuses 'amount + 1', which is not a column reference, PERMISSION_DENIED / 403 on every face", async () => {
    const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, 'amount + 1'))));
    for (const err of refusals) {
      expect(err.code, err.message).toBe('PERMISSION_DENIED');
      expect(err.status).toBe(403);
    }
    expect(refusals[2].message).toBe(refusals[0].message);
  });

  for (const [measure, expected] of [['total', { amer: 150, emea: 30 }], ['count', { amer: 2, emea: 1 }]] as const) {
    it(`CONTROL: '${measure}' serves the same values on every face`, async () => {
      for (const face of FACES) {
        const result = await ask(face, measure);
        expect(byRegion(result, measure), face).toEqual(expected);
      }
    });
  }

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

describe('[#28172] a minted measure on the draft preview meets the field-level read gate', () => {
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

  it("refuses 'secret_sum' PERMISSION_DENIED / 403 naming 'secret' on the preview and on the live strategy", async () => {
    for (const draft of [false, true]) {
      const err = await refusalOf(
        service(draft).queryDataset(
          dataset,
          { dimensions: ['region'], measures: ['secret_sum'] } as never,
          CALLER,
          draft ? { previewDrafts: true } : undefined,
        ),
      );
      expect(err.code, err.message).toBe('PERMISSION_DENIED');
      expect(err.status).toBe(403);
      expect((err as Refusal & { fields?: string[] }).fields).toEqual(['secret']);
    }
  });
});
