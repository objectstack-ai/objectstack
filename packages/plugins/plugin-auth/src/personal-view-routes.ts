// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  evaluateAuthGate,
  isApiKeyLifecycleRefusalError,
  isAuthzStoreUnavailableError,
  recordNotFoundError,
  resolveRequestExecutionContext,
  shouldDenyAnonymous,
  type RequestAuthService,
  type TenancyServiceResolver,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveThrownHttpError, sendError, sendOk, sendServerFault } from '@objectstack/types';

import { PERSONAL_VIEW_OBJECT } from './personal-view-hooks.js';

/**
 * The owner's delete door for a personal view:
 * `DELETE /api/v1/personal-views/:id` removes ONE `sys_personal_view` row, and
 * only the caller's own (seat ruling 6583289013 on #29443, following the shape
 * maintainer ruling 6422861164, letter A, set for the unreact door on #26161).
 *
 * ## Why a door of its own, and not the data door's `DELETE`
 *
 * A personal view is its owner's own record (`sys-personal-view.object.ts`).
 * On the generic data door a removal is a `delete`, and `delete` needs an
 * object-level grant. No every-member set may carry one: ADR-0090 D5 keeps
 * delete, purge and transfer off the `everyone` anchor
 * (`security-anchor-high-privilege`), and the platform baseline
 * `member_default`, the only set that names this object for a member, carries
 * no delete bit. So a member could save a view and never remove it.
 *
 * This door does not widen that grant model. The generic `DELETE` keeps
 * answering exactly what it answered before, and nothing here grants `delete`
 * on any row. What it adds is one verb whose authorization is STRUCTURAL: the
 * row's owner (`user_id`) is the caller. That is narrower than any grant,
 * because it reaches one row and only one person's.
 *
 * ## The order — every refusal before anything is removed
 *
 *  1. **The caller**, resolved by the platform's one authorization resolver
 *     through the one request-to-`ExecutionContext` composition
 *     (`resolveRequestExecutionContext`), from the request's session or API
 *     key. A permission store that cannot be read answers its own
 *     `SERVICE_UNAVAILABLE` / `503`, and an API key its lifecycle refuses
 *     answers its own `403` and code: both relayed as declared.
 *  2. **Anonymous**: `UNAUTHENTICATED` / `401`, the platform's anonymous floor.
 *  3. **A held sign-in** (an expired password, enforced MFA not yet enrolled):
 *     `403` with the authentication policy's own code.
 *  4. **The request**: the door takes no query parameter, and one sent is
 *     refused (`VALIDATION_ERROR` / `400`) rather than ignored.
 *  5. **The row, read AS THE CALLER.** The read runs every gate a read of a
 *     personal view runs: the object grant, the organization wall, and the
 *     owner-only row scope. A row the caller cannot read and an id that names
 *     no row get the same answer, `RECORD_NOT_FOUND` / `404`, the answer the
 *     data door gives both. Another member and an organization administrator
 *     (whose wildcard bypass is closed for this object) land here.
 *  6. **The owner.** A row the caller CAN read whose `user_id` is anyone else
 *     (today only a platform administrator's bare wildcard reads one) is
 *     refused loudly, `PERMISSION_DENIED` / `403`, and stays.
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
export const PERSONAL_VIEW_REMOVE_ROUTE = '/api/v1/personal-views/:id';

/** The slice of the data engine the door reads and writes through. */
export interface PersonalViewEngine {
  findOne(object: string, query: { where: Record<string, unknown>; context: ExecutionContext }): Promise<unknown>;
  delete(object: string, options: { where: Record<string, unknown>; context: ExecutionContext }): Promise<unknown>;
}

/** What the door is composed over — every service read when a request arrives. */
export interface PersonalViewRoutesDeps {
  /** The data engine; `undefined` when none is registered. */
  getEngine(): PersonalViewEngine | undefined;
  /**
   * Resolve the caller of a request. `AuthPlugin` passes
   * {@link personalViewCallerResolver}; the result is `undefined` for a
   * request that names nobody.
   */
  resolveCaller(req: IHttpRequest): Promise<ExecutionContext | undefined>;
}

/** Mount the owner's delete door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerPersonalViewRoutes(http: IHttpServer, deps: PersonalViewRoutesDeps): void {
  http.delete(PERSONAL_VIEW_REMOVE_ROUTE, (req, res) => handleRemovePersonalView(req, res, deps));
}

/** The services the platform's caller resolution reads, per request. */
export interface PersonalViewCallerSources {
  /** The data engine the caller's grants are read through; `undefined` when none is registered. */
  getEngine(): unknown;
  /** The auth service the caller's session is read through; `undefined` when none is available. */
  getAuth(): RequestAuthService | undefined;
  /**
   * How this door reaches the `tenancy` service, for the resolver's
   * posture-conditional API-key refusals; `undefined` when no posture is read.
   */
  tenancy: TenancyServiceResolver | undefined;
}

/**
 * The platform's caller resolution for this door: the one composition
 * (`resolveRequestExecutionContext`), with the choices the unreact door makes.
 * A request that names nobody resolves to `undefined`, which step 2 refuses.
 */
export function personalViewCallerResolver(sources: PersonalViewCallerSources): PersonalViewRoutesDeps['resolveCaller'] {
  return (req) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers ?? {})) {
      if (value == null) continue;
      headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    // - `anonymous: 'fail-closed'`: the door serves signed-in members only.
    // - `authGate: 'resolved'`: the posture rides the envelope, and step 3 enforces it.
    // - `sessionApi: 'optional'`: with no session read, an API key still admits its owner.
    // - `localization`, `requestLocale`, `accessToken`, `oauth`: withheld. The door
    //   answers no translated text, carries no bearer, and speaks no OAuth scope.
    return resolveRequestExecutionContext({
      headers,
      ql: sources.getEngine(),
      authService: sources.getAuth(),
      tenancy: sources.tenancy,
      anonymous: 'fail-closed',
      authGate: 'resolved',
      credentials: 'api-key-and-session',
      sessionApi: 'optional',
      session: 'request',
      localization: 'withhold',
      requestLocale: undefined,
      accessToken: 'withhold',
      oauth: undefined,
      onAdmission: undefined,
    });
  };
}

/**
 * The refusal {@link removeOwnPersonalView} throws for a row whose owner is
 * not the caller: `PERMISSION_DENIED` / `403`, the ADR-0112 shape.
 */
function notYourViewError(id: string): Error {
  const err = new Error(
    `Personal view ${id} was not removed: it is another user's view, and a user removes only their own. ` +
      'The view is unchanged.',
  ) as Error & { code?: string; status?: number };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  return err;
}

/**
 * Remove the caller's own personal view `id` — steps 5 and 6 of the door, and
 * the removal. Throws `RECORD_NOT_FOUND` / `404` for a row the caller cannot
 * read or that does not exist, and `PERMISSION_DENIED` / `403` for a row whose
 * owner is someone else. `context` must name a user.
 */
export async function removeOwnPersonalView(
  engine: PersonalViewEngine,
  id: string,
  context: ExecutionContext,
): Promise<void> {
  const callerId = context.userId;
  if (!callerId) throw new Error('removeOwnPersonalView: the caller context names no user');

  // Step 5: read the row as the caller, so every read gate decides.
  const row = (await engine.findOne(PERSONAL_VIEW_OBJECT, { where: { id }, context })) as
    | { user_id?: unknown }
    | null
    | undefined;
  if (!row) throw recordNotFoundError(PERSONAL_VIEW_OBJECT, id);

  // Step 6: the structural check, and the only thing that admits the write below.
  if (row.user_id !== callerId) throw notYourViewError(id);

  const removed = await engine.delete(PERSONAL_VIEW_OBJECT, {
    where: { id },
    context: {
      isSystem: true,
      attributedUserId: callerId,
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
    } as ExecutionContext,
  });
  // The driver's own "nothing matched": the row went between the read and here.
  if (removed === false || removed === 0) throw recordNotFoundError(PERSONAL_VIEW_OBJECT, id);
}

async function handleRemovePersonalView(
  req: IHttpRequest,
  res: IHttpResponse,
  deps: PersonalViewRoutesDeps,
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
      path: PERSONAL_VIEW_REMOVE_ROUTE,
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
      `Removing a personal view takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
        'Name the view by its id in the path and send nothing else.',
    );
    return;
  }
  const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
  if (id === '') {
    sendError(res, 400, 'VALIDATION_ERROR', 'Name the personal view to remove by its id in the path.');
    return;
  }

  const engine = deps.getEngine();
  if (!engine) {
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Personal views cannot be removed right now: no data engine is registered.');
    return;
  }

  // ⑤ ⑥ and the removal.
  try {
    await removeOwnPersonalView(engine, id, context);
  } catch (err) {
    const thrown = resolveThrownHttpError(err, 500);
    if (thrown.status < 500) {
      sendError(res, thrown.status, thrown.code, thrown.message);
      return;
    }
    sendServerFault(res, thrown.status, thrown.code, 'The personal view could not be removed because of an error on the server.', err, {
      method: 'DELETE',
      path: PERSONAL_VIEW_REMOVE_ROUTE,
    });
    return;
  }
  sendOk(res, { id, deleted: true });
}
