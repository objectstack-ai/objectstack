// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
  evaluateAuthGate,
  isApiKeyLifecycleRefusalError,
  isAuthzStoreUnavailableError,
  resolveRequestExecutionContext,
  shouldDenyAnonymous,
  type RequestAuthService,
  type TenancyServiceResolver,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { sendError, sendOk, sendServerFault } from '@objectstack/types';
import { SharingRulesNotRunningError, type ShareableObject } from './shareable-objects.js';

/**
 * The shareable-objects door: `GET /api/v1/sharing/shareable-objects`. It
 * answers the objects a sharing rule can take effect on, for Setup's
 * sharing-rule object picker (`shareable-objects.ts` says which objects and in
 * what order). It reads and never writes.
 *
 * ## Why plugin-sharing mounts it
 *
 * The sharing-rule administration routes (`/api/v1/sharing/rules*`) are
 * `@objectstack/rest`'s, served over the `sharingRules` service through a spec
 * contract. A list there would need a new member on that contract; this door
 * is the plugin's own, read straight off the `SharingRuleService` the plugin
 * constructs, at a path no other package serves. It reaches for the
 * `http.server` service and registers on `IHttpServer`, as the share-link
 * family does; `sharing-route-ledger.ts` records it.
 *
 * ## Who may ask — the sharing-rule administrators
 *
 * In order, before anything is read:
 *
 *  1. **The caller**, resolved by the platform's one request-to-context
 *     composition (`resolveRequestExecutionContext`) from the request's session
 *     or API key. A permission store that cannot be read answers its own
 *     `SERVICE_UNAVAILABLE` / `503`, and an API key its lifecycle refuses its
 *     own `403` and code: both relayed as declared, never folded into a denial.
 *  2. **A held sign-in** (ADR-0069: an expired password, enforced MFA not yet
 *     enrolled): `403` with the authentication policy's own code.
 *  3. **Anonymous** — the platform's one anonymous floor (ADR-0056 D2):
 *     `UNAUTHENTICATED` / `401`.
 *  4. **The request**: the route takes no query parameter, and a request that
 *     carries one is refused `VALIDATION_ERROR` / `400` naming it (AGENTS.md,
 *     route rule 5: the closed set here is empty), never ignored.
 *  5. **The administrator**: the sharing-rule surface's own admission
 *     (`SharingRuleService.listShareableObjects` asks the check every verb of
 *     that surface asks, ADR-0111 D6). A caller it refuses is answered
 *     `PERMISSION_DENIED` / `403` with its sentence, so the list names nothing
 *     the caller could not author a rule on.
 *
 * ## What the door answers
 *
 *  - **Success:** `200` with `{ objects }` (`ShareableObject[]`), business
 *    objects first.
 *  - **Sharing rules not running on this kernel** (`enforce: false`, or the
 *    rule subsystem did not start): `501` / `NOT_IMPLEMENTED`, the answer the
 *    REST sharing-rule routes give for the same state.
 *  - **An engine that cannot enumerate its objects** is a fault: `500` /
 *    `INTERNAL_ERROR` with this door's sentence and the error in the fault log.
 *    An empty list would read as "no object can take a rule", so it is never
 *    served in place of the answer.
 */

/** The route the door is mounted at. */
export const SHAREABLE_OBJECTS_ROUTE = '/api/v1/sharing/shareable-objects';

/** What the door is composed over — every service read when a request arrives. */
export interface ShareableObjectsRoutesDeps {
  /** The data engine the caller's grants are read through; `undefined` when none is registered. */
  getEngine(): unknown;
  /** The auth service the caller's session is read through; `undefined` when none is registered. */
  getAuth(): RequestAuthService | undefined;
  /** How this door reaches the `tenancy` service; `undefined` on a host with no async service accessor. */
  tenancy: TenancyServiceResolver | undefined;
  /**
   * The list, admitted for `context` — `SharingRuleService.listShareableObjects`.
   * Throws `PERMISSION_DENIED: …` for a caller the sharing-rule surface refuses,
   * and {@link SharingRulesNotRunningError} when no rule service runs.
   */
  listShareableObjects(context: ExecutionContext): ShareableObject[];
}

/** Mount the door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerShareableObjectsRoutes(http: IHttpServer, deps: ShareableObjectsRoutesDeps): void {
  http.get(SHAREABLE_OBJECTS_ROUTE, (req, res) => handleShareableObjects(req, res, deps));
}

/** The sharing-rule surface's refusal idiom (`PERMISSION_DENIED: <sentence>`), read once. */
const PERMISSION_DENIED_PREFIX = /^PERMISSION_DENIED:\s*/;

async function handleShareableObjects(
  req: IHttpRequest,
  res: IHttpResponse,
  deps: ShareableObjectsRoutesDeps,
): Promise<void> {
  // ① The caller.
  let context: ExecutionContext | undefined;
  try {
    context = await resolveCaller(req, deps);
  } catch (err) {
    if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this request could not be resolved.', err, {
      method: 'GET',
      path: SHAREABLE_OBJECTS_ROUTE,
    });
    return;
  }

  // ② A held sign-in.
  const gate = evaluateAuthGate(context, '');
  if (gate) {
    sendError(res, 403, gate.code as ErrorCode, gate.message);
    return;
  }

  // ③ Anonymous.
  if (!context || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
    sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
    return;
  }

  // ④ The request: the closed query set is empty.
  const query = Object.keys(req.query ?? {});
  if (query.length > 0) {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `The shareable objects list takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
        'Ask for the list with no parameters: it always answers every object a sharing rule can take effect on.',
    );
    return;
  }

  // ⑤ The administrator, then the list.
  let objects: ShareableObject[];
  try {
    objects = deps.listShareableObjects(context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof SharingRulesNotRunningError) {
      sendError(res, 501, 'NOT_IMPLEMENTED', message);
      return;
    }
    if (PERMISSION_DENIED_PREFIX.test(message)) {
      sendError(res, 403, 'PERMISSION_DENIED', message.replace(PERMISSION_DENIED_PREFIX, ''));
      return;
    }
    sendServerFault(res, 500, 'INTERNAL_ERROR', 'The objects a sharing rule can take effect on could not be listed.', err, {
      method: 'GET',
      path: SHAREABLE_OBJECTS_ROUTE,
    });
    return;
  }
  sendOk(res, { objects });
}

/**
 * Resolve the caller through the one composition. This door's differences, as
 * its named parameters: anonymous fails closed (the door answers its floor);
 * the held-sign-in posture is the one the resolver decided for the credential
 * that admitted the caller; an API key admits its owner with no session read;
 * no locale, bearer or OAuth token is carried — the list is the same in every
 * language, and nothing downstream acts as the caller.
 */
async function resolveCaller(req: IHttpRequest, deps: ShareableObjectsRoutesDeps): Promise<ExecutionContext | undefined> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (value == null) continue;
    headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
  }
  return await resolveRequestExecutionContext({
    headers,
    ql: deps.getEngine(),
    authService: deps.getAuth(),
    tenancy: deps.tenancy,
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
}
