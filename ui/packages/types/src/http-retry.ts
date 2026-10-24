/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Primitives for retrying a TRANSIENT HTTP failure.
 *
 * These answer two questions only — "is this worth re-attempting?" and "how long
 * until the next attempt?" — and nothing about what to do while waiting. That is
 * deliberate: the two providers that use them have opposite postures.
 * `MePermissionsProvider` is FAIL-CLOSED and holds its loading state across the
 * waits, because rendering a permissive default early is a real hazard;
 * `LocalizationFetchProvider` is COSMETIC and never blocks, because a missing
 * currency just renders a plain number. One definition of "transient", two
 * policies — rather than one policy forced on both, or two copies of the
 * definition drifting apart.
 *
 * They live in this package because it is the lowest one both callers can reach
 * (`@object-ui/types` has no `@object-ui` dependencies of its own).
 */

/** Upper bound on any single backoff wait, so a bad `Retry-After` cannot park a caller. */
export const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Statuses that mean "not now", so retrying can succeed without anything
 * changing on the caller's side:
 *
 *  - `408` / `425` — the request itself did not land.
 *  - `429` — rate limited; `Retry-After` usually accompanies it.
 *  - `502` / `503` / `504` — the upstream is absent, warming or timing out.
 *    `503` is the load-bearing one: on a multi-tenant host the `/auth/me/*`
 *    endpoints are served by the environment kernel that owns the session, and
 *    the framework answers `503` + `Retry-After` while a cold one is still being
 *    built (objectstack#4159). Both providers see it, so both must survive it.
 *
 * Deliberately NOT retried: `401` / `403` (a real answer about this caller),
 * `404` (no such endpoint — retrying cannot conjure one) and `500` (a genuine
 * server fault; hammering it neither helps nor is honest about the failure).
 */
export const TRANSIENT_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 502, 503, 504]);

/** An `Error` that also carries the HTTP status it came from. */
export class HttpFetchError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
    message?: string,
  ) {
    super(message ?? `Endpoint returned ${status}`);
    this.name = 'HttpFetchError';
  }
}

/**
 * Whether a failed attempt is worth re-attempting. A THROWN fetch (offline,
 * DNS, aborted connection) is transient the same way a `503` is — the request
 * never got an answer at all.
 */
export function isTransientFailure(err: unknown): boolean {
  return err instanceof HttpFetchError ? TRANSIENT_STATUS.has(err.status) : true;
}

/**
 * `Retry-After` in ms, or `undefined` when absent/unparseable. Accepts both wire
 * forms (delta-seconds and an HTTP-date) and clamps to {@link MAX_RETRY_DELAY_MS}
 * so a hostile or buggy value cannot park a caller for hours.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs: number,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let ms: number;
  if (/^\d+$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return undefined;
    ms = at - nowMs;
  }
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(ms, MAX_RETRY_DELAY_MS);
}

/** How long to wait before attempt `attempt + 1`. A server-stated delay wins. */
export function backoffMs(attempt: number, baseDelayMs: number, statedMs?: number): number {
  if (statedMs !== undefined) return statedMs;
  return Math.min(baseDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read `Retry-After` off a response without assuming `headers` exists (test doubles often omit it). */
export function retryAfterFrom(res: { headers?: { get?(name: string): string | null } }): number | undefined {
  return parseRetryAfterMs(res.headers?.get?.('Retry-After'), Date.now());
}
