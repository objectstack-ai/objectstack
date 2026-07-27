// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST route-ledger conformance (#3587) — the guard that keeps the REST
 * server's route surface and `@objectstack/client` from drifting apart
 * silently, mirroring the dispatcher guard (#3569).
 *
 * Directions made loud here:
 *
 *  1. A route mounted by `@objectstack/rest` with no ledger entry — a new
 *     route landed without a reviewed SDK disposition.
 *  2. A ledger entry for a route the server no longer mounts — the ledger
 *     went stale.
 *
 * Enumeration is real on BOTH sources: `route-manager` rows against
 * `RestServer.getRoutes()` (the introspection seam RouteManager already
 * provides), and `direct-mount` rows against the registration calls the two
 * bypass registrars make on a mock `IHttpServer` — no pinned-by-hand list.
 *
 * The third direction — "every `sdk` row names a client method that exists" —
 * lives in `packages/client/src/rest-route-ledger-coverage.test.ts`, next to
 * the SDK it introspects, for the same build-cycle reason as tranche 1: a
 * rest→client edge is unbuildable (client's devDeps already reach back into
 * the server packages, and CI's per-package test tasks build only their own
 * dependency closure).
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';
import { registerPackageRoutes } from './package-routes';
import { registerExternalDatasourceRoutes } from './external-datasource-routes';
import { REST_ROUTE_LEDGER } from './rest-route-ledger';

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
 * Protocol mock with the batch capabilities present so the four
 * protocol-capability-gated batch routes register (rest-server.ts).
 */
function createCapableProtocol() {
  return {
    getDiscovery: vi.fn().mockResolvedValue({}),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockResolvedValue({}),
    findData: vi.fn().mockResolvedValue([]),
    getData: vi.fn().mockResolvedValue({}),
    createData: vi.fn().mockResolvedValue({ id: '1' }),
    updateData: vi.fn().mockResolvedValue({}),
    deleteData: vi.fn().mockResolvedValue({ success: true }),
    batchData: vi.fn().mockResolvedValue({}),
    createManyData: vi.fn().mockResolvedValue([]),
    updateManyData: vi.fn().mockResolvedValue([]),
    deleteManyData: vi.fn().mockResolvedValue([]),
  };
}

/** `VERB /path` keys for every route RouteManager holds at default config. */
function enumerateRouteManagerRoutes(): Set<string> {
  const rest = new RestServer(createMockServer() as any, createCapableProtocol() as any, {} as any);
  rest.registerRoutes();
  return new Set(rest.getRoutes().map((r) => `${r.method.toUpperCase()} ${r.path}`));
}

/** `VERB /path` keys captured from the two RouteManager-bypassing registrars. */
function enumerateDirectMountRoutes(): Set<string> {
  const server = createMockServer();
  registerPackageRoutes(server as any, {} as any);
  registerExternalDatasourceRoutes(server as any, { getService: () => undefined } as any);
  const keys = new Set<string>();
  for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    for (const call of (server[verb] as any).mock.calls) {
      keys.add(`${verb.toUpperCase()} ${call[0]}`);
    }
  }
  return keys;
}

function ledgerKeys(source: 'route-manager' | 'direct-mount'): Set<string> {
  return new Set(REST_ROUTE_LEDGER.filter((e) => e.source === source).map((e) => e.route));
}

describe('REST route ledger ↔ RouteManager enumeration', () => {
  it('every RouteManager-registered route has a ledger entry', () => {
    const ledger = ledgerKeys('route-manager');
    const missing = [...enumerateRouteManagerRoutes()].filter((k) => !ledger.has(k));
    expect(
      missing,
      `REST routes with no rest-route-ledger entry: ${missing.join(', ')}. ` +
        'A new route needs a reviewed disposition in rest-route-ledger.ts (#3587).',
    ).toEqual([]);
  });

  it('every route-manager ledger entry is a live RouteManager route', () => {
    const live = enumerateRouteManagerRoutes();
    const stale = [...ledgerKeys('route-manager')].filter((k) => !live.has(k));
    expect(
      stale,
      `rest-route-ledger entries the server no longer mounts: ${stale.join(', ')}. ` +
        'Remove or reclassify them so the ledger stays truthful.',
    ).toEqual([]);
  });
});

describe('REST route ledger ↔ direct-mount registrars', () => {
  it('every directly-mounted route has a ledger entry', () => {
    const ledger = ledgerKeys('direct-mount');
    const missing = [...enumerateDirectMountRoutes()].filter((k) => !ledger.has(k));
    expect(
      missing,
      `Directly-mounted routes with no rest-route-ledger entry: ${missing.join(', ')}.`,
    ).toEqual([]);
  });

  it('every direct-mount ledger entry is really registered by its registrar', () => {
    const live = enumerateDirectMountRoutes();
    const stale = [...ledgerKeys('direct-mount')].filter((k) => !live.has(k));
    expect(
      stale,
      `direct-mount rest-route-ledger entries no registrar mounts: ${stale.join(', ')}.`,
    ).toEqual([]);
  });
});

describe('REST route ledger hygiene', () => {
  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = REST_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = REST_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap count only shrinks — update the ledger (and this number) when closing gaps', () => {
    // Ratchet, not aspiration: 43 audited gaps at #3587 PR-1; 17 after the
    // metadata (9), reports (8), and approvals+record-shares (9) batches
    // (data-actions 2, search 1, email 1, analytics 1, security-explain 2,
    // sharing-rules 5, external-datasource 5 remain). Closing a gap =
    // reclassify to `sdk` AND lower this bound. Raising it demands an
    // explicit, reviewed decision.
    const gaps = REST_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(17);
  });
});
