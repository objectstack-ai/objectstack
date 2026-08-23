// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11130 — `GET /api/v1/packages` must not absorb a failed REGISTRY read either.
 *
 * ## What was wrong
 *
 * The list door merges TWO sources — the in-memory registry (via
 * `protocol.getMetaItems({ type: 'package' })`) and the durable `sys_packages`
 * rows (via `PackageService.list()`). #11063 stopped the door absorbing a
 * failure of the DURABLE half. The REGISTRY half still carried its own:
 *
 *     } catch {
 *       // Protocol unavailable — continue with database only
 *     }
 *
 * so the exact ambiguity #11063 closed stayed open on the other half: when
 * `getMetaItems` threw, the door answered `200` with `{ packages, total }` built
 * from the database alone, and `total` was reported as a COMPLETE count either
 * way. The surviving entries kept `source: 'database'`, which reads as
 * PROVENANCE, not as a warning that the registry half is absent. Nothing on the
 * wire separated *"these are all the packages"* from *"these are the packages I
 * could still see"*.
 *
 * Standing family ruling — #10965 · #10677 / PR #10788 · #10789 / PR #10964 ·
 * #11063: **a read that could not happen must not be reported as a read that
 * found nothing.**
 *
 * ## Why the producer half of route (b) is already landed
 *
 * The card's route (b) is "teach the producer to declare a refusal, then stop
 * swallowing it". Measured before this change: the producer ALREADY declares
 * it. The live `protocol` service is
 * `ObjectStackProtocolImplementation` (`packages/metadata-protocol`), whose
 * `getMetaItems` routes every non-benign `sys_metadata` read failure through
 * `rethrowUnlessMetadataStoreUnprovisioned` → `metadataStoreUnavailableError`,
 * i.e. `SERVICE_UNAVAILABLE` / 503 with an ADR-0112 status+code on the error —
 * the same envelope #10965 gave `PackageService.list()`. That producer behaviour
 * is pinned on the REAL implementation in
 * `packages/metadata-protocol/src/protocol.metadata-store-outage.test.ts`
 * (#5532). So the only leg left for this door is #11063's: stop swallowing.
 *
 * ⚠️ Asserting "the listing returns 200" passes on the OLD code, on the fixed
 * code, and on a wrong fix. Every case below pins the MECHANISM instead: which
 * status and which declared `code` reach the client, that `total` is not
 * reported at all over a read that failed, and that the two HALVES of one merge
 * answer the same failure identically.
 *
 * The refusal is reproduced locally rather than imported, for the reason the
 * #11063 sibling states: this suite stays free of a cross-package VALUE import
 * (and of the build-state dependence it would carry) — and `packages/rest`
 * deliberately has no run-time dependency on `@objectstack/metadata-protocol`
 * at all. The shape it reproduces is `metadataStoreUnavailableError()` in
 * `packages/metadata-protocol/src/protocol.ts`.
 *
 * ⛔ No wire field is added by the fix and none is asserted here. Shape (c) —
 * keep the 200 and make the tolerance visible with a partial-result marker — is
 * a response-shape change, i.e. a contract decision this queue entry does not
 * carry.
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

/** Only the methods this read door reaches. */
type Svc = Partial<{
  list: () => Promise<any[]>;
  get: (id: string, version?: string) => Promise<any>;
}>;

/**
 * The #5532 refusal `ObjectStackProtocolImplementation.getMetaItems` raises when
 * the `sys_metadata` overlay read fails for any reason other than "the table is
 * not provisioned yet", reproduced: an ADR-0112 envelope ON THE ERROR — a
 * declared `status` AND a declared `code` — which is what lets it leave through
 * the door's shared `resolveThrownHttpError` mapping as the PRODUCER's answer
 * rather than as a 500 catch-all.
 */
function metadataStoreUnavailable(): Error {
  return Object.assign(
    new Error(
      'The metadata store could not be read, so whether this item exists is unknown. '
      + 'Retry once the metadata database is reachable.',
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

const DB_MANIFEST = { id: 'com.acme.published', version: '2.0.0' };

/** A durable half that DOES answer — so a swallowed registry failure has
 *  something to answer 200 with, exactly as the defect did. */
const DURABLE_ROWS: Svc = {
  list: async () => [{ id: 'com.acme.published', version: '2.0.0', manifest: DB_MANIFEST }],
};

/** A registry half whose PRESENT `getMetaItems` refuses with the declared 503. */
const REFUSING_REGISTRY = {
  protocol: { getMetaItems: async () => { throw metadataStoreUnavailable(); } },
};

describe('#11130 GET /packages — a failed REGISTRY read reaches the client', () => {
  it('answers the producer’s declared refusal (503 SERVICE_UNAVAILABLE), not a 200', async () => {
    const { status, body } = await drive(mount(DURABLE_ROWS, REFUSING_REGISTRY), 'GET', PKGS);

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
    const { status, body } = await drive(mount(DURABLE_ROWS, REFUSING_REGISTRY), 'GET', PKGS);

    // The defect's signature: a `total` presented as a complete count while the
    // registry half was missing, and a `packages` array the caller could not
    // tell apart from a full listing.
    expect(status).not.toBe(200);
    expect(body.data?.total).toBeUndefined();
    expect(body.data?.packages).toBeUndefined();

    // And specifically NOT the database-only listing served as if it were whole.
    expect(body.data?.packages).not.toEqual([
      expect.objectContaining({ source: 'database' }),
    ]);
  });

  it('answers the SAME failure identically whichever HALF of the merge refuses', async () => {
    // One door, two sources. #11063 made the durable half answer the producer's
    // refusal; a registry half that still swallowed meant the SAME outage got
    // two different answers depending on which store was down. Agreement is the
    // fix, and it is worth one assertion.
    const registryHalf = await drive(mount(DURABLE_ROWS, REFUSING_REGISTRY), 'GET', PKGS);
    const durableHalf = await drive(
      mount(
        { list: async () => { throw metadataStoreUnavailable(); } },
        { protocol: { getMetaItems: async () => ({ items: [] }) } },
      ),
      'GET',
      PKGS,
    );

    expect(registryHalf.status).toBe(durableHalf.status);
    expect(registryHalf.body.error.code).toBe(durableHalf.body.error.code);
    expect(registryHalf.body.success).toBe(durableHalf.body.success);
  });

  it('an UNDECLARED throw from the registry read is a 500 INTERNAL_ERROR, not a 200', async () => {
    // The other half of "stop absorbing": a throw carrying no declared envelope
    // is a server fault and now reaches the outer catch. Before this change the
    // arm was unreachable on this source — the bare `catch {}` ate it too.
    const { status, body } = await drive(
      mount(DURABLE_ROWS, {
        protocol: { getMetaItems: async () => { throw new Error('registry exploded'); } },
      }),
      'GET',
      PKGS,
    );

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(envelopeViolations(body), JSON.stringify(body)).toEqual([]);
  });

  it('an ABSENT protocol service is still the different, HANDLED case — 200, database only', async () => {
    // The overreach guard. The `if (options.protocol && typeof … === 'function')`
    // guard answers "no registry here", which is a fact, not a failed read; a
    // fix that turned a composition without the protocol service into a 503
    // would break every such deployment. Nothing about that path moved.
    const { status, body } = await drive(mount(DURABLE_ROWS, {}), 'GET', PKGS);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(1);
    expect(body.data.packages[0].source).toBe('database');
  });

  it('a registry read that ANSWERS still merges both sources and counts them truthfully', async () => {
    // The half that keeps this from being "refuse always": nothing about the
    // healthy path moved. Two sources, one overlapping id, and a `total` that is
    // a real complete count of what was really read.
    const { status, body } = await drive(
      mount(
        {
          list: async () => [
            { id: 'com.acme.published', version: '2.0.0', manifest: DB_MANIFEST },
            { id: 'com.acme.both', version: '1.0.0', manifest: { id: 'com.acme.both' } },
          ],
        },
        {
          protocol: {
            getMetaItems: async () => ({
              items: [
                { manifest: { id: 'com.acme.both', version: '1.0.0' } },
                { manifest: { id: 'com.acme.registry-only', version: '1.0.0' } },
              ],
            }),
          },
        },
      ),
      'GET',
      PKGS,
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(3);
    expect(body.data.packages).toHaveLength(3);

    const bySource = Object.fromEntries(
      body.data.packages.map((p: any) => [p.manifest?.id ?? p.id, p.source]),
    );
    expect(bySource['com.acme.registry-only']).toBe('registry');
    expect(bySource['com.acme.published']).toBe('database');
    expect(bySource['com.acme.both']).toBe('both');
  });
});
