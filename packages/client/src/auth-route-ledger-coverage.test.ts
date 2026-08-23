// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auth route-ledger ↔ client-surface conformance (#11359) — the client half of
 * the guard whose server half lives in
 * `packages/plugins/plugin-auth/src/auth-route-ledger.conformance.test.ts`.
 * Same contract as the three ledger guards next door
 * (`route-ledger-coverage.test.ts`, `rest-route-ledger-coverage.test.ts`,
 * `service-route-ledger-coverage.test.ts`): every auth ledger entry that names
 * a client method must resolve to a real function on an instantiated client.
 *
 * WHY THIS ARRIVED LAST, AND WHAT WAS UNGUARDED UNTIL IT DID. The server half
 * has always carried a test called "every `sdk` entry names its client
 * method", and read literally it checks only that the FIELD IS NON-EMPTY:
 * `filter((e) => e.disposition === 'sdk' && !e.client)`. `!e.client` is
 * falsy-on-absent, so a row spelled `client: 'auth.setInitialPasword'` — or one
 * naming a method later renamed or deleted — passed it unchanged. The other
 * five ledgers each had a client-side half resolving the name against a real
 * client; `AUTH_ROUTE_LEDGER` is the LARGEST of them (56 rows, 54 `sdk`) and
 * had none. That is the direction #3528 shipped through, quoted in
 * `route-ledger-coverage.test.ts`'s own header: "the ledger equivalent of the
 * day would have said `resume → automation.resume` while no such method
 * existed."
 *
 * Every row resolved on the day this landed, so this file was green from its
 * first run — which is exactly why it carries the discriminating leg below. A
 * guard that passes because the invariant holds and a guard that passes because
 * it asserts nothing are indistinguishable from outside, and that
 * indistinguishability IS the defect being closed here.
 *
 * The ledger is imported as a relative SOURCE file deliberately: it is pure
 * data (no imports — the module says so in its own header, "it must stay
 * import-free"), and a client→plugin-auth package edge for it would be
 * backwards — the plugin is where the routes are mounted, so the ledger lives
 * there, and each package verifies its own half. `packages/client` already
 * reads this exact file the same way from `client-url-conformance.test.ts` and
 * `route-ledger-response-schema.test.ts`, so no new package edge and no new
 * cross-package input radius is created by this guard.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';
import { AUTH_ROUTE_LEDGER } from '../../plugins/plugin-auth/src/auth-route-ledger';

describe('auth route ledger ↔ @objectstack/client surface', () => {
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:9' });

  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), client);

  // Rows carrying a client name, which is NOT the same set as the `sdk` rows: a
  // `disabled` row deliberately keeps its `client` (#7735 — `auth.deleteUser`
  // still exists on the SDK and still builds that URL, so erasing the name
  // would hide the fact the row records). Both are claims about the client
  // surface, so both are resolved here — matching `e.client != null` in the
  // three sibling guards rather than filtering on disposition.
  const named = AUTH_ROUTE_LEDGER.filter((e) => e.client != null);

  it('every auth ledger entry naming a client method resolves to a real function', () => {
    const broken = named
      .filter((e) => typeof resolve(e.client!) !== 'function')
      .map((e) => `${e.route} → client.${e.client}`);
    expect(
      broken,
      `auth ledger entries claiming a client method that does not exist: ${broken.join('; ')}`,
    ).toEqual([]);
  });

  it('the resolver discriminates, over a population that is really there (guard the guard)', () => {
    // The assertion above is `toEqual([])` over a filtered list, which is the
    // shape that passes loudest when it is measuring nothing. Three controls,
    // all derived from the ledger rather than hardcoded so they cannot rot into
    // prose: the population is the ledger's real size, a name taken FROM it
    // resolves, and that same name corrupted does NOT. The third is the
    // permanent form of this card's ablation — the typo'd `client:` value the
    // server-side non-emptiness check waves through.
    expect(named.length).toBeGreaterThan(50);

    const sample = named[0]!.client!;
    expect(typeof resolve(sample), `${sample} should resolve on a real client`).toBe('function');
    expect(
      typeof resolve(`${sample}__no_such_method`),
      'a name that does not exist must NOT resolve — otherwise the guard above cannot fail',
    ).not.toBe('function');
  });
});
