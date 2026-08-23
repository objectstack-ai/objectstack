// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11063 — `GET /api/v1/packages` must not absorb a failed durable read.
 *
 * ## What was wrong, and why "still 200" was not a pin
 *
 * The list door merged two sources — the in-memory registry (via
 * `protocol.getMetaItems`) and the durable `sys_packages` rows (via
 * `PackageService.list()`) — and wrapped the durable half in a bare
 * `catch {}` commented *"Database query failed — continue with registry-only
 * packages"*. A failed durable read was therefore reported as a 200 whose
 * `total` claimed to be a COMPLETE count, and whose registrar-sourced entries
 * kept `source: 'registry'` — which reads as PROVENANCE, not as a warning that
 * the database half is absent. Nothing on the wire separated *"these are all
 * the packages"* from *"these are the packages I could still see"*.
 *
 * This is the standing family ruling — #10965 · #10677 / PR #10788 · #10789 /
 * PR #10964: **a read that could not happen must not be reported as a read that
 * found nothing.** Here it sat one level up, in a consumer-side catch rather
 * than in a flattener, which is why the producer-side fix could not close it.
 *
 * ⚠️ Asserting "the listing returns 200" passes on the OLD code, on the fixed
 * code, and on a wrong fix — it is the empty assertion this file exists to
 * avoid. Every case below pins the MECHANISM instead: which status and which
 * declared `code` reach the client when the durable read refuses, that `total`
 * is not reported at all over a read that failed, and that the two read doors
 * answer the same failure identically.
 *
 * ## Where the halves are pinned
 *
 * The PRODUCER half — that `PackageService.list()`/`get()` refuse with
 * `SERVICE_UNAVAILABLE` / 503 over a seam that accepted the query and returned
 * no result set — is measured on a real booted engine in
 * `packages/runtime/src/package-service.null-seam.test.ts` (#10965). This file
 * pins the DOOR half: that the declared refusal travels through the REST
 * envelope instead of being swallowed. The refusal is reproduced locally rather
 * than imported so this suite stays free of a cross-package VALUE import (and
 * of the build-state dependence one would carry — `@objectstack/service-package`
 * is not aliased to `src/` in this package's vitest config); the shape it
 * reproduces is `packageSeamUnreadableError()` in
 * `packages/services/service-package/src/index.ts`.
 *
 * ⛔ No wire field is added by the fix and none is asserted here. The card's
 * alternative — keep the 200 and carry a declared partial-result marker — is a
 * response-shape change, i.e. a contract decision, and was not authorized.
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

/** Only the methods these two read doors reach. */
type Svc = Partial<{
  list: () => Promise<any[]>;
  get: (id: string, version?: string) => Promise<any>;
}>;

/**
 * The #10965 refusal, reproduced: an ADR-0112 envelope ON THE ERROR — a
 * declared `status` AND a declared `code` — which is what lets it leave through
 * the door's shared `resolveThrownHttpError` mapping as the PRODUCER's answer
 * rather than as a 500 catch-all.
 */
function seamUnreadableError(): Error {
  return Object.assign(
    new Error(
      'The package registry could not be read: the storage seam accepted the query but returned no '
      + 'result set. Whether this package is installed is UNKNOWN — this is not an answer of "no".',
    ),
    { code: 'SERVICE_UNAVAILABLE', status: 503 },
  );
}

function mount(svc: Svc, options: any = {}) {
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
  // The authorization gate (#7033 / #7023) is not this file's subject, so the
  // caller is stubbed holding the ADR-0106 D4 read set.
  registerPackageRoutes(server, () => svc as any, '/api/v1', {
    resolveExecutionContext: async () => ({
      userId: 'u_pkg', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    }),
    ...options,
  });
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

const REGISTRY_MANIFEST = { id: 'com.acme.registry-only', version: '1.0.0' };

/** A registry half that DOES answer — so a swallowed durable failure would have
 *  something to answer 200 with, exactly as the defect did. */
const REGISTRY_PROTOCOL = {
  protocol: { getMetaItems: async () => ({ items: [{ manifest: REGISTRY_MANIFEST }] }) },
};

describe('#11063 GET /packages — a failed durable read reaches the client', () => {
  it('answers the producer’s declared refusal (503 SERVICE_UNAVAILABLE), not a 200', async () => {
    const { status, body } = await drive(
      mount({ list: async () => { throw seamUnreadableError(); } }, REGISTRY_PROTOCOL),
      'GET',
      PKGS,
    );

    // code AND status — the ADR-0112 envelope, never a bare `toThrow()` and
    // never a status on its own.
    expect(status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');

    // …carried in the DECLARED envelope, not an ad-hoc body.
    expect(BaseResponseSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(envelopeViolations(body), JSON.stringify(body)).toEqual([]);
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('reports NO `total` over a read that failed — the corrupted complete count is gone', async () => {
    const { status, body } = await drive(
      mount({ list: async () => { throw seamUnreadableError(); } }, REGISTRY_PROTOCOL),
      'GET',
      PKGS,
    );

    // The defect's signature: a `total` presented as a complete count while the
    // durable half was missing, and a `packages` array the caller could not
    // tell apart from a full listing.
    expect(status).not.toBe(200);
    expect(body.data?.total).toBeUndefined();
    expect(body.data?.packages).toBeUndefined();

    // And specifically NOT the registry-only listing served as if it were whole.
    expect(body.data?.packages).not.toEqual([
      expect.objectContaining({ source: 'registry' }),
    ]);
  });

  it('answers the SAME failure identically on both read doors (#11063 alignment)', async () => {
    // `GET /packages/:id` has never had an inner catch, so it has answered this
    // refusal since #10965. The list door disagreeing with it WAS the defect;
    // agreement is the fix, and it is worth one assertion.
    const list = await drive(
      mount({ list: async () => { throw seamUnreadableError(); } }, REGISTRY_PROTOCOL),
      'GET',
      PKGS,
    );
    const detail = await drive(
      mount({ get: async () => { throw seamUnreadableError(); } }, REGISTRY_PROTOCOL),
      'GET',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );

    expect(list.status).toBe(detail.status);
    expect(list.body.error.code).toBe(detail.body.error.code);
    expect(list.body.success).toBe(detail.body.success);
  });

  it('an UNDECLARED throw from the durable read is a 500 INTERNAL_ERROR, not a 200', async () => {
    // The other half of "stop absorbing": a throw carrying no declared envelope
    // is a server fault and now reaches the outer catch. Before the fix this
    // arm was unreachable on this route — which is why the sibling envelope
    // suite had to drive `GET /:id` to exercise it at all.
    const { status, body } = await drive(
      mount({ list: async () => { throw new Error('db down'); } }, REGISTRY_PROTOCOL),
      'GET',
      PKGS,
    );

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(envelopeViolations(body), JSON.stringify(body)).toEqual([]);
  });

  it('a durable read that ANSWERS still merges both sources and counts them truthfully', async () => {
    // The half that keeps this from being "refuse always": nothing about the
    // healthy path moved. Two sources, one overlapping id, and a `total` that
    // is a real complete count of what was really read.
    const { status, body } = await drive(
      mount(
        {
          list: async () => [
            { id: 'com.acme.registry-only', version: '1.0.0', manifest: REGISTRY_MANIFEST },
            { id: 'com.acme.published', version: '2.0.0', manifest: { id: 'com.acme.published' } },
          ],
        },
        REGISTRY_PROTOCOL,
      ),
      'GET',
      PKGS,
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.packages).toHaveLength(2);

    const bySource = Object.fromEntries(
      body.data.packages.map((p: any) => [p.manifest?.id ?? p.id, p.source]),
    );
    // The id both halves carry is `both`; the durable-only id is `database`.
    expect(bySource['com.acme.registry-only']).toBe('both');
    expect(bySource['com.acme.published']).toBe('database');
  });
});
