// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  evaluateAuthGate,
  isApiKeyLifecycleRefusalError,
  isAuthzStoreUnavailableError,
  recordNotFoundError,
  registerOwnRowDeleteRoute,
  shouldDenyAnonymous,
  type OwnRowDeleteDoor,
  type OwnRowDeleteEngine,
  type OwnRowDeleteRoutesDeps,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveThrownHttpError, sendError, sendOk, sendServerFault } from '@objectstack/types';

import {
  COMMENT_RESOLVED_AT_FIELD,
  COMMENT_RESOLVED_BY_FIELD,
  COMMENT_RESOLVED_FIELD,
  refuseResolutionOnReply,
} from './comment-resolution.js';

/**
 * The comment doors: two verbs a member uses on `sys_comment` rows that the
 * data door's `update` and `delete` cannot serve them, each with exactly the
 * reach the maintainer ruled (ruling record 7069889899 on the comments redo):
 *
 *  - **The resolution door**, `PUT /api/v1/comments/:id/resolution`: resolve
 *    or reopen a thread, by its top-level comment.
 *  - **The own-comment delete door**, `DELETE /api/v1/comments/:id`: remove a
 *    comment the caller wrote.
 *
 * ## Why doors, and not the data door
 *
 * The platform's row floor (`owner_only_writes`, the default permission sets)
 * lets a rank-and-file member update only the rows they created, and it runs
 * before the comment access hooks. Resolving is an update, so on the data
 * door a member could resolve only the threads they started, although whoever
 * may comment on the record may resolve its threads (ruling record 7063285032,
 * option A). The floor cannot be loosened for one column: a row policy decides
 * WHICH rows, never which columns, so admitting the resolve update would also
 * admit a member's edit of a colleague's words, which stays the author's alone
 * (ruling record 7069889899). The resolution door writes one column and
 * nothing else, so it reaches the threads the ruling names without touching
 * the floor.
 *
 * Removing is a `delete`, and `delete` needs an object-level grant that no
 * every-member set may carry (ADR-0090 D5; `member_default` has none on
 * `sys_comment`), so a member could post a comment and never take it back.
 * The own-comment delete door is the platform's shared own-row delete door
 * (`own-row-delete-routes.ts` in `@objectstack/core`), as the unreact door
 * (`comment-reaction-routes.ts`) is.
 *
 * Neither door changes what the data door answers: a member's data-door
 * update of a colleague's comment, `is_resolved` included, and a member's
 * data-door delete are refused exactly as before.
 *
 * ## The resolution door — every refusal before anything is written
 *
 *  1. **The caller**, resolved by the platform's one composition, as the
 *     own-row doors resolve it (`ownRowDeleteCallerResolver`, passed by the
 *     mounting plugin). A permission store that cannot be read answers its own
 *     `503`, and an API key its lifecycle refuses its own `403`.
 *  2. **Anonymous**: `UNAUTHENTICATED` / `401`.
 *  3. **A held sign-in**: `403` with the authentication policy's own code.
 *  4. **The request**: no query parameter, and a body that is exactly
 *     `{ "resolved": true }` or `{ "resolved": false }`; anything else is
 *     `VALIDATION_ERROR` / `400`.
 *  5. **The comment, read AS THE CALLER**: the object grant, the organization
 *     wall, and the comment read gate (a comment is readable exactly when the
 *     record its thread is on is). A comment the caller cannot read and an id
 *     that names none get the same answer, `RECORD_NOT_FOUND` / `404`. This is
 *     the whole of who may: whoever can read the thread may resolve it (ruling
 *     record 7063285032, option A).
 *  6. **A reply** is refused, `VALIDATION_ERROR` / `400`: a thread is resolved
 *     on its top-level comment (`refuseResolutionOnReply`, the data door's
 *     own sentence).
 *
 * Only then is `is_resolved` written, by id, under a system context that keeps
 * the caller as `attributedUserId` and keeps the caller's organization. The
 * platform stamps who and when from that attribution
 * (`stampCommentResolution`), so `resolved_by` names the caller; the audit
 * ledger credits the caller too. The door answers `200` with
 * `{ id, is_resolved, resolved_by, resolved_at }` as stored.
 *
 * ## The own-comment delete door
 *
 *  - **The owner column** is `author_id`, the author the platform stamps from
 *    the session and keeps read-only: the column the comment rules mean by
 *    "authors govern their own words". Another member's comment is refused,
 *    `PERMISSION_DENIED` / `403`, even on a record the caller can edit: the
 *    moderator's delete stays the data door's, behind an explicit delete grant.
 *  - **A comment others replied under stays** (the door's step 7):
 *    `DELETE_RESTRICTED` / `409`. Removing it would rewrite the replies:
 *    `parent_id` is a lookup that clears on delete, so each reply would become
 *    a thread of its own. The author may still edit its text.
 *  - **The removal** is a system delete attributed to the caller, so the
 *    comment gates do not run a second time and the audit ledger credits the
 *    caller.
 *
 * Both routes and their ledger rows: `comment-route-ledger.ts`.
 */

/** The object the doors read and write. */
const COMMENT_OBJECT = 'sys_comment';

/** The resolution door's route pattern. */
export const COMMENT_RESOLUTION_ROUTE = '/api/v1/comments/:id/resolution';

/** The own-comment delete door's route pattern. */
export const COMMENT_REMOVE_ROUTE = '/api/v1/comments/:id';

/** The one body key the resolution door reads. */
const RESOLVED_BODY_KEY = 'resolved';

/**
 * Step 7 of the own-comment delete door: a comment with a reply under it
 * stays. Asked through a system read, so a reply the caller's read scope would
 * hide still counts.
 */
async function refuseRemovalUnderReplies(
  row: Record<string, unknown>,
  engine: OwnRowDeleteEngine,
): Promise<void> {
  const reply = await engine.findOne(COMMENT_OBJECT, {
    where: { parent_id: row.id },
    context: { isSystem: true } as ExecutionContext,
  });
  if (!reply) return;
  const err = new Error(
    `Comment ${String(row.id)} was not removed: other comments reply to it, and removing it would turn each reply ` +
      'into a thread of its own. Edit its text instead. The comment is unchanged.',
  ) as Error & { code?: string; status?: number };
  err.code = 'DELETE_RESTRICTED';
  err.status = 409;
  throw err;
}

/** The own-comment delete door's part of the shared own-row delete door. */
export const COMMENT_REMOVAL_DOOR: OwnRowDeleteDoor = Object.freeze({
  route: COMMENT_REMOVE_ROUTE,
  object: COMMENT_OBJECT,
  ownerField: 'author_id',
  words: Object.freeze({ noun: 'comment', shortNoun: 'comment', owner: 'member' }),
  refuseRemoval: refuseRemovalUnderReplies,
});

/** The slice of the data engine the doors read and write through. */
export interface CommentDoorsEngine extends OwnRowDeleteEngine {
  update(object: string, data: Record<string, unknown>, options: { where: Record<string, unknown>; context: ExecutionContext }): Promise<unknown>;
}

/** What the doors are composed over — every service read when a request arrives. */
export interface CommentDoorsRoutesDeps {
  /** The data engine; `undefined` when none is registered. */
  getEngine(): CommentDoorsEngine | undefined;
  /** Resolve the caller of a request (`ownRowDeleteCallerResolver`); `undefined` names nobody. */
  resolveCaller: OwnRowDeleteRoutesDeps['resolveCaller'];
}

/** Mount both comment doors on `http`. Nothing on `deps` is called until a request arrives. */
export function registerCommentDoorsRoutes(http: IHttpServer, deps: CommentDoorsRoutesDeps): void {
  http.put(COMMENT_RESOLUTION_ROUTE, (req, res) => handleResolution(req, res, deps));
  registerOwnRowDeleteRoute(http, COMMENT_REMOVAL_DOOR, deps);
}

/** The stored resolution the door answers with. */
export interface CommentResolutionAnswer {
  id: string;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
}

/**
 * Resolve or reopen the thread whose top-level comment is `id` — steps 5 and
 * 6 of the resolution door, and the write. Throws `RECORD_NOT_FOUND` / `404`
 * for a comment the caller cannot read or that does not exist, and
 * `VALIDATION_ERROR` / `400` for a reply. `context` must name a user.
 */
export async function resolveCommentThread(
  engine: CommentDoorsEngine,
  id: string,
  resolved: boolean,
  context: ExecutionContext,
): Promise<CommentResolutionAnswer> {
  const callerId = context.userId;
  if (!callerId) throw new Error('resolveCommentThread: the caller context names no user');

  // Step 5: read the comment as the caller, so every read gate decides.
  const row = (await engine.findOne(COMMENT_OBJECT, { where: { id }, context })) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!row) throw recordNotFoundError(COMMENT_OBJECT, id, context);

  // Step 6: a thread is resolved on its top-level comment.
  refuseResolutionOnReply([row]);

  const system = {
    isSystem: true,
    attributedUserId: callerId,
    ...(context.tenantId ? { tenantId: context.tenantId } : {}),
  } as ExecutionContext;
  await engine.update(COMMENT_OBJECT, { [COMMENT_RESOLVED_FIELD]: resolved }, { where: { id }, context: system });

  const stored = (await engine.findOne(COMMENT_OBJECT, { where: { id }, context: system })) as
    | Record<string, unknown>
    | null
    | undefined;
  // The driver's own "nothing matched": the comment went between the read and here.
  if (!stored) throw recordNotFoundError(COMMENT_OBJECT, id, context);
  const text = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
  return {
    id,
    is_resolved: stored[COMMENT_RESOLVED_FIELD] === true,
    resolved_by: text(stored[COMMENT_RESOLVED_BY_FIELD]),
    resolved_at: text(stored[COMMENT_RESOLVED_AT_FIELD]),
  };
}

async function handleResolution(req: IHttpRequest, res: IHttpResponse, deps: CommentDoorsRoutesDeps): Promise<void> {
  const where = { method: 'PUT', path: COMMENT_RESOLUTION_ROUTE };

  // ① The caller.
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

  // ② Anonymous.
  if (!context || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
    sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
    return;
  }

  // ③ A held sign-in.
  const authGate = evaluateAuthGate(context, '');
  if (authGate) {
    sendError(res, 403, authGate.code as ErrorCode, authGate.message);
    return;
  }

  // ④ The request. The body is read outside any catch: a transport that
  // refuses it answers the request itself.
  const query = Object.keys(req.query ?? {});
  if (query.length > 0) {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `Resolving a comment thread takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
        'Name the comment by its id in the path and send { "resolved": true } or { "resolved": false } as the body.',
    );
    return;
  }
  const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
  if (id === '') {
    sendError(res, 400, 'VALIDATION_ERROR', 'Name the comment whose thread to resolve by its id in the path.');
    return;
  }
  const body: unknown = req.body;
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
  const resolved = keys ? (body as Record<string, unknown>)[RESOLVED_BODY_KEY] : undefined;
  if (!keys || keys.length !== 1 || keys[0] !== RESOLVED_BODY_KEY || typeof resolved !== 'boolean') {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'The body must be exactly { "resolved": true } to resolve the thread or { "resolved": false } to reopen it, ' +
        'and nothing else.',
    );
    return;
  }

  const engine = deps.getEngine();
  if (!engine) {
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Comment threads cannot be resolved right now: no data engine is registered.');
    return;
  }

  // ⑤ ⑥ and the write.
  let answer: CommentResolutionAnswer;
  try {
    answer = await resolveCommentThread(engine, id, resolved, context);
  } catch (err) {
    const thrown = resolveThrownHttpError(err, 500);
    if (thrown.status < 500) {
      sendError(res, thrown.status, thrown.code, thrown.message);
      return;
    }
    sendServerFault(res, thrown.status, thrown.code, 'The comment thread could not be updated because of an error on the server.', err, where);
    return;
  }
  sendOk(res, answer);
}
