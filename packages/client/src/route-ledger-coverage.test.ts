// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Route-ledger ↔ client-surface conformance (#3563) — the client half of the
 * guard whose dispatcher half lives in
 * `packages/runtime/src/route-ledger.conformance.test.ts`.
 *
 * Every ledger entry that names a client method must resolve to a real
 * function on an instantiated client — the ledger cannot claim coverage the
 * SDK does not have. This is the direction #3528 shipped through: the ledger
 * equivalent of the day would have said "resume → automation.resume" while no
 * such method existed.
 *
 * The ledger is imported as a relative SOURCE file deliberately: it is pure
 * data (no imports), and a client→runtime package edge for it would be
 * backwards — runtime is where routes are declared, so the ledger lives there,
 * and each package verifies its own half.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';
import { ROUTE_LEDGER } from '../../runtime/src/route-ledger';

describe('route ledger ↔ @objectstack/client surface', () => {
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:9' });

  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), client);

  it('every ledger entry naming a client method resolves to a real function', () => {
    const broken = ROUTE_LEDGER.filter((e) => e.client != null)
      .filter((e) => typeof resolve(e.client!) !== 'function')
      .map((e) => `${e.route} → client.${e.client}`);
    expect(
      broken,
      `Ledger entries claiming a client method that does not exist: ${broken.join('; ')}`,
    ).toEqual([]);
  });
});
