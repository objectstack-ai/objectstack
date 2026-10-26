// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  apiKeyLifecyclePolicySourceOf,
  assembleExecutionContext,
  evaluateAuthGate,
  isApiKeyLifecycleRefusalError,
  isAuthzStoreUnavailableError,
  recordNotFoundError,
  resolveAuthzContext,
  shouldDenyAnonymous,
  userAuthGateSourceOf,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IAuthService, IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { TenancyPosture } from '@objectstack/spec/security';
import { inProcessSessionReadInput, resolveThrownHttpError, sendError, sendOk, sendServerFault } from '@objectstack/types';

import { COMMENT_REACTION_OBJECT } from './comment-access-hooks.js';

/**
 * The unreact door: `DELETE /api/v1/comments/reactions/:id` removes ONE
 * `sys_comment_reaction` row, and only the caller's own (maintainer ruling
 * 6422861164, letter A).
 *
 * ## Why a door of its own, and not the data door's `DELETE`
 *
 * A reaction is its reactor's own record, made and removed, never edited
 * (`objects/sys-comment-reaction.object.ts`). On the generic data door a
 * removal is a `delete`, and `delete` needs an object-level grant. No
 * every-member set may carry one: ADR-0090 D5 keeps delete, purge and transfer
 * off the `everyone` anchor (`security-anchor-high-privilege`), and the
 * platform baseline `member_default` carries no delete bit at all. So a member
 * whose only grants are the every-member ones could add a reaction and never
 * take it back.
 *
 * This door does not widen that grant model. The generic `DELETE` keeps
 * answering exactly what it answered before, and nothing here grants `delete`
 * on any row. What it adds is one verb whose authorization is STRUCTURAL: the
 * row's reactor is the caller. That is a narrower door than any grant, because
 * it reaches one row and only one person's.
 *
 * ## The order — every refusal before anything is removed
 *
 *  1. **The caller**, resolved by the platform's one authorization resolver
 *     (`resolveAuthzContext`) from the request's session, bearer or API key,
 *     and assembled into an `ExecutionContext` the way the REST face assembles
 *     one. A permission store that cannot be read answers its own
 *     `SERVICE_UNAVAILABLE` / `503`, and an API key its lifecycle refuses
 *     answers its own `403` and code: both relayed as declared.
 *  2. **Anonymous**: `UNAUTHENTICATED` / `401`, the platform's anonymous floor.
 *  3. **A held sign-in** (an expired password, enforced MFA not yet enrolled):
 *     `403` with the authentication policy's own code.
 *  4. **The request**: the door takes no query parameter, and one sent is
 *     refused (`VALIDATION_ERROR` / `400`) rather than ignored.
 *  5. **The row, read AS THE CALLER.** The read runs every gate a read of a
 *     reaction runs: the object grant, the organization wall, and the reaction
 *     read gate (a reaction is readable exactly when its comment is,
 *     `comment-access-hooks.ts`). A row the caller cannot read and an id that
 *     names no row get the same answer, `RECORD_NOT_FOUND` / `404`, the answer
 *     the data door gives both, so the door says nothing about a reaction on a
 *     comment the caller cannot see.
 *  6. **The reactor.** `created_by` is the column the platform's own-record
 *     floor keys on (`owner_only_deletes`), stamped by the engine with the
 *     user who reacted. A row whose reactor is anyone else is refused loudly,
 *     `PERMISSION_DENIED` / `403`, and stays.
 *
 * ## The removal
 *
 * Only after all six does the door remove the row, by id, under a system
 * context. That elevation is what lets the door reach a row the caller holds
 * no `delete` grant on, and step 6 is the only thing that admits it: the
 * elevated write is reached by no other path. The context keeps the caller as
 * `attributedUserId` and keeps the caller's organization, so the write is
 * attributed to the person who asked and stays inside their organization. A
 * row that vanished between the read and the removal answers `404`, as the
 * data door answers a delete that matched nothing.
 *
 * ## What the door answers
 *
 *  - **Success:** `200` with `{ id, deleted: true }`.
 *  - **A refusal** a step above names, with its `code` and `status`.
 *  - **Anything else** is a fault: `500` / `INTERNAL_ERROR`, the door's own
 *    sentence, and the error in the fault log.
 */

/** The route pattern the door is mounted at. */
export const COMMENT_REACTION_REMOVE_ROUTE = '/api/v1/comments/reactions/:id';

/** The slice of the data engine the door reads and writes through. */
export interface CommentReactionEngine {
  findOne(object: string, query: { where: Record<string, unknown>; context: ExecutionContext }): Promise<unknown>;
  delete(object: string, options: { where: Record<string, unknown>; context: ExecutionContext }): Promise<unknown>;
}

/** What the door is composed over — every service read when a request arrives. */
export interface CommentReactionRoutesDeps {
  /** The data engine; `undefined` when none is registered. */
  getEngine(): CommentReactionEngine | undefined;
  /**
   * Resolve the caller of a request. The plugin passes
   * {@link platformCallerResolver}; the result is `undefined` for a request
   * that names nobody.
   */
  resolveCaller(req: IHttpRequest): Promise<ExecutionContext | undefined>;
}

/** Mount the unreact door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerCommentReactionRoutes(http: IHttpServer, deps: CommentReactionRoutesDeps): void {
  http.delete(COMMENT_REACTION_REMOVE_ROUTE, (req, res) => handleRemoveReaction(req, res, deps));
}

/** The services the platform's caller resolution reads, per request. */
export interface PlatformCallerSources {
  /** The data engine the caller's grants are read through; `undefined` when none is registered. */
  getEngine(): unknown;
  /** The auth service the caller's session is read through; `undefined` when none is registered. */
  getAuth(): IAuthService | undefined;
  /**
   * The tenancy posture in force, for the resolver's posture-conditional API-key
   * refusals; `undefined` on a kernel that enforces no organization wall. A
   * posture that cannot be read rejects, and the door answers that outage.
   */
  resolveTenancyPosture(): Promise<TenancyPosture | undefined>;
}

/**
 * The platform's caller resolution for this door: the one resolver
 * (`resolveAuthzContext`) over the auth service's in-process session read,
 * assembled the way the REST face assembles a context. A request that names
 * nobody resolves to a context with no `userId`, which step 2 refuses.
 */
export function platformCallerResolver(sources: PlatformCallerSources): CommentReactionRoutesDeps['resolveCaller'] {
  return async (req) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers ?? {})) {
      if (value == null) continue;
      headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    const auth = sources.getAuth();
    const getSession = auth
      ? async (h: Headers) => {
          const api = auth.api ?? (await auth.getApi?.());
          return api?.getSession?.(inProcessSessionReadInput(h));
        }
      : undefined;
    const authz = await resolveAuthzContext({
      ql: sources.getEngine(),
      headers,
      getSession,
      tenancyPosture: await sources.resolveTenancyPosture(),
      userAuthGates: userAuthGateSourceOf(auth),
      apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(auth),
    });
    return assembleExecutionContext({
      authz,
      // No OAuth access token is accepted here: those are honoured at the MCP door alone.
      oauth: undefined,
      // The door answers no translated text; its context carries no language.
      localization: undefined,
      requestLocale: undefined,
      // The REST face's choice: the session bearer is not carried onto the envelope.
      accessToken: undefined,
      authGate: authz.authGate,
    });
  };
}

/**
 * The refusal {@link removeOwnCommentReaction} throws for a row whose reactor
 * is not the caller: `PERMISSION_DENIED` / `403`, the ADR-0112 shape.
 */
function notYourReactionError(id: string): Error {
  const err = new Error(
    `Reaction ${id} was not removed: it is another member's reaction, and a member removes only their own. ` +
      'The reaction is unchanged.',
  ) as Error & { code?: string; status?: number };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  return err;
}

/**
 * Remove the caller's own reaction `id` — steps 5 and 6 of the door, and the
 * removal. Throws `RECORD_NOT_FOUND` / `404` for a row the caller cannot read
 * or that does not exist, and `PERMISSION_DENIED` / `403` for a row whose
 * reactor is someone else. `context` must name a user.
 */
export async function removeOwnCommentReaction(
  engine: CommentReactionEngine,
  id: string,
  context: ExecutionContext,
): Promise<void> {
  const callerId = context.userId;
  if (!callerId) throw new Error('removeOwnCommentReaction: the caller context names no user');

  // Step 5: read the row as the caller, so every read gate decides.
  const row = (await engine.findOne(COMMENT_REACTION_OBJECT, { where: { id }, context })) as
    | { created_by?: unknown }
    | null
    | undefined;
  if (!row) throw recordNotFoundError(COMMENT_REACTION_OBJECT, id);

  // Step 6: the structural check, and the only thing that admits the write below.
  if (row.created_by !== callerId) throw notYourReactionError(id);

  const removed = await engine.delete(COMMENT_REACTION_OBJECT, {
    where: { id },
    context: {
      isSystem: true,
      attributedUserId: callerId,
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
    } as ExecutionContext,
  });
  // The driver's own "nothing matched": the row went between the read and here.
  if (removed === false || removed === 0) throw recordNotFoundError(COMMENT_REACTION_OBJECT, id);
}

async function handleRemoveReaction(
  req: IHttpRequest,
  res: IHttpResponse,
  deps: CommentReactionRoutesDeps,
): Promise<void> {
  // ① The caller.
  let context: ExecutionContext | undefined;
  try {
    context = await deps.resolveCaller(req);
  } catch (err) {
    if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this request could not be resolved.', err, {
      method: 'DELETE',
      path: COMMENT_REACTION_REMOVE_ROUTE,
    });
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

  // ④ The request.
  const query = Object.keys(req.query ?? {});
  if (query.length > 0) {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `Removing a reaction takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
        'Name the reaction by its id in the path and send nothing else.',
    );
    return;
  }
  const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
  if (id === '') {
    sendError(res, 400, 'VALIDATION_ERROR', 'Name the reaction to remove by its id in the path.');
    return;
  }

  const engine = deps.getEngine();
  if (!engine) {
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Reactions cannot be removed right now: no data engine is registered.');
    return;
  }

  // ⑤ ⑥ and the removal.
  try {
    await removeOwnCommentReaction(engine, id, context);
  } catch (err) {
    const thrown = resolveThrownHttpError(err, 500);
    if (thrown.status < 500) {
      sendError(res, thrown.status, thrown.code, thrown.message);
      return;
    }
    sendServerFault(res, thrown.status, thrown.code, 'The reaction could not be removed because of an error on the server.', err, {
      method: 'DELETE',
      path: COMMENT_REACTION_REMOVE_ROUTE,
    });
    return;
  }
  sendOk(res, { id, deleted: true });
}
