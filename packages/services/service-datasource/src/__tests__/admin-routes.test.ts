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

const json = (path: string, init?: RequestInit) =>
  new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

function mount(svc: unknown) {
  const server = new HonoHttpServer(0);
  const ctx = { getService: vi.fn().mockReturnValue(svc) } as any;
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
      datasources: [{ name: 'pg', origin: 'runtime', health: 'ok' }],
    });
    expect(listDatasources).toHaveBeenCalledOnce();
  });

  it('GET /api/v1/datasources/drivers returns the driver catalog with configSchema', async () => {
    const app = mount({}); // no service dependency — static catalog
    const res = await app.fetch(json('/api/v1/datasources/drivers'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drivers: Array<{ id: string; label: string; configSchema: any }> };
    expect(Array.isArray(body.drivers)).toBe(true);
    const sqlite = body.drivers.find((d) => d.id === 'sqlite');
    expect(sqlite).toBeTruthy();
    expect(sqlite!.label).toBe('SQLite');
    expect(sqlite!.configSchema?.properties?.filename?.type).toBe('string');
  });

  it('GET /api/v1/datasources/:name/remote-tables lists remote tables', async () => {
    const listRemoteTables = vi.fn().mockResolvedValue([{ name: 'customers', columnCount: 4 }]);
    const app = mount({ listRemoteTables });
    const res = await app.fetch(json('/api/v1/datasources/demo_ext/remote-tables'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tables: [{ name: 'customers', columnCount: 4 }] });
    expect(listRemoteTables).toHaveBeenCalledWith('demo_ext');
  });

  it('POST /api/v1/datasources/:name/object-draft generates a draft (400 without table)', async () => {
    const generateObjectDraft = vi.fn().mockResolvedValue({ name: 'customers', definition: { fields: { id: {} } } });
    const app = mount({ generateObjectDraft });

    const missing = await app.fetch(json('/api/v1/datasources/demo_ext/object-draft', { method: 'POST', body: JSON.stringify({}) }));
    expect(missing.status).toBe(400);

    const ok = await app.fetch(json('/api/v1/datasources/demo_ext/object-draft', { method: 'POST', body: JSON.stringify({ table: 'customers' }) }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).draft.name).toBe('customers');
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
    expect((await ok.json()).datasource.config.filename).toBe('/tmp/x.db');
    const missing = await app.fetch(json('/api/v1/datasources/nope'));
    expect(missing.status).toBe(404);
    expect(getDatasource).toHaveBeenCalledWith('demo_ext');
  });

  it('POST /api/v1/datasources/:name/test probes a saved datasource by name', async () => {
    const testConnection = vi.fn().mockResolvedValue({ ok: true, latencyMs: 7, tableCount: 2 });
    const app = mount({ testConnection });
    const res = await app.fetch(json('/api/v1/datasources/demo_ext/test', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, latencyMs: 7, tableCount: 2 });
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
    expect(await res.json()).toEqual({ result: { ok: true } });
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
    expect(await res.json()).toEqual({ datasource: { name: 'pg', origin: 'runtime' } });
  });

  it('degrades to 503 when the datasource-admin service is not wired', async () => {
    const app = mount(undefined);

    const res = await app.fetch(json('/api/v1/datasources'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'datasource_admin_unavailable' });
  });

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
    expect(await res.json()).toEqual({
      error: 'datasource_admin_error',
      message: 'duplicate name',
    });
  });
});
