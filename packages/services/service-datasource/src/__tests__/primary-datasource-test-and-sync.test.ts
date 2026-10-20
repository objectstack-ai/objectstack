// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24772] Setup → Datasources: what Test and Sync answer for the platform's
 * PRIMARY datasource (`default`) and for a driver that cannot introspect.
 *
 * The page lists `default` as connected. That is true: `DefaultDatasourcePlugin`
 * connects it through `DatasourceConnectionService` with `asDefault`, and
 * ADR-0062 keeps its driver under the driver's NATURAL name, so the engine's
 * registry has no entry called `default`. Test and Sync both introspected by
 * the datasource name and answered "has no registered driver to introspect":
 * Test `200 { ok: false }`, Sync `400`. A connected `memory` datasource got
 * the same `ok: false` from Test, because its driver has no `introspectSchema`.
 *
 * The seat's ruling (route D) is what these pins hold:
 *
 *  - Test answers truthfully for both. The primary datasource's driver is
 *    found by the resolver `DatasourceConnectionService.disconnect` already
 *    applies (`registeredDriverName`), and a driver that cannot introspect says
 *    so instead of failing.
 *  - Sync on `default` keeps refusing with the SAME status and code, and now
 *    gives the true reason: the primary datasource is the platform's managed
 *    storage, not a federation source (ADR-0015 §1). It never introspects the
 *    platform database.
 *  - Nothing else moves: a managed runtime datasource still tests and syncs
 *    as before, and a datasource with no live driver still answers `ok: false`.
 *
 * The composition is the real one, end to end: a real `ObjectQL` engine (its
 * source, through this package's vitest alias), the real connection service
 * and driver factory, the real `ExternalDatasourceServicePlugin` wiring, and
 * the real admin routes over a Hono server. The SQL and memory drivers are
 * imported by the factory as packages, so they are their built `dist/`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import type { IDataDriver } from '@objectstack/spec/contracts';
import {
  DatasourceConnectionService,
  DEFAULT_DATASOURCE_NAME,
  registeredDriverName,
} from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import { ExternalDatasourceServicePlugin } from '../plugin.js';
import { ExternalDatasourceService } from '../external-datasource-service.js';
import { DatasourceAdminService } from '../datasource-admin-service.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { ENTITLED_CREDENTIAL, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';

const teardowns: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const t of teardowns.splice(0)) await t();
});

type Knex = { schema: { createTable(n: string, cb: (t: never) => void): Promise<void> } };
type Table = { string(n: string): { primary(): void } };

/**
 * The page's composition: the primary datasource connected `asDefault` (the
 * `DefaultDatasourcePlugin.init()` call, verbatim), a managed runtime SQLite
 * datasource like the one the tester created, and a runtime `memory` one.
 */
async function boot() {
  const ql = new ObjectQL();
  const connection = new DatasourceConnectionService({
    factory: () => createDefaultDatasourceDriverFactory({}),
    engine: () => ql as never,
  });
  teardowns.push(() => connection.disconnectAll());

  await connection.connect(
    { name: 'default', label: 'Default', driver: 'sqlite', config: { filename: ':memory:' }, origin: 'code', bootCritical: true },
    { asDefault: true, context: { origin: 'code', trigger: 'declared-auto' } },
  );
  await connection.connect(
    { name: 'warehouse', driver: 'sqlite', config: { filename: ':memory:' }, origin: 'runtime' },
    { context: { origin: 'runtime', trigger: 'runtime-admin' } },
  );
  await connection.connect(
    { name: 'scratch', driver: 'memory', config: {}, origin: 'runtime' },
    { context: { origin: 'runtime', trigger: 'runtime-admin' } },
  );

  const primary = ql.getDriverByName(ql.getDefaultDriverName()!) as IDataDriver & { getKnex(): Knex };
  await primary.getKnex().schema.createTable('acct', (t) => (t as unknown as Table).string('id').primary());
  const warehouse = ql.getDriverByName('warehouse') as IDataDriver & { getKnex(): Knex };
  await warehouse.getKnex().schema.createTable('orders', (t) => (t as unknown as Table).string('id').primary());

  const services = new Map<string, unknown>([['data', ql]]);
  await new ExternalDatasourceServicePlugin().init({
    getService: (n: string) => {
      if (!services.has(n)) throw new Error(`no service: ${n}`);
      return services.get(n);
    },
    registerService: (n: string, s: unknown) => void services.set(n, s),
  } as never);
  const external = services.get('external-datasource') as ExternalDatasourceService;

  const admin = new DatasourceAdminService({
    listDatasourceRecords: async () => [
      { name: 'default', driver: 'sqlite', origin: 'code', config: {} },
      { name: 'warehouse', driver: 'sqlite', origin: 'runtime', config: {} },
      { name: 'scratch', driver: 'memory', origin: 'runtime', config: {} },
    ],
    connectionStates: () => connection.listConnectionStates(),
  } as never);

  const server = new HonoHttpServer(0);
  const authService = createSessionAuthService();
  const grantsEngine = createGrantsEngine();
  registerDatasourceAdminRoutes(
    server,
    {
      getService: (n: string) => {
        if (n === 'auth') return authService;
        if (n === 'objectql' || n === 'data') return grantsEngine;
        if (n === 'external-datasource') return external;
        if (n === 'datasource-admin') return admin;
        throw new Error(`no service: ${n}`);
      },
    } as never,
    '/api/v1',
  );
  const app = server.getRawApp();
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://local/api/v1/datasources${path}`, {
        method,
        headers: { authorization: ENTITLED_CREDENTIAL, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  return { ql, connection, external, primary, call };
}

/** The refusal a service method threw: its envelope fields (ADR-0112). */
async function thrown(answer: Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  const outcome = await answer.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  expect(outcome).not.toHaveProperty('value');
  return (outcome as { error: Error & { code?: string; status?: number } }).error;
}

const NOT_A_FEDERATION_SOURCE = "Datasource 'default' is the platform's managed primary datasource, not a federation source";

describe('the primary datasource: Test agrees with the "connected" the page lists', () => {
  it('Test answers ok through the live driver, and does not introspect the platform database', async () => {
    const { call, primary } = await boot();
    const introspect = vi.spyOn(primary, 'introspectSchema' as never);

    const list = await call('GET', '');
    expect(list.status).toBe(200);
    expect(list.body.data.datasources.find((d: { name: string }) => d.name === 'default').status).toBe('ok');

    const test = await call('POST', '/default/test');
    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ ok: true });
    expect(typeof test.body.data.latencyMs).toBe('number');
    expect(test.body.data).not.toHaveProperty('error');
    // The primary datasource is not a federation source: Test asks the driver
    // whether it is connected, never lists the platform's tables to find out.
    expect(test.body.data).not.toHaveProperty('tableCount');
    expect(introspect).not.toHaveBeenCalled();
  });
});

describe('the primary datasource: Sync refuses as before, with the true reason', () => {
  it('remote-tables and object-draft keep 400 EXTERNAL_DATASOURCE_ERROR, and never introspect it', async () => {
    const { call, primary } = await boot();
    const introspect = vi.spyOn(primary, 'introspectSchema' as never);

    const tables = await call('GET', '/default/remote-tables');
    expect(tables.status).toBe(400);
    expect(tables.body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(tables.body.error.message).toContain(NOT_A_FEDERATION_SOURCE);
    expect(tables.body.error.message).not.toContain('no registered driver');

    const draft = await call('POST', '/default/object-draft', { table: 'acct' });
    expect(draft.status).toBe(400);
    expect(draft.body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(draft.body.error.message).toContain(NOT_A_FEDERATION_SOURCE);

    expect(introspect).not.toHaveBeenCalled();
  });

  it('the import and the catalog refresh refuse it with the code their doors serve', async () => {
    const { external } = await boot();

    expect(await thrown(external.listRemoteTables('default'))).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(await thrown(external.generateObjectDraft('default', 'acct'))).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    expect(await thrown(external.refreshCatalog('default'))).toMatchObject({ code: 'EXTERNAL_DATASOURCE_ERROR', status: 400 });
    const imported = await thrown(external.importObject('default', 'acct'));
    expect(imported).toMatchObject({ code: 'EXTERNAL_IMPORT_ERROR', status: 400 });
    expect(imported.message).toContain(NOT_A_FEDERATION_SOURCE);
  });
});

describe('a driver with no introspectSchema', () => {
  it('Test answers connected and says introspection is unsupported, instead of ok: false', async () => {
    const { call } = await boot();

    const test = await call('POST', '/scratch/test');
    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ ok: true, introspection: 'unsupported' });
    expect(test.body.data).not.toHaveProperty('error');
  });

  it('a registered driver that fails its health check is not reported connected', async () => {
    const service = (checkHealth: () => Promise<boolean>) =>
      new ExternalDatasourceService({
        introspect: async () => {
          throw new Error('introspect must not be reached');
        },
        liveDriver: () => ({ checkHealth }),
        getDatasource: async () => undefined,
        getObject: async () => undefined,
        listObjects: async () => [],
      });

    const unhealthy = await service(async () => false).testConnection('scratch');
    expect(unhealthy.ok).toBe(false);
    expect(unhealthy.error).toContain('health check');

    const throwing = await service(async () => {
      throw new Error('ECONNREFUSED');
    }).testConnection('scratch');
    expect(throwing).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });
});

describe('nothing else moves', () => {
  it('a managed runtime datasource tests and syncs exactly as before', async () => {
    const { call } = await boot();

    const test = await call('POST', '/warehouse/test');
    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ ok: true, tableCount: 1 });
    expect(test.body.data).not.toHaveProperty('introspection');

    const tables = await call('GET', '/warehouse/remote-tables');
    expect(tables.status).toBe(200);
    expect(tables.body.data.tables.map((t: { name: string }) => t.name)).toEqual(['orders']);
  });

  it('Sync on a driver that cannot introspect still refuses with the engine reason', async () => {
    const { call } = await boot();

    const tables = await call('GET', '/scratch/remote-tables');
    expect(tables.status).toBe(400);
    expect(tables.body.error.code).toBe('EXTERNAL_DATASOURCE_ERROR');
    expect(tables.body.error.message).toContain('does not support introspectSchema()');
  });

  it('a datasource with no live driver still answers ok: false', async () => {
    const { call } = await boot();

    const test = await call('POST', '/ghost/test');
    expect(test.status).toBe(200);
    expect(test.body.data.ok).toBe(false);
    expect(test.body.data.error).toContain("Datasource 'ghost' has no registered driver");
  });
});

describe('registeredDriverName — the one spelling of the ADR-0062 default-driver rule', () => {
  const engine = { getDefaultDriverName: () => 'com.objectstack.driver.sql' };

  it('resolves the reserved name to the default driver, and every other name to itself', () => {
    expect(DEFAULT_DATASOURCE_NAME).toBe('default');
    expect(registeredDriverName(engine, 'default')).toBe('com.objectstack.driver.sql');
    expect(registeredDriverName(engine, 'warehouse')).toBe('warehouse');
  });

  it('honours an explicit flag either way, as disconnect() passes its own', () => {
    expect(registeredDriverName(engine, 'default', false)).toBe('default');
    expect(registeredDriverName(engine, 'analytics', true)).toBe('com.objectstack.driver.sql');
    expect(registeredDriverName(undefined, 'default')).toBeUndefined();
  });
});
