// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7541] The two producers of "can this host search" must answer the same
// question the same way.
//
// The defect: `capabilities.search` came from a registered `search` SERVICE
// SLOT, while `GET {basePath}/search` refused on something else entirely —
// `typeof protocol.searchAll !== 'function'`. Nothing in either repository
// registers that slot and the protocol implements `searchAll` unconditionally,
// so every REST host advertised `capabilities.search = {enabled:false}` while
// serving 200s with real hits. A client that trusts the discovery document —
// which is the document's only purpose — skipped a working surface. Prime
// Directive #10 inverted: not an advertised endpoint that 404s, but a live
// endpoint no conforming client will ever call.
//
// WHAT THIS FILE ASSERTS, and why it is shaped this way: it does NOT assert
// `enabled === true`. That assertion passes again the day someone hardcodes the
// bit, which is the same class of defect one layer over. It asserts AGREEMENT —
// `declared === served` — with both sides MEASURED from the real producers in
// the same test: `capabilities.search` off the real `getDiscovery()` through
// the real `/discovery` handler, and the served status off the real
// `registerSearchEndpoints` handler. Three hosts that genuinely differ (below)
// keep the agreement from holding vacuously.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * An engine carrying ONE searchable object with ONE matching row, so the
 * served path is a real 200-with-hits rather than a 200-with-nothing — the
 * exact reproduction in the issue (`?q=audit` → 200, real hits).
 */
function createEngine() {
  const widget = {
    name: 'widget',
    fields: [{ name: 'title', type: 'text', searchable: true }],
  };
  return {
    registry: {
      getObject: (n: string) => (n === 'widget' ? widget : undefined),
      getAllObjects: () => [widget],
      getRegisteredTypes: () => [],
    },
    find: async () => [{ id: 'w1', title: 'audit trail' }],
  };
}

type Host = {
  /** `capabilities.search.enabled` as the composed `/discovery` body reports it. */
  declared: boolean;
  /** HTTP status `GET {basePath}/search?q=audit` actually answers. */
  status: number;
  /** Hit count when it answered 200. */
  hits: number;
};

/**
 * Boot a REST server over the REAL protocol and read BOTH producers off it.
 *
 * `enableSearch` selects whether this server mounts the route at all;
 * `withSearchAll: false` removes the protocol's own implementation, which is
 * the input the route's 501 branch exists for.
 */
async function measure(opts: {
  enableSearch?: boolean;
  withSearchAll?: boolean;
} = {}): Promise<Host> {
  const protocol: any = new ObjectStackProtocolImplementation(
    createEngine() as any,
    () => new Map(),
  );
  if (opts.withSearchAll === false) {
    // Shadow the prototype method on the instance. Both predicates read the
    // same property off the same object, so this single override is what makes
    // the "protocol cannot search" host measurable at all — and it is why the
    // test cannot pass by two independent predicates coincidentally agreeing.
    Object.defineProperty(protocol, 'searchAll', { value: undefined, configurable: true });
  }

  const config: any = {
    api: {
      requireAuth: false,
      ...(opts.enableSearch === false ? { enableSearch: false } : {}),
    },
  };
  const rest = new RestServer(createMockServer() as any, protocol as any, config);
  // Authenticated caller — step 1 of the issue's reproduction. `enforceAuth`
  // runs BEFORE the `searchAll` probe, so an anonymous request 401s and never
  // reaches either predicate; this is the house stub the other rest tests use
  // for authed handlers, and it is upstream of everything under test here.
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRouteManager();

  const discoveryEntry = routes.get('GET', '/api/v1/discovery');
  if (!discoveryEntry) throw new Error('discovery route not registered');
  let discoveryBody: any;
  const discoveryRes: any = {
    json: (b: any) => { discoveryBody = b; },
    status: () => discoveryRes,
  };
  await discoveryEntry.handler({ params: {}, query: {} }, discoveryRes);
  const declared = discoveryBody?.capabilities?.search?.enabled;

  const searchEntry = routes.get('GET', '/api/v1/search');
  if (!searchEntry) {
    // Not mounted — a client calling it gets the router's 404. That IS the
    // served answer for this host.
    return { declared, status: 404, hits: 0 };
  }
  let status = 200;
  let searchBody: any;
  const searchRes: any = {
    status: (s: number) => { status = s; return searchRes; },
    json: (b: any) => { searchBody = b; },
  };
  await searchEntry.handler({ params: {}, query: { q: 'audit' } }, searchRes);
  return { declared, status, hits: searchBody?.hits?.length ?? 0 };
}

/** Served ⇔ a caller can get search results out of this host. */
const isServed = (h: Host) => h.status !== 404 && h.status !== 501;

describe('[#7541] `capabilities.search` and the /search route answer one question', () => {
  it('agrees on the ordinary host — where the document used to contradict the endpoint', async () => {
    const host = await measure();

    // The symptom, measured: the endpoint really does serve real hits here.
    expect(host.status).toBe(200);
    expect(host.hits).toBeGreaterThan(0);

    // The pin: whatever the endpoint does, the document says the same thing.
    // Before the fix `declared` was false against a 200 — the inversion.
    expect(host.declared).toBe(isServed(host));
  });

  it('agrees on a host that does not mount the route (`api.enableSearch: false`)', async () => {
    const host = await measure({ enableSearch: false });

    expect(host.status).toBe(404);
    expect(host.declared).toBe(isServed(host));
  });

  it('agrees on a protocol that cannot search — both ends refuse on the same predicate', async () => {
    const host = await measure({ withSearchAll: false });

    // The route's own 501 branch, reached through the real handler.
    expect(host.status).toBe(501);
    expect(host.declared).toBe(isServed(host));
  });

  it('anti-vacuity: the three hosts are genuinely discriminated, in both directions', async () => {
    const [served, unmounted, unimplemented] = await Promise.all([
      measure(),
      measure({ enableSearch: false }),
      measure({ withSearchAll: false }),
    ]);

    // Without this, `declared === served` would hold for the empty reason if
    // some future edit pinned the bit — or the route — to one constant.
    expect([served.declared, unmounted.declared, unimplemented.declared])
      .toEqual([true, false, false]);
    expect([served.status, unmounted.status, unimplemented.status])
      .toEqual([200, 404, 501]);
  });
});
