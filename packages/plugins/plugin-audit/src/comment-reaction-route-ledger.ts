// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Comment-reaction route ledger — the audited disposition of every HTTP route
 * `registerCommentReactionRoutes` (`comment-reaction-routes.ts`) mounts.
 *
 * WHY THIS EXISTS. `AuditPlugin` reaches for the `http.server` service and
 * registers straight on `IHttpServer`, so neither the dispatcher ledger nor the
 * REST ledger sees its route, the same shape as the print, storage and settings
 * families. `comment-reaction-route-ledger.conformance.test.ts` fails when the
 * registrar mounts a route with no row here, and when a row names a route it no
 * longer mounts.
 *
 * A GAP, NOT SDK SURFACE YET. The consumer is the console's reaction chip,
 * which removes a reaction today through the generic data door's `delete` and
 * moves to this route in the console half of the same ruling. `@objectstack/client`
 * has no method for it yet, so the row is an acknowledged `gap`.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free, so a guard in another
 * package can read it as a relative SOURCE file.
 */

/** Disposition of a single route. Same vocabulary as the REST ledger. */
export type CommentReactionRouteDisposition =
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

export interface CommentReactionRouteLedgerEntry {
  /** `VERB /api/v1/...` — the full wire path. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: CommentReactionRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const COMMENT_REACTION_ROUTE_LEDGER: readonly CommentReactionRouteLedgerEntry[] = [
  { route: 'DELETE /api/v1/comments/reactions/:id', family: 'comment-reactions', disposition: 'gap',
    note: "remove the caller's own sys_comment_reaction row, needing no object delete grant; the console's reaction chip is the consumer and the SDK has no method yet" },
];
