/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types aligned with @objectstack/client ETag caching
// ---------------------------------------------------------------------------

/** Configuration for ETag-based HTTP caching. */
export interface ETagCacheConfig {
  /** Enable ETag caching (default: true) */
  enabled?: boolean;
  /** Storage backend for ETags ('memory' | 'localStorage') */
  storage?: 'memory' | 'localStorage';
  /** Storage key prefix (default: 'oui-etag') */
  storagePrefix?: string;
  /** Max cache entries (default: 1000) */
  maxEntries?: number;
  /** Cache TTL in ms (default: 3600000 = 1 hour) */
  ttl?: number;
  /** Whether to register a Service Worker for caching (default: false) */
  useServiceWorker?: boolean;
  /** Service Worker script URL */
  serviceWorkerUrl?: string;
}

/** A single cache entry with its associated ETag and metadata. */
export interface CacheEntry<T = unknown> {
  data: T;
  etag: string;
  url: string;
  timestamp: number;
  lastModified?: string;
}

/** Result returned by the useETagCache hook. */
export interface ETagCacheResult {
  /** Fetch data with ETag support — sends If-None-Match header, returns cached data on 304. */
  fetchWithETag: <T>(
    url: string,
    options?: RequestInit,
  ) => Promise<{ data: T; fromCache: boolean; etag?: string }>;
  /** Invalidate cache for a specific URL. */
  invalidate: (url: string) => void;
  /** Invalidate all cache entries matching a pattern. */
  invalidatePattern: (pattern: string | RegExp) => void;
  /** Clear entire cache. */
  clearCache: () => void;
  /** Number of cached entries. */
  cacheSize: number;
  /** Whether Service Worker is registered and active. */
  serviceWorkerActive: boolean;
  /** Register/update the Service Worker. */
  registerServiceWorker: () => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  enabled: true,
  storage: 'memory' as const,
  storagePrefix: 'oui-etag',
  maxEntries: 1000,
  ttl: 3_600_000, // 1 hour
  useServiceWorker: false,
  serviceWorkerUrl: '/service-worker.js',
} as const;

// ---------------------------------------------------------------------------
// LRU cache implementation (module-scoped, shared across instances)
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, CacheEntry>();

/** Access order tracking for LRU eviction — most recently used at the end. */
const accessOrder: string[] = [];

function touchAccessOrder(url: string): void {
  const idx = accessOrder.indexOf(url);
  if (idx !== -1) accessOrder.splice(idx, 1);
  accessOrder.push(url);
}

function evictLRU(maxEntries: number): void {
  while (memoryCache.size > maxEntries && accessOrder.length > 0) {
    const oldest = accessOrder.shift();
    if (oldest) memoryCache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers (SSR-safe)
// ---------------------------------------------------------------------------

function loadFromLocalStorage(prefix: string): Map<string, CacheEntry> {
  if (typeof localStorage === 'undefined') return new Map();
  const entries = new Map<string, CacheEntry>();
  try {
    const raw = localStorage.getItem(`${prefix}:index`);
    if (!raw) return entries;
    const keys = JSON.parse(raw) as string[];
    for (const key of keys) {
      const item = localStorage.getItem(`${prefix}:${key}`);
      if (item) {
        entries.set(key, JSON.parse(item) as CacheEntry);
      }
    }
  } catch {
    // corrupted storage — ignore
  }
  return entries;
}

function persistToLocalStorage(prefix: string, cache: Map<string, CacheEntry>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keys = Array.from(cache.keys());
    localStorage.setItem(`${prefix}:index`, JSON.stringify(keys));
    for (const [key, entry] of cache) {
      localStorage.setItem(`${prefix}:${key}`, JSON.stringify(entry));
    }
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function clearLocalStorage(prefix: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(`${prefix}:index`);
    if (raw) {
      const keys = JSON.parse(raw) as string[];
      for (const key of keys) {
        localStorage.removeItem(`${prefix}:${key}`);
      }
    }
    localStorage.removeItem(`${prefix}:index`);
  } catch {
    // ignore
  }
}

function removeFromLocalStorage(prefix: string, url: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(`${prefix}:${url}`);
    const raw = localStorage.getItem(`${prefix}:index`);
    if (raw) {
      const keys = (JSON.parse(raw) as string[]).filter((k) => k !== url);
      localStorage.setItem(`${prefix}:index`, JSON.stringify(keys));
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// useETagCache hook
// ---------------------------------------------------------------------------

/**
 * Hook for ETag-based HTTP caching with optional Service Worker support.
 * Integrates with @objectstack/client ETag caching for efficient data fetching.
 * When the server responds with 304 Not Modified, cached data is reused.
 *
 * @example
 * ```tsx
 * function UserProfile({ userId }: { userId: string }) {
 *   const cache = useETagCache({ storage: 'localStorage', ttl: 60_000 });
 *
 *   useEffect(() => {
 *     cache.fetchWithETag<User>(`/api/users/${userId}`).then(({ data, fromCache }) => {
 *       console.log(fromCache ? 'Served from cache' : 'Fresh data');
 *       setUser(data);
 *     });
 *   }, [userId]);
 *
 *   return <div>Cache entries: {cache.cacheSize}</div>;
 * }
 * ```
 */
export function useETagCache(userConfig: ETagCacheConfig = {}): ETagCacheResult {
  const enabled = userConfig.enabled ?? DEFAULTS.enabled;
  const storage = userConfig.storage ?? DEFAULTS.storage;
  const storagePrefix = userConfig.storagePrefix ?? DEFAULTS.storagePrefix;
  const maxEntries = userConfig.maxEntries ?? DEFAULTS.maxEntries;
  const ttl = userConfig.ttl ?? DEFAULTS.ttl;
  const useSW = userConfig.useServiceWorker ?? DEFAULTS.useServiceWorker;
  const swUrl = userConfig.serviceWorkerUrl ?? DEFAULTS.serviceWorkerUrl;

  const [cacheSize, setCacheSize] = useState(0);
  const [serviceWorkerActive, setServiceWorkerActive] = useState(false);

  // Keep config in a ref so callbacks always see latest values. Every reader
  // below is a `useCallback` with `[]` deps whose identity consumers may key
  // effects on, so the config has to reach them without changing it — that is
  // the ref's job. Only the WRITE moves: done in the render body it also ran
  // for renders React discards or replays, publishing config from a tree that
  // never committed. `useInsertionEffect` runs in the mutation phase, ahead of
  // every layout effect, ref attachment and paint, so the sole window deferred
  // is the render phase — where `fetchWithETag` / `clearCache` and the other
  // side effects are not callable anyway.
  //
  // The object itself is built by `useMemo` rather than inline at the two
  // places that consume it. `useRef({ ... })` evaluates its argument on EVERY
  // render and keeps only the first result, so every later render allocated a
  // five-key object that was thrown away (objectui#6817) — the same shape PR
  // objectui#6796 repaired in `useSchemaPersistence`. Its identity is
  // unobservable from outside the hook: the ref is private and every reader
  // only reads fields off `.current`, so a memo React chooses to discard is
  // harmless — it rebuilds an equal object, which is what every render used
  // to do unconditionally.
  const config = useMemo(
    () => ({ enabled, storage, storagePrefix, maxEntries, ttl }),
    [enabled, storage, storagePrefix, maxEntries, ttl],
  );
  const configRef = useRef(config);
  useInsertionEffect(() => {
    configRef.current = config;
  });

  // Hydrate memory cache from localStorage on mount
  useEffect(() => {
    if (storage === 'localStorage') {
      const persisted = loadFromLocalStorage(storagePrefix);
      for (const [key, entry] of persisted) {
        if (!memoryCache.has(key)) {
          memoryCache.set(key, entry);
          touchAccessOrder(key);
        }
      }
      evictLRU(maxEntries);
      setCacheSize(memoryCache.size);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-register Service Worker when enabled
  useEffect(() => {
    if (!useSW) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register(swUrl, { scope: '/' })
      .then((registration) => {
        const worker = registration.active ?? registration.installing ?? registration.waiting;
        setServiceWorkerActive(worker?.state === 'activated');

        registration.onupdatefound = () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.onstatechange = () => {
            if (installing.state === 'activated') {
              setServiceWorkerActive(true);
            }
          };
        };
      })
      .catch(() => {
        setServiceWorkerActive(false);
      });
  }, [useSW, swUrl]);

  // ----- Helpers that read/write the shared cache -----

  const isExpired = useCallback((entry: CacheEntry): boolean => {
    return Date.now() - entry.timestamp > configRef.current.ttl;
  }, []);

  const setEntry = useCallback(
    (url: string, entry: CacheEntry): void => {
      memoryCache.set(url, entry);
      touchAccessOrder(url);
      evictLRU(configRef.current.maxEntries);

      if (configRef.current.storage === 'localStorage') {
        persistToLocalStorage(configRef.current.storagePrefix, memoryCache);
      }
      setCacheSize(memoryCache.size);
    },
    [],
  );

  const removeEntry = useCallback(
    (url: string): void => {
      memoryCache.delete(url);
      const idx = accessOrder.indexOf(url);
      if (idx !== -1) accessOrder.splice(idx, 1);

      if (configRef.current.storage === 'localStorage') {
        removeFromLocalStorage(configRef.current.storagePrefix, url);
      }
      setCacheSize(memoryCache.size);
    },
    [],
  );

  // ----- Public API -----

  const fetchWithETag = useCallback(
    async <T>(
      url: string,
      options?: RequestInit,
    ): Promise<{ data: T; fromCache: boolean; etag?: string }> => {
      // Validate URL: only allow http(s) or relative URLs
      if (url.includes('://')) {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('Unsupported')) throw e;
          // Any other parse failure collapses to a generic message; we can't
          // attach `e` as the `Error` `cause` because this package targets
          // ES2020, whose lib types the 1-arg `Error` constructor only.
          // eslint-disable-next-line preserve-caught-error
          throw new Error('Invalid URL');
        }
      }

      if (!configRef.current.enabled) {
        const res = await fetch(url, options);
        const data = (await res.json()) as T;
        return { data, fromCache: false, etag: res.headers.get('etag') ?? undefined };
      }

      const cached = memoryCache.get(url) as CacheEntry<T> | undefined;
      const headers = new Headers(options?.headers);

      if (cached && !isExpired(cached)) {
        if (cached.etag) {
          headers.set('If-None-Match', cached.etag);
        }
        if (cached.lastModified) {
          headers.set('If-Modified-Since', cached.lastModified);
        }
      }

      const res = await fetch(url, { ...options, headers });

      // 304 Not Modified — serve from cache
      if (res.status === 304 && cached) {
        touchAccessOrder(url);
        return { data: cached.data, fromCache: true, etag: cached.etag };
      }

      const data = (await res.json()) as T;
      const etag = res.headers.get('etag') ?? undefined;
      const lastModified = res.headers.get('last-modified') ?? undefined;

      if (etag || lastModified) {
        setEntry(url, {
          data,
          etag: etag ?? '',
          url,
          timestamp: Date.now(),
          lastModified,
        });
      }

      return { data, fromCache: false, etag };
    },
    [isExpired, setEntry],
  );

  const invalidate = useCallback(
    (url: string): void => {
      removeEntry(url);
    },
    [removeEntry],
  );

  const invalidatePattern = useCallback(
    (pattern: string | RegExp): void => {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      const keysToRemove = Array.from(memoryCache.keys()).filter((key) => regex.test(key));
      for (const key of keysToRemove) {
        removeEntry(key);
      }
    },
    [removeEntry],
  );

  const clearCache = useCallback((): void => {
    memoryCache.clear();
    accessOrder.length = 0;

    if (configRef.current.storage === 'localStorage') {
      clearLocalStorage(configRef.current.storagePrefix);
    }
    setCacheSize(0);
  }, []);

  const registerSW = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.register(swUrl, { scope: '/' });
      const worker = registration.active ?? registration.installing ?? registration.waiting;
      const active = worker?.state === 'activated';
      setServiceWorkerActive(active);
      return active;
    } catch {
      setServiceWorkerActive(false);
      return false;
    }
  }, [swUrl]);

  return useMemo<ETagCacheResult>(
    () => ({
      fetchWithETag,
      invalidate,
      invalidatePattern,
      clearCache,
      cacheSize,
      serviceWorkerActive,
      registerServiceWorker: registerSW,
    }),
    [fetchWithETag, invalidate, invalidatePattern, clearCache, cacheSize, serviceWorkerActive, registerSW],
  );
}
