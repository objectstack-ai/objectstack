/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types for performance budget enforcement
// ---------------------------------------------------------------------------

/** Metric names that can be tracked against a budget. */
export type BudgetMetric = 'lcp' | 'fcp' | 'renderTime' | 'memory';

/**
 * Performance budget configuration.
 * Defines thresholds for LCP, bundle size, render time, etc.
 */
export interface PerformanceBudget {
  /** Max Largest Contentful Paint in ms (default: 600) */
  maxLCP?: number;
  /** Max First Contentful Paint in ms (default: 300) */
  maxFCP?: number;
  /** Max component render time in ms (default: 16) */
  maxRenderTime?: number;
  /** Max bundle size in KB (gzipped) - informational only */
  maxBundleSizeKB?: number;
  /** Max memory usage in MB */
  maxMemoryMB?: number;
  /** Whether to log warnings to console in dev mode (default: true) */
  warnOnViolation?: boolean;
  /** Callback when a budget is violated */
  onViolation?: (violation: BudgetViolation) => void;
}

export interface BudgetViolation {
  metric: BudgetMetric;
  budget: number;
  actual: number;
  timestamp: number;
}

export interface PerformanceBudgetResult {
  /** Current violations */
  violations: BudgetViolation[];
  /** Whether all budgets are within limits */
  isWithinBudget: boolean;
  /** Check if a specific metric is within budget */
  checkMetric: (metric: BudgetMetric, value: number) => boolean;
  /** Track a render and check against budget */
  trackRender: (durationMs: number) => boolean;
  /** Clear all recorded violations */
  clearViolations: () => void;
  /** Current performance snapshot */
  snapshot: {
    lcp: number | null;
    fcp: number | null;
    memoryMB: number | null;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  maxLCP: 600,
  maxFCP: 300,
  maxRenderTime: 16,
  maxMemoryMB: 128,
  warnOnViolation: true,
} as const;

// ---------------------------------------------------------------------------
// Helpers (same getFCP/getLCP pattern as usePerformance.ts)
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

/** Chrome-only memory API (guarded). */
function getMemoryMB(): number | null {
  try {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    if (mem?.usedJSHeapSize != null) {
      return Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 100) / 100;
    }
  } catch {
    /* not available */
  }
  return null;
}

function buildViolationKey(metric: BudgetMetric): string {
  return metric;
}

// ---------------------------------------------------------------------------
// usePerformanceBudget hook
// ---------------------------------------------------------------------------

/**
 * Hook for performance budget enforcement aligned with ROADMAP Q3 3.3.
 *
 * Monitors Web Vitals (LCP, FCP), memory usage, and component render times
 * against configurable thresholds. Violations are recorded, deduplicated,
 * and optionally logged to the console in development mode.
 *
 * @example
 * ```tsx
 * function App() {
 *   const budget = usePerformanceBudget({
 *     maxLCP: 500,
 *     maxRenderTime: 16,
 *     onViolation: (v) => analytics.track('perf_violation', v),
 *   });
 *
 *   if (!budget.isWithinBudget) {
 *     console.warn('Performance budget exceeded:', budget.violations);
 *   }
 *
 *   return <Dashboard />;
 * }
 * ```
 */
export function usePerformanceBudget(
  userBudget: PerformanceBudget = {},
): PerformanceBudgetResult {
  const budget = useMemo(
    () => ({
      maxLCP: userBudget.maxLCP ?? DEFAULTS.maxLCP,
      maxFCP: userBudget.maxFCP ?? DEFAULTS.maxFCP,
      maxRenderTime: userBudget.maxRenderTime ?? DEFAULTS.maxRenderTime,
      maxMemoryMB: userBudget.maxMemoryMB ?? DEFAULTS.maxMemoryMB,
      warnOnViolation: userBudget.warnOnViolation ?? DEFAULTS.warnOnViolation,
    }),
    [
      userBudget.maxLCP,
      userBudget.maxFCP,
      userBudget.maxRenderTime,
      userBudget.maxMemoryMB,
      userBudget.warnOnViolation,
    ],
  );

  const onViolationRef = useRef(userBudget.onViolation);
  useEffect(() => {
    onViolationRef.current = userBudget.onViolation;
  }, [userBudget.onViolation]);

  const [violations, setViolations] = useState<BudgetViolation[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  const [snapshot, setSnapshot] = useState<{
    lcp: number | null;
    fcp: number | null;
    memoryMB: number | null;
  }>({ lcp: null, fcp: null, memoryMB: null });

  // -------------------------------------------------------------------
  // Violation recording with deduplication
  // -------------------------------------------------------------------

  const recordViolation = useCallback(
    (metric: BudgetMetric, budgetValue: number, actual: number) => {
      const key = buildViolationKey(metric);
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);

      const violation: BudgetViolation = {
        metric,
        budget: budgetValue,
        actual: Math.round(actual * 100) / 100,
        timestamp: Date.now(),
      };

      setViolations((prev) => [...prev, violation]);

      if (budget.warnOnViolation && (globalThis as any).process?.env?.NODE_ENV !== 'production') {
        console.warn(
          `[ObjectUI] Performance budget violated: ${metric} = ${violation.actual} (budget: ${budgetValue})`,
        );
      }

      onViolationRef.current?.(violation);
    },
    [budget.warnOnViolation],
  );

  // -------------------------------------------------------------------
  // Collect Web Vitals & memory on mount
  // -------------------------------------------------------------------

  useEffect(() => {
    const timer = setTimeout(() => {
      const fcp = getFCP();
      const lcp = getLCP();
      const memoryMB = getMemoryMB();

      setSnapshot({ lcp, fcp, memoryMB });

      if (fcp != null && fcp > budget.maxFCP) {
        recordViolation('fcp', budget.maxFCP, fcp);
      }
      if (lcp != null && lcp > budget.maxLCP) {
        recordViolation('lcp', budget.maxLCP, lcp);
      }
      if (memoryMB != null && memoryMB > budget.maxMemoryMB) {
        recordViolation('memory', budget.maxMemoryMB, memoryMB);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [budget.maxFCP, budget.maxLCP, budget.maxMemoryMB, recordViolation]);

  // -------------------------------------------------------------------
  // Periodic memory monitoring
  // -------------------------------------------------------------------

  useEffect(() => {
    // Only run when memory API is available
    if (getMemoryMB() == null) return;

    const interval = setInterval(() => {
      const memoryMB = getMemoryMB();
      if (memoryMB != null) {
        setSnapshot((prev) => ({ ...prev, memoryMB }));
        if (memoryMB > budget.maxMemoryMB) {
          recordViolation('memory', budget.maxMemoryMB, memoryMB);
        }
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [budget.maxMemoryMB, recordViolation]);

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  const checkMetric = useCallback(
    (metric: BudgetMetric, value: number): boolean => {
      let threshold: number;
      switch (metric) {
        case 'lcp':
          threshold = budget.maxLCP;
          break;
        case 'fcp':
          threshold = budget.maxFCP;
          break;
        case 'renderTime':
          threshold = budget.maxRenderTime;
          break;
        case 'memory':
          threshold = budget.maxMemoryMB;
          break;
      }

      const withinBudget = value <= threshold;
      if (!withinBudget) {
        recordViolation(metric, threshold, value);
      }
      return withinBudget;
    },
    [budget.maxLCP, budget.maxFCP, budget.maxRenderTime, budget.maxMemoryMB, recordViolation],
  );

  const trackRender = useCallback(
    (durationMs: number): boolean => {
      return checkMetric('renderTime', durationMs);
    },
    [checkMetric],
  );

  const clearViolations = useCallback(() => {
    setViolations([]);
    seenRef.current.clear();
  }, []);

  return useMemo(
    () => ({
      violations,
      isWithinBudget: violations.length === 0,
      checkMetric,
      trackRender,
      clearViolations,
      snapshot,
    }),
    [violations, checkMetric, trackRender, clearViolations, snapshot],
  );
}
