// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ErrorCode } from '@objectstack/spec/api';
import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  evaluateAuthGate,
  isApiKeyLifecycleRefusalError,
  isAuthzStoreUnavailableError,
  ownRowDeleteCallerResolver,
  recordNotFoundError,
  registerOwnRowDeleteRoute,
  shouldDenyAnonymous,
  type OwnRowDeleteCallerSources,
  type OwnRowDeleteDoor,
  type OwnRowDeleteEngine,
  type OwnRowDeleteRoutesDeps,
} from '@objectstack/core';
import type { IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveThrownHttpError, sendError, sendOk, sendServerFault } from '@objectstack/types';

/**
 * The attachment's own doors, at one route: the uploader's removal door and,
 * below it, the rename door ({@link ATTACHMENT_RENAME_ROUTE}).
 *
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
 *  - **The route and its ledger rows** (`attachment-removal-route-ledger.ts`,
 *    one per door). The route is fixed, like the other own-row doors, and
 *    lives outside the storage family's `basePath`.
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

/**
 * The slice of the data engine the two doors read and write through: the
 * removal door's reads and its delete, and the rename door's update.
 */
export interface AttachmentRemovalEngine extends OwnRowDeleteEngine {
  update(
    object: string,
    data: Record<string, unknown>,
    options: { where: Record<string, unknown>; context: ExecutionContext },
  ): Promise<unknown>;
}

/** What the doors are composed over — every service read when a request arrives. */
export interface AttachmentRemovalRoutesDeps extends Omit<OwnRowDeleteRoutesDeps, 'getEngine'> {
  /** The data engine; `undefined` when none is registered. */
  getEngine(): AttachmentRemovalEngine | undefined;
}

/**
 * Mount the attachment's two doors on `http`: the uploader's removal door and
 * the rename door. Nothing on `deps` is called until a request arrives.
 */
export function registerAttachmentRemovalRoutes(http: IHttpServer, deps: AttachmentRemovalRoutesDeps): void {
  registerOwnRowDeleteRoute(http, ATTACHMENT_REMOVAL_DOOR, deps);
  http.patch(ATTACHMENT_RENAME_ROUTE, (req, res) => handleRenameAttachment(req, res, deps));
}

/** The services the platform's caller resolution reads, per request. */
export type AttachmentRemovalCallerSources = OwnRowDeleteCallerSources;

/**
 * The platform's caller resolution for both doors: the shared door's one
 * composition ({@link ownRowDeleteCallerResolver}). A request that names
 * nobody resolves to `undefined`, which the doors refuse.
 */
export function attachmentRemovalCallerResolver(
  sources: AttachmentRemovalCallerSources,
): AttachmentRemovalRoutesDeps['resolveCaller'] {
  return ownRowDeleteCallerResolver(sources);
}

// ── The rename door ──────────────────────────────────────────────────────

/**
 * The rename door: `PATCH /api/v1/attachments/:id` with `{ file_name }` sets
 * the name ONE `sys_attachment` row is listed under, for a caller who may
 * govern that row — the attachment delete rule, uploader or parent editor
 * (`installAttachmentAccessHooks`). The same route as the removal door, so the
 * two verbs of the record Attachments panel's row menu are one resource.
 *
 * ## What it renames
 *
 * The row's `file_name`, the name the Attachments panel lists and the record
 * page payload serves. Nothing else: the `sys_file` row and its bytes are
 * untouched, so a file attached to several records keeps its name on every
 * other one, and the download keeps the stored file's name.
 *
 * ## Who may — the delete rule, asked where it already lives
 *
 * The door restates no part of the rule. It reads the row AS THE CALLER (the
 * object grant, the organization wall and the attachment read-visibility gate
 * decide; a row the caller cannot read and an id that names no row both
 * answer `404 RECORD_NOT_FOUND`, as the removal door answers them), then
 * writes by one of the two limbs of the rule:
 *
 *  - **The uploader.** A row whose `uploaded_by` names the caller is renamed
 *    under a system context attributed to the caller — the removal door's
 *    elevation, for the removal door's reason: the member grant carries read
 *    and create only, and the uploader limb is served without a wider grant
 *    (maintainer ruling 6879388034). That comparison is the only thing that
 *    admits the elevated write.
 *  - **Anyone else.** The update runs AS THE CALLER through the data engine,
 *    so every gate an update of `sys_attachment` meets judges it: the object's
 *    edit grant, and the attachment update gate, whose row rule IS the delete
 *    rule (one `authorizeRows` for both verbs — the parent editor passes, and
 *    a caller who can read the record but not edit it is refused there with
 *    the update verb's `403 RECORD_NOT_ACCESSIBLE`).
 *
 * ## The request
 *
 * No query parameter (one sent is refused `400 VALIDATION_ERROR`), and a body
 * of exactly `{ file_name }`: a string that is not blank once trimmed, stored
 * trimmed. Any other key is refused, never ignored. The column's own rules
 * (its length) are the engine's, on both limbs.
 *
 * ## What it answers
 *
 *  - **Success:** `200` with `{ id, file_name }`, the stored name.
 *  - **A refusal** with its `code` and `status`: `401 UNAUTHENTICATED` for a
 *    request that names nobody, the held sign-in's `403`, `400` for the
 *    request, `404` above, and the update gate's or the grant's `403`.
 *  - **Anything else** is a fault: `500` / `INTERNAL_ERROR`, the door's own
 *    sentence, and the error in the fault log.
 */
export const ATTACHMENT_RENAME_ROUTE = ATTACHMENT_REMOVE_ROUTE;

/** The object the rename door writes: the removal door's own. */
const RENAMED_OBJECT = 'sys_attachment';

/** The rename door's whole body: the one key it reads. */
export const ATTACHMENT_RENAME_BODY_KEYS: readonly string[] = Object.freeze(['file_name']);

/**
 * Rename attachment `id` to `fileName` (already trimmed and non-blank) as
 * `context`'s caller — the door's row read and write, by the delete rule's
 * two limbs. Throws `RECORD_NOT_FOUND` / `404` for a row the caller cannot
 * read or that does not exist, and whatever the engine's update gates refuse
 * a caller who is not the uploader with. `context` must name a user.
 */
export async function renameAttachment(
  engine: AttachmentRemovalEngine,
  id: string,
  fileName: string,
  context: ExecutionContext,
): Promise<void> {
  const callerId = context.userId;
  if (!callerId) throw new Error('renameAttachment: the caller context names no user');

  // The row, read as the caller, so every read gate decides.
  const row = (await engine.findOne(RENAMED_OBJECT, { where: { id }, context })) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!row) throw recordNotFoundError(RENAMED_OBJECT, id, context);

  const writeContext: ExecutionContext =
    row[ATTACHMENT_REMOVAL_DOOR.ownerField] === callerId
      ? ({
          isSystem: true,
          attributedUserId: callerId,
          ...(context.tenantId ? { tenantId: context.tenantId } : {}),
        } as ExecutionContext)
      : context;
  const updated = await engine.update(RENAMED_OBJECT, { file_name: fileName }, { where: { id }, context: writeContext });
  // The driver's own "nothing matched": the row went between the read and here.
  if (updated == null || updated === false || updated === 0) throw recordNotFoundError(RENAMED_OBJECT, id, context);
}

/** The body's one name, or the sentence that refuses the body. */
function readRenameBody(body: unknown): { fileName: string } | { refusal: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { refusal: 'Renaming an attachment takes a JSON body of exactly { "file_name": "<the new name>" }.' };
  }
  const unknown = Object.keys(body).filter((key) => !ATTACHMENT_RENAME_BODY_KEYS.includes(key));
  if (unknown.length > 0) {
    return {
      refusal:
        `Renaming an attachment takes only "file_name", and this body also carries ${unknown.map((k) => `"${k}"`).join(', ')}. ` +
        'Send the new name and nothing else.',
    };
  }
  const value = (body as { file_name?: unknown }).file_name;
  const fileName = typeof value === 'string' ? value.trim() : '';
  if (fileName === '') {
    return { refusal: 'Renaming an attachment needs "file_name": the new name, as text that is not blank.' };
  }
  return { fileName };
}

async function handleRenameAttachment(
  req: IHttpRequest,
  res: IHttpResponse,
  deps: AttachmentRemovalRoutesDeps,
): Promise<void> {
  const where = { method: 'PATCH', path: ATTACHMENT_RENAME_ROUTE };

  // The caller, by the removal door's own resolution.
  let context: ExecutionContext | undefined;
  try {
    context = await deps.resolveCaller(req);
  } catch (err) {
    if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this request could not be resolved.', err, where);
    return;
  }

  if (!context || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
    sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
    return;
  }

  const authGate = evaluateAuthGate(context, '');
  if (authGate) {
    sendError(res, 403, authGate.code as ErrorCode, authGate.message);
    return;
  }

  const query = Object.keys(req.query ?? {});
  if (query.length > 0) {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `Renaming an attachment takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
        'Name the attachment by its id in the path and send the new name in the body.',
    );
    return;
  }
  const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
  if (id === '') {
    sendError(res, 400, 'VALIDATION_ERROR', 'Name the attachment to rename by its id in the path.');
    return;
  }
  // Read outside any catch: a transport that refuses the body has answered.
  const parsed = readRenameBody(req.body);
  if ('refusal' in parsed) {
    sendError(res, 400, 'VALIDATION_ERROR', parsed.refusal);
    return;
  }

  const engine = deps.getEngine();
  if (!engine) {
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Attachments cannot be renamed right now: no data engine is registered.');
    return;
  }

  try {
    await renameAttachment(engine, id, parsed.fileName, context);
  } catch (err) {
    const thrown = resolveThrownHttpError(err, 500);
    if (thrown.status < 500) {
      sendError(res, thrown.status, thrown.code, thrown.message);
      return;
    }
    sendServerFault(res, thrown.status, thrown.code, 'The attachment could not be renamed because of an error on the server.', err, where);
    return;
  }
  sendOk(res, { id, file_name: parsed.fileName });
}
