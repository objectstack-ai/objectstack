// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Attachment-removal route ledger — the audited disposition of every HTTP route
 * `registerAttachmentRemovalRoutes` (`attachment-removal-routes.ts`) mounts.
 *
 * WHY THIS EXISTS. `StorageServicePlugin` registers the uploader's removal door
 * straight on `IHttpServer`, beside the storage family and outside it: the
 * door's route is fixed (the family's honours `basePath`), and it is not a
 * storage-family route, so `storage-route-ledger.ts` does not carry it, the
 * same shape as the comment-reaction and personal-view doors.
 * `attachment-removal-route-ledger.conformance.test.ts` fails when the
 * registrar mounts a route with no row here, and when a row names a route it no
 * longer mounts.
 *
 * A GAP, NOT SDK SURFACE YET. The consumer is the Console's record Attachments
 * panel, whose per-row delete goes through the generic data door today and is
 * offered only to a holder of the delete grant; it moves to this route in the
 * console half of the same ruling. `@objectstack/client` has no method for it
 * yet, so the row is an acknowledged `gap`.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free, so a guard in another
 * package can read it as a relative SOURCE file.
 */

/** Disposition of a single route. Same vocabulary as the REST ledger. */
export type AttachmentRemovalRouteDisposition =
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

export interface AttachmentRemovalRouteLedgerEntry {
  /** `VERB /api/v1/...` — the full wire path. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: AttachmentRemovalRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const ATTACHMENT_REMOVAL_ROUTE_LEDGER: readonly AttachmentRemovalRouteLedgerEntry[] = [
  { route: 'DELETE /api/v1/attachments/:id', family: 'attachments', disposition: 'gap',
    note: "remove a sys_attachment row the caller uploaded (uploaded_by), needing no object delete grant; the Console's record Attachments panel is the consumer and the SDK has no method yet" },
];
