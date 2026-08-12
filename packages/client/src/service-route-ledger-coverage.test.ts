// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Service route-ledger ↔ client-surface conformance (#3636) — the client half
 * of the guards whose server halves live next to the registrars that mount the
 * routes:
 *
 *   - `packages/services/service-storage/src/storage-route-ledger.conformance.test.ts`
 *   - `packages/services/service-i18n/src/i18n-route-ledger.conformance.test.ts`
 *   - `packages/services/service-datasource/src/datasource-route-ledger.conformance.test.ts`
 *
 * Same contract as the two ledger guards next door
 * (`route-ledger-coverage.test.ts`, `rest-route-ledger-coverage.test.ts`):
 * every ledger entry that names a client method must resolve to a real
 * function on an instantiated client.
 *
 * All three ledgers are imported as relative SOURCE files deliberately: they
 * are pure data (no imports), and a client→service package edge for them would
 * be backwards — the services are where the routes are declared, so the ledgers
 * live there, and each package verifies its own half. That is the tranche-1
 * lesson (`no runtime→client package edge`) applied verbatim: CI's per-package
 * test tasks build only their own dependency closure, so a real package edge
 * here would be unbuildable.
 *
 * With these, all THREE server surfaces the SDK reaches are ledgered —
 * dispatcher (#3563), REST (#3587), autonomous service mounts (#3636, joined by
 * the datasource-admin family in #7744).
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';
import { STORAGE_ROUTE_LEDGER } from '../../services/service-storage/src/storage-route-ledger';
import { I18N_ROUTE_LEDGER } from '../../services/service-i18n/src/i18n-route-ledger';
import { DATASOURCE_ROUTE_LEDGER } from '../../services/service-datasource/src/datasource-route-ledger';

describe('service route ledgers ↔ @objectstack/client surface', () => {
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:9' });

  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), client);

  const brokenIn = (ledger: readonly { route: string; client?: string }[]): string[] =>
    ledger
      .filter((e) => e.client != null)
      .filter((e) => typeof resolve(e.client!) !== 'function')
      .map((e) => `${e.route} → client.${e.client}`);

  it('every storage ledger entry naming a client method resolves to a real function', () => {
    const broken = brokenIn(STORAGE_ROUTE_LEDGER);
    expect(
      broken,
      `storage ledger entries claiming a client method that does not exist: ${broken.join('; ')}`,
    ).toEqual([]);
  });

  it('every i18n ledger entry naming a client method resolves to a real function', () => {
    const broken = brokenIn(I18N_ROUTE_LEDGER);
    expect(
      broken,
      `i18n ledger entries claiming a client method that does not exist: ${broken.join('; ')}`,
    ).toEqual([]);
  });

  it('every datasource-admin ledger entry naming a client method resolves to a real function', () => {
    const broken = brokenIn(DATASOURCE_ROUTE_LEDGER);
    expect(
      broken,
      `datasource-admin ledger entries claiming a client method that does not exist: ${broken.join('; ')}`,
    ).toEqual([]);
  });

  it('the datasource-admin family is audited as reaching NO client method', () => {
    // Said as a measurement rather than left implicit, because the assertion
    // above holds vacuously while every row is `server-only` — and a guard
    // that can only ever pass is the "declared but unverified" shape these
    // ledgers exist to remove. What is measured here is the #7744 audit's
    // actual finding: `client.datasources` reaches the FEDERATION family in
    // packages/rest (ledgered there, as `datasources.external.*`), and no
    // method reaches the Setup/console lifecycle family. The day the SDK
    // gains a datasource-lifecycle method, this expectation is the one that
    // fails and sends the author to the ledger row that must name it.
    const claimed = DATASOURCE_ROUTE_LEDGER.map((e) => e.client).filter((c) => c != null);
    expect(claimed).toEqual([]);

    const datasources = (client as unknown as { datasources: Record<string, unknown> }).datasources;
    expect(Object.keys(datasources)).toEqual(['external']);
  });

  it('the whole `storage` namespace is backed by a ledger row', () => {
    // The reverse direction, scoped to the namespace this tranche audited:
    // a client method reaching a storage route that no ledger row backs is
    // the pre-#3563 posture (expressed, working, unguarded) reappearing.
    const claimed = new Set(
      STORAGE_ROUTE_LEDGER.map((e) => e.client).filter((c): c is string => c != null),
    );
    const unbacked = Object.keys((client as unknown as { storage: object }).storage)
      .map((m) => `storage.${m}`)
      .filter((m) => !claimed.has(m));
    expect(
      unbacked,
      `client.storage methods no storage-route-ledger row backs: ${unbacked.join(', ')}. ` +
        'Either the route is unledgered or the method targets a surface that does not exist (#3636).',
    ).toEqual([]);
  });

  it('the whole `i18n` namespace is backed by a ledger row', () => {
    const claimed = new Set(
      I18N_ROUTE_LEDGER.map((e) => e.client).filter((c): c is string => c != null),
    );
    const unbacked = Object.keys((client as unknown as { i18n: object }).i18n)
      .map((m) => `i18n.${m}`)
      .filter((m) => !claimed.has(m));
    expect(
      unbacked,
      `client.i18n methods no i18n-route-ledger row backs: ${unbacked.join(', ')}.`,
    ).toEqual([]);
  });
});
