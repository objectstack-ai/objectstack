// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Route-ledger conformance (#3563) — the guard that keeps the dispatcher's
 * route surface and `@objectstack/client` from drifting apart silently again.
 *
 * #3528's root cause was exactly such a drift: the resume route existed and
 * worked while the SDK had no way to express it, and nothing failed. These
 * assertions make the two failure directions loud:
 *
 *  1. A domain registered on the dispatcher with no ledger entry — a new
 *     route surface landed without a reviewed SDK disposition.
 *  2. A ledger entry claiming a client method that does not exist — the
 *     ledger says "covered" but the SDK cannot make the call.
 *
 * The ledger's per-route rows are documentation; the machine contract here is
 * domain-level (registry introspection) plus method-level (client instance
 * introspection). The legacy if-chain prefixes cannot be enumerated from the
 * registry, so they are pinned in LEGACY_CHAIN_PREFIXES — when ADR-0076 D11
 * extracts another branch, that list and the ledger move together.
 *
 * The registry checks are domain-level, not route-level, and worth naming
 * precisely so nobody reads their green as "every route has a row".
 * "At least one ledger entry" is satisfied the moment any row exists for a
 * domain — most domains here carry several routes, but a few carry exactly
 * one, where domain- and route-granularity coincide only by accident. For a
 * multi-route domain, any non-last row can be deleted, or never added,
 * without turning them red. That is not a slip in those assertions — it is
 * what the registry exposes: `DomainHandlerRegistry.list()` returns
 * `{prefix, match, methods, handler}` per domain, with no sub-route field to
 * walk, and a busy domain like `/automation` resolves its own routes through
 * one function's inline `parts[N] === 'literal'` if-chain rather than a table
 * anything here could enumerate. An ablation on #17038 measured the
 * consequence directly: deleting a whole `ROUTE_LEDGER` row left this suite
 * fully green, because the row's domain still held "at least one" through its
 * siblings.
 *
 * The route-granularity arm (#26513) reads a different source: the routes
 * `dispatcher-plugin.ts` registers on the host `IHttpServer`, recorded as the
 * plugin starts. That table is complete for what the plugin MOUNTS, so a
 * mounted route whose row is deleted now reds here. It cannot see a row with
 * no mount of its own spelling — a route only `dispatch()` answers behind a
 * catch-all host (`/meta`, `/data`, …), a `servedBy` specialization, a door a
 * plugin serves from the raw app — so those rows are still guarded per row by
 * `check:route-ledger-census` alone. Whether the ledger should be checked per
 * route beyond the mount is an open maintainer question, left open and tracked
 * at #26513 (the issue it was first filed under no longer resolves).
 * Deliberately no row/domain counts here: a hand-typed number in this prose is
 * exactly the unguarded-count defect this lane spent the same day eliminating
 * elsewhere (commits 2cd4c548e, edf59e359), and nothing in this file would
 * ever notice it going stale.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { ROUTE_LEDGER, LEGACY_CHAIN_PREFIXES, NON_DISPATCH_MOUNT_PREFIXES } from './route-ledger.js';

/** Minimal kernel — enough for the constructor to register builtin domains. */
function fakeKernel(): any {
  return {
    getState: () => 'running',
    getService: () => undefined,
    getServiceAsync: async () => undefined,
  };
}

/** Live registry prefixes, normalized (`/keys?` query-form → `/keys`). */
function registryPrefixes(): Set<string> {
  const dispatcher = new HttpDispatcher(fakeKernel());
  const routes = (dispatcher as any).domainRegistry.list() as Array<{ prefix: string }>;
  return new Set(routes.map((r) => (r.prefix.endsWith('?') ? r.prefix.slice(0, -1) : r.prefix)));
}

describe('route ledger ↔ dispatcher domain registry', () => {
  it('every registered dispatcher domain has at least one ledger entry', () => {
    const ledgerDomains = new Set(ROUTE_LEDGER.map((e) => e.domain));
    const missing = [...registryPrefixes()].filter((p) => !ledgerDomains.has(p));
    expect(
      missing,
      `Dispatcher domains with no route-ledger entry: ${missing.join(', ')}. ` +
        'A new route surface needs a reviewed disposition in route-ledger.ts (#3563).',
    ).toEqual([]);
  });

  it('every ledger domain is a live registry prefix, a pinned legacy branch, or a pinned non-dispatch mount', () => {
    const live = registryPrefixes();
    const legacy = new Set<string>(LEGACY_CHAIN_PREFIXES);
    // [#5090] The third source: prefixes `dispatcher-plugin` serves without
    // going through `dispatch()` (today: the declarative-endpoint fallback
    // seam). Neither the registry nor the if-chain can enumerate them, and
    // pinning them in the list whose name says "legacy if-chain" would have
    // made that list lie — the ledger's job is the opposite.
    const nonDispatch = new Set<string>(NON_DISPATCH_MOUNT_PREFIXES);
    const stale = [...new Set(ROUTE_LEDGER.map((e) => e.domain))].filter(
      (d) => !live.has(d) && !legacy.has(d) && !nonDispatch.has(d),
    );
    expect(
      stale,
      `Route-ledger domains that no longer exist on the dispatcher: ${stale.join(', ')}. ` +
        'Remove or reclassify them so the ledger stays truthful.',
    ).toEqual([]);
  });
});

/** The wire prefix `route-ledger.ts` documents for its non-`absolute` rows. */
const LEDGER_WIRE_PREFIX = '/api/v1';

/** The base the plugin mounts an environment-scoped twin under (`dispatcher-plugin.ts`). */
const SCOPED_PREFIX = `${LEDGER_WIRE_PREFIX}/environments/:environmentId`;

/**
 * Every `VERB /path` the dispatcher plugin registers on its host, recorded as
 * it starts. Mounts nothing; the plugin's own `start()` is the only author.
 *
 * The composition is the WIDEST the plugin has, so as few mounts as possible
 * go unobserved:
 *  - no REST plugin on the kernel, so the plugin keeps `/discovery` (it cedes
 *    that one route when REST is present — a strict subset);
 *  - a serveable `analytics` service, so the capability-conditional
 *    `/analytics` routes mount;
 *  - environment scoping on, under the default `projectResolution: 'auto'`, so
 *    every scoped twin mounts beside its unscoped route (`'required'` drops
 *    the unscoped ones — again a strict subset).
 * Not exercised: routes a service emits at runtime on the `ai:routes` hook.
 * They are dynamic by construction and the `* /ai/**` family row speaks for
 * them; the plugin's own `/ai/*` mounts ARE recorded here.
 */
async function dispatcherPluginMounts(): Promise<string[]> {
  const mounts: string[] = [];
  const record = (verb: string) => (path: string) => {
    mounts.push(`${verb} ${path}`);
  };
  const server = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    delete: record('DELETE'),
    patch: record('PATCH'),
    use: () => {},
  };
  const services: Record<string, unknown> = { analytics: {} };
  const kernel = {
    getService: (name: string) => services[name],
    getServiceAsync: async (name: string) => services[name],
  };
  const plugin = createDispatcherPlugin({
    securityHeaders: false,
    scoping: { enableProjectScoping: true },
  });
  await plugin.start?.({
    getKernel: () => kernel,
    getService: (name: string) => (name === 'http.server' ? server : services[name]),
    environmentId: undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    hook: () => {},
    on: () => {},
  } as any);
  return mounts;
}

/**
 * Whether `mount` has a ledger row: its exact `VERB /pattern` under the wire
 * prefix, or a `* /prefix/**` family row whose base it sits at or under — the
 * same reading the live-mount parity gate gives a wildcard row. A scoped twin
 * answers to its unscoped row: the plugin mounts it by calling the same
 * registrar with the scoped base, and `dispatch()` strips the scope before
 * routing, so the ledger's dispatcher-internal `cleanPath` is the same route.
 */
function hasLedgerRow(mount: string): boolean {
  const sp = mount.indexOf(' ');
  const verb = mount.slice(0, sp);
  let path = mount.slice(sp + 1);
  if (path.startsWith(`${SCOPED_PREFIX}/`)) path = LEDGER_WIRE_PREFIX + path.slice(SCOPED_PREFIX.length);
  return ROUTE_LEDGER.some((row) => {
    const rsp = row.route.indexOf(' ');
    const rowVerb = row.route.slice(0, rsp);
    const rowPath = (row.absolute ? '' : LEDGER_WIRE_PREFIX) + row.route.slice(rsp + 1);
    if (rowPath.includes('*')) {
      const base = rowPath.replace(/\/\*+$/, '');
      return (rowVerb === '*' || rowVerb === verb) && (path === base || path.startsWith(`${base}/`));
    }
    return rowVerb === verb && rowPath === path;
  });
}

describe('route ledger ← dispatcher plugin mounts, per route (#26513)', () => {
  let mounts: string[];
  beforeAll(async () => {
    mounts = await dispatcherPluginMounts();
  });

  it('the composition reaches its conditional branches (a boot that skipped them would pass the arm below)', () => {
    expect(mounts.some((m) => m.endsWith(`${LEDGER_WIRE_PREFIX}/discovery`)), 'no `/discovery` mount').toBe(true);
    expect(mounts.some((m) => m.includes(`${LEDGER_WIRE_PREFIX}/analytics/`)), 'no `/analytics` mount').toBe(true);
    expect(mounts.some((m) => m.includes(`${SCOPED_PREFIX}/`)), 'no environment-scoped mount').toBe(true);
  });

  it('every route the dispatcher plugin mounts has a ledger row', () => {
    const unledgered = [...new Set(mounts)].filter((m) => !hasLedgerRow(m));
    expect(
      unledgered,
      `Dispatcher mounts with no route-ledger row: ${unledgered.join(', ')}. ` +
        'Add the row to route-ledger.ts with its reviewed disposition (#3563), or delete the mount.',
    ).toEqual([]);
  });
});

describe('non-dispatch mounts (#5090)', () => {
  it('every pinned non-dispatch mount has a ledger row', () => {
    const ledgerDomains = new Set(ROUTE_LEDGER.map((e) => e.domain));
    const missing = NON_DISPATCH_MOUNT_PREFIXES.filter((p) => !ledgerDomains.has(p));
    expect(
      missing,
      `Non-dispatch mounts with no route-ledger entry: ${missing.join(', ')}.`,
    ).toEqual([]);
  });

  it('the `/apps` carve-out is owned by nothing else (ADR-0121 D1)', () => {
    // D1 rests on a factual claim about THIS repo — that `apps` is not a
    // built-in prefix — and reserves it for app-declared endpoints on that
    // basis. A future built-in domain mounted at `/apps` would silently shadow
    // every declared endpoint, so the claim is pinned rather than trusted: the
    // ADR's own conflict analysis ("端点撞内建域:不可能") is only true while
    // this passes.
    const live = registryPrefixes();
    const legacy = new Set<string>(LEGACY_CHAIN_PREFIXES);
    for (const prefix of NON_DISPATCH_MOUNT_PREFIXES) {
      expect(live.has(prefix), `${prefix} is now a dispatcher domain prefix — ADR-0121 D1 needs revisiting`).toBe(false);
      expect(legacy.has(prefix), `${prefix} is now a legacy-chain prefix — ADR-0121 D1 needs revisiting`).toBe(false);
    }
  });
});

// The client-instance direction — "every named client method actually exists"
// — lives in packages/client/src/route-ledger-coverage.test.ts, next to the
// SDK it introspects. It cannot live here: a runtime→client edge (package OR
// dist import) is unbuildable — client's own devDeps point back at runtime
// (turbo rejects the cycle), and CI's per-package test tasks build only their
// own dependency closure, so the client dist does not exist for this suite.
describe('route ledger hygiene', () => {
  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap count only shrinks — update the ledger (and this number) when closing gaps', () => {
    // Ratchet, not aspiration: 27 audited gaps at #3563 PR-1; 24 after PR-2
    // (actions surface); 17 after PR-3 (keys / share-links / security);
    // 6 after PR-4 (packages lifecycle); 0 after PR-5 (meta + automation
    // descriptors) — every should-be-SDK dispatcher route is now expressed.
    // Closing a gap = reclassify to `sdk` AND lower this bound. Raising it
    // demands an explicit, reviewed decision.
    const gaps = ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(0);
  });
});
