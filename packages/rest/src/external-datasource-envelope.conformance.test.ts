// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope conformance for `/api/v1/datasources/:name/external/*`
 * (#3843).
 *
 * The drift this closes: the pre-#3675 `{ error: '<string>' }` on both error
 * arms, no `success` flag on any body, and — on `POST /validate` — its own
 * private success word:
 *
 *     res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
 *     res.json({ ok: results.every((r: any) => r.ok), results });
 *
 * The `ok` is the interesting one, because it is NOT the `ok` #3689 retired from
 * storage. There, `{ ok: true, key }` was a second word for the envelope's own
 * `success` and was dropped. Here `ok` is a COMPUTED verdict over the federated
 * objects — "did every one of them validate" — which is a domain answer that
 * happens to share the name. It stays, inside `data`, and the assertion below
 * pins that distinction so a later sweep for "`ok` beside `success`" does not
 * delete a real field.
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
import type { IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';

const EXT = '/api/v1/datasources/:name/external';

interface Captured {
  status: number;
  body: any;
}

/**
 * [#9686] The family requires an authenticated caller, so every case in this
 * file — whose subject is the ENVELOPE of the success / 400 / 503 arms — mounts
 * with a resolver standing in for a credentialed one. Without it each case
 * would read the 401 body instead of the arm it names, and this file would
 * silently stop measuring what it exists to measure.
 *
 * [#9901] …and an ENTITLED one: four of the five routes now also require a
 * capability (`manage_platform_settings` on the reads, `manage_metadata` on the
 * writes), so this stub holds both. Same reasoning one step further — a
 * resolver carrying an identity but no grants would turn every case below into
 * a reading of the 403 body. Holding both rather than one per case is
 * deliberate: which capability each route requires is not this file's subject,
 * and pinning it twice would make the split harder to change in the one place
 * that does own it.
 *
 * The guard itself is pinned in `external-datasource-routes-auth-guard.test.ts`;
 * the 401's own envelope is the last case below, which is this file's business.
 */
const CREDENTIALED = async () => ({
  userId: 'u_env_conformance',
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
});

/**
 * A resolver that RESOLVES, and resolves to no identity — the anonymous case as
 * the production resolver expresses it. Spelled as its own constant because
 * passing `undefined` for the parameter below would take the default above:
 * "no argument" and "no identity" are different facts, and only one of them is
 * what the 401 case means to drive.
 */
const ANONYMOUS = async () => undefined;

function mount(svc: unknown, resolveExecutionContext: any = CREDENTIALED) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as unknown as IHttpServer;
  const ctx = { getService: vi.fn().mockReturnValue(svc) } as any;
  registerExternalDatasourceRoutes(server, ctx, '/api/v1', { resolveExecutionContext });
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  req: Record<string, any> = {},
): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: { name: 'ext' }, query: {}, body: undefined, headers: {}, method, path, ...req } as any,
    res,
  );
  return captured;
}

describe('external-datasource envelope (#3843) — success bodies', () => {
  const CASES: Array<{ name: string; status: number; dataKeys: string[]; run: () => Promise<Captured> }> = [
    {
      name: 'GET /tables',
      status: 200,
      dataKeys: ['tables'],
      run: () => drive(mount({ listRemoteTables: async () => [{ name: 'customers' }] }), 'GET', `${EXT}/tables`),
    },
    {
      name: 'POST /tables/:remote/draft',
      status: 200,
      dataKeys: ['draft'],
      run: () => drive(mount({ generateObjectDraft: async () => ({ name: 'customers' }) }), 'POST', `${EXT}/tables/:remote/draft`, { params: { name: 'ext', remote: 'customers' } }),
    },
    {
      // Carries a non-200 success status.
      name: 'POST /tables/:remote/import (201)',
      status: 201,
      dataKeys: ['object'],
      run: () => drive(mount({ importObject: async () => ({ name: 'customers' }) }), 'POST', `${EXT}/tables/:remote/import`, { params: { name: 'ext', remote: 'customers' } }),
    },
    {
      name: 'POST /refresh-catalog',
      status: 200,
      dataKeys: ['catalog'],
      run: () => drive(mount({ refreshCatalog: async () => ({ tables: [] }) }), 'POST', `${EXT}/refresh-catalog`),
    },
    {
      name: 'POST /validate',
      status: 200,
      dataKeys: ['ok', 'results'],
      run: () => drive(
        mount({ validateAll: async () => ({ results: [{ datasource: 'ext', ok: true }] }) }),
        'POST',
        `${EXT}/validate`,
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

  it("POST /validate keeps its `ok` — a domain verdict, not a second `success`", async () => {
    // All results valid → data.ok true, while `success` reports the request.
    const pass = await drive(
      mount({ validateAll: async () => ({ results: [{ datasource: 'ext', ok: true }] }) }),
      'POST',
      `${EXT}/validate`,
    );
    expect(pass.body.success).toBe(true);
    expect(pass.body.data.ok).toBe(true);

    // One invalid → the request still SUCCEEDED, and the verdict is false. The
    // two flags disagree on purpose; that is why `ok` was not folded into
    // `success` the way storage's was.
    const fail = await drive(
      mount({
        validateAll: async () => ({
          results: [{ datasource: 'ext', ok: true }, { datasource: 'ext', ok: false }],
        }),
      }),
      'POST',
      `${EXT}/validate`,
    );
    expect(fail.body.success).toBe(true);
    expect(fail.body.data.ok).toBe(false);
    expect(fail.body.data.results).toHaveLength(2);
  });
});

describe('external-datasource envelope (#3843) — error bodies', () => {
  const CASES: Array<{ name: string; status: number; code: string; run: () => Promise<Captured> }> = [
    {
      name: 'federation is not wired into the host',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      run: () => drive(mount(undefined), 'GET', `${EXT}/tables`),
    },
    {
      name: 'an import the service refuses',
      status: 400,
      code: 'EXTERNAL_IMPORT_ERROR',
      run: () => drive(
        mount({ importObject: async () => { throw new Error('metadata store is read-only'); } }),
        'POST',
        `${EXT}/tables/:remote/import`,
        { params: { name: 'ext', remote: 'customers' } },
      ),
    },
    {
      // #4249: before it, the two introspection routes had no `catch`, so this
      // throw surfaced as the adapter's non-envelope 500 — while the same
      // service operation through `service-datasource/admin-routes.ts` answered
      // 400. Both paths now refuse with the same registered code.
      name: 'an introspection the service refuses',
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
      run: () => drive(
        mount({ listRemoteTables: async () => { throw new Error('no such schema'); } }),
        'GET',
        `${EXT}/tables`,
      ),
    },
    {
      name: 'a draft generation the service refuses',
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
      run: () => drive(
        mount({ generateObjectDraft: async () => { throw new Error('no such table'); } }),
        'POST',
        `${EXT}/tables/:remote/draft`,
        { params: { name: 'ext', remote: 'customers' } },
      ),
    },
    {
      // #4264: the two rows below are the routes #4249 left uncovered — no
      // `catch` at all, so these throws surfaced as the adapter's non-envelope
      // `500 { error: 'No response from handler' }`, the real cause swallowed.
      name: 'a catalog refresh the service refuses',
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
      run: () => drive(
        mount({ refreshCatalog: async () => { throw new Error('unknown datasource "ext"'); } }),
        'POST',
        `${EXT}/refresh-catalog`,
      ),
    },
    {
      name: 'a validation sweep the service refuses',
      status: 400,
      code: 'EXTERNAL_DATASOURCE_ERROR',
      run: () => drive(
        mount({ validateAll: async () => { throw new Error('metadata store offline'); } }),
        'POST',
        `${EXT}/validate`,
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

      // The pre-#3675 shapes, explicitly dead.
      expect(typeof body.error).not.toBe('string');
      expect(body.message).toBeUndefined();
    });
  }

  it('the refusal reason reads at `error.message`', async () => {
    const { body } = await drive(
      mount({ importObject: async () => { throw new Error('metadata store is read-only'); } }),
      'POST',
      `${EXT}/tables/:remote/import`,
      { params: { name: 'ext', remote: 'customers' } },
    );
    expect(body.error.message).toBe('metadata store is read-only');
  });

  it('every route degrades to the enveloped 503, not just the first', async () => {
    const routes = mount(undefined);
    const paths: Array<[string, string, Record<string, any>?]> = [
      ['GET', `${EXT}/tables`],
      ['POST', `${EXT}/tables/:remote/draft`, { params: { name: 'ext', remote: 'c' } }],
      ['POST', `${EXT}/tables/:remote/import`, { params: { name: 'ext', remote: 'c' } }],
      ['POST', `${EXT}/refresh-catalog`],
      ['POST', `${EXT}/validate`],
    ];
    for (const [method, path, req] of paths) {
      const { status, body } = await drive(routes, method, path, req);
      expect(status, `${method} ${path}`).toBe(503);
      expect(body.success, `${method} ${path}`).toBe(false);
      expect(body.error.code, `${method} ${path}`).toBe('SERVICE_UNAVAILABLE');
    }
  });
});

describe('[#9686] the anonymous refusal is written in the same declared envelope', () => {
  it('an unauthenticated caller gets 401 { success: false, error: { code } }, not a hand-written body', async () => {
    // The guard added a body to this surface, and a new body is exactly where
    // an envelope drifts. Same assertions the arms above make, on the arm the
    // authentication floor produces.
    const routes = mount({ listRemoteTables: async () => [{ name: 'customers' }] }, ANONYMOUS);
    const { status, body } = await drive(routes, 'GET', `${EXT}/tables`);

    expect(status).toBe(401);
    expect(BaseResponseSchema.safeParse(body).success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHENTICATED');
    expect(body.data).toBeUndefined();
  });
});
