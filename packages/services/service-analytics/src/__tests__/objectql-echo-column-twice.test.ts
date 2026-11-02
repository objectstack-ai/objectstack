// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28841] The `/analytics/sql` dry run refuses what `/analytics/query`
 * refuses for one column asked twice under one name, on real SQLite.
 *
 * ## The shape this closes
 *
 * A selection asking one column for two values (two granularities of it, the
 * column raw beside its own bucket, or two spellings of it bucketed twice) is
 * refused by the query: the ObjectQL strategy's dataset door
 * (`dataset-group-column-door.ts`, #28798) judges the keys `execute()` hands
 * the engine, `INVALID_QUERY` / 400. Native declines every bucketed selection
 * to that strategy, so its `generateSql` is the dry run that answers. It built
 * its GROUP BY from its own map of one granularity per dimension and ran no
 * door, so on `main` `7e60dc23` it rendered a statement for each:
 *
 * | selection | the dry run rendered |
 * |:--|:--|
 * | `closed_at` month and year | one `strftime('%Y', …)` bucket (the month entry dropped) |
 * | `closed_at` raw beside `CUBE.closed_at` month | `GROUP BY closed_at, strftime('%Y-%m', …)` |
 * | `closed_day` (over `closed_at`) beside `closed_at` month | the same two columns |
 * | `closed_at` month beside `CUBE.closed_at` year | both buckets |
 * | `account.name` beside `closed_at` month and year | the join, one `year` bucket |
 * | `closed_at` month and year at `America/New_York` | `NOT_IMPLEMENTED` / 501 saying the query is served |
 *
 * It now judges the same keys with the same door before it renders anything
 * (the cross-object path's keys when the selection routes there), so it
 * answers the query's refusal field for field. Every echo the query serves
 * still renders byte for byte (pinned below).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DEAL = 'os28841_deal';
const ACCOUNT = 'os28841_account';
const CUBE = 'os28841_cube';

const CUBES = [
  {
    name: CUBE,
    title: 'Column twice cube',
    sql: DEAL,
    public: true,
    measures: { amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' } },
    dimensions: {
      region: { type: 'string', sql: 'region', label: 'Region' },
      closed_at: { type: 'time', sql: 'closed_at', label: 'Closed at' },
      closed_on: { type: 'time', sql: 'closed_on', label: 'Closed on' },
      closed_day: { type: 'time', sql: 'closed_at', label: 'Closed day' },
    },
  },
] as unknown as Cube[];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Query = Record<string, unknown>;
const td = (dimension: string, granularity: string) => ({ dimension, granularity });
const onCube = (extra: Query): Query => ({ cube: CUBE, measures: ['amount_sum'], ...extra });
/** The inferred cube over the deal object, which serves a lookup path as a cross-object dimension. */
const onObject = (extra: Query): Query => ({ cube: DEAL, measures: ['amount_sum'], ...extra });

describe('[#28841] the /analytics/sql dry run refuses one column asked twice, as the query does', () => {
  let engine: ObjectQL;
  let analytics: AnalyticsService;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({ name: ACCOUNT, label: 'Account', fields: { name: { name: 'name', type: 'text' } } } as never);
    engine.registry.registerObject({
      name: DEAL,
      label: 'Deal',
      fields: {
        region: { name: 'region', type: 'text' },
        amount: { name: 'amount', type: 'number' },
        closed_at: { name: 'closed_at', type: 'datetime' },
        closed_on: { name: 'closed_on', type: 'date' },
        account: { name: 'account', type: 'lookup', reference: ACCOUNT },
      },
    } as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    await engine.insert(ACCOUNT, { id: 'a1', name: 'Acme' } as never);
    await engine.insert(DEAL, { id: 'd1', region: 'amer', amount: 10, closed_at: '2026-03-01T00:00:00.000Z', closed_on: '2026-03-02', account: 'a1' } as never);

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
      object: err.object, param: err.param, path: err.path, fields: err.fields,
    };
  };

  it.each<[string, Query, string]>([
    ['two granularities of one dimension', onCube({ timeDimensions: [td('closed_at', 'month'), td('closed_at', 'year')] }), 'groupBy.1.field'],
    ['a column raw beside its own bucket, spelled CUBE.closed_at', onCube({ dimensions: ['closed_at'], timeDimensions: [td(`${CUBE}.closed_at`, 'month')] }), 'groupBy.1.field'],
    ['a second dimension over the column, raw beside its bucket', onCube({ dimensions: ['closed_day'], timeDimensions: [td('closed_at', 'month')] }), 'groupBy.1.field'],
    ['two spellings of one column at two granularities', onCube({ timeDimensions: [td('closed_at', 'month'), td(`${CUBE}.closed_at`, 'year')] }), 'groupBy.1.field'],
    ['the column raw beside its bucket on the inferred cube', onObject({ dimensions: ['closed_at'], timeDimensions: [td(`${DEAL}.closed_at`, 'month')] }), 'groupBy.1.field'],
    ["two granularities beside a cross-object 'account.name' (its FK column first)", onObject({ dimensions: ['account.name'], timeDimensions: [td('closed_at', 'month'), td('closed_at', 'year')] }), 'groupBy.2.field'],
    ["two granularities beside two dimensions through one relationship (one FK key, so the later position)", onObject({ dimensions: ['account.id', 'account.name'], timeDimensions: [td('closed_at', 'month'), td('closed_at', 'year')] }), 'groupBy.2.field'],
    ['two granularities at a non-UTC zone, where the dry run said the query is served (501)', onCube({ timeDimensions: [td('closed_at', 'month'), td('closed_at', 'year')], timezone: 'America/New_York' }), 'groupBy.1.field'],
  ])('refuses %s with the query\'s refusal, field for field', async (_label, query, path) => {
    const asQuery = await refusalOf('query', analytics.query({ ...query } as never));
    const asSql = await refusalOf('sql', analytics.generateSql({ ...query } as never));
    expect(asQuery).toMatchObject({ code: 'INVALID_QUERY', status: 400, httpStatus: 400, object: DEAL, param: 'groupBy', path, fields: ['closed_at'] });
    expect(asSql, 'the dry run vs the query').toEqual(asQuery);
  });

  it.each<[string, Query, string]>([
    [
      'one bucket of one column',
      onCube({ timeDimensions: [td('closed_at', 'month')] }),
      "SELECT strftime('%Y-%m', `closed_at`) AS \"closed_at\", SUM(amount) AS \"amount_sum\" FROM \"os28841_deal\" "
      + "GROUP BY strftime('%Y-%m', `closed_at`)",
    ],
    [
      'buckets of two columns',
      onCube({ timeDimensions: [td('closed_at', 'month'), td('closed_on', 'year')] }),
      "SELECT strftime('%Y-%m', `closed_at`) AS \"closed_at\", strftime('%Y', `closed_on`) AS \"closed_on\", "
      + "SUM(amount) AS \"amount_sum\" FROM \"os28841_deal\" GROUP BY strftime('%Y-%m', `closed_at`), strftime('%Y', `closed_on`)",
    ],
    [
      'a dimension that is its own bucket, asked twice at one granularity, beside a raw column',
      onCube({ dimensions: ['region', 'closed_at'], timeDimensions: [td('closed_at', 'month'), td('closed_at', 'month')] }),
      "SELECT region AS \"region\", strftime('%Y-%m', `closed_at`) AS \"closed_at\", SUM(amount) AS \"amount_sum\" "
      + "FROM \"os28841_deal\" GROUP BY region, strftime('%Y-%m', `closed_at`)",
    ],
  ])('still renders %s byte for byte, the statement the query echoes', async (_label, query, sql) => {
    const dryRun = await analytics.generateSql({ ...query } as never);
    expect(dryRun).toEqual({ sql, params: [] });
    expect((await analytics.query({ ...query } as never)).sql).toBe(sql);
  });

  it("still renders a cross-object 'account.name' beside one bucket byte for byte", async () => {
    const dryRun = await analytics.generateSql(onObject({ dimensions: ['account.name'], timeDimensions: [td('closed_at', 'month')] }) as never);
    expect(dryRun).toEqual({
      sql: "SELECT \"os28841_account\".\"name\" AS \"account.name\", strftime('%Y-%m', `closed_at`) AS \"closed_at\", "
        + "SUM(amount) AS \"amount_sum\" FROM \"os28841_deal\" LEFT JOIN \"os28841_account\" ON \"os28841_deal\".\"account\" = "
        + "\"os28841_account\".\"id\" GROUP BY \"os28841_account\".\"name\", strftime('%Y-%m', `closed_at`)",
      params: [],
    });
  });

  it('still answers one bucket at a non-UTC zone with the echo refusal, while the query serves it', async () => {
    const query = onCube({ timeDimensions: [td('closed_at', 'month')], timezone: 'America/New_York' });
    expect(await refusalOf('sql', analytics.generateSql({ ...query } as never))).toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
    expect((await analytics.query({ ...query } as never)).rows).toHaveLength(1);
  });
});
