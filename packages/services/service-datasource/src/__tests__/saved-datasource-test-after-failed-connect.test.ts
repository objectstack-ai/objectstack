// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27100] Setup → Datasources: what Test answers for a saved datasource whose
 * connect failed.
 *
 * An admin creates a Postgres datasource with a wrong host or password. The
 * create answers `status: 'error'` with the connect failure in `statusReason`.
 * They press Test to find out what is wrong, and Test answered "has no
 * registered driver to introspect": true of the engine's registry (a failed
 * connect registers nothing), and pointing them at installing a driver that is
 * installed.
 *
 * The triage ruling these pins hold: one source of truth. Test answers the
 * datasource's held connect verdict, the same `reason` the admin list and the
 * create answer serve as `statusReason`, in the `{ ok: false, error }` shape
 * Test already uses for a failure. It builds no second message, and the
 * driver-missing sentence stays for a datasource that has no verdict and no
 * driver.
 *
 * Test does not re-attempt the connect, before this change or after it
 * (measured below: the driver factory is not called). A datasource recovers
 * through its edit, which rebuilds the pool, and Test then answers whatever
 * that rebuild left: a fresh failure's own reason, or the live driver.
 *
 * The composition is the real one, end to end: a real `ObjectQL` engine, the
 * real connection service and driver factory (the `pg` client against a closed
 * local port, so the refusal is a deterministic ECONNREFUSED with no network),
 * the real admin service, the real `ExternalDatasourceServicePlugin` wiring,
 * and the real admin routes over a Hono server.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { DatasourceConnectionService } from '../datasource-connection-service.js';
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

/** Nothing listens on port 1: `pg` is refused before any authentication. */
const UNREACHABLE = { url: 'postgres://app@127.0.0.1:1/app' };
const ALSO_UNREACHABLE = { url: 'postgres://app@127.0.0.1:2/app' };

async function boot() {
  const ql = new ObjectQL();
  const factory = createDefaultDatasourceDriverFactory({});
  const build = vi.spyOn(factory, 'create');
  const connection = new DatasourceConnectionService({
    factory: () => factory,
    engine: () => ql as never,
  });
  teardowns.push(() => connection.disconnectAll());

  // The admin plugin's own wiring of the pool seams (`datasource-admin-plugin.ts`):
  // one connect path, degrade-not-throw for a runtime-admin connect.
  const records = new Map<string, StoredDatasource>();
  const admin = new DatasourceAdminService({
    probe: async () => ({ ok: true }),
    listDatasourceRecords: async () => [...records.values()],
    getDatasourceRecord: async (n: string) => records.get(n),
    putDatasourceRecord: async (r: StoredDatasource) => void records.set(r.name, r),
    deleteDatasourceRecord: async (n: string) => void records.delete(n),
    writeSecret: async () => 'unused',
    countBoundObjects: async () => 0,
    listObjectsBoundTo: async () => [],
    registerPool: async (record: StoredDatasource) => {
      await connection.connect(record, { context: { origin: 'runtime', trigger: 'runtime-admin' } });
    },
    unregisterPool: async (name: string) => {
      await connection.disconnect(name);
    },
    reregisterPool: async (previous: StoredDatasource, next: StoredDatasource) => {
      await connection.reconnect(next, { previous, context: { origin: 'runtime', trigger: 'runtime-admin' } });
    },
    connectionStates: () => connection.listConnectionStates(),
  });

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
  const call = async (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://local/api/v1/datasources${path}`, {
        method,
        headers: { authorization: ENTITLED_CREDENTIAL, 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  return { call, connection, build, records };
}

const listed = async (call: Awaited<ReturnType<typeof boot>>['call'], name: string) =>
  (await call('GET', '')).body.data.datasources.find((d: { name: string }) => d.name === name);

describe('Test on a datasource whose connect failed', () => {
  it('answers the connect failure the create reported, never "no registered driver"', async () => {
    const { call } = await boot();

    const created = await call('POST', '', { name: 'crm_pg', driver: 'postgres', config: UNREACHABLE });
    expect(created.status).toBe(201);
    expect(created.body.data.datasource.status).toBe('error');
    const statusReason: string = created.body.data.datasource.statusReason;
    expect(statusReason).toContain('ECONNREFUSED');

    const test = await call('POST', '/crm_pg/test');
    expect(test.status).toBe(200);
    expect(test.body.success).toBe(true);
    // The held verdict, verbatim: one message, the one the create served.
    expect(test.body.data).toEqual({ ok: false, error: statusReason });
    expect(test.body.data.error).not.toContain('no registered driver');
    // …and the one the admin list serves for the same datasource.
    expect((await listed(call, 'crm_pg')).statusReason).toBe(statusReason);
  });

  it('does not re-attempt the connect: Test reads the verdict, the factory is not called', async () => {
    const { call, build } = await boot();
    await call('POST', '', { name: 'crm_pg', driver: 'postgres', config: UNREACHABLE });
    const builds = build.mock.calls.length;

    await call('POST', '/crm_pg/test');
    await call('POST', '/crm_pg/test');

    expect(build.mock.calls.length).toBe(builds);
  });

  it('after an edit that fails again, answers that fresh failure', async () => {
    const { call, connection } = await boot();
    await call('POST', '', { name: 'crm_pg', driver: 'postgres', config: UNREACHABLE });

    const patched = await call('PATCH', '/crm_pg', { config: ALSO_UNREACHABLE });
    expect(patched.status).toBe(200);
    const fresh: string = patched.body.data.datasource.statusReason;
    expect(fresh).toContain('127.0.0.1:2');

    const test = await call('POST', '/crm_pg/test');
    expect(test.body.data).toEqual({ ok: false, error: fresh });
    expect(connection.getConnectionState('crm_pg')?.reason).toBe(fresh);
  });

  it('after an edit that connects, tests through the live driver', async () => {
    const { call } = await boot();
    await call('POST', '', { name: 'crm_pg', driver: 'postgres', config: UNREACHABLE });

    const patched = await call('PATCH', '/crm_pg', { driver: 'sqlite', config: { filename: ':memory:' } });
    expect(patched.body.data.datasource.status).toBe('ok');

    const test = await call('POST', '/crm_pg/test');
    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ ok: true, tableCount: 0 });
  });
});

describe('what does not move', () => {
  it('a datasource with no verdict and no driver keeps the driver-missing sentence', async () => {
    const { call, records } = await boot();
    // Saved, never connected. [#27510] It is a stored record because Test
    // answers a name with no record 404 (`saved-datasource-test-unknown-name.test.ts`).
    records.set('ghost', { name: 'ghost', driver: 'postgres', origin: 'runtime', config: UNREACHABLE });

    const test = await call('POST', '/ghost/test');
    expect(test.status).toBe(200);
    expect(test.body.data.ok).toBe(false);
    expect(test.body.data.error).toContain("Datasource 'ghost' has no registered driver to introspect.");
  });

  it('a connected datasource tests through its driver as before', async () => {
    const { call } = await boot();
    const created = await call('POST', '', { name: 'warehouse', driver: 'sqlite', config: { filename: ':memory:' } });
    expect(created.body.data.datasource.status).toBe('ok');

    const test = await call('POST', '/warehouse/test');
    expect(test.status).toBe(200);
    expect(test.body.data).toMatchObject({ ok: true, tableCount: 0 });
    expect(test.body.data).not.toHaveProperty('error');
  });

  it('a failed rebuild that kept the old pool serving still probes the serving pool', async () => {
    const { call } = await boot();
    await call('POST', '', { name: 'warehouse', driver: 'sqlite', config: { filename: ':memory:' } });

    // The update keeps the previous pool when the rebuild fails (#13804): the
    // verdict is the loud failed one, and the old driver is still registered.
    const patched = await call('PATCH', '/warehouse', { driver: 'postgres', config: UNREACHABLE });
    expect(patched.body.data.datasource.status).toBe('error');
    expect(patched.body.data.datasource.statusReason).toContain('still the one serving');

    const test = await call('POST', '/warehouse/test');
    expect(test.body.data).toMatchObject({ ok: true, tableCount: 0 });
  });
});

describe('only a failed verdict is answered', () => {
  const service = (availability: 'available' | 'blocked' | 'failed' | 'unattempted', reason?: string) =>
    new ExternalDatasourceService({
      introspect: async (n) => {
        throw new Error(`[ObjectQL] Datasource '${n}' has no registered driver to introspect.`);
      },
      liveDriver: () => undefined,
      connectionState: () => ({ availability, ...(reason ? { reason } : {}) }),
      // [#27510] A saved datasource: Test answers a name with no record 404.
      getDatasource: async (name) => ({ name }),
      getObject: async () => undefined,
      listObjects: async () => [],
    });

  it('a blocked or unattempted verdict, or a failed one with no reason, keeps the engine answer', async () => {
    for (const [availability, reason] of [
      ['blocked', 'denied by policy'],
      ['unattempted', 'metadata-only'],
      ['failed', undefined],
    ] as const) {
      const answer = await service(availability, reason).testConnection('crm_pg');
      expect(answer).toEqual({ ok: false, error: "[ObjectQL] Datasource 'crm_pg' has no registered driver to introspect." });
    }
  });

  it('a failed verdict with a reason is answered verbatim', async () => {
    expect(await service('failed', 'connect ECONNREFUSED 127.0.0.1:1').testConnection('crm_pg')).toEqual({
      ok: false,
      error: 'connect ECONNREFUSED 127.0.0.1:1',
    });
  });
});
