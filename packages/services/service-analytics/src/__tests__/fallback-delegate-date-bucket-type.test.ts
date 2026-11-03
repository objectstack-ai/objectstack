// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29364] The delegated fallback face (`FallbackDelegateStrategy`) refuses a
 * date bucket over a field that is not a date or a datetime, as the engine face
 * refuses it, field for field.
 *
 * ## The shape this closes
 *
 * `FallbackDelegateStrategy` hands a cube query to the host's fallback
 * `IAnalyticsService` (`MemoryAnalyticsService` from `@objectstack/driver-memory`
 * is the in-repo one), which folds a bucketed time dimension itself and reads
 * no field type. Measured on `origin/main` `aca58cdb` with
 * `MemoryAnalyticsService` as the delegate, a month bucket over:
 *
 * | field | the fallback face answered |
 * |:--|:--|
 * | `formula` (virtual: no stored column) | 200, one `null` group holding every row |
 * | `text` | 200, a `null` group beside whatever text parsed as a date |
 * | `datetime` (the control) | 200, the right buckets |
 *
 * while the engine face (the default composition: real ObjectQL + SqlDriver on
 * SQLite) refused the first two with `INVALID_FIELD` / 400 at
 * `groupBy.N.dateGranularity`. No shipped composition reaches this face; the
 * public construction paths do, and both are pinned below:
 * `new AnalyticsService({ fallbackService })`, and `AnalyticsServicePlugin`
 * capturing a pre-registered analytics service under a `queryCapabilities`
 * override with `objectqlAggregate: false`.
 *
 * The delegate here is a recording double: the pin is the service's face (the
 * refusal, and that the delegate was never called), not the delegate's fold.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsResult, IAnalyticsService } from '@objectstack/spec/contracts';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DEAL = 'os29364_deal';
const CUBE = 'os29364_cube';

const CUBES = [
  {
    name: CUBE,
    title: 'Fallback date bucket cube',
    sql: DEAL,
    public: true,
    measures: { amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' } },
    dimensions: {
      calc: { type: 'time', sql: 'calc', label: 'Calc' },
      region: { type: 'time', sql: 'region', label: 'Region' },
      closed_at: { type: 'time', sql: 'closed_at', label: 'Closed at' },
    },
  },
] as unknown as Cube[];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Query = Record<string, unknown>;
const bucket = (...dims: Array<[dimension: string, granularity: string]>): Query => ({
  cube: CUBE,
  measures: [`${CUBE}.amount_sum`],
  timeDimensions: dims.map(([d, granularity]) => ({ dimension: `${CUBE}.${d}`, granularity })),
});

/** The rows and statement the recording delegate answers with. */
const DELEGATED: AnalyticsResult = {
  rows: [{ [`${CUBE}.closed_at`]: '2026-03', [`${CUBE}.amount_sum`]: 10 }],
  fields: [{ name: `${CUBE}.closed_at`, type: 'string' }, { name: `${CUBE}.amount_sum`, type: 'number' }],
};
const DELEGATED_SQL = { sql: 'SELECT 1 -- delegated', params: [] as unknown[] };

function recordingDelegate() {
  return {
    query: vi.fn(async () => DELEGATED),
    generateSql: vi.fn(async () => DELEGATED_SQL),
    getMeta: vi.fn(async () => []),
  };
}

/** The refusal `p` rejects with, as the keys a caller reads; a resolution fails the case. */
const refusalOf = async (face: string, p: Promise<unknown>) => {
  const err = (await p.then(
    () => { throw new Error(`${face}: expected a refusal, but it resolved`); },
    (e: unknown) => e,
  )) as Error & Record<string, unknown>;
  return {
    message: err.message, code: err.code, status: err.status, httpStatus: err.httpStatus,
    object: err.object, param: err.param, path: err.path, field: err.field, fields: err.fields,
  };
};

describe('[#29364] the fallback face refuses a date bucket over a field that is not a date, as the engine face does', () => {
  let engine: ObjectQL;
  /** The engine face: the default composition, no `queryCapabilities` override. */
  let engineFace: AnalyticsService;

  /** A field's declaration on the engine, as the plugin's `sourceFieldMeta` reads it. */
  const fieldMeta = (object: string, field: string) => {
    const f = (engine as unknown as { getObject(o: string): { fields?: Record<string, { type?: string }> } | undefined })
      .getObject(object)?.fields?.[field];
    return f ? { type: f.type } : undefined;
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: DEAL,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        closed_at: { name: 'closed_at', type: 'datetime' },
        closed_on: { name: 'closed_on', type: 'date' },
        // A formula the table stores no column for, whose result is a date.
        calc: { name: 'calc', type: 'formula', expression: 'closed_on', returnType: 'date' },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    await engine.insert(DEAL, {
      id: 'd1', region: 'amer', amount: 10, closed_at: '2026-03-01T00:00:00.000Z', closed_on: '2026-03-02',
    } as never);

    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({ cubes: CUBES } as never).init({
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    engineFace = registered.analytics as AnalyticsService;
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /** `new AnalyticsService({ fallbackService })` with the host's field types. */
  const constructedFace = () => {
    const delegate = recordingDelegate();
    const face = new AnalyticsService({
      cubes: CUBES,
      logger: quiet as never,
      fallbackService: delegate as unknown as IAnalyticsService,
      sourceFieldMeta: fieldMeta,
    } as never);
    return { face, delegate };
  };

  /** `AnalyticsServicePlugin` capturing a pre-registered analytics service, `objectqlAggregate: false`. */
  const pluginFace = async () => {
    const delegate = recordingDelegate();
    const registered: Record<string, unknown> = { analytics: delegate };
    await new AnalyticsServicePlugin({
      cubes: CUBES,
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: false, inMemory: false }),
    } as never).init({
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    return { face: registered.analytics as AnalyticsService, delegate };
  };

  const FACES = [
    ['new AnalyticsService({ fallbackService })', constructedFace],
    ['AnalyticsServicePlugin, objectqlAggregate: false', pluginFace],
  ] as const;

  const REFUSED: Array<[label: string, query: Query, field: string, path: string]> = [
    ['a formula by month', bucket(['calc', 'month']), 'calc', 'groupBy.0.dateGranularity'],
    ['a text column by month', bucket(['region', 'month']), 'region', 'groupBy.0.dateGranularity'],
    ['a formula after a datetime bucket', bucket(['closed_at', 'year'], ['calc', 'month']), 'calc', 'groupBy.1.dateGranularity'],
  ];

  for (const [faceLabel, makeFace] of FACES) {
    describe(faceLabel, () => {
      it.each(REFUSED)('refuses %s with the engine face\'s refusal, on the query and the dry run, and never calls the delegate', async (_l, query, field, path) => {
        const { face, delegate } = await makeFace();
        const asEngine = await refusalOf('engine', engineFace.query({ ...query } as never));
        // The engine face's own refusal, so a reader can see what is being matched.
        expect(asEngine).toMatchObject({ code: 'INVALID_FIELD', status: 400, object: DEAL, param: 'groupBy', path, field, fields: [field] });

        expect(await refusalOf('fallback query', face.query({ ...query } as never)), 'the fallback query vs the engine face').toEqual(asEngine);
        expect(await refusalOf('fallback sql', face.generateSql({ ...query } as never)), 'the fallback dry run vs the engine face').toEqual(asEngine);
        expect(delegate.query).not.toHaveBeenCalled();
        expect(delegate.generateSql).not.toHaveBeenCalled();
      });

      it('serves a datetime bucket through the delegate, as before (the control)', async () => {
        const { face, delegate } = await makeFace();
        const query = bucket(['closed_at', 'month']);
        const result = await face.query({ ...query } as never);
        expect(delegate.query).toHaveBeenCalledTimes(1);
        expect(result.rows).toEqual(DELEGATED.rows);
        expect(await face.generateSql({ ...query } as never)).toEqual(DELEGATED_SQL);
        expect(delegate.generateSql).toHaveBeenCalledTimes(1);
      });
    });
  }

  it('does not judge a bucket the host gave no field type for (no sourceFieldMeta), as the preview and the dry run', async () => {
    const delegate = recordingDelegate();
    const face = new AnalyticsService({
      cubes: CUBES,
      logger: quiet as never,
      fallbackService: delegate as unknown as IAnalyticsService,
    } as never);
    await face.query({ ...bucket(['calc', 'month']) } as never);
    expect(delegate.query).toHaveBeenCalledTimes(1);
  });
});
