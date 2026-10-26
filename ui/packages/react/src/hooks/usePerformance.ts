/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// This file's header used to read "Types aligned with @objectstack/spec v2.0.7
// PerformanceConfigSchema", and `PerformanceConfig` was on the objectstack#4115
// ledger because the spec exported that name.
//
// It no longer does. `PerformanceConfigSchema` / `PerformanceConfig` were
// RETIRED from `@objectstack/spec/ui` in 17.0.0-rc.1, so there is nothing to
// import and no collision left: the name is objectui's own now. The shape below
// is what the spec's schema was, kept because `usePerformance` implements it.
//
// Worth a second look by someone who knows the spec's plans: the KEYS still
// exist inside the spec (`virtualScroll`, `debounceMs`, … appear nested under
// `@objectstack/spec/api`), so this may be a move rather than a retirement. If
// it is a move, this should derive from wherever it landed.
// ---------------------------------------------------------------------------

/** Cache strategy for data fetching. */
export type CacheStrategyType =
  | 'none'
  | 'cache-first'
  | 'network-first'
  | 'stale-while-revalidate';

/** Virtual scroll configuration. */
export interface VirtualScrollConfig {
  enabled?: boolean;
  itemHeight?: number;
  overscan?: number;
}

/** Performance configuration. */
export interface PerformanceConfig {
  /** Whether to lazy-load components/data. */
  lazyLoad?: boolean;
  /** Virtual scroll settings for large lists. */
  virtualScroll?: VirtualScrollConfig;
  /** Cache strategy for data fetching. */
  cacheStrategy?: CacheStrategyType;
  /** Whether to prefetch linked resources. */
  prefetch?: boolean;
  /** Default page size for paginated views. */
  pageSize?: number;
  /** Debounce interval in milliseconds for user input. */
  debounceMs?: number;
}

/** Web Vitals metrics snapshot. */
export interface PerformanceMetrics {
  /** Largest Contentful Paint (ms). */
  lcp: number | null;
  /** First Contentful Paint (ms). */
  fcp: number | null;
  /** Time to Interactive (ms). */
  tti: number | null;
  /** Total render count since mount. */
  renderCount: number;
  /** Last render duration (ms). */
  lastRenderDuration: number | null;
}

/** Result returned by the usePerformance hook. */
export interface PerformanceResult {
  /** The resolved performance configuration (with defaults). */
  config: Required<Omit<PerformanceConfig, 'virtualScroll'>> & {
    virtualScroll: Required<VirtualScrollConfig>;
  };
  /** Current performance metrics. */
  metrics: PerformanceMetrics;
  /** Mark a rendering start (returns stop function). */
  markRenderStart: () => () => void;
  /** Create a debounced version of a callback. */
  debounce: <T extends (...args: unknown[]) => void>(fn: T) => T;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  lazyLoad: true,
  cacheStrategy: 'stale-while-revalidate' as CacheStrategyType,
  prefetch: false,
  pageSize: 50,
  debounceMs: 300,
  virtualScroll: {
    enabled: false,
    itemHeight: 40,
    overscan: 5,
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFCP(): number | null {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return null;
  try {
    const entries = performance.getEntriesByType('paint');
    const entry = entries.find((e) => e.name === 'first-contentful-paint');
    return entry ? Math.round(entry.startTime) : null;
  } catch {
    return null;
  }
}

function getLCP(): number | null {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return null;
  try {
    const entries = performance.getEntriesByType('largest-contentful-paint');
    const entry = entries.length > 0 ? entries[entries.length - 1] : undefined;
    return entry ? Math.round(entry.startTime) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// usePerformance hook
// ---------------------------------------------------------------------------

/**
 * Hook for performance monitoring and configuration. Its config type IS the
 * spec's `PerformanceConfigSchema` (authoring side) — see {@link PerformanceConfig}.
 *
 * Provides resolved config values, Web Vitals metrics, and utility functions
 * (debounce, render marking) for performance-aware components.
 *
 * @example
 * ```tsx
 * function DataGrid({ data }: { data: unknown[] }) {
 *   const perf = usePerformance({
 *     lazyLoad: true,
 *     virtualScroll: { enabled: true, itemHeight: 40 },
 *     debounceMs: 200,
 *   });
 *
 *   const handleSearch = perf.debounce((query: string) => {
 *     // debounced search
 *   });
 *
 *   return (
 *     <div>
 *       {perf.config.virtualScroll.enabled
 *         ? <VirtualList itemHeight={perf.config.virtualScroll.itemHeight} />
 *         : <NormalList />}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePerformance(userConfig: PerformanceConfig = {}): PerformanceResult {
  const config = useMemo(
    () => ({
      lazyLoad: userConfig.lazyLoad ?? DEFAULTS.lazyLoad,
      cacheStrategy: userConfig.cacheStrategy ?? DEFAULTS.cacheStrategy,
      prefetch: userConfig.prefetch ?? DEFAULTS.prefetch,
      pageSize: userConfig.pageSize ?? DEFAULTS.pageSize,
      debounceMs: userConfig.debounceMs ?? DEFAULTS.debounceMs,
      virtualScroll: {
        enabled: userConfig.virtualScroll?.enabled ?? DEFAULTS.virtualScroll.enabled,
        itemHeight: userConfig.virtualScroll?.itemHeight ?? DEFAULTS.virtualScroll.itemHeight,
        overscan: userConfig.virtualScroll?.overscan ?? DEFAULTS.virtualScroll.overscan,
      },
    }),
    [
      userConfig.lazyLoad,
      userConfig.cacheStrategy,
      userConfig.prefetch,
      userConfig.pageSize,
      userConfig.debounceMs,
      userConfig.virtualScroll?.enabled,
      userConfig.virtualScroll?.itemHeight,
      userConfig.virtualScroll?.overscan,
    ],
  );

  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    lcp: null,
    fcp: null,
    tti: null,
    renderCount: 0,
    lastRenderDuration: null,
  });

  // Collect paint metrics on mount
  useEffect(() => {
    // Defer metric collection to allow paint entries to populate
    const timer = setTimeout(() => {
      setMetrics((prev) => ({
        ...prev,
        fcp: getFCP(),
        lcp: getLCP(),
      }));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const markRenderStart = useCallback((): (() => void) => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return () => {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const duration = Math.round((end - start) * 100) / 100;
      setMetrics((prev) => ({ ...prev, lastRenderDuration: duration, renderCount: prev.renderCount + 1 }));
    };
  }, []);

  const debounceMs = config.debounceMs;
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const debounce = useCallback(
    <T extends (...args: unknown[]) => void>(fn: T): T => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const debounced = (...args: unknown[]) => {
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(timer);
        }
        timer = setTimeout(() => {
          fn(...args);
          if (timer) timersRef.current.delete(timer);
        }, debounceMs);
        timersRef.current.add(timer);
      };
      return debounced as unknown as T;
    },
    [debounceMs],
  );

  // Cleanup all debounce timers
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return useMemo(
    () => ({
      config,
      metrics,
      markRenderStart,
      debounce,
    }),
    [config, metrics, markRenderStart, debounce],
  );
}
