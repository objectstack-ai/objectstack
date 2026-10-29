// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Sync doors on a name that resolves no saved datasource.
 *
 * `GET /datasources/:name/remote-tables` and `POST /datasources/:name/object-draft`
 * answered an unknown name `400 EXTERNAL_DATASOURCE_ERROR` with the federation
 * lecture ("has no datasource definition, so nothing declares it a federation
 * source: ADR-0015 reserves federation …"), while `GET /datasources/:name`
 * answered the same name `404 RESOURCE_NOT_FOUND`. That told an admin tool,
 * script or AI caller its request was malformed, or that it should re-declare
 * the datasource `external`, when the datasource does not exist.
 *
 * The triage ruling these pins hold: a name with no definition is the one
 * shared `404` every by-name door answers; a definition that is not a
 * federation source keeps its `400` (a managed datasource, and the platform's
 * primary one).
 *
 * The composition is the real one, end to end, as in
 * `saved-datasource-test-unknown-name.test.ts`: a real `ObjectQL` engine, the
 * real connection service, the real admin service, the real
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
 * The saved datasources. `warehouse` is managed (it declares no `schemaMode`,
 * and `managed` is the default), so it exists and is not a federation source.
 * The primary datasource has no record, as `DefaultDatasourcePlugin.init()`
 * leaves it.
 */
const RECORDS: StoredDatasource[] = [{ name: 'warehouse', driver: 'memory', origin: 'runtime', config: {} }];

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

  return { call };
}

type Call = Awaited<ReturnType<typeof boot>>['call'];

/** The two Sync doors, each addressing `name`. */
const SYNC_DOORS: Array<[door: string, ask: (call: Call, name: string) => ReturnType<Call>]> = [
  ['GET /datasources/:name/remote-tables', (call, name) => call('GET', `/${name}/remote-tables`)],
  ['POST /datasources/:name/object-draft', (call, name) => call('POST', `/${name}/object-draft`, { table: 'orders' })],
];

describe('the Sync doors on a name that resolves no saved datasource', () => {
  it.each(SYNC_DOORS)('%s answers what GET /datasources/:name answers: 404 RESOURCE_NOT_FOUND', async (_door, ask) => {
    const { call } = await boot();

    const read = await call('GET', '/no_such_ds');
    const answer = await ask(call, 'no_such_ds');

    expect({ status: read.status, code: read.body.error?.code }).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    expect({
      status: answer.status,
      success: answer.body.success,
      code: answer.body.error?.code,
      message: answer.body.error?.message,
    }).toEqual({ status: 404, success: false, code: 'RESOURCE_NOT_FOUND', message: read.body.error.message });
    expect(answer.body).not.toHaveProperty('data');
  });
});

describe('the Sync doors on a datasource that exists and is not a federation source', () => {
  it.each(SYNC_DOORS)('%s still refuses a managed datasource 400 EXTERNAL_DATASOURCE_ERROR', async (_door, ask) => {
    const { call } = await boot();

    const answer = await ask(call, 'warehouse');

    expect({ status: answer.status, code: answer.body.error?.code }).toEqual({
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
    });
    expect(answer.body.error.message).toContain("Datasource 'warehouse' is managed");
  });

  it.each(SYNC_DOORS)('%s still refuses the primary datasource 400 EXTERNAL_DATASOURCE_ERROR', async (_door, ask) => {
    const { call } = await boot();

    const answer = await ask(call, DEFAULT_DATASOURCE_NAME);

    expect({ status: answer.status, code: answer.body.error?.code }).toEqual({
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
    });
    expect(answer.body.error.message).toContain("is the platform's managed primary datasource");
  });
});
