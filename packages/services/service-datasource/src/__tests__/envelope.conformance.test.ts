// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope conformance for `/api/v1/datasources/*` (#3843).
 *
 * The drift this closes was the WORSE of the two dialects #3843 surveyed: not
 * merely a missing `success` flag, but the pre-#3675 `{ error: '<string>' }`,
 * with the message a SIBLING of `error` rather than a field of it —
 *
 *     res.status(400).json({ error: 'datasource_admin_error', message });
 *
 * so a caller reading `body.error.message` got `undefined` here and the real
 * message from the dispatcher. That is the identical asymmetry #3675 opened on,
 * still live in this module two issues later because #3675 and #3689 each
 * scoped themselves to one service and neither asked whether the same drift
 * existed elsewhere.
 *
 * Driven against the REAL `HonoHttpServer` — the same `IHttpServer` `os serve`
 * mounts — so the bodies asserted here are the bytes a client receives, not a
 * mock's record of what a handler passed to `json()`. That matters for the
 * success arm: `sendOk` sets an explicit `status(200)` where the module used to
 * call bare `res.json(…)`, and only a real adapter proves the chain works.
 *
 * The static half is the shared guard (`@objectstack/route-envelope-conformance`),
 * so a NEW route cannot bypass the helpers — the coverage a driven test can
 * never give, since it can only drive the routes that exist today.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkRouteEnvelope } from '@objectstack/route-envelope-conformance';
import { BaseResponseSchema } from '@objectstack/spec/api';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';

const req = (path: string, init?: RequestInit) =>
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

interface Captured {
  status: number;
  body: any;
}

async function drive(app: any, path: string, init?: RequestInit): Promise<Captured> {
  const res = await app.fetch(req(path, init));
  return { status: res.status, body: await res.json() };
}

describe('datasource-admin envelope (#3843) — success bodies', () => {
  const CASES: Array<{ name: string; status: number; dataKeys: string[]; run: () => Promise<Captured> }> = [
    {
      name: 'GET /datasources',
      status: 200,
      dataKeys: ['datasources'],
      run: () => drive(mount({ listDatasources: async () => [{ name: 'pg', origin: 'runtime' }] }), '/api/v1/datasources'),
    },
    {
      name: 'GET /datasources/drivers',
      status: 200,
      dataKeys: ['drivers'],
      run: () => drive(mount({}), '/api/v1/datasources/drivers'),
    },
    {
      name: 'GET /datasources/:name/remote-tables',
      status: 200,
      dataKeys: ['tables'],
      run: () => drive(mount({ listRemoteTables: async () => [{ name: 'customers' }] }), '/api/v1/datasources/ext/remote-tables'),
    },
    {
      name: 'GET /datasources/:name',
      status: 200,
      dataKeys: ['datasource'],
      run: () => drive(mount({ getDatasource: async () => ({ name: 'ext', driver: 'sqlite' }) }), '/api/v1/datasources/ext'),
    },
    {
      name: 'POST /datasources/:name/test',
      status: 200,
      // The service's own verdict object, carried under `data` whole.
      dataKeys: ['ok'],
      run: () => drive(mount({ testConnection: async () => ({ ok: true, latencyMs: 7 }) }), '/api/v1/datasources/ext/test', { method: 'POST', body: '{}' }),
    },
    {
      name: 'POST /datasources/:name/object-draft',
      status: 200,
      dataKeys: ['draft'],
      run: () => drive(mount({ generateObjectDraft: async () => ({ name: 'customers' }) }), '/api/v1/datasources/ext/object-draft', { method: 'POST', body: JSON.stringify({ table: 'customers' }) }),
    },
    {
      name: 'POST /datasources/test',
      status: 200,
      dataKeys: ['result'],
      run: () => drive(mount({ testConnection: async () => ({ ok: true }) }), '/api/v1/datasources/test', { method: 'POST', body: JSON.stringify({ driver: 'postgres' }) }),
    },
    {
      // The one that carries a non-200 success status — proving `sendOk`'s
      // `status` argument survives the real adapter.
      name: 'POST /datasources (201)',
      status: 201,
      dataKeys: ['datasource'],
      run: () => drive(mount({ createDatasource: async () => ({ name: 'pg', origin: 'runtime' }) }), '/api/v1/datasources', { method: 'POST', body: JSON.stringify({ name: 'pg', driver: 'postgres' }) }),
    },
    {
      name: 'PATCH /datasources/:name',
      status: 200,
      dataKeys: ['datasource'],
      run: () => drive(mount({ updateDatasource: async () => ({ name: 'pg', origin: 'runtime' }) }), '/api/v1/datasources/pg', { method: 'PATCH', body: JSON.stringify({ active: false }) }),
    },
  ];

  for (const c of CASES) {
    it(`${c.name} answers ${c.status} { success: true, data }`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      // The contract itself, imported — not a restatement of it.
      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
      expect(body.success).toBe(true);
      expect(body.error).toBeUndefined();

      for (const k of c.dataKeys) {
        expect(body.data?.[k], `data.${k} missing from ${c.name}`).toBeDefined();
      }
    });
  }

  it('the pre-#3843 shape is dead — no payload at the top level', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      expect(typeof body.success, `${c.name} answers no success flag`).toBe('boolean');
      for (const k of c.dataKeys) {
        expect(body[k], `${c.name} still answers a top-level ${k}`).toBeUndefined();
      }
    }
  });

  it('DELETE /datasources/:name stays a bodiless 204 — nothing to envelope', async () => {
    const app = mount({ removeDatasource: async () => undefined });
    const res = await app.fetch(req('/api/v1/datasources/pg', { method: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });
});

describe('datasource-admin envelope (#3843) — error bodies', () => {
  const CASES: Array<{ name: string; status: number; code: string; run: () => Promise<Captured> }> = [
    {
      name: 'the datasource-admin service is not wired',
      status: 503,
      code: 'datasource_admin_unavailable',
      run: () => drive(mount(undefined), '/api/v1/datasources'),
    },
    {
      name: 'a lifecycle failure carries the service message',
      status: 400,
      code: 'datasource_admin_error',
      run: () => drive(mount({ createDatasource: async () => { throw new Error('duplicate name'); } }), '/api/v1/datasources', { method: 'POST', body: JSON.stringify({ name: 'pg' }) }),
    },
    {
      name: 'a missing required body field',
      status: 400,
      code: 'datasource_admin_error',
      run: () => drive(mount({ generateObjectDraft: async () => ({}) }), '/api/v1/datasources/ext/object-draft', { method: 'POST', body: '{}' }),
    },
    {
      name: 'reading a datasource that does not exist',
      status: 404,
      code: 'not_found',
      run: () => drive(mount({ getDatasource: async () => undefined }), '/api/v1/datasources/nope'),
    },
    {
      name: 'a remote-table introspection failure',
      status: 400,
      code: 'datasource_admin_error',
      run: () => drive(mount({ listRemoteTables: async () => { throw new Error('no such schema'); } }), '/api/v1/datasources/ext/remote-tables'),
    },
    {
      name: 'a removal failure',
      status: 400,
      code: 'datasource_admin_error',
      run: () => drive(mount({ removeDatasource: async () => { throw new Error('not runtime-origin'); } }), '/api/v1/datasources/pg', { method: 'DELETE' }),
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → ${c.status} ${c.code}, in the declared envelope`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe(c.code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);

      // The pre-#3675 shapes, explicitly dead: `error` is no longer a bare
      // string, and `message` is no longer a SIBLING of it.
      expect(typeof body.error).not.toBe('string');
      expect(body.message).toBeUndefined();
    });
  }

  it('the service message reads at `error.message` — the asymmetry #3675 opened on', async () => {
    const { body } = await drive(
      mount({ createDatasource: async () => { throw new Error('duplicate name'); } }),
      '/api/v1/datasources',
      { method: 'POST', body: JSON.stringify({ name: 'pg' }) },
    );
    // Before #3843 this read `undefined`, and the message sat at `body.message`.
    expect(body.error.message).toBe('duplicate name');
  });
});

describe('datasource-admin envelope (#3843) — the shared guard', () => {
  it('routes every body through the two helpers', () => {
    const source = readFileSync(new URL('../admin-routes.ts', import.meta.url), 'utf8');
    expect(checkRouteEnvelope({ source, module: 'admin-routes.ts' })).toEqual([]);
  });
});
