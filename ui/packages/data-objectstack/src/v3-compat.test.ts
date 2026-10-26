/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * This file used to be titled "v3.0.0 compatibility tests for @objectstack
 * dependencies" and hold five blocks under a top-level `v3.0.0 Compatibility`
 * describe: `Cloud namespace (replacing Hub)`, `Contracts module`,
 * `Integration module`, `Security module`, `Studio module`. All five modules
 * were `@objectstack/spec` v3.0.0-era code added under `index.ts`'s
 * `// v3.0.0 Deep Integration modules` banner, and none of them tested
 * compatibility with any v3 of anything — they exercised local, self-contained
 * helpers (`CloudOperations.deploy`, `validatePluginContract`,
 * `IntegrationManager.register`, `SecurityManager.generateCSPHeader`,
 * `createDefaultCanvasConfig`) with no producer or consumer outside this
 * package.
 *
 * `Cloud namespace (replacing Hub)` went first (objectui#4152 / PR #4239) —
 * its `CloudOperations` fabricated success instead of failing when the
 * `client.cloud` namespace it called into did not exist. The negative pin
 * `cloud-surface-retired-4152.pin.test.ts` fails if that surface returns.
 *
 * The other four (`Contracts`, `Integration`, `Security`, `Studio`) followed
 * under the same startup-focus reasoning, minus the fabrication limb —
 * objectui#4241 measured zero consumers of any of them outside this package
 * and retired `contracts.ts` / `integration.ts` / `security.ts` / `studio.ts`
 * wholesale. `v3-deep-integration-retired-4241.pin.test.ts` is their negative
 * pin.
 *
 * What is left below never depended on any of the five and does not claim a
 * v3 of anything, so it keeps this file rather than moving.
 *
 * objectui#4712 — the surviving `PaginatedResult API` block asserted only on
 * an inline object literal it constructed itself (`const result = {...};
 * expect(result.total).toBe(10)`), with no import from `./index` or anywhere
 * else. It could not fail in a way that signals anything about production
 * code — real syntax, real `expect()` calls, zero coverage. Measured before
 * fixing: `grep -rn "PaginatedResult"` under `packages/` finds no interface
 * or export by that name anywhere in this repo; the real production shape it
 * meant to describe is `QueryResult<T>` (`packages/types/src/data.ts`),
 * returned by `ObjectStackAdapter.find()` via the private
 * `normalizeQueryResult()` (`index.ts`) — which had ZERO coverage of its
 * `total`/`hasMore`/`page`/`pageSize` computation anywhere else in this
 * package (`queryDataset.test.ts` / `listViews.test.ts` exercise other
 * fields of the adapter's return shape, never these). The block below now
 * drives that real method through `ObjectStackAdapter.find()` with a mocked
 * transport, so a change to the server-envelope parsing or the
 * page/hasMore fallback logic turns it red.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

/** An adapter whose data-fetch response is fully controlled by the caller. */
function makeAdapter(dataResponse: unknown) {
  const fetchImpl = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as any;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => dataResponse } as any;
  });
  return new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
}

describe('ObjectStackAdapter.find() pagination result (QueryResult: data/total/hasMore)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('normalizes the server records/total/hasMore envelope into QueryResult', async () => {
    const adapter = makeAdapter({
      success: true,
      data: { object: 'account', records: [{ id: '1' }], total: 10, hasMore: true },
    });

    const result = await adapter.find('account', { $top: 5 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.pageSize).toBe(5);
    expect(result.page).toBe(1);
  });

  it('computes page from $skip/$top', async () => {
    const adapter = makeAdapter({
      success: true,
      data: { object: 'account', records: [{ id: '3' }], total: 30, hasMore: true },
    });

    const result = await adapter.find('account', { $skip: 20, $top: 10 });

    // normalizeQueryResult: page = floor($skip / $top) + 1
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it('falls back to a page-local hasMore estimate when the server omits it', async () => {
    const adapter = makeAdapter({
      success: true,
      // A full page with no server-reported `hasMore`.
      data: { object: 'account', records: [{ id: '1' }, { id: '2' }], total: 2 },
    });

    const result = await adapter.find('account', { $top: 2 });

    // records.length === $top ⇒ treated as "there may be more" — the
    // fallback normalizeQueryResult uses when the server doesn't say.
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore false for a short (non-full) page with no server hint', async () => {
    const adapter = makeAdapter({
      success: true,
      data: { object: 'account', records: [{ id: '1' }], total: 1 },
    });

    const result = await adapter.find('account', { $top: 5 });

    expect(result.hasMore).toBe(false);
  });
});
