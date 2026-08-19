// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope conformance for `/api/v1/datasources/*` (#3843).
 *
 * The drift this closes was the WORSE of the two dialects #3843 surveyed: not
 * merely a missing `success` flag, but the pre-#3675 `{ error: '<string>' }`,
 * with the message a SIBLING of `error` rather than a field of it —
 *
 *     res.status(400).json({ error: 'DATASOURCE_ADMIN_ERROR', message });
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
 * The STATIC half of this conformance — proving no route can bypass the
 * `sendOk` / `sendError` pair — is not here. It is
 * `scripts/check-route-envelope.mjs`, a repo-wide guard run by
 * `pnpm check:route-envelope` in CI. It sits outside any package on purpose: the
 * three predecessors of that scan were per-package, which structurally cannot
 * notice a route module nobody thought to convert, and two such modules turned up
 * the moment it went repo-wide: `share-link-routes.ts` (#3983) and the dev-only
 * `hmr-routes.ts`, neither of them in #3843's hand-written survey.
 *
 * What stays here is the half that has to live next to the routes it drives:
 * every branch driven, every body parsed against the real spec schemas.
 */

import { describe, it, expect, vi } from 'vitest';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import {
  ENTITLED_CREDENTIAL,
  createSessionAuthService,
  createGrantsEngine,
} from './entitled-caller.fixture.js';

/**
 * The family requires authentication (#9391) and the `manage_platform_settings`
 * capability (#9593), so every request below carries an ENTITLED caller's
 * session and the mock context resolves both the `auth` service that admits it
 * and the data engine its grants resolve from. The subject here is the ENVELOPE
 * of the success and refusal bodies; an unauthenticated fixture would replace
 * all of them with the guard's 401 and an unentitled one with its 403, and this
 * file would stop covering what it exists to cover. Both refusal envelopes are
 * asserted by `admin-routes-auth-guard.test.ts`; the entitlement itself comes
 * from the one `entitled-caller.fixture.ts` definition that pin uses.
 */
const SESSION = ENTITLED_CREDENTIAL;
const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

const req = (path: string, init?: RequestInit) =>
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
  const ctx = {
    getService: vi.fn((name: string) =>
      name === 'auth'
        ? authService
        : name === 'objectql' || name === 'data'
          ? grantsEngine
          : svc,
    ),
  } as any;
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
    {
      name: 'POST /datasources/:name/migrate-credential',
      status: 200,
      dataKeys: ['result'],
      run: () => drive(
        mount({ migrateCredential: async () => ({ name: 'pg', status: 'migrated', migratedKey: 'password' }) }),
        '/api/v1/datasources/pg/migrate-credential',
        { method: 'POST', body: '{}' },
      ),
    },
    {
      // A REFUSAL is a 200 answer, not a 400 (#8155): the datasource is intact
      // and the operator's request was well-formed. It rides the same envelope
      // as the success arm, which is what lets a caller read `data.result.status`
      // without branching on the HTTP code first.
      name: 'POST /datasources/:name/migrate-credential (refused)',
      status: 200,
      dataKeys: ['result'],
      run: () => drive(
        mount({
          migrateCredential: async () => ({
            name: 'pg', status: 'refused', reason: 'credential embedded in config.url', remedy: 're-enter it',
          }),
        }),
        '/api/v1/datasources/pg/migrate-credential',
        { method: 'POST', body: '{}' },
      ),
    },
  ];

  for (const c of CASES) {
    it(`${c.name} answers ${c.status} { success: true, data }`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      // The envelope SKELETON, imported. It is not the whole contract: it declares
      // no `data` and strips unknown keys, so on its own it passes `{ success: true }`
      // and passes a payload duplicated into a stray top-level key. What it DOES
      // catch is the missing `success` flag — the drift this line was added for.
      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
      // The declared envelope in full — `safeParse` alone passes a body with no
      // `data`, or a payload duplicated into a stray top-level key (#4049).
      expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
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
      code: 'SERVICE_UNAVAILABLE',
      run: () => drive(mount(undefined), '/api/v1/datasources'),
    },
    {
      // The same 503, from the three routes served by the OTHER service (#4225).
      // Which service is named is asserted in `admin-routes.test.ts`; what this
      // row adds is that the branch emits the declared envelope, like its twin.
      name: 'the external-datasource service is not wired',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      run: () => drive(mount(undefined), '/api/v1/datasources/ext/remote-tables'),
    },
    {
      name: 'a lifecycle failure carries the service message',
      status: 400,
      code: 'DATASOURCE_ADMIN_ERROR',
      run: () => drive(mount({ createDatasource: async () => { throw new Error('duplicate name'); } }), '/api/v1/datasources', { method: 'POST', body: JSON.stringify({ name: 'pg' }) }),
    },
    {
      // #4264: the one route in the module that still had no `catch`, so this
      // throw surfaced as the adapter's non-envelope
      // `500 { error: 'No response from handler' }` instead of the 400 below.
      name: 'a datasource listing failure',
      status: 400,
      code: 'DATASOURCE_ADMIN_ERROR',
      run: () => drive(mount({ listDatasources: async () => { throw new Error('backing store offline'); } }), '/api/v1/datasources'),
    },
    {
      // On an external-datasource route, so the refusal carries THAT service's
      // registered code (#4249) — even though this one is raised by the route
      // itself before the service is called.
      name: 'a missing required body field',
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
      run: () => drive(mount({ generateObjectDraft: async () => ({}) }), '/api/v1/datasources/ext/object-draft', { method: 'POST', body: '{}' }),
    },
    {
      name: 'reading a datasource that does not exist',
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      run: () => drive(mount({ getDatasource: async () => undefined }), '/api/v1/datasources/nope'),
    },
    {
      // #4249: raised by the external-datasource introspector, so the code says
      // so. Until then this row pinned `DATASOURCE_ADMIN_ERROR` — the same
      // mis-attribution #4225 fixed in the 503 `message`, machine-readable here.
      name: 'a remote-table introspection failure',
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
      run: () => drive(mount({ listRemoteTables: async () => { throw new Error('no such schema'); } }), '/api/v1/datasources/ext/remote-tables'),
    },
    {
      name: 'a saved-datasource connection test failure',
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
      run: () => drive(mount({ testConnection: async () => { throw new Error('connection refused'); } }), '/api/v1/datasources/ext/test', { method: 'POST', body: '{}' }),
    },
    {
      name: 'a removal failure',
      status: 400,
      code: 'DATASOURCE_ADMIN_ERROR',
      run: () => drive(mount({ removeDatasource: async () => { throw new Error('not runtime-origin'); } }), '/api/v1/datasources/pg', { method: 'DELETE' }),
    },
    {
      // The credential migration's THROW arm — an unknown name, a store that
      // failed — as distinct from its `refused` result, which is a 200 above.
      name: 'a credential-migration failure',
      status: 400,
      code: 'DATASOURCE_ADMIN_ERROR',
      run: () => drive(
        mount({ migrateCredential: async () => { throw new Error("Datasource 'nope' not found."); } }),
        '/api/v1/datasources/nope/migrate-credential',
        { method: 'POST', body: '{}' },
      ),
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → ${c.status} ${c.code}, in the declared envelope`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
      // The declared envelope in full — `safeParse` alone passes a body with no
      // `data`, or a payload duplicated into a stray top-level key (#4049).
      expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);

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
