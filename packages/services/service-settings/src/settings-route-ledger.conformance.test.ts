// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings route-ledger conformance (#17062) — the guard every OTHER
 * `*-route-ledger.ts` in the tree pairs with a `*-route-ledger.conformance.test.ts`,
 * missing here since the ledger itself landed at #7526.
 *
 * WHY THIS SHAPE. `registerSettingsRoutes` (`settings-routes.ts`) is a
 * standalone, synchronous, top-level function — `(http, service, opts) => void`
 * — that calls `http.get/put/post` directly and touches neither argument
 * before a request arrives. That is exactly the shape `storage-routes.ts` and
 * `admin-routes.ts` (datasource) export, and their conformance tests already
 * settled the right seam for it: drive the registrar against a capturing mock
 * `IHttpServer` and read its recorded calls as the route set. It is NOT the
 * i18n shape (`I18nServicePlugin.registerI18nRoutes` is a *private* method
 * reached only by driving the plugin's `init`→`start`→`kernel:ready`
 * lifecycle) — `registerSettingsRoutes` needs no lifecycle to reach because it
 * is already the exported seam, and driving one it does not require would
 * intercept nothing the direct call does not. It is also not a source-scan:
 * that shape (cli/metadata/trigger-api's second limb) earns its keep when the
 * mounting mechanism can't be driven behind a mock (a dispatcher table read at
 * import time, a scan of static bindings); registration here is an ordinary
 * function call.
 *
 * ⭐ THE DIRECTION THAT MATTERS (per the issue). The dogfood live-mount-parity
 * gate (`packages/qa/dogfood/test/route-ledger-live-mount-parity.dogfood.test.ts`,
 * #7526) already checks that every ledgered settings row resolves on a real
 * boot — but only that direction. It says nothing about a route this package
 * mounts with NO ledger row: a boot that mounts an extra, unledgered path
 * still satisfies "every ledgered row resolves". This file's first `it` is the
 * missing direction — a route `registerSettingsRoutes` mounts that the ledger
 * does not know about fails HERE, by name, in a plain unit test that runs on
 * every `pnpm test`, not only in the dogfood suite.
 *
 * The second direction (a ledger row the registrar no longer mounts) is
 * already covered in spirit by the dogfood gate's direction 1 — reproduced
 * here too, in the #3636 / #7744 pattern every sibling follows, so this
 * package's ledger is guarded the same way regardless of which suite runs.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerSettingsRoutes } from './settings-routes.js';
import { SETTINGS_ROUTE_LEDGER } from './settings-route-ledger.js';

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
 * `VERB /path` keys for every route the registrar mounts at the DEFAULT base.
 *
 * Registration only closes over `service`/`opts` — nothing on either is
 * called until a request arrives (every read of `service` happens inside a
 * handler body), so a bare stub for each enumerates the full surface exactly
 * as the storage/datasource siblings' bare stubs do.
 */
function enumerateSettingsRoutes(): Set<string> {
  const server = createMockServer();
  registerSettingsRoutes(server as any, {} as any, {});
  const keys = new Set<string>();
  for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    for (const call of server[verb].mock.calls) {
      keys.add(`${verb.toUpperCase()} ${call[0]}`);
    }
  }
  return keys;
}

const ledgerKeys = (): Set<string> => new Set(SETTINGS_ROUTE_LEDGER.map((e) => e.route));

describe('settings route ledger ↔ registerSettingsRoutes enumeration', () => {
  it('every mounted settings route has a ledger entry', () => {
    const ledger = ledgerKeys();
    const missing = [...enumerateSettingsRoutes()].filter((k) => !ledger.has(k));
    expect(
      missing,
      `Settings routes with no settings-route-ledger entry: ${missing.join(', ')}. ` +
        'A new route needs a reviewed disposition in settings-route-ledger.ts (#17062).',
    ).toEqual([]);
  });

  it('every ledger entry is really mounted by the registrar', () => {
    const live = enumerateSettingsRoutes();
    const stale = [...ledgerKeys()].filter((k) => !live.has(k));
    expect(
      stale,
      `settings-route-ledger entries the registrar no longer mounts: ${stale.join(', ')}. ` +
        'Remove or reclassify them so the ledger stays truthful.',
    ).toEqual([]);
  });

  it('no route is ledgered twice', () => {
    const seen = new Set<string>();
    const dupes = SETTINGS_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
    expect(dupes, `duplicate settings-route-ledger rows: ${dupes.join(', ')}`).toEqual([]);
  });

  it('the ledger is compared against a real enumeration, not an empty one', () => {
    // Absence must be loud (AGENTS.md, Route & surface ownership §3). Both
    // set-difference assertions above pass vacuously if the registrar ever
    // stops registering anything — a refactor that moves the mount elsewhere,
    // or a mock whose recorded calls stop being readable — leaving this file
    // green while guarding nothing. Assert the enumeration produced something,
    // and that the two sides are the same size rather than merely non-conflicting.
    const live = enumerateSettingsRoutes();
    expect(live.size).toBeGreaterThan(0);
    expect(live.size).toBe(ledgerKeys().size);
  });
});

describe('settings route ledger hygiene', () => {
  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = SETTINGS_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = SETTINGS_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap and mismatch counts only shrink — update the ledger (and these numbers) when closing them', () => {
    // Ratchet, not aspiration. The settings surface is four reviewed
    // `server-only` rows (deployment configuration read/written by the
    // Setup/admin UI over plain HTTP — see settings-route-ledger.ts's own
    // header): `@objectstack/client` expresses no settings method, and
    // nothing has ever asked the SDK for one, so `gap` is not the disposition.
    // A new `gap` or `mismatch` row is a product decision that needs its own
    // review, so these bounds stay 0.
    const gaps = SETTINGS_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(0);

    const mismatches = SETTINGS_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length;
    expect(mismatches).toBeLessThanOrEqual(0);
  });
});
