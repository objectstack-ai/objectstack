// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ownRowDeleteCallerResolver,
  registerOwnRowDeleteRoute,
  type OwnRowDeleteCallerSources,
  type OwnRowDeleteDoor,
  type OwnRowDeleteEngine,
  type OwnRowDeleteRoutesDeps,
} from '@objectstack/core';
import type { IHttpServer } from '@objectstack/spec/contracts';

/**
 * The uploader's removal door: `DELETE /api/v1/attachments/:id` removes ONE
 * `sys_attachment` row, and only one the caller uploaded (maintainer ruling
 * 6879388034: a member may delete an attachment they uploaded themselves, own
 * uploads only, and the member grant carries no wider delete bit).
 *
 * The door is `@objectstack/core`'s own-row delete door
 * (`own-row-delete-routes.ts`), which holds the order of its refusals, the
 * system removal attributed to the caller, and every answer. What this file
 * supplies is the object's part:
 *
 *  - **Why an attachment needs it.** Every member holds read and create on
 *    `sys_attachment` through the storage service's own baseline set
 *    (`attachment-member-grant.ts`), and that set carries no delete bit: a set
 *    every member holds through the `everyone` anchor may not (ADR-0090 D5),
 *    and the seam that contributes it admits read and create only. So a member
 *    who attached the wrong file to a record could never take it back; only a
 *    holder of an explicit delete grant could. The data door's `DELETE` keeps
 *    answering exactly what it answered before: this door grants `delete` on
 *    no row, and a member's data-door delete is still refused by RBAC.
 *  - **What the read as the caller runs** (the door's step 5): the object
 *    grant, the organization wall, and the attachment read-visibility gate (a
 *    row is readable exactly when its parent record is,
 *    `installAttachmentReadVisibility`). An attachment on a record the caller
 *    cannot read answers as an unknown id, the uploader's own included, as
 *    every other write door answers it.
 *  - **The owner column** (the door's step 6): `uploaded_by`, the uploader the
 *    attach rule stamps from the session at insert and the engine keeps
 *    read-only after it (`installAttachmentAccessHooks`). Another member's
 *    attachment is refused loudly, even on a record the caller can edit: the
 *    parent-editor limb of the attachment delete rule stays the data door's,
 *    behind an explicit delete grant.
 *  - **The removal.** A system delete attributed to the caller, so the
 *    attachment gates do not run a second time and the lifecycle does: the
 *    file the row pointed at is tombstoned when no other row holds it
 *    (`installAttachmentLifecycleHooks`, `afterDelete`).
 *  - **The route and its ledger row** (`attachment-removal-route-ledger.ts`).
 *    The route is fixed, like the other own-row doors, and lives outside the
 *    storage family's `basePath`.
 */

/** The route pattern the door is mounted at. */
export const ATTACHMENT_REMOVE_ROUTE = '/api/v1/attachments/:id';

/** The attachment's part of the shared own-row delete door. */
export const ATTACHMENT_REMOVAL_DOOR: OwnRowDeleteDoor = Object.freeze({
  route: ATTACHMENT_REMOVE_ROUTE,
  object: 'sys_attachment',
  ownerField: 'uploaded_by',
  words: Object.freeze({ noun: 'attachment', shortNoun: 'attachment', owner: 'user' }),
});

/** The slice of the data engine the door reads and writes through. */
export type AttachmentRemovalEngine = OwnRowDeleteEngine;

/** What the door is composed over — every service read when a request arrives. */
export type AttachmentRemovalRoutesDeps = OwnRowDeleteRoutesDeps;

/** Mount the uploader's removal door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerAttachmentRemovalRoutes(http: IHttpServer, deps: AttachmentRemovalRoutesDeps): void {
  registerOwnRowDeleteRoute(http, ATTACHMENT_REMOVAL_DOOR, deps);
}

/** The services the platform's caller resolution reads, per request. */
export type AttachmentRemovalCallerSources = OwnRowDeleteCallerSources;

/**
 * The platform's caller resolution for this door: the shared door's one
 * composition ({@link ownRowDeleteCallerResolver}). A request that names
 * nobody resolves to `undefined`, which the door refuses.
 */
export function attachmentRemovalCallerResolver(
  sources: AttachmentRemovalCallerSources,
): AttachmentRemovalRoutesDeps['resolveCaller'] {
  return ownRowDeleteCallerResolver(sources);
}
