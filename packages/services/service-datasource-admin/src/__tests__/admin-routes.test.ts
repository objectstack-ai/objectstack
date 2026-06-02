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
