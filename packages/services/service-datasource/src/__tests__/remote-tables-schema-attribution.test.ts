// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `listRemoteTables`' two schema filters — `?schema=` and the datasource's
 * `external.allowedSchemas` — over the introspection the in-tree drivers
 * really produce: BARE table names.
 *
 * Every other fixture for this method writes `mart.fact_orders`-style
 * qualified names, which no in-tree driver emits. Over a qualified fake both
 * filters narrow, so the suites stayed green while, on a real Postgres or
 * SQLite datasource, both filters were skipped for every table:
 * `?schema=sales` answered 200 with the `public` tables, and an allow-list let
 * every table through. The cases below drive the shape the driver produces:
 *
 *  - SQLite, through a REAL `SqlDriver.introspectSchema()` (in-memory). The
 *    driver is imported as a package, so this reads its built `dist/`; the
 *    service is imported relatively, so it reads `src/`.
 *  - Postgres, through a fake holding exactly what the real driver returned
 *    for a database with `public.customers`, `sales.orders` and
 *    `sales.customers` (measured on PostgreSQL 16): on the default search path
 *    the table `customers` alone, and with `searchPath: ['sales']` the tables
 *    `orders` and `customers`, every name bare.
 *
 * A filter in force either narrows or refuses (`400 EXTERNAL_DATASOURCE_ERROR`
 * at both route spellings). The qualified-name producer stays the control: it
 * is still narrowed, never refused.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import type { IntrospectedColumn, IntrospectedSchema, IntrospectedTable } from '@objectstack/spec/contracts';
import { ExternalDatasourceService, type DatasourceLike } from '../external-datasource-service.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

const col = (name: string, primaryKey = false): IntrospectedColumn => ({
  name,
  type: name === 'id' ? 'integer' : 'text',
  nullable: !primaryKey,
  primaryKey,
});

/** The table record the real driver emits: the spec keys plus its key lists. */
type DriverTable = IntrospectedTable & { foreignKeys: unknown[]; primaryKeys: string[] };

const driverTable = (name: string, columns: string[]): DriverTable => ({
  name,
  columns: columns.map((c) => col(c, c === 'id')),
  foreignKeys: [],
  primaryKeys: ['id'],
});

/** The real Postgres introspection on the default search path (`public`). */
const PG_DEFAULT_PATH: IntrospectedSchema = {
  dialect: 'postgres',
  introspectedAt: '2026-10-19T00:00:00.000Z',
  tables: { customers: driverTable('customers', ['id', 'email']) },
};

/** The real Postgres introspection with `searchPath: ['sales']`. */
const PG_SALES_PATH: IntrospectedSchema = {
  dialect: 'postgres',
  introspectedAt: '2026-10-19T00:00:00.000Z',
  tables: {
    orders: driverTable('orders', ['id', 'amount']),
    customers: driverTable('customers', ['id', 'region']),
  },
};

/** The control: a producer that qualifies its names, as the older fixtures do. */
const QUALIFIED: IntrospectedSchema = {
  dialect: 'postgres',
  introspectedAt: '2026-10-19T00:00:00.000Z',
  tables: {
    'public.customers': { name: 'public.customers', columns: [col('id', true), col('email')] },
    'sales.orders': { name: 'sales.orders', columns: [col('id', true), col('amount')] },
    'sales.customers': { name: 'sales.customers', columns: [col('id', true), col('region')] },
  },
};

const DS = 'pg';

function serviceOver(schema: IntrospectedSchema, external?: DatasourceLike['external']) {
  const ds: DatasourceLike = { name: DS, schemaMode: 'external', ...(external ? { external } : {}) };
  return new ExternalDatasourceService({
    introspect: async () => schema,
    getDatasource: async (name) => (name === DS ? ds : undefined),
    getObject: async () => undefined,
    listObjects: async () => [],
  });
}

/** The refusal's envelope fields: the code and status both route spellings serve. */
async function refusalOf(answer: Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  const outcome = await answer.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  expect(outcome).not.toHaveProperty('value');
  return (outcome as { error: Error & { code?: string; status?: number } }).error;
}

const opened: SqlDriver[] = [];

afterEach(async () => {
  while (opened.length) {
    await opened.pop()!.getKnex().destroy();
  }
});

/** A live in-memory SQLite database with two tables, introspected by the real driver. */
async function introspectSqlite(): Promise<IntrospectedSchema> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  } as never);
  opened.push(driver);
  const knex = driver.getKnex();
  await knex.schema.createTable('customers', (t) => {
    t.integer('id').primary();
    t.string('email');
  });
  await knex.schema.createTable('orders', (t) => {
    t.integer('id').primary();
  });
  return driver.introspectSchema();
}

describe('SQLite, through a real SqlDriver introspection (bare names)', () => {
  it('lists every table, with no schema, when no filter is in force', async () => {
    const tables = await serviceOver(await introspectSqlite()).listRemoteTables(DS);
    expect(tables).toEqual([
      { schema: undefined, name: 'customers', columnCount: 2 },
      { schema: undefined, name: 'orders', columnCount: 1 },
    ]);
  });

  it('refuses ?schema= rather than answering the unfiltered list', async () => {
    const err = await refusalOf(serviceOver(await introspectSqlite()).listRemoteTables(DS, { schema: 'main' }));
    expect(err).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(err.message).toContain(`schema 'main'`);
  });

  it('refuses a listing the allow-list cannot narrow', async () => {
    const err = await refusalOf(serviceOver(await introspectSqlite(), { allowedSchemas: ['main'] }).listRemoteTables(DS));
    expect(err).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(err.message).toContain('external.allowedSchemas');
  });
});

describe('Postgres, through a fake shaped like the real driver introspection (bare names)', () => {
  it('?schema=sales no longer answers the public tables: it refuses', async () => {
    const err = await refusalOf(serviceOver(PG_DEFAULT_PATH).listRemoteTables(DS, { schema: 'sales' }));
    expect(err).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(err.message).toContain(`schema 'sales'`);
  });

  it('refuses even when every table is in fact in the requested schema, because the listing cannot say so', async () => {
    const err = await refusalOf(serviceOver(PG_SALES_PATH).listRemoteTables(DS, { schema: 'sales' }));
    expect(err).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
  });

  it('an allow-list refuses the listing instead of letting every table through', async () => {
    const err = await refusalOf(serviceOver(PG_SALES_PATH, { allowedSchemas: ['public'] }).listRemoteTables(DS));
    expect(err).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(err.message).toContain('external.allowedSchemas');
  });

  it('answers an empty list where no table can pass whatever its schema', async () => {
    expect(await serviceOver(PG_SALES_PATH, { allowedSchemas: [] }).listRemoteTables(DS)).toEqual([]);
    expect(
      await serviceOver(PG_SALES_PATH, { allowedSchemas: ['public'] }).listRemoteTables(DS, { schema: 'sales' }),
    ).toEqual([]);
  });

  it('lists every table when no filter is in force', async () => {
    expect(await serviceOver(PG_SALES_PATH).listRemoteTables(DS)).toEqual([
      { schema: undefined, name: 'orders', columnCount: 2 },
      { schema: undefined, name: 'customers', columnCount: 2 },
    ]);
  });
});

describe('control: a producer that qualifies its names is narrowed, as before', () => {
  it('?schema= narrows to that schema', async () => {
    const tables = await serviceOver(QUALIFIED).listRemoteTables(DS, { schema: 'sales' });
    expect(tables.map((t) => `${t.schema}.${t.name}`)).toEqual(['sales.orders', 'sales.customers']);
  });

  it('the allow-list narrows, and combines with ?schema=', async () => {
    const svc = serviceOver(QUALIFIED, { allowedSchemas: ['public', 'sales'] });
    expect((await serviceOver(QUALIFIED, { allowedSchemas: ['public'] }).listRemoteTables(DS)).map((t) => t.name)).toEqual([
      'customers',
    ]);
    expect((await svc.listRemoteTables(DS, { schema: 'public' })).map((t) => `${t.schema}.${t.name}`)).toEqual([
      'public.customers',
    ]);
  });

  it('one bare name among qualified ones is enough to refuse a filter', async () => {
    const mixed: IntrospectedSchema = {
      ...QUALIFIED,
      tables: { ...QUALIFIED.tables, audit_log: { name: 'audit_log', columns: [col('id', true)] } },
    };
    const err = await refusalOf(serviceOver(mixed).listRemoteTables(DS, { schema: 'sales' }));
    expect(err).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(err.message).toContain(`'audit_log'`);
  });
});

describe('GET /api/v1/datasources/:name/remote-tables answers the refusal in the registered envelope', () => {
  const authService = createSessionAuthService();
  const grantsEngine = createGrantsEngine();

  function mount(service: ExternalDatasourceService) {
    const server = new HonoHttpServer(0);
    const ctx = {
      getService: (name: string) => {
        if (name === 'auth') return authService;
        if (name === 'objectql' || name === 'data') return grantsEngine;
        if (name === 'external-datasource') return service;
        throw new Error(`no service: ${name}`);
      },
    } as never;
    registerDatasourceAdminRoutes(server, ctx, '/api/v1');
    return server.getRawApp();
  }

  const get = (path: string) =>
    new Request(`http://local${path}`, { headers: { authorization: ENTITLED_CREDENTIAL } });

  it('?schema=sales over the Postgres shape is a 400 EXTERNAL_DATASOURCE_ERROR, not a 200 with the public tables', async () => {
    const app = mount(serviceOver(PG_DEFAULT_PATH));

    const refused = await app.fetch(get(`/api/v1/datasources/${DS}/remote-tables?schema=sales`));
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');

    const listed = await app.fetch(get(`/api/v1/datasources/${DS}/remote-tables`));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      success: true,
      data: { tables: [{ name: 'customers', columnCount: 2 }] },
    });
  });
});
