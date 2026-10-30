// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28201] A dimension the dataset does not declare, through `queryDataset` on
 * the native strategy, the ObjectQL strategy and the draft preview.
 *
 * ## What these pins hold
 *
 * - A dimension whose field the object does not have (`bogus`) is refused
 *   `INVALID_FIELD` / 400 on every face, with the same message naming the
 *   member and the valid dimensions, alone or beside a declared dimension.
 *   Before, the preview grouped every row under one `null` key and served the
 *   total.
 * - CONTROL: a declared dimension and an undeclared one naming a real field
 *   (`amount`) serve the same groups on every face.
 * - The preview asks its gates in the live order, so a query with two mistakes
 *   is answered about the same one first on every face: a measure field the
 *   object does not have before a bogus dimension, a bogus dimension before
 *   the field-type door, and the field-type door before the column-reference
 *   gate.
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

  it("refuses 'bogus' INVALID_FIELD / 400 with one message on every face", async () => {
    const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, { dimensions: ['bogus'], measures: ['total'] }))));
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.param).toBe('dimensions');
      expect(err.field).toBe('bogus');
      expect(err.dimension).toBe('bogus');
      expect(err.message).toContain("Dimension 'bogus' on cube 'os28201_deals' groups by field 'bogus'");
      expect(err.message).toContain('Valid dimensions: region.');
    }
    const [native, objectql, preview] = refusals;
    expect(preview.message).toBe(native.message);
    expect(objectql.message).toBe(native.message);
  });

  it("refuses 'bogus' beside a declared dimension with one message on every face", async () => {
    const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, { dimensions: ['region', 'bogus'], measures: ['deals'] }))));
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.field).toBe('bogus');
    }
    expect(refusals[2].message).toBe(refusals[0].message);
  });

  for (const [dimension, expected] of [
    ['region', [{ key: 'amer', total: 150 }, { key: 'emea', total: 30 }]],
    ['amount', [{ key: 30, total: 30 }, { key: 50, total: 50 }, { key: 100, total: 100 }]],
  ] as const) {
    it(`CONTROL: '${dimension}' serves the same groups on every face`, async () => {
      for (const face of FACES) {
        const result = await ask(face, { dimensions: [dimension], measures: ['total'] });
        const groups = (result.rows as Array<Record<string, unknown>>)
          .map((r) => ({ key: r[dimension], total: Number(r.total) }))
          .sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
        expect(groups, face).toEqual(expected);
      }
    });
  }

  for (const [label, selection, param] of [
    ["'nope' beside 'bogus': the measure's missing field", { dimensions: ['bogus'], measures: ['nope'] }, 'measures'],
    ["'region_sum' beside 'bogus': the dimension's missing field", { dimensions: ['bogus'], measures: ['region_sum'] }, 'dimensions'],
    ["'amount + 1' beside 'region_sum': the field-type door", { dimensions: ['region'], measures: ['amount + 1', 'region_sum'] }, 'measures'],
  ] as const) {
    it(`two mistakes, ${label} first, on every face`, async () => {
      const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, selection))));
      for (const err of refusals) {
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.param).toBe(param);
      }
      expect(refusals[2].message).toBe(refusals[0].message);
    });
  }
});
