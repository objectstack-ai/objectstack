// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Personal-view route ledger — the audited disposition of every HTTP route
 * `registerPersonalViewRoutes` (`personal-view-routes.ts`) mounts.
 *
 * WHY THIS EXISTS. `AuthPlugin` registers the owner's delete door straight on
 * `IHttpServer`, so neither the dispatcher ledger nor the REST ledger sees its
 * route, the same shape as the comment-reaction, print, storage and settings
 * families. `personal-view-route-ledger.conformance.test.ts` fails when the
 * registrar mounts a route with no row here, and when a row names a route it no
 * longer mounts.
 *
 * A GAP, NOT SDK SURFACE YET. The consumer is the Console's "My views" list
 * (the second half of #29443's ruling), which does not exist yet.
 * `@objectstack/client` has no method for it, so the row is an acknowledged
 * `gap`.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free, so a guard in another
 * package can read it as a relative SOURCE file.
 */

/** Disposition of a single route. Same vocabulary as the REST ledger. */
export type PersonalViewRouteDisposition =
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

export interface PersonalViewRouteLedgerEntry {
  /** `VERB /api/v1/...` — the full wire path. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: PersonalViewRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const PERSONAL_VIEW_ROUTE_LEDGER: readonly PersonalViewRouteLedgerEntry[] = [
  { route: 'DELETE /api/v1/personal-views/:id', family: 'personal-views', disposition: 'gap',
    note: "remove the caller's own sys_personal_view row, needing no object delete grant; the Console's My views list is the consumer and the SDK has no method yet" },
];
