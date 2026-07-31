// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * i18n route-ledger conformance (#3636) — the guard that keeps the
 * autonomously-mounted i18n surface and `@objectstack/client` from drifting
 * apart silently, mirroring the dispatcher guard (#3569) and the REST guard
 * (#3587).
 *
 * Directions made loud here:
 *
 *  1. A route `I18nServicePlugin` mounts with no ledger entry.
 *  2. A ledger entry for a route the plugin no longer mounts.
 *
 * Enumeration is real: the plugin is driven through its actual lifecycle
 * (`init` → `start` → `kernel:ready`) against a capturing mock `IHttpServer`,
 * so the registration calls ARE the route set — including the `kernel:ready`
 * deferral, which a hand-pinned list would quietly stop exercising.
 *
 * The client half — every `sdk` row resolving to a real method — lives in
 * `packages/client/src/service-route-ledger-coverage.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { I18nServicePlugin } from './i18n-service-plugin.js';
import { I18N_ROUTE_LEDGER } from './i18n-route-ledger.js';

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

/** PluginContext mock exposing the `http-server` service and replaying hooks. */
function createMockContext(httpServer: unknown) {
  const hooks = new Map<string, Array<(...args: unknown[]) => Promise<void>>>();
  return {
    registerService: vi.fn(),
    replaceService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'http-server') return httpServer;
      throw new Error(`Service '${name}' not found`);
    }),
    getServices: vi.fn(() => new Map()),
    getKernel: vi.fn(),
    hook: vi.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name)!.push(handler);
    }),
    trigger: vi.fn(async (name: string, ...args: unknown[]) => {
      for (const h of hooks.get(name) ?? []) await h(...args);
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
}

/** `VERB /path` keys for every route the plugin mounts at the DEFAULT base. */
async function enumerateI18nRoutes(): Promise<Set<string>> {
  const server = createMockServer();
  const ctx = createMockContext(server);
  const plugin = new I18nServicePlugin();
  await plugin.init!(ctx as never);
  await plugin.start!(ctx as never);
  await ctx.trigger('kernel:ready');

  const keys = new Set<string>();
  for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    for (const call of server[verb].mock.calls) {
      keys.add(`${verb.toUpperCase()} ${call[0]}`);
    }
  }
  return keys;
}

const ledgerKeys = (): Set<string> => new Set(I18N_ROUTE_LEDGER.map((e) => e.route));

describe('i18n route ledger ↔ I18nServicePlugin enumeration', () => {
  it('every mounted i18n route has a ledger entry', async () => {
    const ledger = ledgerKeys();
    const missing = [...(await enumerateI18nRoutes())].filter((k) => !ledger.has(k));
    expect(
      missing,
      `i18n routes with no i18n-route-ledger entry: ${missing.join(', ')}. ` +
        'A new route needs a reviewed disposition in i18n-route-ledger.ts (#3636).',
    ).toEqual([]);
  });

  it('every ledger entry is really mounted by the plugin', async () => {
    const live = await enumerateI18nRoutes();
    const stale = [...ledgerKeys()].filter((k) => !live.has(k));
    expect(
      stale,
      `i18n-route-ledger entries the plugin no longer mounts: ${stale.join(', ')}. ` +
        'Remove or reclassify them so the ledger stays truthful.',
    ).toEqual([]);
  });

  it('no route is ledgered twice', () => {
    const seen = new Set<string>();
    const dupes = I18N_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
    expect(dupes, `duplicate i18n-route-ledger rows: ${dupes.join(', ')}`).toEqual([]);
  });
});

describe('i18n route ledger hygiene', () => {
  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = I18N_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = I18N_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap and mismatch counts only shrink — update the ledger (and these numbers) when closing them', () => {
    // Ratchet, not aspiration. This surface audited at TWO mismatches (#3636):
    // getTranslations and getFieldLabels each spoke a `?locale=` dialect no
    // server mounts. Both were closed in the same PR by moving the client to
    // the path form the spec declares, so all three routes are SDK-expressed
    // and these bounds stay 0.
    const gaps = I18N_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(0);

    const mismatches = I18N_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length;
    expect(mismatches).toBeLessThanOrEqual(0);
  });
});
