// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28201] A dimension the dataset does not declare, through `queryDataset` on
 * the native strategy, the ObjectQL strategy and the draft preview.
 *
 * ## What these pins hold
 *
 * The dataset is a closed surface (ADR-0021, ADR-0149 D1): a selection
 * dimension the dataset does not declare is refused by the closed-member rule
 * (`dataset-declared-members.ts`) before any face reads anything — whether its
 * field is missing (`bogus`) or real (`amount`), alone or beside a declared
 * dimension — `INVALID_FIELD` / 400 with one message on every face, naming
 * the member, the declared members and the remedy. Before, the faces judged
 * the dimension's field, and a real one grouped.
 *
 * - CONTROL: a declared dimension serves the same groups on every face.
 * - A query with two undeclared members names both and is answered about the
 *   first in the closed-member rule's order (measures, then dimensions, then
 *   time dimensions), the same on every face.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28201_deal';

const ROWS = [
  { id: 'd1', region: 'amer', amount: 100 },
  { id: 'd2', region: 'amer', amount: 50 },
  { id: 'd3', region: 'emea', amount: 30 },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os28201_deals',
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

type Refusal = Error & { code?: string; status?: number; param?: string; field?: string; dimension?: string };

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28201_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[#28201] an undeclared dimension on the native, ObjectQL and draft-preview faces', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, selection: { dimensions: readonly string[]; measures: readonly string[] }) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      DATASET,
      { dimensions: [...selection.dimensions], measures: [...selection.measures] } as never,
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

  for (const [label, selection, member] of [
    ["'bogus'", { dimensions: ['bogus'], measures: ['total'] }, 'bogus'],
    ["'bogus' beside a declared dimension", { dimensions: ['region', 'bogus'], measures: ['deals'] }, 'bogus'],
    ["'amount', a real field the dataset does not declare", { dimensions: ['amount'], measures: ['total'] }, 'amount'],
  ] as const) {
    it(`refuses ${label} INVALID_FIELD / 400 with one message on every face`, async () => {
      const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, selection))));
      for (const err of refusals) {
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe('dimensions');
        expect((err as { member?: string }).member).toBe(member);
        expect(err.message).toContain(`The dataset "os28201_deals" does not declare the dimension "${member}".`);
        expect(err.message).toContain('Dimensions you may use: region.');
      }
      const [native, objectql, preview] = refusals;
      expect(preview.message).toBe(native.message);
      expect(objectql.message).toBe(native.message);
    });
  }

  it("CONTROL: 'region' serves the same groups on every face", async () => {
    for (const face of FACES) {
      const result = await ask(face, { dimensions: ['region'], measures: ['total'] });
      const groups = (result.rows as Array<Record<string, unknown>>)
        .map((r) => ({ key: r.region, total: Number(r.total) }))
        .sort((x, y) => String(x.key).localeCompare(String(y.key)));
      expect(groups, face).toEqual([{ key: 'amer', total: 150 }, { key: 'emea', total: 30 }]);
    }
  });

  for (const [label, selection, param, named] of [
    ["'nope' beside 'bogus': the measure", { dimensions: ['bogus'], measures: ['nope'] }, 'measures', 'measure "nope", dimension "bogus"'],
    ["'region_sum' beside 'bogus': the measure", { dimensions: ['bogus'], measures: ['region_sum'] }, 'measures', 'measure "region_sum", dimension "bogus"'],
    ["'amount + 1' beside 'region_sum': the first measure", { dimensions: ['region'], measures: ['amount + 1', 'region_sum'] }, 'measures', 'measure "amount + 1", measure "region_sum"'],
  ] as const) {
    it(`two mistakes, ${label} first, both named, on every face`, async () => {
      const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, selection))));
      for (const err of refusals) {
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
        expect(err.message).toContain(`does not declare the ${named}.`);
      }
      expect(refusals[2].message).toBe(refusals[0].message);
    });
  }
});
