// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Comment-door route ledger — the audited disposition of every HTTP route
 * `registerCommentDoorsRoutes` (`comment-routes.ts`) mounts.
 *
 * WHY THIS EXISTS. `AuditPlugin` reaches for the `http.server` service and
 * registers straight on `IHttpServer`, so neither the dispatcher ledger nor the
 * REST ledger sees these routes, the same shape as the unreact door's
 * (`comment-reaction-route-ledger.ts`). `comment-route-ledger.conformance.test.ts`
 * fails when the registrar mounts a route with no row here, and when a row
 * names a route it no longer mounts.
 *
 * A GAP, NOT SDK SURFACE YET. The consumer is the console's comment panel (its
 * ✓ and its Delete on the viewer's own comment). `@objectstack/client` has no
 * method for either, so both rows are acknowledged `gap`s.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free.
 */

/** One row: the same shape and vocabulary as the unreact door's ledger and the REST ledger. */
export interface CommentRouteLedgerEntry {
  /** `VERB /api/v1/...` — the full wire path. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: 'sdk' | 'gap' | 'server-only' | 'public' | 'mismatch';
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const COMMENT_ROUTE_LEDGER: readonly CommentRouteLedgerEntry[] = [
  { route: 'PUT /api/v1/comments/:id/resolution', family: 'comments', disposition: 'gap',
    note: "resolve or reopen a thread by its top-level sys_comment row for any reader of it, writing is_resolved alone; the console's comment panel is the consumer and the SDK has no method yet" },
  { route: 'DELETE /api/v1/comments/:id', family: 'comments', disposition: 'gap',
    note: "remove the caller's own sys_comment row, needing no object delete grant; the console's comment panel is the consumer and the SDK has no method yet" },
];
