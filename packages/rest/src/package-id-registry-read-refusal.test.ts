// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11376 — `GET /api/v1/packages/:id` must not answer a terminal `404` for a
 * REGISTRY read that could not happen.
 *
 * ## What was wrong, and why it is the WORSE half of this family
 *
 * The detail door tries the durable `sys_packages` read first
 * (`PackageService.get()`) and falls back to the in-memory registry (via
 * `protocol.getMetaItems({ type: 'package' })`). The fallback carried its own:
 *
 *     } catch {
 *       // Protocol unavailable
 *     }
 *
 * so when `getMetaItems` threw, control fell straight through to the line
 * below it and the door answered
 * **`404 RESOURCE_NOT_FOUND` — `Package "<id>" was not found.`**
 *
 * Its sibling on the list door (#11130) answered a `200` whose `total`
 * under-counted. This one answers a TERMINAL NEGATIVE FACT. `404` /
 * `RESOURCE_NOT_FOUND` is not "the answer may be incomplete", it is *"this
 * package does not exist"*, and a caller acts on it: an installer decides the
 * package is not installed and offers to install it, a console hides the entry,
 * a script branches to the create path. The producer's own words for the same
 * condition are the opposite — *"whether this item exists is unknown"*.
 *
 * Standing family ruling — #10965 · #10677 / PR #10788 · #10789 / PR #10964 ·
 * #11063 · #11130: **a read that could not happen must not be reported as a
 * read that found nothing.** The direction here is INHERITED from those
 * siblings and transplanted, not redesigned: the repair is #11063's and
 * #11130's edit — delete the consumer-side catch and let the producer's
 * declared refusal through `sendThrownError`.
 *
 * ## The producer half is already landed
 *
 * The live `protocol` service is `ObjectStackProtocolImplementation`
 * (`packages/metadata-protocol`), whose `getMetaItems` routes every non-benign
 * `sys_metadata` overlay read failure through
 * `rethrowUnlessMetadataStoreUnprovisioned` → `metadataStoreUnavailableError`:
 * `SERVICE_UNAVAILABLE` / 503 with an ADR-0112 status+code ON the error, pinned
 * on the REAL implementation in
 * `packages/metadata-protocol/src/protocol.metadata-store-outage.test.ts`
 * (#5532). This door's catch was #5532's own defect resurfacing one layer up:
 * the producer was taught not to call an unreadable store "absent", and this
 * consumer re-applied exactly that relabelling to the producer's answer.
 *
 * The refusal is reproduced locally rather than imported, for the reason both
 * siblings state: this suite stays free of a cross-package VALUE import (and of
 * the build-state dependence it would carry), and `packages/rest` deliberately
 * has no run-time dependency on `@objectstack/metadata-protocol` at all. The
 * shape it reproduces is `metadataStoreUnavailableError()` in
 * `packages/metadata-protocol/src/protocol.ts`.
 *
 * ## What this file pins: the DISCRIMINATION, in both directions
 *
 * The defect is that a failed read was INDISTINGUISHABLE from an absent
 * resource. Pinning only the new branch would leave "answer 500 for everything"
 * passing, so §2 is as load-bearing as §1: a genuine miss, an absent protocol
 * service, a registry hit and a database hit all keep the answers they had.
 * §2's last case states the discrimination itself — the same request, against a
 * registry that REFUSES and a registry that reads clean and empty, must not
 * produce the same answer.
 *
 * ⚠️ No case here asserts a bare `toThrow()` or a status on its own: every
 * refusal is pinned as `code` AND `status` in the ADR-0112 envelope.
 *
 * ⛔ No wire field is added by the fix and none is asserted here — the response
 * shape is a contract decision this card does not carry.
 *
 * ## Anti-vacuity — directions predicted BEFORE running, measured after
 *
 * Baseline leg: this file run with ONLY `package-routes.ts` reverted to
 * `origin/main` (the fix committed first; revert via
 * `git checkout origin/main -- <path>`, restore via
 * `git checkout <branch> -- <path>`, both under a `trap … EXIT INT TERM`), and
 * the mutation confirmed ON DISK by anchored greps in both directions rather
 * than by an editor's exit code.
 *
 * No rebuild between legs, and the claim was checked rather than assumed: the
 * mutated symbol is reached by the RELATIVE import `./package-routes.js` inside
 * this package, which vitest transforms from source, and the only
 * `exports`-resolved workspace deps in this suite (`@objectstack/spec/api`,
 * `@objectstack/types`) are untouched by the mutation. An all-green ablation
 * leg would have been the stale-artifact signature; it was not what happened.
 *
 *   §1 predicted RED 3 / GREEN 0   measured 3 red — as predicted.
 *   §2 predicted RED 1 / GREEN 4   measured 1 red (the discrimination case) — as
 *      predicted. The four controls are green on BOTH sides, which is what makes
 *      them controls.
 *   §3 predicted RED 2 / GREEN 1   measured 2 red — as predicted. The green one
 *      is the durable half, which has answered 503 since #10965.
 *
 *   Total 6 of 11 red, as predicted. Predictions are left as written, per this
 *   repo's rule that a wrong prediction is reported rather than fitted to the
 *   measurement.
 */

import { describe, it, expect, vi } from 'vitest';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';
const PKG_ID = '/api/v1/packages/:id';
const WANTED = 'com.acme.crm';

interface Captured {
  status: number;
  body: any;
}

/** Only the methods these read doors reach. */
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

/** `GET /packages/:id` for the id every case below asks for. */
const getWanted = (routes: Map<string, RouteHandler>) =>
  drive(routes, 'GET', PKG_ID, { params: { id: WANTED } });

/**
 * A durable half that ANSWERS and does not hold the id — so the door really
 * reaches the registry fallback, exactly as the defect did. `undefined` is what
 * `PackageService.get()` returns for a row that is not there.
 */
const DURABLE_MISS: Svc = { get: async () => undefined };

/** A registry half whose PRESENT `getMetaItems` refuses with the declared 503. */
const REFUSING_REGISTRY = {
  protocol: { getMetaItems: async () => { throw metadataStoreUnavailable(); } },
};

/** A registry half that reads fine and genuinely holds nothing. */
const EMPTY_REGISTRY = {
  protocol: { getMetaItems: async () => ({ items: [] }) },
};

// ---------------------------------------------------------------------------
// §1 The failed REGISTRY read reaches the client
// ---------------------------------------------------------------------------

describe('#11376 GET /packages/:id — a failed REGISTRY read is not a 404', () => {
  it('answers the producer’s declared refusal (503 SERVICE_UNAVAILABLE) in the declared envelope', async () => {
    const { status, body } = await getWanted(mount(DURABLE_MISS, REFUSING_REGISTRY));

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

  it('the TERMINAL negative fact is gone — no 404, no RESOURCE_NOT_FOUND, no “was not found”', async () => {
    const { status, body } = await getWanted(mount(DURABLE_MISS, REFUSING_REGISTRY));

    // The defect's exact signature, asserted as the thing that must NOT be on
    // the wire: a caller told the package does not exist branches to install /
    // create / hide, and none of those is a correct response to an outage.
    expect(status).not.toBe(404);
    expect(body.error.code).not.toBe('RESOURCE_NOT_FOUND');
    expect(JSON.stringify(body)).not.toContain('was not found');
    expect(body.data?.package).toBeUndefined();
  });

  it('an UNDECLARED throw from the registry read is a 500 INTERNAL_ERROR, not a 404', async () => {
    // The other half of "stop absorbing": a throw carrying no declared envelope
    // is a server fault and now reaches the outer catch. Before this change the
    // arm was unreachable on this source — the bare `catch {}` ate it too and
    // answered the same 404 as a genuine miss.
    const { status, body } = await getWanted(mount(DURABLE_MISS, {
      protocol: { getMetaItems: async () => { throw new Error('registry exploded'); } },
    }));

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(envelopeViolations(body), JSON.stringify(body)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 The DISCRIMINATION the fix must preserve — the other direction
//
// Without these, "answer 503 for everything" and "answer 500 for everything"
// both pass §1. A genuine absence is still a genuine absence.
// ---------------------------------------------------------------------------

describe('#11376 GET /packages/:id — a genuine miss is still a terminal 404', () => {
  it('CONTROL — both sources read fine and neither holds the id: 404 RESOURCE_NOT_FOUND', async () => {
    const { status, body } = await getWanted(mount(DURABLE_MISS, EMPTY_REGISTRY));

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.error.message).toContain(WANTED);
    expect(envelopeViolations(body), JSON.stringify(body)).toEqual([]);
  });

  it('CONTROL — an ABSENT protocol service is an absence, not a failed read: still 404', async () => {
    // The overreach guard. `if (options.protocol && typeof … === 'function')`
    // answers "no registry in this composition", which is a fact about the
    // deployment rather than a read that failed. A fix that turned those
    // deployments into 503s would break every one of them; nothing about that
    // path moved.
    const { status, body } = await getWanted(mount(DURABLE_MISS, {}));

    expect(status).toBe(404);
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('CONTROL — a registry HIT still answers 200 with `source: "registry"`', async () => {
    const { status, body } = await getWanted(mount(DURABLE_MISS, {
      protocol: {
        getMetaItems: async () => ({ items: [{ manifest: { id: WANTED, version: '1.0.0' } }] }),
      },
    }));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.package.source).toBe('registry');
    expect(body.data.package.manifest.id).toBe(WANTED);
  });

  it('CONTROL — a DATABASE hit still answers 200 and never consults the registry', async () => {
    // The durable read is tried first and short-circuits. Pinned with a spy so
    // "the registry is not even asked" is measured, not inferred: a refusing
    // registry must not be able to turn a successful durable read into a 503.
    const getMetaItems = vi.fn(async () => { throw metadataStoreUnavailable(); });
    const { status, body } = await getWanted(mount(
      { get: async () => ({ id: WANTED, version: '2.0.0', manifest: { id: WANTED, version: '2.0.0' } }) },
      { protocol: { getMetaItems } },
    ));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.package.source).toBe('database');
    expect(getMetaItems).not.toHaveBeenCalled();
  });

  it('the DISCRIMINATION itself: an outage and a clean-empty registry no longer answer alike', async () => {
    // One request, two registries. This is the defect stated directly — before
    // the fix both of these were `404 RESOURCE_NOT_FOUND` and a caller had
    // nothing on the wire to tell "this package does not exist" from "I could
    // not find out". Asserted as a DIFFERENCE so it cannot be satisfied by
    // moving both answers together.
    const outage = await getWanted(mount(DURABLE_MISS, REFUSING_REGISTRY));
    const miss = await getWanted(mount(DURABLE_MISS, EMPTY_REGISTRY));

    expect(outage.status).not.toBe(miss.status);
    expect(outage.body.error.code).not.toBe(miss.body.error.code);
    expect(miss.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(outage.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// §3 One outage, one answer — across the halves of this door and across doors
// ---------------------------------------------------------------------------

describe('#11376 the same metadata-store outage answers identically everywhere', () => {
  it('CONTROL — the DURABLE half of this door already answered 503, and still does', async () => {
    // Green before and after: `PackageService.get()` has never had an inner
    // catch, so its #10965 refusal has reached `sendThrownError` all along.
    // That is also the measurement behind this card's `Clause-②` answer — 503
    // was already a reachable answer on this exact route, so letting the
    // registry half reach it too adds no status to the door's answer set.
    const { status, body } = await getWanted(mount(
      { get: async () => { throw metadataStoreUnavailable(); } },
      EMPTY_REGISTRY,
    ));

    expect(status).toBe(503);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('both HALVES of this door answer the same outage identically', async () => {
    // Which of the two stores is down is an implementation detail of the
    // merge, never a fact about the caller's request. Agreement is the fix.
    const registryHalf = await getWanted(mount(DURABLE_MISS, REFUSING_REGISTRY));
    const durableHalf = await getWanted(mount(
      { get: async () => { throw metadataStoreUnavailable(); } },
      EMPTY_REGISTRY,
    ));

    expect(registryHalf.status).toBe(durableHalf.status);
    expect(registryHalf.body.error.code).toBe(durableHalf.body.error.code);
    expect(registryHalf.body.success).toBe(durableHalf.body.success);
  });

  it('the DETAIL door and the LIST door answer the same registry outage identically', async () => {
    // #11130 fixed the list door's registry half; the detail door answering a
    // terminal 404 for the same outage was the surviving inconsistency — and
    // the more dangerous of the two answers.
    const detail = await getWanted(mount(DURABLE_MISS, REFUSING_REGISTRY));
    const list = await drive(
      mount({ list: async () => [] }, REFUSING_REGISTRY),
      'GET',
      PKGS,
    );

    expect(detail.status).toBe(list.status);
    expect(detail.body.error.code).toBe(list.body.error.code);
  });
});
