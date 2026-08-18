// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';

/**
 * End-to-end routing test against the REAL `HonoHttpServer` adapter — the same
 * IHttpServer implementation `os serve` mounts. We exercise the routes via
 * `getRawApp().fetch(...)` (no socket bind needed), proving the wiring path the
 * serve composition root relies on: routes mount on `IHttpServer` and dispatch
 * to whatever object the plugin context resolves for the `datasource-admin`
 * service.
 */

/**
 * The credential every request in this file carries, and the fake `auth`
 * service that admits it.
 *
 * This family requires authentication (#9391), so a fixture that presented no
 * identity would answer 401 to every case below — a suite measuring the guard
 * instead of the routing and failure-attribution it exists to measure. The
 * guard itself has its own both-sides pin, `admin-routes-auth-guard.test.ts`;
 * here an authenticated caller is the premise, not the subject.
 */
const SESSION = 'Bearer test-session';
const authService = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) =>
      headers?.get?.('authorization') === SESSION ? { user: { id: 'u_test' } } : null,
  },
};

/**
 * Wrap a `getService` so `auth` resolves to the fake above and every other
 * lookup keeps the behaviour the case under test wired — including throwing,
 * which is what drives the resolver's catch arm.
 */
const withAuth = (getService: (name: string) => unknown) =>
  vi.fn((name: string) => (name === 'auth' ? authService : getService(name)));

const json = (path: string, init?: RequestInit) =>
  new Request(`http://local${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: SESSION,
      ...(init?.headers ?? {}),
    },
  });

function mount(svc: unknown) {
  const server = new HonoHttpServer(0);
  const ctx = { getService: withAuth(() => svc) } as any;
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return server.getRawApp();
}

/**
 * Mount with a service PER NAME, unlike `mount` above, which answers the same
 * object for every lookup.
 *
 * That difference is the point: this module dispatches to two services, and a
 * context that cannot tell them apart cannot show which one a route resolved.
 * It is what let #4225 sit here — the 503 named `datasource-admin` on all nine
 * routes, three of which resolve `external-datasource`, and no test could see it.
 */
function mountServices(services: Record<string, unknown>) {
  const server = new HonoHttpServer(0);
  const ctx = { getService: withAuth((name: string) => services[name]) } as any;
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return server.getRawApp();
}

describe('registerDatasourceAdminRoutes (real HonoHttpServer)', () => {
  it('GET /api/v1/datasources returns the service listing', async () => {
    const listDatasources = vi.fn().mockResolvedValue([
      { name: 'pg', origin: 'runtime', health: 'ok' },
    ]);
    const app = mount({ listDatasources });

    const res = await app.fetch(json('/api/v1/datasources'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { datasources: [{ name: 'pg', origin: 'runtime', health: 'ok' }] },
    });
    expect(listDatasources).toHaveBeenCalledOnce();
  });

  it('GET /api/v1/datasources/drivers returns the driver catalog with configSchema', async () => {
    const app = mount({}); // no service dependency — static catalog
    const res = await app.fetch(json('/api/v1/datasources/drivers'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { drivers: Array<{ id: string; label: string; configSchema: any }> } };
    expect(Array.isArray(body.data.drivers)).toBe(true);
    const sqlite = body.data.drivers.find((d) => d.id === 'sqlite');
    expect(sqlite).toBeTruthy();
    expect(sqlite!.label).toBe('SQLite');
    expect(sqlite!.configSchema?.properties?.filename?.type).toBe('string');
  });

  it('GET /api/v1/datasources/:name/remote-tables lists remote tables', async () => {
    const listRemoteTables = vi.fn().mockResolvedValue([{ name: 'customers', columnCount: 4 }]);
    const app = mount({ listRemoteTables });
    const res = await app.fetch(json('/api/v1/datasources/demo_ext/remote-tables'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { tables: [{ name: 'customers', columnCount: 4 }] } });
    // No `?schema=` ⇒ the options bag carries no filter (#7955). The bag itself
    // is always passed; `{ schema: undefined }` is what the service reads as
    // "unfiltered", and it is the same value the federation twin hands it.
    expect(listRemoteTables).toHaveBeenCalledWith('demo_ext', { schema: undefined });
  });

  // The forwarding half of #7955 at THIS spelling. The cross-package half —
  // that the two spellings answer the same SET — is
  // `packages/rest/src/remote-tables-twin.equivalence.test.ts`, which has to
  // live where both registrars are reachable; this case is what fails first if
  // the query stops being read here at all.
  it('GET /api/v1/datasources/:name/remote-tables forwards ?schema= to the service', async () => {
    const listRemoteTables = vi.fn().mockResolvedValue([]);
    const app = mount({ listRemoteTables });
    const res = await app.fetch(json('/api/v1/datasources/demo_ext/remote-tables?schema=public'));
    expect(res.status).toBe(200);
    expect(listRemoteTables).toHaveBeenCalledWith('demo_ext', { schema: 'public' });
  });

  it('POST /api/v1/datasources/:name/object-draft generates a draft (400 without table)', async () => {
    const generateObjectDraft = vi.fn().mockResolvedValue({ name: 'customers', definition: { fields: { id: {} } } });
    const app = mount({ generateObjectDraft });

    const missing = await app.fetch(json('/api/v1/datasources/demo_ext/object-draft', { method: 'POST', body: JSON.stringify({}) }));
    expect(missing.status).toBe(400);

    const ok = await app.fetch(json('/api/v1/datasources/demo_ext/object-draft', { method: 'POST', body: JSON.stringify({ table: 'customers' }) }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).data.draft.name).toBe('customers');
    expect(generateObjectDraft).toHaveBeenCalledWith('demo_ext', 'customers', {});
  });

  it('GET /api/v1/datasources/:name returns the credential-stripped detail (404 when unknown)', async () => {
    const getDatasource = vi.fn(async (name: string) =>
      name === 'demo_ext'
        ? { name: 'demo_ext', driver: 'sqlite', schemaMode: 'managed', config: { filename: '/tmp/x.db' }, active: true, origin: 'runtime', hasSecret: false }
        : undefined,
    );
    const app = mount({ getDatasource });
    const ok = await app.fetch(json('/api/v1/datasources/demo_ext'));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).data.datasource.config.filename).toBe('/tmp/x.db');
    const missing = await app.fetch(json('/api/v1/datasources/nope'));
    expect(missing.status).toBe(404);
    expect(getDatasource).toHaveBeenCalledWith('demo_ext');
  });

  it('POST /api/v1/datasources/:name/test probes a saved datasource by name', async () => {
    const testConnection = vi.fn().mockResolvedValue({ ok: true, latencyMs: 7, tableCount: 2 });
    const app = mount({ testConnection });
    const res = await app.fetch(json('/api/v1/datasources/demo_ext/test', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { ok: true, latencyMs: 7, tableCount: 2 } });
    expect(testConnection).toHaveBeenCalledWith('demo_ext');
  });

  it('POST /api/v1/datasources/test splits the inline secret out of the draft', async () => {
    const testConnection = vi.fn().mockResolvedValue({ ok: true });
    const app = mount({ testConnection });

    const res = await app.fetch(
      json('/api/v1/datasources/test', {
        method: 'POST',
        body: JSON.stringify({ name: 'pg', driver: 'postgres', secret: 's3cr3t' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { result: { ok: true } } });
    // draft must NOT carry the secret; secret is normalised to { value }.
    expect(testConnection).toHaveBeenCalledWith(
      { name: 'pg', driver: 'postgres' },
      { value: 's3cr3t' },
    );
  });

  it('POST /api/v1/datasources creates a runtime datasource (201)', async () => {
    const createDatasource = vi.fn().mockResolvedValue({ name: 'pg', origin: 'runtime' });
    const app = mount({ createDatasource });

    const res = await app.fetch(
      json('/api/v1/datasources', {
        method: 'POST',
        body: JSON.stringify({ name: 'pg', driver: 'postgres' }),
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: { datasource: { name: 'pg', origin: 'runtime' } } });
  });

  it('degrades to 503 when the service registry THROWS, not just when it answers undefined', async () => {
    // The other arm of the resolver's try/catch. `getService` throwing on an
    // unregistered name is the shape a real `PluginContext` has; every mock in
    // this file returns `undefined` instead, so nothing else drives this branch.
    const server = new HonoHttpServer(0);
    const ctx = {
      getService: withAuth(() => {
        throw new Error('service "datasource-admin" is not registered');
      }),
    } as any;
    registerDatasourceAdminRoutes(server, ctx, '/api/v1');

    const res = await server.getRawApp().fetch(json('/api/v1/datasources'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The datasource-admin service is not available.',
      },
    });
  });

  /**
   * #4225 — the 503 names the service the route ACTUALLY resolves.
   *
   * Every route below is listed with the service it dispatches to, so the table
   * is the module's service map as well as its test: a new route that resolves
   * one service and reports the other has to disagree with a row here.
   */
  const UNAVAILABLE: Array<{ route: string; service: string; run: (app: any) => Promise<Response> }> = [
    { route: 'GET /datasources', service: 'datasource-admin', run: (a) => a.fetch(json('/api/v1/datasources')) },
    { route: 'GET /datasources/:name', service: 'datasource-admin', run: (a) => a.fetch(json('/api/v1/datasources/pg')) },
    { route: 'POST /datasources/test', service: 'datasource-admin', run: (a) => a.fetch(json('/api/v1/datasources/test', { method: 'POST', body: '{}' })) },
    { route: 'POST /datasources', service: 'datasource-admin', run: (a) => a.fetch(json('/api/v1/datasources', { method: 'POST', body: '{}' })) },
    { route: 'PATCH /datasources/:name', service: 'datasource-admin', run: (a) => a.fetch(json('/api/v1/datasources/pg', { method: 'PATCH', body: '{}' })) },
    { route: 'DELETE /datasources/:name', service: 'datasource-admin', run: (a) => a.fetch(json('/api/v1/datasources/pg', { method: 'DELETE' })) },
    { route: 'GET /datasources/:name/remote-tables', service: 'external-datasource', run: (a) => a.fetch(json('/api/v1/datasources/ext/remote-tables')) },
    { route: 'POST /datasources/:name/test', service: 'external-datasource', run: (a) => a.fetch(json('/api/v1/datasources/ext/test', { method: 'POST', body: '{}' })) },
    { route: 'POST /datasources/:name/object-draft', service: 'external-datasource', run: (a) => a.fetch(json('/api/v1/datasources/ext/object-draft', { method: 'POST', body: JSON.stringify({ table: 'customers' }) })) },
  ];

  for (const c of UNAVAILABLE) {
    it(`${c.route} degrades to 503 naming ${c.service} (#4225)`, async () => {
      const res = await c.run(mountServices({}));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `The ${c.service} service is not available.`,
        },
      });
    });
  }

  it('a wired datasource-admin does not answer for an unwired external-datasource (#4225)', async () => {
    // The operator's actual situation: lifecycle works, federation does not. The
    // old message sent them to read the logs of the service that was running.
    const app = mountServices({
      'datasource-admin': {
        listDatasources: async () => [{ name: 'ext', origin: 'runtime' }],
        getDatasource: async () => ({ name: 'ext', driver: 'sqlite' }),
        testConnection: async () => ({ ok: true }),
      },
      // 'external-datasource' deliberately absent.
    });

    expect((await app.fetch(json('/api/v1/datasources'))).status).toBe(200);

    const remote = await app.fetch(json('/api/v1/datasources/ext/remote-tables'));
    expect(remote.status).toBe(503);
    expect(((await remote.json()) as any).error.message).toBe(
      'The external-datasource service is not available.',
    );

    // `POST /:name/test` resolves `external-datasource` even though its unsaved-draft
    // sibling `POST /test` resolves `datasource-admin` — the wired admin service
    // above has a `testConnection`, and it must not answer for this route.
    const saved = await app.fetch(json('/api/v1/datasources/ext/test', { method: 'POST', body: '{}' }));
    expect(saved.status).toBe(503);
    expect(((await saved.json()) as any).error.message).toBe(
      'The external-datasource service is not available.',
    );
  });

  /**
   * #4249 — the 400 `error.code` names the service that refused, the way the
   * 503 `message` above names the one that was missing (#4225). Same defect one
   * field over: `badRequest` hard-coded `DATASOURCE_ADMIN_ERROR`, so the three
   * external-datasource routes reported their refusals as datasource-admin's —
   * and where #4225 misled a human reading prose, this misrouted a client
   * switching on `error.code`.
   *
   * One row per route with a refusal path. The `code` column is a deliberate
   * PIN, not derived from the route's service, so a wrong entry in the module's
   * `SERVICE_ERROR_CODE` map has to disagree with a literal here. Each mount
   * wires ONLY the service the route should resolve — a route dispatching to
   * the other one answers 503, failing the row before the code is even read.
   */
  const REFUSALS: Array<{
    route: string;
    service: string;
    code: string;
    svc: Record<string, unknown>;
    run: (app: any) => Promise<Response>;
  }> = [
    // The list row is #4264: the one route that had no refusal path at all —
    // its throw surfaced as the adapter's non-envelope 500, not any code here.
    { route: 'GET /datasources', service: 'datasource-admin', code: 'DATASOURCE_ADMIN_ERROR', svc: { listDatasources: async () => { throw new Error('backing store offline'); } }, run: (a) => a.fetch(json('/api/v1/datasources')) },
    { route: 'GET /datasources/:name', service: 'datasource-admin', code: 'DATASOURCE_ADMIN_ERROR', svc: { getDatasource: async () => { throw new Error('backing store offline'); } }, run: (a) => a.fetch(json('/api/v1/datasources/pg')) },
    { route: 'POST /datasources/test', service: 'datasource-admin', code: 'DATASOURCE_ADMIN_ERROR', svc: { testConnection: async () => { throw new Error('backing store offline'); } }, run: (a) => a.fetch(json('/api/v1/datasources/test', { method: 'POST', body: '{}' })) },
    { route: 'POST /datasources', service: 'datasource-admin', code: 'DATASOURCE_ADMIN_ERROR', svc: { createDatasource: async () => { throw new Error('backing store offline'); } }, run: (a) => a.fetch(json('/api/v1/datasources', { method: 'POST', body: '{}' })) },
    { route: 'PATCH /datasources/:name', service: 'datasource-admin', code: 'DATASOURCE_ADMIN_ERROR', svc: { updateDatasource: async () => { throw new Error('backing store offline'); } }, run: (a) => a.fetch(json('/api/v1/datasources/pg', { method: 'PATCH', body: '{}' })) },
    { route: 'DELETE /datasources/:name', service: 'datasource-admin', code: 'DATASOURCE_ADMIN_ERROR', svc: { removeDatasource: async () => { throw new Error('backing store offline'); } }, run: (a) => a.fetch(json('/api/v1/datasources/pg', { method: 'DELETE' })) },
    { route: 'GET /datasources/:name/remote-tables', service: 'external-datasource', code: 'EXTERNAL_DATASOURCE_ERROR', svc: { listRemoteTables: async () => { throw new Error('no such schema'); } }, run: (a) => a.fetch(json('/api/v1/datasources/ext/remote-tables')) },
    { route: 'POST /datasources/:name/test', service: 'external-datasource', code: 'EXTERNAL_DATASOURCE_ERROR', svc: { testConnection: async () => { throw new Error('connection refused'); } }, run: (a) => a.fetch(json('/api/v1/datasources/ext/test', { method: 'POST', body: '{}' })) },
    { route: 'POST /datasources/:name/object-draft', service: 'external-datasource', code: 'EXTERNAL_DATASOURCE_ERROR', svc: { generateObjectDraft: async () => { throw new Error('no such table'); } }, run: (a) => a.fetch(json('/api/v1/datasources/ext/object-draft', { method: 'POST', body: JSON.stringify({ table: 'customers' }) })) },
  ];

  for (const c of REFUSALS) {
    it(`${c.route} refuses as 400 ${c.code} (#4249)`, async () => {
      const res = await c.run(mountServices({ [c.service]: c.svc }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(c.code);
      // The service's own message still reads at `error.message`, as before.
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
    });
  }

  it('surfaces lifecycle errors as 400 with the service message', async () => {
    const createDatasource = vi.fn().mockRejectedValue(new Error('duplicate name'));
    const app = mount({ createDatasource });

    const res = await app.fetch(
      json('/api/v1/datasources', {
        method: 'POST',
        body: JSON.stringify({ name: 'pg', driver: 'postgres' }),
      }),
    );

    expect(res.status).toBe(400);
    // #3843: `message` is a FIELD of `error` now, not a sibling of it — the
    // asymmetry that made `body.error.message` read `undefined` here.
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'DATASOURCE_ADMIN_ERROR', message: 'duplicate name' },
    });
  });
});
