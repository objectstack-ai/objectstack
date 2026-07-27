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
// Relative import of the BUILT client, NOT a package dependency:
// @objectstack/client's own devDependencies already point back at runtime
// (its Hono tests boot a real server), so a runtime→client package edge would
// close a turbo build cycle. Importing the dist keeps the graph acyclic — and
// CI's Test job always runs after Build, so the dist is present. (The client
// SOURCE can't be imported here: its module graph resolves through runtime's
// vitest aliases and breaks on subpath imports like @objectstack/core/logger.)
import { ObjectStackClient } from '../../client/dist/index.mjs';
import { HttpDispatcher } from './http-dispatcher.js';
import { ROUTE_LEDGER, LEGACY_CHAIN_PREFIXES } from './route-ledger.js';

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

  it('every ledger domain is a live registry prefix or a pinned legacy branch', () => {
    const live = registryPrefixes();
    const legacy = new Set<string>(LEGACY_CHAIN_PREFIXES);
    const stale = [...new Set(ROUTE_LEDGER.map((e) => e.domain))].filter(
      (d) => !live.has(d) && !legacy.has(d),
    );
    expect(
      stale,
      `Route-ledger domains that no longer exist on the dispatcher: ${stale.join(', ')}. ` +
        'Remove or reclassify them so the ledger stays truthful.',
    ).toEqual([]);
  });
});

describe('route ledger ↔ @objectstack/client surface', () => {
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:9' });

  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), client);

  it('every `sdk`/`mismatch` entry names a client method that actually exists', () => {
    const broken = ROUTE_LEDGER.filter((e) => e.client != null)
      .filter((e) => typeof resolve(e.client!) !== 'function')
      .map((e) => `${e.route} → client.${e.client}`);
    expect(
      broken,
      `Ledger entries claiming a client method that does not exist: ${broken.join('; ')}`,
    ).toEqual([]);
  });

  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap count only shrinks — update the ledger (and this number) when closing gaps', () => {
    // Ratchet, not aspiration: 27 audited gaps at #3563 PR-1. Closing one =
    // reclassify the entry to `sdk` AND lower this bound. Raising it demands
    // an explicit, reviewed decision to ship a new un-expressed route.
    const gaps = ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(27);
  });
});
