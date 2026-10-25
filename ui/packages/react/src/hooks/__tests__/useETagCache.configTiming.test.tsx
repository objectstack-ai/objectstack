/**
 * ObjectUI — useETagCache config-ref timing pins (objectui#6797)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `useETagCache` kept its five resolved config values in a ref written in the
 * RENDER BODY, which is what `react-hooks/refs` reported:
 *
 *   packages/react/src/hooks/useETagCache.ts:204:3
 *     react-hooks/refs  Cannot update ref during render
 *
 * Who reads that ref, measured on this base: `isExpired` reads `.ttl`;
 * `setEntry` reads `.maxEntries` / `.storage` / `.storagePrefix`; `removeEntry`
 * and `clearCache` read `.storage` / `.storagePrefix`; `fetchWithETag` reads
 * `.enabled`. Every one of them is a `useCallback` with `[]` deps, and their
 * identity is part of the hook's published result — so the config has to reach
 * them WITHOUT rebuilding them. Re-keying those callbacks on the config values
 * instead would have changed `fetchWithETag`'s identity whenever a caller's
 * `ttl` moved, re-firing any consumer effect keyed on it; that is an observable
 * change, so the ref stays and only the WRITE moved.
 *
 * The write now happens in `useInsertionEffect`. Pin 2 is the discriminating
 * one: `clearCache` is fully synchronous, so a child layout effect of the same
 * commit reaching it fails under BOTH `useEffect` and `useLayoutEffect`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { render, renderHook, act } from '@testing-library/react';
import { useETagCache, type ETagCacheResult, type ETagCacheConfig } from '../useETagCache';

/** Seed the on-disk shape `clearLocalStorage(prefix)` walks: an index + entries. */
function seedPrefix(prefix: string, url: string) {
  localStorage.setItem(`${prefix}:index`, JSON.stringify([url]));
  localStorage.setItem(
    `${prefix}:${url}`,
    JSON.stringify({ data: { v: prefix }, etag: 'W/"1"', url, timestamp: Date.now() }),
  );
}

/** Parent holds the hook; the child reaches `clearCache` from its layout effect. */
function Harness({ config, trigger }: { config: ETagCacheConfig; trigger: number }) {
  const cache = useETagCache(config);
  return <CommitPhaseCaller clearCache={cache.clearCache} trigger={trigger} />;
}

function CommitPhaseCaller({ clearCache, trigger }: { clearCache: () => void; trigger: number }) {
  useLayoutEffect(() => {
    if (trigger > 0) clearCache();
  }, [trigger, clearCache]);
  return null;
}

/** The LRU map is module-scoped and shared across instances — reset it. */
function resetSharedCache() {
  const { result, unmount } = renderHook(() => useETagCache({ storage: 'memory' }));
  act(() => {
    result.current.clearCache();
  });
  unmount();
}

beforeEach(() => {
  resetSharedCache();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useETagCache — config ref is refreshed in the commit, not in render (#6797)', () => {
  // ---- pin 1: the newest config reaches the stable callbacks ---------------
  it('clears the storage prefix of the LATEST committed render', () => {
    seedPrefix('pfx-a', '/api/a');
    seedPrefix('pfx-b', '/api/b');

    const { result, rerender } = renderHook(
      ({ prefix }: { prefix: string }) =>
        useETagCache({ storage: 'localStorage', storagePrefix: prefix }),
      { initialProps: { prefix: 'pfx-a' } },
    );

    rerender({ prefix: 'pfx-b' });
    act(() => {
      result.current.clearCache();
    });

    expect(localStorage.getItem('pfx-b:index')).toBeNull();
    expect(localStorage.getItem('pfx-b:/api/b')).toBeNull();
    expect(localStorage.getItem('pfx-a:index')).not.toBeNull();
  });

  // ---- pin 2: DISCRIMINATING — a child layout effect of the SAME commit ----
  it('has the swap in place before a child layout effect of the same commit clears', () => {
    seedPrefix('hot-a', '/api/a');
    seedPrefix('hot-b', '/api/b');

    const { rerender } = render(
      <Harness config={{ storage: 'localStorage', storagePrefix: 'hot-a' }} trigger={0} />,
    );

    act(() => {
      rerender(
        <Harness config={{ storage: 'localStorage', storagePrefix: 'hot-b' }} trigger={1} />,
      );
    });

    expect(localStorage.getItem('hot-b:index')).toBeNull();
    expect(localStorage.getItem('hot-a:index')).not.toBeNull();
  });

  // ---- pin 3: the identity the ref exists to protect -----------------------
  it('keeps the returned callbacks identical across config changes', () => {
    const { result, rerender } = renderHook(
      ({ ttl }: { ttl: number }) => useETagCache({ ttl, storagePrefix: `p-${ttl}` }),
      { initialProps: { ttl: 1_000 } },
    );

    const first: ETagCacheResult = result.current;

    rerender({ ttl: 2_000 });
    rerender({ ttl: 3_000 });

    expect(result.current.fetchWithETag).toBe(first.fetchWithETag);
    expect(result.current.clearCache).toBe(first.clearCache);
    expect(result.current.invalidate).toBe(first.invalidate);
    expect(result.current.invalidatePattern).toBe(first.invalidatePattern);
  });

  // ---- pin 4: the async reader (`isExpired` via fetchWithETag) sees it too --
  it('judges expiry against the ttl of the LATEST committed render', async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { etag: 'W/"v1"', 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ ttl }: { ttl: number }) => useETagCache({ ttl, storage: 'memory' }),
      { initialProps: { ttl: 60_000 } },
    );

    // First call caches the entry (the response carries an etag).
    await act(async () => {
      await result.current.fetchWithETag('/api/ttl-probe');
    });

    clock += 5_000;
    // 5s have passed. Under the OLD ttl the entry is fresh; under the new one
    // it is stale — and a stale entry must NOT send a revalidation header.
    rerender({ ttl: 1_000 });

    await act(async () => {
      await result.current.fetchWithETag('/api/ttl-probe');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = new Headers(
      (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].headers,
    );
    expect(secondHeaders.get('If-None-Match')).toBeNull();

    // Control: with the ttl left alone the same entry DOES revalidate, so the
    // assertion above is reading the ttl and not just a missing cache entry.
    await act(async () => {
      await result.current.fetchWithETag('/api/ttl-probe');
    });
    const thirdHeaders = new Headers(
      (fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].headers,
    );
    expect(thirdHeaders.get('If-None-Match')).toBe('W/"v1"');
  });
});
