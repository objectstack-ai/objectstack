// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The per-origin `discovery` document cache. `index.ts` re-exports
 * `getSharedDiscovery` and calls it from `ObjectStackAdapter.connect()`;
 * `clearSharedDiscoveryCache` is test-only and stays off the package entry,
 * so tests import it from this module.
 */

const discoveryCache = new Map<string, Promise<unknown>>();

/**
 * Fetch the server `discovery` document once per (baseUrl) and reuse the
 * resulting Promise. Used by `ObjectStackAdapter.connect()` (and any caller
 * that wants the discovery payload without spinning up a new client).
 */
export async function getSharedDiscovery(
  baseUrl: string,
  fetcher: () => Promise<unknown>,
): Promise<unknown> {
  const key = baseUrl || '<default>';
  const cached = discoveryCache.get(key);
  if (cached) return cached;
  const p = fetcher().catch((err) => {
    // Allow retry on failure
    discoveryCache.delete(key);
    throw err;
  });
  discoveryCache.set(key, p);
  return p;
}

/** Test/dev helper to drop the cache (e.g. on logout or origin change). */
export function clearSharedDiscoveryCache(): void {
  discoveryCache.clear();
}
