// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope conformance for `/api/v1/packages/*` (#3843).
 *
 * This module was the *partially converted* one, which #3843 called "arguably
 * worse than untouched": 3 of its 16 bodies carried `success: true` and the rest
 * did not, so the same registrar answered two shapes depending on which route
 * you hit. Its errors were the pre-#3675 bare string throughout — and the string
 * was a human message rather than a code —
 *
 *     res.status(400).json({ error: 'Missing required fields: manifest, metadata' });
 *
 * while two failure bodies carried no `error` at all:
 *
 *     res.status(400).json({ success: false, failed, cleanups });
 *     res.status(400).json({ success: false });
 *
 * i.e. a caller was told it failed and never told why. They are also why this
 * module had no codes to carry over: its `error` strings were human messages, so
 * every code here had to be chosen rather than re-spelled.
 *
 * ADR-0112 (#3841) settled the vocabulary, so the choice was not free. Generic
 * conditions reuse the STANDARD catalog — `MISSING_REQUIRED_FIELD`,
 * `RESOURCE_NOT_FOUND`, `INTERNAL_ERROR` — and only the package-specific outcomes
 * are registered in `ERROR_CODE_LEDGER` (`PACKAGE_MANIFEST_INVALID`,
 * `PACKAGE_PUBLISH_FAILED`, `PACKAGE_DELETE_PARTIAL`, `PACKAGE_DELETE_FAILED`);
 * see `sendError`'s note in `package-routes.ts`. `ApiErrorSchema.code` is a closed
 * union now, so an unregistered code fails parse — which is what makes the
 * `BaseResponseSchema.safeParse` assertions below catch an invented one.
 *
 * The three bodies that already had the flag kept their payload as SIBLINGS of
 * it (`{ success: true, message, package }`); the assertions below pin that they
 * now sit under `data`, so the envelope has one payload slot rather than a
 * spread — which is what makes `unwrapResponse` able to return it.
 */

import { describe, it, expect } from 'vitest';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';

interface Captured {
  status: number;
  body: any;
}

/** A `PackageService` stub — only the four methods these routes reach. */
type Svc = Partial<{
  publish: (arg: any) => Promise<any>;
  list: () => Promise<any[]>;
  get: (id: string, version?: string) => Promise<any>;
  delete: (id: string, version?: string) => Promise<any>;
}>;

function mount(svc: Svc, options: any = {}) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as any;
  registerPackageRoutes(server, svc as any, '/api/v1', options);
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
    { params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any,
    res,
  );
  return captured;
}

const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };

describe('packages envelope (#3843) — success bodies', () => {
  const CASES: Array<{ name: string; status: number; dataKeys: string[]; run: () => Promise<Captured> }> = [
    {
      name: 'POST /packages/publish',
      status: 200,
      dataKeys: ['message', 'package'],
      run: () => drive(
        mount({ publish: async () => ({ success: true }) }),
        'POST',
        `${PKGS}/publish`,
        { body: { manifest: MANIFEST, metadata: { author: 'acme' } } },
      ),
    },
    {
      name: 'GET /packages',
      status: 200,
      dataKeys: ['packages', 'total'],
      run: () => drive(
        mount({ list: async () => [{ id: 'com.acme.crm', manifest: MANIFEST }] }),
        'GET',
        PKGS,
      ),
    },
    {
      name: 'GET /packages/:id',
      status: 200,
      dataKeys: ['package'],
      run: () => drive(
        mount({ get: async () => ({ id: 'com.acme.crm', manifest: MANIFEST }) }),
        'GET',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
      ),
    },
    {
      name: 'DELETE /packages/:id (version-scoped, durable registry)',
      status: 200,
      dataKeys: ['message'],
      run: () => drive(
        mount({ delete: async () => ({ success: true }) }),
        'DELETE',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' }, query: { version: '1.0.0' } },
      ),
    },
    {
      name: 'DELETE /packages/:id (full uninstall via protocol)',
      status: 200,
      dataKeys: ['message', 'deletedCount', 'cleanups'],
      run: () => drive(
        mount({}, {
          protocol: {
            deletePackage: async () => ({
              success: true, deletedCount: 3, failedCount: 0, failed: [], cleanups: [{ name: 'security', success: true, removed: 2 }],
            }),
          },
        }),
        'DELETE',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
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

  it('the two shapes are now one — no payload beside the flag, none without it', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      // The 13 bodies that had no flag.
      expect(typeof body.success, `${c.name} answers no success flag`).toBe('boolean');
      // The 3 that had one, with the payload spread beside it.
      for (const k of c.dataKeys) {
        expect(body[k], `${c.name} still answers a top-level ${k}`).toBeUndefined();
      }
      expect(Object.keys(body).sort()).toEqual(['data', 'success']);
    }
  });

  it('a registry-only package is still found when the database has none', async () => {
    // Guards the fallback arm of GET /:id, which is a separate `sendOk` call.
    const { status, body } = await drive(
      mount({ get: async () => undefined }, {
        protocol: { getMetaItems: async () => ({ items: [{ manifest: MANIFEST }] }) },
      }),
      'GET',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.package.source).toBe('registry');
  });
});

describe('packages envelope (#3843) — error bodies', () => {
  const CASES: Array<{ name: string; status: number; code: string; run: () => Promise<Captured> }> = [
    {
      name: 'publish without manifest/metadata',
      status: 400,
      code: 'MISSING_REQUIRED_FIELD',
      run: () => drive(mount({}), 'POST', `${PKGS}/publish`, { body: {} }),
    },
    {
      name: 'publish with a manifest missing id/version',
      status: 400,
      code: 'PACKAGE_MANIFEST_INVALID',
      run: () => drive(mount({}), 'POST', `${PKGS}/publish`, { body: { manifest: {}, metadata: {} } }),
    },
    {
      name: 'a publish the service refuses',
      status: 400,
      code: 'PACKAGE_PUBLISH_FAILED',
      run: () => drive(
        mount({ publish: async () => ({ success: false, error: 'version already published' }) }),
        'POST',
        `${PKGS}/publish`,
        { body: { manifest: MANIFEST, metadata: {} } },
      ),
    },
    {
      name: 'reading a package that does not exist',
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      run: () => drive(
        mount({ get: async () => undefined }),
        'GET',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.nope' } },
      ),
    },
    {
      // Was a bare `{ success: false, failed, cleanups }` — a failure with no
      // `error` at all.
      name: 'an uninstall that leaves items behind',
      status: 400,
      code: 'PACKAGE_DELETE_PARTIAL',
      run: () => drive(
        mount({}, {
          protocol: {
            deletePackage: async () => ({
              success: false, deletedCount: 1, failedCount: 2,
              failed: [{ type: 'object', name: 'invoice', error: 'in use' }],
              cleanups: [],
            }),
          },
        }),
        'DELETE',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
      ),
    },
    {
      // And the other one: a bare `{ success: false }`.
      name: 'a version-scoped delete the service refuses',
      status: 400,
      code: 'PACKAGE_DELETE_FAILED',
      run: () => drive(
        mount({ delete: async () => ({ success: false }) }),
        'DELETE',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' }, query: { version: '1.0.0' } },
      ),
    },
    {
      // NOT `GET /packages`: that route catches a failing `list()` in an INNER
      // try and degrades to the registry-only listing, so its 500 arm is
      // unreachable that way (pinned below). `GET /:id` has no inner catch.
      name: 'an unexpected throw from the package service',
      status: 500,
      code: 'INTERNAL_ERROR',
      run: () => drive(
        mount({ get: async () => { throw new Error('db down'); } }),
        'GET',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
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

      // The pre-#3675 shape, explicitly dead: `error` is no longer the message.
      expect(typeof body.error).not.toBe('string');
    });
  }

  it('a failure now always says why — the two bare `{ success: false }` bodies are gone', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      expect(body.error, `${c.name} reports failure with no error`).toBeDefined();
      expect(body.error.message.length, `${c.name} reports failure with no message`).toBeGreaterThan(0);
    }
  });

  it('GET /packages still degrades to a 200 registry-only listing when the database is down', async () => {
    // Pre-existing, deliberate (`// Database query failed — continue with
    // registry-only packages`) and unchanged by #3843 — recorded here because it
    // is why the 500 case above drives `GET /:id` instead.
    const { status, body } = await drive(
      mount({ list: async () => { throw new Error('db down'); } }, {
        protocol: { getMetaItems: async () => ({ items: [{ manifest: MANIFEST }] }) },
      }),
      'GET',
      PKGS,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.packages).toHaveLength(1);
  });

  it('a repeated `?version=` is refused identically on both verbs (#6307)', async () => {
    // The rule is one rule, so the two verbs must answer the SAME code, status
    // and message — two answers for one parameter would be a new inconsistency.
    const get = await drive(
      mount({ get: async () => ({ id: 'com.acme.crm', manifest: MANIFEST }) }),
      'GET',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' }, query: { version: ['1.0.0', '2.0.0'] } },
    );
    const del = await drive(
      mount({ delete: async () => ({ success: true }) }),
      'DELETE',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' }, query: { version: ['1.0.0', '2.0.0'] } },
    );
    expect(get.status).toBe(400);
    expect(del.status).toBe(400);
    expect(get.body).toEqual(del.body);
    expect(get.body.error.code).toBe('VALIDATION_ERROR');
    expect(get.body.error.message).toContain('"version"');
    expect(envelopeViolations(get.body)).toEqual([]);
    expect(BaseResponseSchema.safeParse(get.body).success).toBe(true);
  });

  it('a partial uninstall keeps its per-item detail under `error.details`', async () => {
    const { body } = await drive(
      mount({}, {
        protocol: {
          deletePackage: async () => ({
            success: false, deletedCount: 1, failedCount: 2,
            failed: [{ type: 'object', name: 'invoice', error: 'in use' }],
            cleanups: [{ name: 'security', success: true, removed: 1 }],
          }),
        },
      }),
      'DELETE',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );
    // The `failed` / `cleanups` arrays were top-level siblings of a bare
    // `success: false`; they survive where the envelope declares context.
    expect(body.error.details.failed).toHaveLength(1);
    expect(body.error.details.cleanups).toHaveLength(1);
  });
});

