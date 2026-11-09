// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sharing route ledger — the audited disposition of every HTTP route
 * `registerShareableObjectsRoutes` (`shareable-objects-routes.ts`) mounts.
 *
 * WHY THIS EXISTS. `SharingServicePlugin` reaches for the `http.server`
 * service and registers straight on `IHttpServer`, so the REST ledger does not
 * see this route, the same shape as the messaging, print, storage and settings
 * families. `sharing-route-ledger.conformance.test.ts` fails when the registrar
 * mounts a route with no row here, and when a row names a route it no longer
 * mounts; the dogfood live-mount parity gate reads this ledger beside the
 * others on a real boot. The sharing-rule administration routes
 * (`/api/v1/sharing/rules*`) are not here: `@objectstack/rest` serves them, and
 * they are rows of its ledger. The share-link routes are rows of the
 * dispatcher ledger (`/share-links`).
 *
 * NOT SDK SURFACE. `@objectstack/client` expresses no method for it: the
 * consumer is the console's sharing-rule object picker, over plain HTTP. That
 * is a `server-only` disposition.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free, so a guard in another
 * package can read it as a relative SOURCE file.
 */

/** Disposition of a single sharing route. Same vocabulary as the REST ledger. */
export type SharingRouteDisposition =
  /** Expressed by the SDK — `client` names the method (dotted path). */
  | 'sdk'
  /** Should be in the SDK and is not — an open, acknowledged gap. */
  | 'gap'
  /** Deliberately not SDK surface. */
  | 'server-only'
  /** Public, unauthenticated browser-facing route. */
  | 'public'
  /** Server and client disagree on the shape — needs reconciliation. */
  | 'mismatch';

export interface SharingRouteLedgerEntry {
  /** `VERB /api/v1/sharing/...` — the full wire path. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: SharingRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const SHARING_ROUTE_LEDGER: readonly SharingRouteLedgerEntry[] = [
  { route: 'GET /api/v1/sharing/shareable-objects', family: 'sharing-shareable-objects', disposition: 'server-only',
    note: "the objects a sharing rule can take effect on, for the console's sharing-rule object picker; sharing-rule administrators only, read-only" },
];
