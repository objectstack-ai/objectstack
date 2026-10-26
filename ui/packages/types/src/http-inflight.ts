/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Sharing ONE in-flight GET between callers that cannot see each other
 * (objectui#5544).
 *
 * ## The defect this closes
 *
 * The console's boot issues several `fetch` calls from modules that have no
 * shared provider between them, and two pairs of them ask for the *same* URL at
 * the same time:
 *
 *  - `GET /api/v1/runtime/config` — the pre-React branding script inlined in
 *    `apps/console/index.html` (it runs during parse, so the title and favicon
 *    are right before the bundle is even fetched) and `initRuntimeConfig()` in
 *    `@object-ui/app-shell`, which needs the whole payload.
 *  - `GET /api/v1/auth/me/localization` — `seedTenantLanguage()` on a device's
 *    true first visit, and `LocalizationFetchProvider` on every boot.
 *
 * A guard *inside* either caller cannot see the other one, which is what makes
 * this a request-layer problem rather than a component one.
 *
 * ## What this is, and what it deliberately is not
 *
 * It shares the in-flight PROMISE and nothing else. The registry entry is
 * created when a request starts and deleted the moment it settles — there is no
 * response cache, no TTL, and no stale window. A caller arriving after settle
 * issues a fresh request and sees fresh data, exactly as it did before. The only
 * observable change is that callers *overlapping in time* cost one round trip
 * instead of N.
 *
 * Three consequences worth stating, because a dedup that gets any of them wrong
 * is worse than the duplicate it removed:
 *
 *  1. **A rejection fans out.** Every sharer of a failed request sees the same
 *     `HttpFetchError`, so a caller with a retry policy (`LocalizationFetchProvider`)
 *     still gets its 503 and still retries. A dedup that resolved the late
 *     caller with `undefined` would starve it silently.
 *  2. **Each caller gets its own object.** The parsed body is cloned per caller,
 *     so two consumers of one request are as independent as two consumers of two
 *     requests. Handing out one shared reference would let either caller's
 *     mutation reach the other.
 *  3. **GET only.** {@link sharedGetJson} refuses any other method outright
 *     rather than quietly rewriting it: replaying one POST for two callers, or
 *     collapsing two POSTs into one, is data loss. Declared = enforced.
 *
 * ## Why the registry hangs off `globalThis`
 *
 * One of the two callers above is an inline **classic** script in `index.html`.
 * It cannot import this module — it has to run before any module chunk executes
 * — so a module-scoped `Map` could never be reached from it, and the most
 * valuable duplicate (every cold load, on the critical path to first paint)
 * would survive the fix. `Symbol.for` gives both worlds one registry with no
 * import and no bundler cooperation. `apps/console/src/__tests__/` executes the
 * real script text out of the shipped `index.html` against this module, so the
 * two spellings of {@link inflightGetKey} cannot drift apart unnoticed.
 *
 * It lives in `@object-ui/types` for the same reason `http-retry.ts` does: it is
 * the lowest package every caller can reach.
 */

import { HttpFetchError, retryAfterFrom } from './http-retry.js';

/**
 * The registry's slot on `globalThis`.
 *
 * `Symbol.for` (not a plain string, and not a module-local symbol) so the inline
 * classic script in `index.html`, this module, and any duplicate copy of this
 * module a bundler happens to emit all resolve to the SAME map.
 */
export const INFLIGHT_GET_REGISTRY_KEY = Symbol.for('objectui.inflightGet');

/** Registry contents: request key → the in-flight parsed-body promise. */
type InflightRegistry = Map<string, Promise<unknown>>;

function registry(): InflightRegistry {
  const holder = globalThis as unknown as Record<symbol, InflightRegistry | undefined>;
  const existing = holder[INFLIGHT_GET_REGISTRY_KEY];
  if (existing) return existing;
  const created: InflightRegistry = new Map();
  holder[INFLIGHT_GET_REGISTRY_KEY] = created;
  return created;
}

/**
 * Normalise request headers to `name=value` pairs, lowercased and sorted.
 *
 * Header names are case-insensitive on the wire, and object literals have no
 * meaningful order, so two callers spelling the same request differently must
 * still produce one key.
 */
function normalizeHeaders(headers: HeadersInit | undefined): string {
  if (!headers) return '';
  const pairs: string[] = [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, name) => pairs.push(`${name.toLowerCase()}=${value}`));
  } else if (Array.isArray(headers)) {
    for (const [name, value] of headers) pairs.push(`${String(name).toLowerCase()}=${String(value)}`);
  } else {
    for (const [name, value] of Object.entries(headers)) {
      pairs.push(`${name.toLowerCase()}=${String(value)}`);
    }
  }
  return pairs.sort().join(',');
}

/**
 * The identity of a GET request, for in-flight sharing.
 *
 * Two requests share a promise only when this string matches, which is why the
 * credentials mode and the headers are part of it and not just the URL. That is
 * load-bearing, not defensive: the console asks `GET /api/v1/auth/get-session`
 * twice on purpose — once Bearer-only with `credentials: 'omit'` to detect a
 * stale token, then again through the cookie — and collapsing those two would
 * destroy the very signal the first one exists to read. Different headers,
 * different key, two requests.
 *
 * ⚠️ The inline branding script in `apps/console/index.html` builds this string
 * by hand (it cannot import). Change the format here and that script must change
 * with it; `runtimeConfigBootDedup.test.ts` executes the shipped script against
 * this function so a mismatch fails rather than silently un-shares.
 */
export function inflightGetKey(url: string, init?: RequestInit): string {
  const credentials = init?.credentials ?? 'same-origin';
  return `GET\n${credentials}\n${url}\n${normalizeHeaders(init?.headers)}`;
}

/**
 * Hand each caller its own copy of the parsed body.
 *
 * The value came off `Response.json()`, so it is JSON-shaped by construction and
 * both branches are lossless for it.
 */
function copy<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The `fetch` this module uses when a caller does not inject one. */
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

/**
 * Issue `GET url`, or join the identical request already in flight, and resolve
 * the parsed JSON body.
 *
 * Rejects with {@link HttpFetchError} carrying the status (and any `Retry-After`)
 * on a non-2xx, so a caller's existing retry policy keeps working unchanged.
 *
 * @param url     Absolute or same-origin URL.
 * @param init    Standard `fetch` init. `method` may be omitted or `'GET'`;
 *                anything else throws.
 * @param fetchImpl Injected transport, for tests and for callers that must go
 *                through an authenticated wrapper.
 */
export async function sharedGetJson<T>(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = defaultFetch,
): Promise<T> {
  const method = init?.method;
  if (method !== undefined && method.toUpperCase() !== 'GET') {
    throw new TypeError(
      `sharedGetJson is GET-only; refusing to share a ${method.toUpperCase()} request`,
    );
  }

  // An `AbortSignal` belongs to ONE caller. Sharing a request behind two signals
  // would let either caller's abort cancel the other's read — a starvation this
  // module exists to avoid — and the signal is not part of the key, so it cannot
  // be separated by one either. A cancellable request simply opts out: it fetches
  // on its own, and it neither joins nor blocks anyone else's.
  if (init?.signal) {
    const res = await fetchImpl(url, { ...init, method: 'GET' });
    if (!res.ok) throw new HttpFetchError(res.status, retryAfterFrom(res));
    return (await res.json()) as T;
  }

  const key = inflightGetKey(url, init);
  const reg = registry();

  const existing = reg.get(key) as Promise<T> | undefined;
  if (existing) return copy(await existing);

  const started = (async (): Promise<T> => {
    const res = await fetchImpl(url, { ...init, method: 'GET' });
    if (!res.ok) throw new HttpFetchError(res.status, retryAfterFrom(res));
    return (await res.json()) as T;
  })();

  reg.set(key, started);
  // `.then(cleanup, cleanup)` rather than `.finally(cleanup)`: `finally`
  // re-raises the rejection on a NEW chained promise we do not return, which the
  // runtime then reports as unhandled even though every real caller handled it.
  const cleanup = () => {
    // Only drop the entry if it is still ours — a caller that started after we
    // settled may already have replaced it.
    if (reg.get(key) === started) reg.delete(key);
  };
  started.then(cleanup, cleanup);

  return copy(await started);
}

/** Drop every registry entry. Tests only — production code never needs this. */
export function resetInflightGetsForTesting(): void {
  registry().clear();
}
