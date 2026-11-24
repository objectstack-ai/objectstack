// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28257] A `runtimeFilter` on a field the dataset object does not have, and
 * a dimension over a structured-JSON column (#20807), through `queryDataset` on
 * the native strategy, the ObjectQL strategy and the draft preview.
 *
 * ## What these pins hold
 *
 * - A filter member whose field the object does not have is refused
 *   `INVALID_FIELD` / 400 with `param: 'where'` on every face, with the same
 *   message, whether it is the whole filter, one arm of an `$or` or the array
 *   spelling. Before, the preview matched no row and served `[]`, or under the
 *   `$or` served the other arm's rows.
 * - A dimension over a `json` column, declared or not, is refused
 *   `INVALID_FIELD` / 400 with `param: 'dimensions'` on every face, with the
 *   same message. Before, the preview grouped by each row's object value.
 * - CONTROL: a filter on a declared dimension, on an undeclared real field and
 *   an `$in` filter serve the same rows on every face.
 * - The preview asks both gates in the live order: the JSON door after the
 *   dimension-field gate and before the field-type door, the `where` gate last
 *   among `ensureCube`'s and before the column-reference gate.
 * - [ADR-0149 D1] A selection member the dataset does not declare (the raw
 *   `payload`, `region_sum`, `amount + 1`) is refused by the closed-member rule
 *   ahead of all of these, on every face alike; the JSON door is pinned
 *   through the declared `payload_dim`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28257_deal';

const ROWS = [
  { id: 'd1', region: 'amer', amount: 100, payload: { k: 1 } },
  { id: 'd2', region: 'amer', amount: 50, payload: { k: 2 } },
  { id: 'd3', region: 'emea', amount: 30, payload: { k: 1 } },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os28257_deals',
  label: 'Deals',
  object: OBJECT,
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'payload_dim', field: 'payload', type: 'string' },
  ],
  measures: [
    { name: 'total', aggregate: 'sum', field: 'amount' },
    { name: 'deals', aggregate: 'count' },
  ],
});

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; param?: string; field?: string };

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28257_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[#28257] an unknown filter field and a json dimension on the native, ObjectQL and draft-preview faces', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, selection: Record<string, unknown>) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      DATASET,
      selection as never,
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
        payload: { name: 'payload', type: 'json' },
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

  const refusedAlike = async (selection: Record<string, unknown>, param: string, field: string) => {
    const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, selection))));
    for (const err of refusals) {
      expect(err.code, err.message).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.param).toBe(param);
      expect(err.field).toBe(field);
    }
    const [native, objectql, preview] = refusals;
    expect(preview.message).toBe(native.message);
    expect(objectql.message).toBe(native.message);
    return native;
  };

  for (const [label, runtimeFilter] of [
    ['the whole filter', { bogus: 'x' }],
    ['one arm of an $or', { $or: [{ bogus: 1 }, { region: 'amer' }] }],
    ['the array spelling', [['bogus', '=', 'x']]],
  ] as const) {
    it(`refuses a filter on 'bogus' as ${label}, INVALID_FIELD / 400 param where, with one message on every face`, async () => {
      const err = await refusedAlike({ dimensions: ['region'], measures: ['total'], runtimeFilter }, 'where', 'bogus');
      expect(err.message).toContain("Filter member 'bogus' in 'where' on cube 'os28257_deals' constrains field 'bogus'");
    });
  }

  for (const [label, runtimeFilter, expected] of [
    ['a declared dimension', { region: 'amer' }, [{ key: 'amer', total: 150 }]],
    ['an undeclared real field', { amount: { $gt: 40 } }, [{ key: 'amer', total: 150 }]],
    ['an $in on a declared dimension', { region: { $in: ['emea'] } }, [{ key: 'emea', total: 30 }]],
  ] as const) {
    it(`CONTROL: a filter on ${label} serves the same rows on every face`, async () => {
      for (const face of FACES) {
        const result = await ask(face, { dimensions: ['region'], measures: ['total'], runtimeFilter });
        const rows = (result.rows as Array<Record<string, unknown>>).map((r) => ({ key: r.region, total: Number(r.total) }));
        expect(rows, face).toEqual(expected);
      }
    });
  }

  it("refuses the json dimension 'payload_dim' INVALID_FIELD / 400 param dimensions, with one message on every face", async () => {
    const err = await refusedAlike({ dimensions: ['payload_dim'], measures: ['total'] }, 'dimensions', 'payload');
    expect(err.message).toContain('declares as json');
  });

  it("CONTROL: the json field 'payload' named raw is not a declared dimension: the closed-member refusal, alike on every face", async () => {
    const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, { dimensions: ['payload'], measures: ['total'] }))));
    for (const err of refusals) {
      expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'dimensions', member: 'payload' });
      expect(err.message).toContain('The dataset "os28257_deals" does not declare the dimension "payload".');
    }
    expect(refusals[2].message).toBe(refusals[0].message);
  });

  it('two mistakes, a json dimension beside a bogus filter: the json door first, on every face', async () => {
    await refusedAlike({ dimensions: ['payload_dim'], measures: ['total'], runtimeFilter: { ghost: 1 } }, 'dimensions', 'payload');
  });

  for (const [label, selection, member] of [
    ["a json dimension beside 'region_sum'", { dimensions: ['payload_dim'], measures: ['region_sum'] }, 'region_sum'],
    ["'amount + 1' beside a bogus filter", { dimensions: ['region'], measures: ['amount + 1'], runtimeFilter: { ghost: 1 } }, 'amount + 1'],
  ] as const) {
    it(`two mistakes, ${label}: the undeclared measure first, on every face`, async () => {
      const refusals = await Promise.all(FACES.map((face) => refusalOf(ask(face, selection))));
      for (const err of refusals) {
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, param: 'measures', member });
      }
      expect(refusals[2].message).toBe(refusals[0].message);
    });
  }
});
