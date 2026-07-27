// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST route-ledger ↔ client-surface conformance (#3587) — the client half of
 * the guard whose server half lives in
 * `packages/rest/src/rest-route-ledger.conformance.test.ts`. Same contract as
 * the dispatcher-ledger guard next door (`route-ledger-coverage.test.ts`):
 * every REST ledger entry that names a client method must resolve to a real
 * function on an instantiated client.
 *
 * The ledger is imported as a relative SOURCE file deliberately: it is pure
 * data (no imports), and a client→rest package edge for it would be backwards
 * — the REST server is where the routes are declared, so the ledger lives
 * there, and each package verifies its own half.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';
import { REST_ROUTE_LEDGER } from '../../rest/src/rest-route-ledger';

describe('REST route ledger ↔ @objectstack/client surface', () => {
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:9' });

  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), client);

  it('every REST ledger entry naming a client method resolves to a real function', () => {
    const broken = REST_ROUTE_LEDGER.filter((e) => e.client != null)
      .filter((e) => typeof resolve(e.client!) !== 'function')
      .map((e) => `${e.route} → client.${e.client}`);
    expect(
      broken,
      `REST ledger entries claiming a client method that does not exist: ${broken.join('; ')}`,
    ).toEqual([]);
  });
});
