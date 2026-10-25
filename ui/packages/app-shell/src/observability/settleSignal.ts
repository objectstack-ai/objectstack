/**
 * settleSignal — global "is the app idle?" in-flight request counter.
 *
 * ADR-0054 "UI testability contract", invariant C5 (machine-readable async
 * state). Gives an automated (AI) browser driver a single predicate to poll
 * instead of hardcoding waits or scraping per-component spinners:
 *
 *   await page.waitForFunction(() => window.__objectui?.idle === true)
 *   // or:  window.__objectui.pendingRequests === 0
 *   // or:  await window.__objectui.whenIdle()
 *
 * The app-shell data layer increments the counter around every outbound request
 * by wrapping the adapter's `fetch` with {@link withSettleSignal}. Async regions
 * additionally expose `aria-busy`/`data-state` for region-level waiting.
 *
 * The counter is a module singleton (shared across the app); `window.__objectui`
 * mirrors it via live getters installed by {@link installSettleSignalGlobal}.
 *
 * @module
 */

type Listener = (pending: number) => void;

let pending = 0;
const listeners = new Set<Listener>();
let idleWaiters: Array<() => void> = [];

function notify(): void {
  for (const l of listeners) {
    try {
      l(pending);
    } catch {
      /* a listener throwing must not break request accounting */
    }
  }
  if (pending === 0 && idleWaiters.length > 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) {
      try {
        resolve();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Mark one request as in-flight. Pair with {@link endRequest}. */
export function beginRequest(): void {
  pending += 1;
  notify();
}

/** Mark one in-flight request as settled (clamped at 0). */
export function endRequest(): void {
  pending = Math.max(0, pending - 1);
  notify();
}

/** Current number of in-flight requests. */
export function getPendingRequests(): number {
  return pending;
}

/** Whether the app is idle (no requests in flight). */
export function isIdle(): boolean {
  return pending === 0;
}

/**
 * Subscribe to in-flight count changes. Returns an unsubscribe function.
 * Used by {@link useSettleSignal} and any consumer wanting a global busy state.
 */
export function subscribeSettle(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Resolve once the app is idle (no in-flight requests). Resolves immediately if
 * already idle. `timeoutMs` (default 10s, `0` to disable) caps the wait so a
 * pathological never-idle app — e.g. a held-open stream — can't hang a driver.
 */
export function whenIdle(timeoutMs = 10_000): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    idleWaiters.push(finish);
    if (timeoutMs > 0 && typeof setTimeout !== 'undefined') {
      setTimeout(finish, timeoutMs);
    }
  });
}

/**
 * Wrap a `fetch` so each call increments the in-flight counter before the
 * request and decrements it when the promise settles (success or failure).
 */
export function withSettleSignal(fetchFn: typeof fetch): typeof fetch {
  return (async (...args: Parameters<typeof fetch>) => {
    beginRequest();
    try {
      return await fetchFn(...args);
    } finally {
      endRequest();
    }
  }) as typeof fetch;
}

/** Shape mirrored onto `window.__objectui` for automated drivers. */
export interface ObjectUiGlobal {
  /** Live in-flight request count. */
  readonly pendingRequests: number;
  /** Live idle flag (`pendingRequests === 0`). */
  readonly idle: boolean;
  /** Resolve once idle (see {@link whenIdle}). */
  whenIdle: (timeoutMs?: number) => Promise<void>;
  /** Subscribe to in-flight count changes. */
  subscribe: (cb: (pending: number) => void) => () => void;
}

/**
 * Install live `window.__objectui` accessors (idempotent). Safe to call in any
 * environment — a no-op when `window` is undefined (SSR/tests).
 */
export function installSettleSignalGlobal(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __objectui?: Record<string, unknown> };
  const ns = (w.__objectui ??= {});
  // Live getters so reads always reflect the current count.
  Object.defineProperty(ns, 'pendingRequests', { get: getPendingRequests, configurable: true });
  Object.defineProperty(ns, 'idle', { get: isIdle, configurable: true });
  ns.whenIdle = whenIdle;
  ns.subscribe = subscribeSettle;
}

/** Test-only: reset the counter and listeners to a clean state. */
export function __resetSettleSignal(): void {
  pending = 0;
  listeners.clear();
  idleWaiters = [];
}
