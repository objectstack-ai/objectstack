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
 */

import { describe, it, expect } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
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
