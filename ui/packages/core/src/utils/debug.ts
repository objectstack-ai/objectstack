/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export type DebugCategory = 'schema' | 'registry' | 'expression' | 'action' | 'plugin' | 'render' | 'dashboard';

/**
 * Fine-grained debug flags parsed from URL parameters.
 *
 * @example
 * ```
 * ?__debug              → { enabled: true }
 * ?__debug_schema       → { enabled: true, schema: true }
 * ?__debug_perf&__debug_data → { enabled: true, perf: true, data: true }
 * ```
 */
export interface DebugFlags {
  /** Master switch — true when any debug parameter is present */
  enabled: boolean;
  schema?: boolean;
  perf?: boolean;
  data?: boolean;
  expr?: boolean;
  events?: boolean;
  registry?: boolean;
}

const DEBUG_PARAM_PREFIX = '__debug';

/**
 * Parse debug flags from a URL search string (e.g. `?__debug&__debug_schema`).
 * SSR-safe — returns `{ enabled: false }` when `window` is unavailable.
 *
 * @param search — Optional search string. Defaults to `window.location.search` when available.
 */
export function parseDebugFlags(search?: string): DebugFlags {
  let qs: string | undefined = search;
  if (qs === undefined) {
    try {
      qs = typeof window !== 'undefined' ? window.location.search : '';
    } catch {
      qs = '';
    }
  }

  const params = new URLSearchParams(qs);
  const hasMain = params.has(DEBUG_PARAM_PREFIX);
  const schema = params.has(`${DEBUG_PARAM_PREFIX}_schema`);
  const perf = params.has(`${DEBUG_PARAM_PREFIX}_perf`);
  const data = params.has(`${DEBUG_PARAM_PREFIX}_data`);
  const expr = params.has(`${DEBUG_PARAM_PREFIX}_expr`);
  const events = params.has(`${DEBUG_PARAM_PREFIX}_events`);
  const registry = params.has(`${DEBUG_PARAM_PREFIX}_registry`);

  const anySub = schema || perf || data || expr || events || registry;
  const enabled = hasMain || anySub;

  return {
    enabled,
    ...(schema && { schema }),
    ...(perf && { perf }),
    ...(data && { data }),
    ...(expr && { expr }),
    ...(events && { events }),
    ...(registry && { registry }),
  };
}

/**
 * Check whether debug mode is enabled.
 *
 * Resolution order (first truthy wins):
 * 1. URL parameter `?__debug` (browser only)
 * 2. `globalThis.OBJECTUI_DEBUG`
 * 3. `process.env.OBJECTUI_DEBUG`
 */
export function isDebugEnabled(): boolean {
  try {
    // 1. URL parameter (browser only, SSR-safe)
    if (typeof window !== 'undefined') {
      try {
        const flags = parseDebugFlags(window.location.search);
        if (flags.enabled) return true;
      } catch { /* ignore */ }
    }

    // 2. globalThis flag
    const g = typeof globalThis !== 'undefined' && (globalThis as any).OBJECTUI_DEBUG;
    if (g === true || g === 'true') return true;

    // 3. process.env
    const proc = (globalThis as any).process;
    if (proc?.env?.OBJECTUI_DEBUG === 'true') return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Log a debug message when OBJECTUI_DEBUG is enabled.
 * No-op in production or when debug mode is off.
 *
 * @example
 * ```ts
 * // Enable debug mode
 * globalThis.OBJECTUI_DEBUG = true;
 *
 * debugLog('schema', 'Resolving component', { type: 'Button' });
 * // [ObjectUI Debug][schema] Resolving component { type: 'Button' }
 * ```
 */
export function debugLog(category: DebugCategory, message: string, data?: unknown): void {
  if (!isDebugEnabled()) return;
  if (data !== undefined) {
    // objectui#4029 — this IS the repo's debug channel (opt-in via
    // globalThis.OBJECTUI_DEBUG, gated by isDebugEnabled() above), not a
    // leaked module-scope log; no-console's blanket ban would otherwise
    // block the function whose entire job is to console.log.
    // eslint-disable-next-line no-console
    console.log(`[ObjectUI Debug][${category}] ${message}`, data);
  } else {
    // eslint-disable-next-line no-console -- see comment above
    console.log(`[ObjectUI Debug][${category}] ${message}`);
  }
}

const timers = new Map<string, number>();

/**
 * Start a debug timer. Pair with {@link debugTimeEnd}.
 */
export function debugTime(label: string): void {
  if (!isDebugEnabled()) return;
  timers.set(label, performance.now());
}

/**
 * End a debug timer and log the elapsed time.
 */
export function debugTimeEnd(label: string): void {
  if (!isDebugEnabled()) return;
  const start = timers.get(label);
  if (start !== undefined) {
    const elapsed = (performance.now() - start).toFixed(2);
    // eslint-disable-next-line no-console -- objectui#4029, see debugLog above
    console.log(`[ObjectUI Debug][perf] ${label}: ${elapsed}ms`);
    timers.delete(label);
  }
}
