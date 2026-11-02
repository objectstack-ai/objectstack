// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28852] The draft preview refuses a date bucket over a column declared
 * neither a date nor a datetime, as both live faces do, on real SQLite (the
 * #28201 / #28690 harness: real ObjectQL + SqlDriver through
 * `AnalyticsServicePlugin.init`, a fake `protocol` answering one pending seed).
 *
 * ## The shape this closes
 *
 * Measured on `main` `9a9823d9`, a `timeDimensions` granularity over a text,
 * select, number or boolean column:
 *
 * | column | native / ObjectQL | draft preview before |
 * |:--|:--|:--|
 * | text `region` by month | `INVALID_FIELD` / 400 at `groupBy.0.dateGranularity` | one `null` group holding the total |
 * | select `stage` by month | the same | one `null` group |
 * | number `amount` by year | the same | one `1970` group |
 * | boolean `flag` by month | the same | one `null` group |
 *
 * The live answer is the engine's `assertDateBucketTargetsAreTemporal`. The
 * preview now judges the same keys with the same reading
 * (`preview-date-bucket-door.ts`) and gives the same refusal, field for field.
 * A date and a datetime bucket are served alike on every face, as before.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os28852_deal';

const ROWS = [
  { id: 'd1', region: 'amer', stage: 'won', amount: 100, flag: true, closed_at: '2026-03-01T00:00:00.000Z', closed_on: '2026-03-02' },
  { id: 'd2', region: 'emea', stage: 'lost', amount: 50, flag: false, closed_at: '2026-04-01T00:00:00.000Z', closed_on: '2026-04-02' },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os28852_deals',
  label: 'Deals',
  object: OBJECT,
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'amount_d', field: 'amount', type: 'number' },
    { name: 'flag', field: 'flag', type: 'boolean' },
    { name: 'closed_at', field: 'closed_at', type: 'date' },
    { name: 'closed_on', field: 'closed_on', type: 'date' },
  ],
  measures: [{ name: 'total', aggregate: 'sum', field: 'amount' }],
});

type Face = 'native' | 'objectql' | 'preview';
const FACES: readonly Face[] = ['native', 'objectql', 'preview'];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Selection = { dimensions?: string[]; measures: string[]; timeDimensions?: Array<Record<string, unknown>> };

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os28852_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[#28852] a date bucket over a column that is not a date, on every face', () => {
  let engine: ObjectQL;
  const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

  const ask = (face: Face, selection: Selection) =>
    services[face === 'preview' ? 'objectql' : face]!.queryDataset(
      DATASET,
      { ...selection } as never,
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
        stage: { name: 'stage', type: 'select', options: [{ label: 'Won', value: 'won' }, { label: 'Lost', value: 'lost' }] },
        amount: { name: 'amount', type: 'number' },
        flag: { name: 'flag', type: 'boolean' },
        closed_at: { name: 'closed_at', type: 'datetime' },
        closed_on: { name: 'closed_on', type: 'date' },
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

  /** Every face refuses `selection`, with one refusal, field for field. */
  const refusedAlike = async (selection: Selection) => {
    const refusals: Array<Record<string, unknown>> = [];
    for (const face of FACES) {
      const err = (await ask(face, selection).then(
        () => { throw new Error(`${face}: expected a refusal, but the query resolved`); },
        (e: unknown) => e,
      )) as Error & Record<string, unknown>;
      expect(err.code, `${face}: ${err.message}`).toBe('INVALID_FIELD');
      expect(err.status, face).toBe(400);
      refusals.push({
        message: err.message, code: err.code, status: err.status, httpStatus: err.httpStatus,
        object: err.object, param: err.param, path: err.path, field: err.field, fields: err.fields,
      });
    }
    for (const [i, refusal] of refusals.entries()) expect(refusal, `${FACES[i]} vs native`).toEqual(refusals[0]);
    return refusals[0];
  };

  it.each([
    ['text', 'region', 'region', 'text', 'month'],
    ['select', 'stage', 'stage', 'select', 'month'],
    ['number', 'amount_d', 'amount', 'number', 'year'],
    ['boolean', 'flag', 'flag', 'boolean', 'month'],
  ])('refuses a bucket over a %s column, where the preview served one null (or 1970) group', async (_label, dimension, field, type, granularity) => {
    const refusal = await refusedAlike({ measures: ['total'], timeDimensions: [{ dimension, granularity }] });
    expect(refusal).toEqual({
      message:
        `aggregate('${OBJECT}'): groupBy.0.dateGranularity buckets '${field}' by '${granularity}', but '${field}' is a `
        + `declared ${type} field — only a date or datetime field can be date-bucketed. The query was NOT run. Group by `
        + `'${field}' without 'dateGranularity', or bucket a date or datetime field. A value that is not a date has no `
        + 'calendar position: every row fell into one null bucket (or, for a number, an epoch bucket) while the answer '
        + 'looked served.',
      code: 'INVALID_FIELD', status: 400, httpStatus: 400,
      object: OBJECT, param: 'groupBy', path: 'groupBy.0.dateGranularity', field, fields: [field],
    });
  });

  it('names the later position beside a raw dimension and a datetime bucket', async () => {
    const refusal = await refusedAlike({
      dimensions: ['closed_on'],
      measures: ['total'],
      timeDimensions: [{ dimension: 'closed_at', granularity: 'month' }, { dimension: 'region', granularity: 'month' }],
    });
    expect(refusal).toMatchObject({ path: 'groupBy.2.dateGranularity', fields: ['region'] });
  });

  it.each([
    ['date', 'closed_on'],
    ['datetime', 'closed_at'],
  ])('still serves a %s bucket alike on every face', async (_label, dimension) => {
    for (const face of FACES) {
      const result = await ask(face, { measures: ['total'], timeDimensions: [{ dimension, granularity: 'month' }] });
      const rows = (result.rows as Array<Record<string, unknown>>).map((r) => ({ ...r, total: Number(r.total) }));
      expect(rows, face).toEqual([{ [dimension]: '2026-03', total: 100 }, { [dimension]: '2026-04', total: 50 }]);
      expect((result.fields ?? []).map((f: { name: string; type: string }) => `${f.name}:${f.type}`), face).toEqual([`${dimension}:time`, 'total:number']);
    }
  });
});
