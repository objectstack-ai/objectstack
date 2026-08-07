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
 * Enumeration is real, and since #5822 there is exactly ONE of it:
 * `RestServer.getRoutes()`, asked of a server booted the way production boots
 * it — its own `registerRoutes()` plus `mountAndRecordDirectRoutes`, the same
 * composition step `rest-api-plugin.ts` calls. Each row carries the `source`
 * that says how it was mounted, so both ledger sources are still audited
 * separately, from one table.
 *
 * That replaced a second enumeration: `direct-mount` rows used to be captured
 * by re-invoking the two bypass registrars against a mock `IHttpServer` here,
 * because the server held no record of them. Two consequences of the merge are
 * worth knowing — the guard now fails if a direct-mount route is mounted but
 * NOT recorded (previously invisible), and a third bypass registrar added to
 * the composition step is enumerated here automatically instead of needing this
 * file to be taught about it.
 *
 * The third direction — "every `sdk` row names a client method that exists" —
 * lives in `packages/client/src/rest-route-ledger-coverage.test.ts`, next to
 * the SDK it introspects, for the same build-cycle reason as tranche 1: a
 * rest→client edge is unbuildable (client's devDeps already reach back into
 * the server packages, and CI's per-package test tasks build only their own
 * dependency closure).
 */

// `.js` on the relative imports: without it `moduleResolution: nodenext` does
// not resolve them, every imported symbol degrades to `any`, and the callbacks
// below turn into a TS7006 pile in this package's TEST_DEBT entry.
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';
import { mountAndRecordDirectRoutes } from './direct-mount-composition.js';
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';

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

/**
 * A plugin context with the services the direct-mount composition gates on.
 *
 * `package` is present, so the package registrar runs — this guard audits the
 * ledger's whole direct-mount surface, and a boot without the service mounts a
 * strict subset of it (that direction is pinned in
 * `direct-mount-introspection.test.ts`, not here).
 */
function createDirectMountCtx() {
  return {
    getService: (name: string) => {
      if (name === 'package') return { list: vi.fn(), get: vi.fn(), publish: vi.fn(), delete: vi.fn() };
      return undefined;
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

/**
 * A server booted the way production boots it: its own routes, then the
 * direct-mount composition — the SAME function `rest-api-plugin.ts` calls.
 */
function bootRestServer(): RestServer {
  const server = createMockServer();
  const rest = new RestServer(server as any, createCapableProtocol() as any, {} as any);
  rest.registerRoutes();
  mountAndRecordDirectRoutes({
    server: server as any,
    recorder: rest,
    ctx: createDirectMountCtx() as any,
    versionedBase: '/api/v1',
  });
  return rest;
}

/** `VERB /path` keys for every route the booted server reports for one source. */
function enumerateMountedRoutes(source: 'route-manager' | 'direct-mount'): Set<string> {
  return new Set(
    bootRestServer()
      .getRoutes()
      .filter((r) => r.source === source)
      .map((r) => `${r.method.toUpperCase()} ${r.path}`),
  );
}

function ledgerKeys(source: 'route-manager' | 'direct-mount'): Set<string> {
  return new Set(REST_ROUTE_LEDGER.filter((e) => e.source === source).map((e) => e.route));
}

describe('REST route ledger ↔ RouteManager enumeration', () => {
  it('every RouteManager-registered route has a ledger entry', () => {
    const ledger = ledgerKeys('route-manager');
    const missing = [...enumerateMountedRoutes('route-manager')].filter((k) => !ledger.has(k));
    expect(
      missing,
      `REST routes with no rest-route-ledger entry: ${missing.join(', ')}. ` +
        'A new route needs a reviewed disposition in rest-route-ledger.ts (#3587).',
    ).toEqual([]);
  });

  it('every route-manager ledger entry is a live RouteManager route', () => {
    const live = enumerateMountedRoutes('route-manager');
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
    const missing = [...enumerateMountedRoutes('direct-mount')].filter((k) => !ledger.has(k));
    expect(
      missing,
      `Directly-mounted routes with no rest-route-ledger entry: ${missing.join(', ')}.`,
    ).toEqual([]);
  });

  it('every direct-mount ledger entry is really registered by its registrar', () => {
    const live = enumerateMountedRoutes('direct-mount');
    const stale = [...ledgerKeys('direct-mount')].filter((k) => !live.has(k));
    expect(
      stale,
      `direct-mount rest-route-ledger entries no registrar mounts: ${stale.join(', ')}.`,
    ).toEqual([]);
  });

  it('reports them through the server, not through a parallel enumeration', () => {
    // The #5822 convergence, asserted rather than described: what the ledger is
    // compared against is the SERVER's own answer. Before, this suite ran a
    // second enumeration (mock-server registration capture) precisely because
    // `getRoutes()` could not see these nine — so a regression that stopped
    // recording them would have kept this file green while emptying the
    // OpenAPI document.
    const directMounted = bootRestServer().getRoutes().filter((r) => r.source === 'direct-mount');
    expect(directMounted.length).toBe(ledgerKeys('direct-mount').size);
    expect(directMounted.every((r) => typeof r.handler === 'function')).toBe(true);
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
    // Ratchet, not aspiration: 43 audited gaps at #3587 PR-1, closed to ZERO
    // across five batches (metadata 9, reports 8, approvals+record-shares 9,
    // sharing-rules+security-explain+search 8, data-actions+email+analytics+
    // external-datasource 9). Every REST route is now either SDK-expressed
    // or carries a reviewed non-sdk disposition. A new `gap` row demands an
    // explicit, reviewed decision — this bound stays 0.
    const gaps = REST_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(0);
  });
});
