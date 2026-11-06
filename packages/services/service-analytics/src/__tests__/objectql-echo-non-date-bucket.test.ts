// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28977] The `/analytics/sql` dry run refuses a date bucket over a column
 * declared neither a date nor a datetime, as `/analytics/query` does, on real
 * SQLite (the #28841 harness: real ObjectQL + SqlDriver, the default
 * composition).
 *
 * ## The shape this closes
 *
 * The query hands `engine.aggregate` the keys the ObjectQL strategy builds
 * (native declines every bucketed selection to it), and the engine refuses a
 * bucket over any other declared type: `INVALID_FIELD` / 400 at
 * `groupBy.N.dateGranularity`. The dry run rendered the bucket without reading
 * the column's type, so on `main` `ab085a04` it printed a statement for each:
 *
 * | selection | the dry run rendered |
 * |:--|:--|
 * | text `region` by month | `strftime('%Y-%m', \`region\`)` |
 * | select, number, boolean, `time` | the same over that column |
 * | `account.name` beside a text bucket (the cross-object path) | the join and the bucket |
 * | a cube dimension over `region` declaring one granularity, asked raw | the bucket |
 * | text `region` by month at `America/New_York` | `NOT_IMPLEMENTED` / 501 saying the query is served |
 *
 * [#29167] …and a bucket over a `formula` (virtual: no stored column), which
 * the dry run rendered as `strftime('%Y-%m', calc)` while the query refused it
 * from the SQL driver's missing-column backstop: both now answer the engine's
 * virtual-field refusal, field for field.
 *
 * [#29304] …and a PLAIN group over a `formula`, which the native strategy
 * compiled into `GROUP BY calc` and ran (`DATABASE_ERROR` / 500), the ObjectQL
 * strategy handed the SQL driver's missing-column backstop, and the dry run
 * rendered on both compositions (measured on `origin/main` `447226b2`). The
 * native strategy now declines a grouped dimension over a virtual field, so
 * the query and the dry run both answer the engine's plain-group refusal.
 *
 * It now judges the keys `execute()` hands the engine with the service's one
 * reading of it (`dataset-date-bucket-door.ts`, #28852), after the `dateRange`
 * read and the column-asked-twice door as `query()` refuses, so it answers the
 * query's refusal field for field. A date and a datetime bucket still render
 * byte for byte (pinned below).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DEAL = 'os28977_deal';
const ACCOUNT = 'os28977_account';
const CUBE = 'os28977_cube';

const CUBES = [
  {
    name: CUBE,
    title: 'Date bucket cube',
    sql: DEAL,
    public: true,
    measures: { amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' } },
    dimensions: {
      region: { type: 'string', sql: 'region', label: 'Region' },
      // A time dimension over a text column, declaring one granularity: asked
      // raw, it is bucketed by that granularity (`withDeclaredGranularityDefaults`).
      region_month: { type: 'time', sql: 'region', label: 'Region month', granularities: ['month'] },
      // [#29304] A string dimension over the formula, asked raw: a plain group.
      calc_label: { type: 'string', sql: 'calc', label: 'Calc label' },
    },
  },
] as unknown as Cube[];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Query = Record<string, unknown>;
const td = (dimension: string, granularity: string, extra: Query = {}) => ({ dimension, granularity, ...extra });
/** The inferred cube over the deal object, which serves a lookup path as a cross-object dimension. */
const onObject = (extra: Query): Query => ({ cube: DEAL, measures: ['amount_sum'], ...extra });
const onCube = (extra: Query): Query => ({ cube: CUBE, measures: ['amount_sum'], ...extra });

/** The engine's refusal for a bucket over `field`, declared `type`, at `path`. */
const refusalFor = (field: string, type: string, granularity: string, path: string) => ({
  message:
    `aggregate('${DEAL}'): ${path} buckets '${field}' by '${granularity}', but '${field}' is a `
    + `declared ${type} field — only a date or datetime field can be date-bucketed. The query was NOT run. Group by `
    + `'${field}' without 'dateGranularity', or bucket a date or datetime field. A value that is not a date has no `
    + 'calendar position: every row fell into one null bucket (or, for a number, an epoch bucket) while the answer '
    + 'looked served.',
  code: 'INVALID_FIELD', status: 400, httpStatus: 400,
  object: DEAL, param: 'groupBy', path, field, fields: [field],
});

describe('[#28977] the /analytics/sql dry run refuses a date bucket over a column that is not a date, as the query does', () => {
  let engine: ObjectQL;
  let analytics: AnalyticsService;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: ACCOUNT,
      label: 'Account',
      fields: {
        name: { name: 'name', type: 'text' },
        // [#29304] A formula on the related object, read through `account.`.
        name_calc: { name: 'name_calc', type: 'formula', expression: 'name', returnType: 'text' },
      },
    } as never);
    engine.registry.registerObject({
      name: DEAL,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        stage: { name: 'stage', type: 'select', options: [{ label: 'Won', value: 'won' }, { label: 'Lost', value: 'lost' }] },
        amount: { name: 'amount', type: 'number' },
        flag: { name: 'flag', type: 'boolean' },
        opened_time: { name: 'opened_time', type: 'time' },
        closed_at: { name: 'closed_at', type: 'datetime' },
        closed_on: { name: 'closed_on', type: 'date' },
        account: { name: 'account', type: 'lookup', reference: ACCOUNT },
        // [#29167] A formula the table stores no column for, whose result is a date.
        calc: { name: 'calc', type: 'formula', expression: 'closed_on', returnType: 'date' },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    await engine.insert(ACCOUNT, { id: 'a1', name: 'Acme' } as never);
    await engine.insert(DEAL, {
      id: 'd1', region: 'amer', stage: 'won', amount: 10, flag: true, opened_time: '10:00',
      closed_at: '2026-03-01T00:00:00.000Z', closed_on: '2026-03-02', account: 'a1',
    } as never);

    // The default composition: no `queryCapabilities` override.
    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({ cubes: CUBES, debugSql: true } as never).init({
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    analytics = registered.analytics as AnalyticsService;
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

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

  /** The query's refusal and the dry run's, for one selection. */
  const bothRefusals = async (query: Query) => ({
    asQuery: await refusalOf('query', analytics.query({ ...query } as never)),
    asSql: await refusalOf('sql', analytics.generateSql({ ...query } as never)),
  });

  it.each<[string, Query, [field: string, type: string, granularity: string, path: string]]>([
    ['text', onObject({ timeDimensions: [td('region', 'month')] }), ['region', 'text', 'month', 'groupBy.0.dateGranularity']],
    ['select', onObject({ timeDimensions: [td('stage', 'month')] }), ['stage', 'select', 'month', 'groupBy.0.dateGranularity']],
    ['number', onObject({ timeDimensions: [td('amount', 'year')] }), ['amount', 'number', 'year', 'groupBy.0.dateGranularity']],
    ['boolean', onObject({ timeDimensions: [td('flag', 'month')] }), ['flag', 'boolean', 'month', 'groupBy.0.dateGranularity']],
    ['time', onObject({ timeDimensions: [td('opened_time', 'day')] }), ['opened_time', 'time', 'day', 'groupBy.0.dateGranularity']],
  ])('refuses a bucket over a %s column with the query\'s refusal, field for field', async (_label, query, expected) => {
    const { asQuery, asSql } = await bothRefusals(query);
    expect(asQuery).toEqual(refusalFor(...expected));
    expect(asSql, 'the dry run vs the query').toEqual(asQuery);
  });

  it.each<[string, Query, string]>([
    ['by month', onObject({ timeDimensions: [td('calc', 'month')] }), 'groupBy.0.dateGranularity'],
    ['after a datetime bucket', onObject({ timeDimensions: [td('closed_at', 'year'), td('calc', 'month')] }), 'groupBy.1.dateGranularity'],
    ['at a non-UTC zone', onObject({ timeDimensions: [td('calc', 'month')], timezone: 'America/New_York' }), 'groupBy.0.dateGranularity'],
  ])('[#29167] refuses a bucket over a formula (virtual: no stored column) %s with the query\'s refusal, where the dry run rendered strftime', async (_label, query, path) => {
    const { asQuery, asSql } = await bothRefusals(query);
    expect(asQuery).toEqual({
      message:
        `aggregate('${DEAL}'): ${path} buckets 'calc' by 'month', but 'calc' is a formula field — its value is computed `
        + 'on read and never stored, so no driver materialises a column to bucket. The query was NOT run. Denormalise '
        + `the value onto '${DEAL}' (a stored date or datetime field, written when the source changes) and bucket that. `
        + 'A formula field is virtual: with no column behind it the bucket reached the driver as a column that does not '
        + 'exist, and an engine that aggregates in memory put every row into one null group while the answer looked served.',
      code: 'INVALID_FIELD', status: 400, httpStatus: 400,
      object: DEAL, param: 'groupBy', path, field: 'calc', fields: ['calc'],
    });
    expect(asSql, 'the dry run vs the query').toEqual(asQuery);
  });

  /** The engine's plain-group refusal of the formula `field` on `object`, at `path`. */
  const plainGroupRefusal = (object: string, field: string, path: string) => ({
    message:
      `aggregate('${object}'): ${path} groups by '${field}', but '${field}' is a formula field — its value is computed `
      + 'on read and never stored, so no driver materialises a column to group by. The query was NOT run. Denormalise '
      + `the value onto '${object}' (a stored field, written when the source changes) and group by that. A formula `
      + 'field is virtual: with no column behind it the group key reached the driver as a column that does not exist, '
      + 'and an engine that aggregates in memory put every row into one null group while the answer looked served.',
    code: 'INVALID_FIELD', status: 400, httpStatus: 400,
    object, param: 'groupBy', path, field, fields: [field],
  });

  it.each<[string, Query, [object: string, field: string, path: string]]>([
    ['an inferred dimension', onObject({ dimensions: ['calc'] }), [DEAL, 'calc', 'groupBy.0']],
    ['after a stored dimension', onObject({ dimensions: ['region', 'calc'] }), [DEAL, 'calc', 'groupBy.1']],
    ["a cube dimension's sql", onCube({ dimensions: ['calc_label'] }), [DEAL, 'calc', 'groupBy.0']],
    // The cross-object path's FK-resolve aggregate on the related object
    // (`groupBy: ['id', attr]`): the engine's position there, judged by the
    // service before the related object is read.
    ["a related object's formula through 'account.'", onObject({ dimensions: ['account.name_calc'] }), [ACCOUNT, 'name_calc', 'groupBy.1']],
  ])('[#29304] refuses a plain group over a formula (%s) on the query and the dry run alike, where native answered 500 and the dry run rendered GROUP BY calc', async (_label, query, expected) => {
    const { asQuery, asSql } = await bothRefusals(query);
    expect(asQuery).toEqual(plainGroupRefusal(...expected));
    expect(asSql, 'the dry run vs the query').toEqual(asQuery);
  });

  it('[#29304] routes only a grouped formula off the native strategy: a stored dimension and a measure-only query stay native', async () => {
    const aggregate = vi.spyOn(engine, 'aggregate');
    try {
      // The default composition answers both on the native strategy, which runs
      // raw SQL and never calls `engine.aggregate`.
      for (const query of [onObject({ dimensions: ['region'] }), onObject({}), onCube({ dimensions: ['region'] })]) {
        const label = JSON.stringify(query);
        const result = await analytics.query({ ...query } as never);
        expect(result.rows, label).toHaveLength(1);
        expect(result.sql, label).toContain('COALESCE(SUM(amount), 0)');
      }
      expect(aggregate, 'native: no engine aggregate').not.toHaveBeenCalled();
      // A grouped formula declines to the ObjectQL strategy, whose engine refuses it.
      await expect(analytics.query({ ...onObject({ dimensions: ['calc'] }) } as never)).rejects.toMatchObject({ code: 'INVALID_FIELD', path: 'groupBy.0' });
      expect(aggregate, 'declined: the engine judged it').toHaveBeenCalledTimes(1);
    } finally {
      aggregate.mockRestore();
    }
  });

  it.each<[string, Query, string]>([
    ["beside a cross-object 'account.name' (its FK column first)", onObject({ dimensions: ['account.name'], timeDimensions: [td('region', 'month')] }), 'groupBy.1.dateGranularity'],
    ['after a raw date column and a datetime bucket', onObject({ dimensions: ['closed_on'], timeDimensions: [td('closed_at', 'month'), td('region', 'month')] }), 'groupBy.2.dateGranularity'],
    ["by a cube dimension's one declared granularity, asked raw", onCube({ dimensions: ['region_month'] }), 'groupBy.0.dateGranularity'],
    ['at a non-UTC zone, where the dry run said the query is served (501)', onObject({ timeDimensions: [td('region', 'month')], timezone: 'America/New_York' }), 'groupBy.0.dateGranularity'],
  ])('refuses a text bucket %s with the query\'s refusal, field for field', async (_label, query, path) => {
    const { asQuery, asSql } = await bothRefusals(query);
    expect(asQuery).toEqual(refusalFor('region', 'text', 'month', path));
    expect(asSql, 'the dry run vs the query').toEqual(asQuery);
  });

  it.each<[string, Query, string]>([
    ['an unrecognised dateRange on the bucket itself', onObject({ timeDimensions: [td('region', 'month', { dateRange: 'not a range' })] }), 'ANALYTICS_DATE_RANGE_UNRECOGNIZED'],
    ['a one-entry dateRange on another entry', onObject({ timeDimensions: [td('region', 'month'), td('closed_at', 'year', { dateRange: ['2026-01-01'] })] }), 'ANALYTICS_DATE_RANGE_UNRECOGNIZED'],
    ['the column asked twice', onObject({ timeDimensions: [td('region', 'month'), td('region', 'year')] }), 'INVALID_QUERY'],
  ])('answers %s before a text bucket, as the query does', async (_label, query, code) => {
    const { asQuery, asSql } = await bothRefusals(query);
    expect(asQuery).toMatchObject({ code, status: 400 });
    expect(asSql, 'the dry run vs the query').toEqual(asQuery);
  });

  it.each<[string, string]>([
    ['date', 'closed_on'],
    ['datetime', 'closed_at'],
  ])('still renders a %s bucket byte for byte, the statement the query echoes', async (_label, column) => {
    const query = onObject({ timeDimensions: [td(column, 'month')] });
    const sql = `SELECT strftime('%Y-%m', \`${column}\`) AS "${column}", SUM(amount) AS "amount_sum" FROM "${DEAL}" `
      + `GROUP BY strftime('%Y-%m', \`${column}\`)`;
    expect(await analytics.generateSql({ ...query } as never)).toEqual({ sql, params: [] });
    expect((await analytics.query({ ...query } as never)).sql).toBe(sql);
  });
});
