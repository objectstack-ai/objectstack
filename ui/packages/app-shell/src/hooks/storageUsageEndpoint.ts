/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * storageUsageEndpoint — the ONE reader of the tenant runtime's
 * `GET {apiBase}/usage/storage` (objectui#10439).
 *
 * Two console surfaces read that one response, each for its own half:
 *
 *   - `useStorageUsageReading` — the flat storage half (`state`, `warn`,
 *     `blocked`, `usedMb`, `limitMb`), behind the storage-capacity banner.
 *   - `useReadRateReading` — the nested `readRate`, behind the read-rate report.
 *
 * Both banners mount side by side in `ConsoleShell`, behind the same admin gate,
 * in the same commit. Without a shared reader every admin page load would issue
 * the same request twice.
 *
 * ## One in-flight request, no cached answer
 *
 * {@link readStorageUsage} hands every caller that asks while a request for the
 * same URL is pending that same pending request, and forgets it the moment it
 * settles — the shape `useApproverDirectory`'s `INFLIGHT` map already uses. It
 * keeps NO answer: a caller that asks after the request settled issues a new
 * one, so either hook's `refetch` still means "look again".
 *
 * Each hook parses only its own half of the payload. A half that is
 * off-contract is that hook's `'unavailable'`, never the other's.
 *
 * @module
 */
import { createAuthenticatedFetch } from '@object-ui/auth';

/**
 * Resolve the tenant runtime API base — `${VITE_SERVER_URL}/api/v1`, the same
 * origin + prefix the console's other `/api/v1/*` callers use.
 */
export function resolveRuntimeApiBase(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, '');
  // Typed narrowly rather than through `any` — the only member read is the one
  // named here (AGENTS.md #6).
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const serverUrl = env.VITE_SERVER_URL ?? '';
  return `${serverUrl.replace(/\/$/, '')}/api/v1`;
}

/** Pending requests, keyed by URL. An entry lives exactly as long as its request. */
const IN_FLIGHT = new Map<string, Promise<unknown>>();

/**
 * Read `GET {apiBase}/usage/storage` and resolve with the parsed JSON body.
 *
 * Rejects on a network failure or a non-2xx answer; each caller maps that to
 * its own "no trustworthy reading" status. See the module header for why
 * concurrent callers share one request.
 */
export function readStorageUsage(apiBase: string): Promise<unknown> {
  const url = `${apiBase}/usage/storage`;
  const pending = IN_FLIGHT.get(url);
  if (pending) return pending;

  // Built per request rather than per module: this is the console's `/api/v1/*`
  // lane, the Bearer token lives in localStorage and there is no session
  // cookie, so a bare `fetch` here would be unauthenticated — and a fetcher
  // captured once would outlive the session it was built for.
  const authFetch = createAuthenticatedFetch();
  const request = authFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
    .then(async (res): Promise<unknown> => {
      if (!res.ok) throw new Error(`Failed to load storage usage (${res.status})`);
      return res.json();
    })
    // Removed before any caller sees the outcome: `finally` settles the promise
    // callers hold only after this callback has run.
    .finally(() => {
      IN_FLIGHT.delete(url);
    });
  IN_FLIGHT.set(url, request);
  return request;
}
