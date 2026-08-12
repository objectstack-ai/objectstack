// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Datasource-admin route-ledger conformance (#7744) — the guard that keeps the
 * autonomously-mounted datasource-admin surface and `@objectstack/client` from
 * drifting apart silently, mirroring the storage (#3636) and i18n (#3636)
 * guards.
 *
 * Directions made loud here:
 *
 *  1. A route `registerDatasourceAdminRoutes` mounts with no ledger entry — a
 *     new route landed without a reviewed SDK disposition. This is the
 *     direction that was open when #7744 was filed: all ten routes were in it.
 *  2. A ledger entry for a route the registrar no longer mounts — the ledger
 *     went stale.
 *
 * ENUMERATION IS DERIVED, NOT TRANSCRIBED, and that is the whole point of the
 * file. The registrar runs against a capturing mock `IHttpServer` and its
 * registration calls ARE the route set — the same seam the two tranche-3
 * ledgers use. No path literal in this file is compared against the mount: a
 * hand-copied expectation would go green on a ledger that agrees with the test
 * and disagrees with the server, which is exactly the class of gap #7744
 * reported (the REST ledger spelled the family `/external/tables` while the
 * mount said `/remote-tables`, and nothing was comparing either to a mount).
 * Add an eleventh route and this file fails until it is ledgered.
 *
 * The third direction — "every `sdk` row names a client method that exists" —
 * lives in `packages/client/src/service-route-ledger-coverage.test.ts`, next to
 * the SDK it introspects: a service→client package edge would be backwards.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerDatasourceAdminRoutes } from './admin-routes.js';
import { DATASOURCE_ROUTE_LEDGER } from './datasource-route-ledger.js';

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
 * The context is never consulted during registration — every handler resolves
 * its service per request through `resolve()`, which is what lets the family
 * answer 503 rather than record a boot-time verdict about a service that may
 * still register (AGENTS.md, "never record a verdict the boot can still
 * contradict"). So a context that answers `undefined` for everything still
 * enumerates the full surface.
 */
function enumerateDatasourceAdminRoutes(): Set<string> {
  const server = createMockServer();
  const ctx = { getService: () => undefined, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  registerDatasourceAdminRoutes(server as never, ctx as never, '/api/v1');
  const keys = new Set<string>();
  for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    for (const call of server[verb].mock.calls) {
      keys.add(`${verb.toUpperCase()} ${String(call[0])}`);
    }
  }
  return keys;
}

const ledgerKeys = (): Set<string> => new Set(DATASOURCE_ROUTE_LEDGER.map((e) => e.route));

describe('datasource-admin route ledger ↔ registerDatasourceAdminRoutes enumeration', () => {
  it('every mounted datasource-admin route has a ledger entry', () => {
    const ledger = ledgerKeys();
    const missing = [...enumerateDatasourceAdminRoutes()].filter((k) => !ledger.has(k));
    expect(
      missing,
      `Datasource-admin routes with no datasource-route-ledger entry: ${missing.join(', ')}. ` +
        'A new route needs a reviewed disposition in datasource-route-ledger.ts (#7744).',
    ).toEqual([]);
  });

  it('every ledger entry is really mounted by the registrar', () => {
    const live = enumerateDatasourceAdminRoutes();
    const stale = [...ledgerKeys()].filter((k) => !live.has(k));
    expect(
      stale,
      `datasource-route-ledger entries the registrar no longer mounts: ${stale.join(', ')}. ` +
        'Remove or reclassify them so the ledger stays truthful.',
    ).toEqual([]);
  });

  it('no route is ledgered twice', () => {
    const seen = new Set<string>();
    const dupes = DATASOURCE_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
    expect(dupes, `duplicate datasource-route-ledger rows: ${dupes.join(', ')}`).toEqual([]);
  });

  it('the ledger is compared against a real enumeration, not an empty one', () => {
    // Absence must be loud (AGENTS.md, Route & surface ownership §3). Both
    // set-difference assertions above pass vacuously if the registrar ever
    // stops registering — a refactor that moves the mount elsewhere, or a mock
    // whose recorded calls stop being readable, would leave this file green
    // while guarding nothing. So assert the enumeration produced something,
    // and that the two sides are the same size rather than merely non-conflicting.
    const live = enumerateDatasourceAdminRoutes();
    expect(live.size).toBeGreaterThan(0);
    expect(live.size).toBe(ledgerKeys().size);
  });

  it('carries the LIVE admin spelling of the introspection route, not the federation one', () => {
    // The #7744 regression pin, stated as the card states it. `/remote-tables`
    // is what `admin-routes.ts` mounts; `/external/tables` is the separate
    // federation route in packages/rest, ledgered there. Reading the value out
    // of the ENUMERATION rather than asserting a literal is what keeps this an
    // assertion about the mount: if the mount were ever renamed, the row this
    // resolves would follow it — while the first two assertions above would
    // still catch the rename as a ledger diff.
    const live = enumerateDatasourceAdminRoutes();
    const introspection = [...live].filter((k) => k.includes('remote-tables'));
    expect(introspection).not.toEqual([]);
    for (const key of introspection) {
      expect(
        ledgerKeys().has(key),
        `${key} is mounted but unledgered — the #7744 gap, reopened.`,
      ).toBe(true);
    }
    // And the federation spelling is NOT this ledger's business: it belongs to
    // packages/rest, whose own conformance guard would fail if it moved here.
    expect([...ledgerKeys()].filter((k) => k.includes('/external/'))).toEqual([]);
  });
});

describe('datasource-admin route ledger hygiene', () => {
  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = DATASOURCE_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = DATASOURCE_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap and mismatch counts only shrink — update the ledger (and these numbers) when closing them', () => {
    // Ratchet, not aspiration. The family audited at #7744 as ten reviewed
    // `server-only` rows: no client method and no CLI command reaches any of
    // them, and they are mounted by `objectstack serve` rather than by
    // `@objectstack/rest`. Zero is therefore the measured state, not an
    // aspiration — and a `gap` row here would be a product decision to give
    // the SDK a datasource-lifecycle surface, which needs its own review.
    const gaps = DATASOURCE_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(0);

    const mismatches = DATASOURCE_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length;
    expect(mismatches).toBeLessThanOrEqual(0);
  });
});
