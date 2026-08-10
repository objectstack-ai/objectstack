// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `?version=` multiplicity on `/api/v1/packages/:id` (#6307).
 *
 * `IHttpRequest.query` is declared `Record<string, string | string[]>`, so a
 * repeated query parameter arrives as an ARRAY. Both handlers used it as a
 * string and handed the array straight to `PackageService`, whose parameter is
 * `version?: string`. Measured on `origin/main` before the fix:
 *
 *     GET    ?version=1.0.0&version=2.0.0 → packageService.get(id, ['1.0.0','2.0.0'])
 *     DELETE ?version=1.0.0&version=2.0.0 → packageService.delete(id, ['1.0.0','2.0.0'])
 *                                           …and `protocol.deletePackage` NOT called,
 *                                           answering 200 "Deleted com.acme.crm@1.0.0,2.0.0"
 *
 * The DELETE line is the sharp one: `if (!version && protocol.deletePackage)`
 * gates the FULL uninstall (metadata rows + the durable `sys_packages` record +
 * the registered data-plane cleanups, #2747). A truthy `version` skips it, so a
 * repeated parameter silently narrowed the operation's SCOPE and still reported
 * success. That is a wrong answer on a destructive verb, so the route refuses
 * the ambiguity instead of resolving it — see `readSingleQueryValue`.
 *
 * Observation-class: no user hits this today, because it takes a client that
 * repeats the parameter, and the Hono adapter collapses repeats to the first
 * value before a handler sees them. The `node:http` adapter does not (measured:
 * `NodeHttpServer` hands `['1.0.0','2.0.0']` through over a real socket), which
 * is why the consumer has to handle the shape its contract declares rather than
 * depend on which server booted.
 *
 * What these cases pin, in order: the single-value paths behave EXACTLY as
 * before (the fix is not allowed to move them), repetition is refused
 * identically on both verbs, and the full-uninstall branch is still reached
 * when no version is supplied at all.
 */

import { describe, it, expect } from 'vitest';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';
const ID = 'com.acme.crm';
const MANIFEST = { id: ID, version: '1.0.0' };

interface Captured { status: number; body: any }

/** Records every argument the service/protocol layer is handed. */
interface Spy {
  getVersions: unknown[];
  deleteVersions: unknown[];
  protocolCalls: number;
}

function harness(options: { protocol?: boolean } = {}) {
  const spy: Spy = { getVersions: [], deleteVersions: [], protocolCalls: 0 };
  const svc = {
    get: async (_id: string, version?: string) => {
      spy.getVersions.push(version);
      return { id: ID, manifest: MANIFEST };
    },
    delete: async (_id: string, version?: string) => {
      spy.deleteVersions.push(version);
      return { success: true };
    },
  };
  const opts = options.protocol
    ? {
        protocol: {
          deletePackage: async () => {
            spy.protocolCalls += 1;
            return { success: true, deletedCount: 3, failedCount: 0, failed: [], cleanups: [] };
          },
        },
      }
    : {};

  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: () => {},
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as any;
  // [#7033 / #7023] The package routes now carry an authorization gate that runs
  // BEFORE the `?version=` multiplicity check these cases pin. GET is a read
  // route and DELETE a write route, so the caller is stubbed to hold BOTH the
  // read set (`studio.access` / `setup.access`) and the write key
  // (`manage_metadata`) — every case here then reaches the multiplicity rule it
  // is named after. The gate itself is pinned in
  // `package-envelope.conformance.test.ts`'s `packages authz` describe.
  registerPackageRoutes(server, svc as any, '/api/v1', {
    resolveExecutionContext: async () => ({
      userId: 'u_pkg', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    }),
    ...opts,
  });

  const drive = async (method: 'GET' | 'DELETE', query: Record<string, any>): Promise<Captured> => {
    const handler = routes.get(`${method}:${PKGS}/:id`);
    if (!handler) throw new Error(`no handler for ${method}`);
    const captured: Captured = { status: 200, body: undefined };
    const res: any = {
      json(d: any) { captured.body = d; },
      send() {},
      status(c: number) { captured.status = c; return res; },
      header() { return res; },
    };
    await handler(
      { params: { id: ID }, query, body: undefined, headers: {}, method, path: `${PKGS}/:id` } as any,
      res,
    );
    return captured;
  };

  return { spy, drive };
}

describe('#6307 — a single `?version=` behaves exactly as before', () => {
  it('GET with one value passes that STRING through and answers the same body', async () => {
    const { spy, drive } = harness();
    const { status, body } = await drive('GET', { version: '1.0.0' });
    expect(spy.getVersions).toEqual(['1.0.0']);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { package: { id: ID, manifest: MANIFEST, source: 'database' } },
    });
  });

  it('GET with no version still asks for `latest`', async () => {
    const { spy, drive } = harness();
    await drive('GET', {});
    expect(spy.getVersions).toEqual(['latest']);
  });

  it('GET with an EMPTY `?version=` still asks for `latest` (falsy, as before)', async () => {
    const { spy, drive } = harness();
    await drive('GET', { version: '' });
    expect(spy.getVersions).toEqual(['latest']);
  });

  it('DELETE with one value stays version-scoped and answers the same body', async () => {
    const { spy, drive } = harness({ protocol: true });
    const { status, body } = await drive('DELETE', { version: '1.0.0' });
    expect(spy.deleteVersions).toEqual(['1.0.0']);
    expect(spy.protocolCalls).toBe(0);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: { message: `Deleted ${ID}@1.0.0` } });
  });
});

describe('#6307 — the full-uninstall branch is still reached without a version', () => {
  it('DELETE with NO version goes through protocol.deletePackage', async () => {
    const { spy, drive } = harness({ protocol: true });
    const { status, body } = await drive('DELETE', {});
    expect(spy.protocolCalls).toBe(1);
    expect(spy.deleteVersions).toEqual([]);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { message: `Deleted ${ID}`, deletedCount: 3, cleanups: [] },
    });
  });

  it('DELETE with an EMPTY `?version=` still uninstalls fully (falsy, as before)', async () => {
    const { spy, drive } = harness({ protocol: true });
    await drive('DELETE', { version: '' });
    expect(spy.protocolCalls).toBe(1);
  });

  it('DELETE with the parameter absent from an EMPTY array is no occurrence at all', async () => {
    // A contract-legal encoding of "not supplied". It must not be mistaken for
    // a version pin — that would silently narrow the uninstall again.
    const { spy, drive } = harness({ protocol: true });
    await drive('DELETE', { version: [] });
    expect(spy.protocolCalls).toBe(1);
  });
});

describe('#6307 — one occurrence encoded as a one-element array is still one occurrence', () => {
  it('GET accepts `[\'1.0.0\']` and unwraps it', async () => {
    const { spy, drive } = harness();
    const { status } = await drive('GET', { version: ['1.0.0'] });
    expect(status).toBe(200);
    expect(spy.getVersions).toEqual(['1.0.0']);
  });

  it('DELETE accepts `[\'1.0.0\']` and stays version-scoped', async () => {
    const { spy, drive } = harness({ protocol: true });
    const { status } = await drive('DELETE', { version: ['1.0.0'] });
    expect(status).toBe(200);
    expect(spy.deleteVersions).toEqual(['1.0.0']);
    expect(spy.protocolCalls).toBe(0);
  });
});

describe('#6307 — a REPEATED `?version=` is refused, not resolved', () => {
  it('GET answers 400 VALIDATION_ERROR and never reaches the service', async () => {
    const { spy, drive } = harness();
    const { status, body } = await drive('GET', { version: ['1.0.0', '2.0.0'] });
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('"version"');
    expect(body.error.message).toContain('2 times');
    // The array never reaches `version?: string`.
    expect(spy.getVersions).toEqual([]);
  });

  it('DELETE answers 400 and performs NO deletion of either kind', async () => {
    // The defect answered 200 here, having quietly skipped the full uninstall
    // and asked the durable registry to delete "1.0.0,2.0.0".
    const { spy, drive } = harness({ protocol: true });
    const { status, body } = await drive('DELETE', { version: ['1.0.0', '2.0.0'] });
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(spy.deleteVersions).toEqual([]);
    expect(spy.protocolCalls).toBe(0);
  });

  it('both verbs answer the identical body — one rule, one answer', async () => {
    const g = await harness().drive('GET', { version: ['a', 'b'] });
    const d = await harness({ protocol: true }).drive('DELETE', { version: ['a', 'b'] });
    expect(g.status).toBe(d.status);
    expect(g.body).toEqual(d.body);
  });

  it('two IDENTICAL values are still two occurrences, and still refused', async () => {
    // Deliberate: the rule is "supply it at most once", which a client can check
    // without knowing our semantics. "at most one DISTINCT value" would be a
    // de-duplication rule nobody can predict.
    const { spy, drive } = harness({ protocol: true });
    const { status } = await drive('DELETE', { version: ['1.0.0', '1.0.0'] });
    expect(status).toBe(400);
    expect(spy.protocolCalls).toBe(0);
  });

  it('three or more occurrences are reported by count', async () => {
    const { body } = await harness().drive('GET', { version: ['1', '2', '3'] });
    expect(body.error.message).toContain('3 times');
  });
});
