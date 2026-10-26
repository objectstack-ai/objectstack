/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The single construction point for {@link MetadataClient} in the console.
 *
 * Authentication is a cross-cutting concern, but `MetadataClient` is a
 * framework-agnostic HTTP client that defaults its `fetch` to the bare
 * `globalThis.fetch` (no `Authorization` header). The console authenticates
 * to `/api/v1/*` with a **Bearer token** kept in `localStorage`
 * (`auth-session-token`) — there is no session cookie — so any client built on
 * the raw global fetch is *unauthenticated* and every `/api/v1/meta/*` request
 * comes back `401 unauthenticated`. That failure only surfaces in the
 * token-based console (a same-origin cookie deployment masks it), which is why
 * two construction sites silently regressed.
 *
 * Funnelling every console client through this factory bakes in the shared
 * authenticated fetch (Bearer token + `X-Tenant-ID` + `Accept-Language`, via
 * {@link createAuthenticatedFetch}) so a caller can no longer *forget* to
 * authenticate. `metadata-client-auth.ratchet.test.ts` forbids a bare
 * `new MetadataClient(` anywhere else in app-shell so this stays the one source
 * of truth. This is additive for cookie deployments — `createAuthenticatedFetch`
 * never touches `credentials`, so a same-origin session cookie still flows.
 */

import { MetadataClient, type MetadataSaveAdvisoryListener } from '@object-ui/data-objectstack';
import { createAuthenticatedFetch } from '@object-ui/auth';

/**
 * One authenticated fetch shared by every console metadata client.
 * `createAuthenticatedFetch()` returns a stateless wrapper — it reads the
 * Bearer token and active organization from storage *lazily on each call* — so
 * a single shared instance is both correct (always current) and cheaper than
 * re-allocating the closure per client.
 */
const consoleApiFetch = createAuthenticatedFetch();

/**
 * Resolve the metadata API base URL. `VITE_SERVER_URL` targets a split-origin
 * backend (the `pnpm dev` setup: SPA on :5180, API on :3000); when unset it
 * falls back to `''` (relative → current origin) for same-origin production,
 * matching every other client in the app (see `apps/console/src/main.tsx`).
 */
export function resolveMetadataBaseUrl(): string {
  return (
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: Record<string, string | undefined> }).env
        ?.VITE_SERVER_URL) ||
    ''
  );
}

export interface ConsoleMetadataClientOptions {
  /**
   * ADR-0037 Live Canvas — when true, reads overlay pending drafts on the
   * active registry (`?preview=draft`). Writes are unaffected.
   */
  previewDrafts?: boolean;
  /** Scope reads/writes to a tenant environment (`withEnvironment`). */
  environmentId?: string;
  /**
   * #4133 — sink for the runtime authoring gate's advisory findings on a
   * SUCCESSFUL save (objectstack#7435). Passed straight through to
   * {@link MetadataClient}; `useMetadataClient` supplies the console's toast
   * renderer, which is what puts one wiring in front of every save call site
   * in the app. Omitted for read-only clients (`MetadataProvider`), which
   * never write and so can never receive one.
   */
  onSaveAdvisory?: MetadataSaveAdvisoryListener;
}

/**
 * Build an authenticated {@link MetadataClient} for the console. This is the
 * only sanctioned way to construct one inside app-shell — see the module doc.
 */
export function createConsoleMetadataClient(
  options: ConsoleMetadataClientOptions = {},
): MetadataClient {
  const { previewDrafts = false, environmentId, onSaveAdvisory } = options;
  const client = new MetadataClient({
    baseUrl: resolveMetadataBaseUrl(),
    previewDrafts,
    fetch: consoleApiFetch,
    ...(onSaveAdvisory ? { onSaveAdvisory } : {}),
  });
  return environmentId ? client.withEnvironment(environmentId) : client;
}
