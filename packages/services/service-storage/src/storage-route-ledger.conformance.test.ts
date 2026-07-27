// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Storage route-ledger conformance (#3636) — the guard that keeps the
 * autonomously-mounted storage surface and `@objectstack/client` from drifting
 * apart silently, mirroring the dispatcher guard (#3569) and the REST guard
 * (#3587).
 *
 * Directions made loud here:
 *
 *  1. A route `registerStorageRoutes` mounts with no ledger entry — a new
 *     route landed without a reviewed SDK disposition.
 *  2. A ledger entry for a route the registrar no longer mounts — the ledger
 *     went stale.
 *
 * Enumeration is real, not a hand-pinned list: the registrar runs against a
 * capturing mock `IHttpServer` and its registration calls ARE the route set —
 * the same seam tranche 2 used for the two RouteManager-bypassing registrars.
 *
 * The third direction — "every `sdk` row names a client method that exists" —
 * lives in `packages/client/src/service-route-ledger-coverage.test.ts`, next
 * to the SDK it introspects: a service→client package edge would be backwards
 * (the routes are declared here, so the ledger lives here) and each package
 * verifies its own half.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerStorageRoutes } from './storage-routes';
import { STORAGE_ROUTE_LEDGER } from './storage-route-ledger';

/** Minimal IHttpServer mock that records registrations. */
function createMockServer() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * `VERB /path` keys for every route the registrar mounts at the DEFAULT base.
 *
 * Registration only closes over `storage`/`store` — nothing is called until a
 * request arrives — so bare stubs enumerate the full surface. Options are left
 * empty on purpose: no storage route is opt-in, and any that became so would
 * surface here as a ledger diff rather than vanishing silently.
 */
function enumerateStorageRoutes(): Set<string> {
  const server = createMockServer();
  registerStorageRoutes(server as any, {} as any, {} as any);
  const keys = new Set<string>();
  for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    for (const call of server[verb].mock.calls) {
      keys.add(`${verb.toUpperCase()} ${call[0]}`);
    }
  }
  return keys;
}

const ledgerKeys = (): Set<string> => new Set(STORAGE_ROUTE_LEDGER.map((e) => e.route));

describe('storage route ledger ↔ registerStorageRoutes enumeration', () => {
  it('every mounted storage route has a ledger entry', () => {
    const ledger = ledgerKeys();
    const missing = [...enumerateStorageRoutes()].filter((k) => !ledger.has(k));
    expect(
      missing,
      `Storage routes with no storage-route-ledger entry: ${missing.join(', ')}. ` +
        'A new route needs a reviewed disposition in storage-route-ledger.ts (#3636).',
    ).toEqual([]);
  });

  it('every ledger entry is really mounted by the registrar', () => {
    const live = enumerateStorageRoutes();
    const stale = [...ledgerKeys()].filter((k) => !live.has(k));
    expect(
      stale,
      `storage-route-ledger entries the registrar no longer mounts: ${stale.join(', ')}. ` +
        'Remove or reclassify them so the ledger stays truthful.',
    ).toEqual([]);
  });

  it('no route is ledgered twice', () => {
    const seen = new Set<string>();
    const dupes = STORAGE_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
    expect(dupes, `duplicate storage-route-ledger rows: ${dupes.join(', ')}`).toEqual([]);
  });
});

describe('storage route ledger hygiene', () => {
  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = STORAGE_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = STORAGE_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap and mismatch counts only shrink — update the ledger (and these numbers) when closing them', () => {
    // Ratchet, not aspiration. The storage surface audited CLEAN at #3636:
    // seven routes carry SDK expression, three are reviewed `server-only`
    // (the browser capability URL and the two local-driver loopbacks). Every
    // storage route is therefore either SDK-expressed or explicitly not SDK
    // surface — a new `gap` or `mismatch` row demands a reviewed decision, so
    // these bounds stay 0.
    const gaps = STORAGE_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(0);

    const mismatches = STORAGE_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length;
    expect(mismatches).toBeLessThanOrEqual(0);
  });
});
