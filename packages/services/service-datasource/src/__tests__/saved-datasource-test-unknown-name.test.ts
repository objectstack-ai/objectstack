// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /datasources/:name/test` on a name that resolves no saved datasource.
 *
 * Every other by-name door answers an unknown name `404 RESOURCE_NOT_FOUND`
 * (`datasource-unknown-name.test.ts` holds the four `datasource-admin` ones).
 * Test answered it `200 { ok: false }` with the engine's "has no registered
 * driver to introspect" sentence, which is the answer it gives a saved
 * datasource that is down. An admin tool or script testing a datasource by
 * name could not tell "this datasource is down" from "this datasource does not
 * exist".
 *
 * The triage ruling these pins hold: resolve the saved name with the lookup
 * the sibling routes use and answer `RESOURCE_NOT_FOUND`; keep `{ ok: false }`
 * for a datasource that exists and fails its probe. Two controls ride along:
 * a saved datasource that is up still answers `ok: true`, and the platform's
 * primary datasource, which may have no stored record, is still tested through
 * its live driver.
 *
 * The composition is the real one, end to end: a real `ObjectQL` engine, the
 * real connection service and driver factory, the real admin service, the real
 * `ExternalDatasourceServicePlugin` wiring, and the real admin routes over a
 * Hono server. Both services read the same stored records, as the two plugins
 * do (`metadata.get('datasource', name)`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { DatasourceConnectionService, DEFAULT_DATASOURCE_NAME } from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import { ExternalDatasourceServicePlugin } from '../plugin.js';
import { ExternalDatasourceService } from '../external-datasource-service.js';
import { DatasourceAdminService, type StoredDatasource } from '../datasource-admin-service.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { ENTITLED_CREDENTIAL, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';

const teardowns: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const t of teardowns.splice(0)) await t();
});

/**
 * The saved datasources. `warehouse` is connected; `offline` is saved but has
 * no live driver (nothing connected it), so its probe fails. The primary
 * datasource has NO record here: it is connected `asDefault`, as
 * `DefaultDatasourcePlugin.init()` does, and nothing stores it.
 */
const RECORDS: StoredDatasource[] = [
  { name: 'warehouse', driver: 'memory', origin: 'runtime', config: {} },
  { name: 'offline', driver: 'memory', origin: 'runtime', config: {} },
];

async function boot() {
  const ql = new ObjectQL();
  const connection = new DatasourceConnectionService({
    factory: () => createDefaultDatasourceDriverFactory({}),
    engine: () => ql as never,
  });
  teardowns.push(() => connection.disconnectAll());

  await connection.connect(
    { name: DEFAULT_DATASOURCE_NAME, driver: 'memory', config: {}, origin: 'code', bootCritical: true },
    { asDefault: true, context: { origin: 'code', trigger: 'declared-auto' } },
  );
  await connection.connect(RECORDS[0], { context: { origin: 'runtime', trigger: 'runtime-admin' } });

  const records = new Map(RECORDS.map((r) => [r.name, r]));
  const admin = new DatasourceAdminService({
    listDatasourceRecords: async () => [...records.values()],
    getDatasourceRecord: async (n: string) => records.get(n),
    connectionStates: () => connection.listConnectionStates(),
  } as never);

  const services = new Map<string, unknown>([
    ['data', ql],
    ['metadata', { get: async (type: string, n: string) => (type === 'datasource' ? records.get(n) : undefined) }],
    ['datasource-connection', connection],
  ]);
  await new ExternalDatasourceServicePlugin().init({
    getService: (n: string) => {
      if (!services.has(n)) throw new Error(`no service: ${n}`);
      return services.get(n);
    },
    registerService: (n: string, s: unknown) => void services.set(n, s),
  } as never);
  const external = services.get('external-datasource') as ExternalDatasourceService;

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
  const call = async (method: 'GET' | 'POST', path: string) => {
    const res = await app.fetch(
      new Request(`http://local/api/v1/datasources${path}`, {
        method,
        headers: { authorization: ENTITLED_CREDENTIAL, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  return { call, records };
}

describe('POST /datasources/:name/test on a name that resolves no saved datasource', () => {
  it('answers 404 RESOURCE_NOT_FOUND naming the datasource, not 200 { ok: false }', async () => {
    const { call } = await boot();

    const test = await call('POST', '/no_such_ds/test');

    expect({ status: test.status, success: test.body.success, code: test.body.error?.code }).toEqual({
      status: 404,
      success: false,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(test.body.error.message).toContain('no_such_ds');
    expect(test.body).not.toHaveProperty('data');
  });

  it('gives the answer GET /datasources/:name gives the same name: status, code and message', async () => {
    const { call } = await boot();

    const read = await call('GET', '/no_such_ds');
    const test = await call('POST', '/no_such_ds/test');

    expect(read.status).toBe(404);
    expect({ status: test.status, code: test.body.error?.code, message: test.body.error?.message }).toEqual({
      status: read.status,
      code: read.body.error.code,
      message: read.body.error.message,
    });
  });
});

describe('POST /datasources/:name/test on a datasource that exists', () => {
  it('a saved datasource that fails its probe still answers 200 { ok: false, error }', async () => {
    const { call } = await boot();

    const test = await call('POST', '/offline/test');

    expect(test.status).toBe(200);
    expect(test.body.data.ok).toBe(false);
    expect(typeof test.body.data.error).toBe('string');
    expect(test.body.data.error).toContain('offline');
  });

  it('a saved datasource that is up still answers 200 { ok: true }', async () => {
    const { call } = await boot();

    const test = await call('POST', '/warehouse/test');

    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ ok: true });
  });

  it('the primary datasource with no stored record is still tested through its live driver', async () => {
    const { call, records } = await boot();
    expect(records.has(DEFAULT_DATASOURCE_NAME)).toBe(false);

    const test = await call('POST', `/${DEFAULT_DATASOURCE_NAME}/test`);

    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ ok: true });
    expect(typeof test.body.data.latencyMs).toBe('number');
  });
});
