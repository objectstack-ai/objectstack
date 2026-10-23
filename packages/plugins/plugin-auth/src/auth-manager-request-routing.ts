// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 10] The request routing of `AuthManager` — the one seam every
 * better-auth request passes through on its way to the vendor handler and
 * back, the question of whether better-auth routes a request at all, and the
 * endpoint path both of them key on — moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same client address established once, the same
 * vendor header and dev-only `Origin`, the same admin-session recovery on the
 * way out of impersonation, the same request-state and actor-attribution
 * scopes, the same SCIM scope and atomic erasure, the same refusal envelopes
 * and the same server-error log, the same ownership table and its memo.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which `auth-manager-actor-guards.ts`,
 * `auth-manager-sign-in-lockout.ts`, `auth-manager-password-session-policy.ts`,
 * `auth-manager-database-hooks.ts`, `auth-manager-email-sms-delivery.ts`,
 * `auth-manager-plugin-assembly.ts`, `auth-manager-database-secret.ts`,
 * `auth-manager-membership-admission.ts` and `auth-manager-mcp-access-token.ts`
 * follow, applied per method. The class keeps all three methods — the
 * published `dist/*.d.ts` lists each one — and each body is one literal of
 * exactly the {@link RequestRoutingHost} members that method reads, plus a
 * `.call`. `handleRequest` and `ownsRoute` are no longer `async`: each returns
 * the moved function's own promise, so a caller awaits the same promise the
 * body settles, with no extra wrapper.
 *
 * A method goes as a closure that calls it on the manager at call time, so a
 * test double or spy set on the manager is still the one a body reaches —
 * `betterAuthEndpointPath` included, which `handleRequest` and `ownsRoute` ask
 * through the manager rather than calling the function here directly.
 * `routeOwnership` and `routeOwnershipFor` go as get/set pairs, because
 * `ownsRoute` stores the table it builds, and the instance it built it from,
 * on the manager: the memo stays the one the manager holds, rebuilt when that
 * instance is replaced, as before.
 *
 * `isScimProtocolPath` stays: the SCIM provisioning decision record anchors
 * it, and the prefix it reads, on `auth-manager.ts`. So that file exports it
 * and this module imports it by VALUE, for one read inside `handleRequest`,
 * when a request is handled. `index.ts` lists `auth-manager.ts`'s published
 * names one by one, so that export is not published. The two modules import
 * each other, and that is safe because nothing reads the binding while they
 * are first evaluated: this module's top level is imports, an interface and
 * function declarations.
 * `ORGANIZATION_DELETE_PATH` is imported by both modules, because the
 * before-hook in `auth-manager.ts` reads it too.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import { refuseAnonymousSession } from './anonymous-session-refusal.js';
import { runWithAuthActorScope } from './auth-actor-attribution.js';
import { isScimProtocolPath, type AuthManager } from './auth-manager.js';
import { buildBetterAuthRouteOwnership } from './better-auth-route-ownership.js';
import { withVendorClientAddress } from './client-address-vendor.js';
import {
  ADMIN_SESSION_COOKIE_KEY,
  STOP_IMPERSONATING_PATH,
  withBearerAdminSessionRecovery,
} from './impersonation-bearer-rotation.js';
import { ORGANIZATION_DELETE_PATH } from './organization-delete.js';
import { clientAddressStateEntries } from './request-client-address.js';
import { SESSION_ERASURE_PATHS } from './session-tombstone.js';
import { envelopeVendorAdminRefusal } from './vendor-admin-refusal-envelope.js';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `routeOwnership` and `routeOwnershipFor` are accessors.
 */
export interface RequestRoutingHost {
  routeOwnership: AuthManager['routeOwnership'];
  routeOwnershipFor: AuthManager['routeOwnershipFor'];
  betterAuthEndpointPath: AuthManager['betterAuthEndpointPath'];
  getBasePath: AuthManager['getBasePath'];
  getOrCreateAuth: AuthManager['getOrCreateAuth'];
  resolveClientAddress: AuthManager['resolveClientAddress'];
  runSubjectErasureAtomically: AuthManager['runSubjectErasureAtomically'];
}

/** The body of `AuthManager#handleRequest`; the method's docblock there is its contract. */
export async function handleRequest(this: Pick<RequestRoutingHost, 'betterAuthEndpointPath' | 'getOrCreateAuth' | 'resolveClientAddress' | 'runSubjectErasureAtomically'>, request: Request, transport?: { remoteAddress?: string }): Promise<Response> {
  // ADR-0069 D7 — the client address this request's sign-in audit stamps,
  // established ONCE, here, by the same trust rule the D5 allow-list judges
  // with (`resolveClientAddress`). Read before any rewrite below, and carried
  // to the after-hook in better-auth's request state (`request-client-address.ts`).
  const clientHeaders: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    clientHeaders[name] = value;
  });
  const clientAddress = this.resolveClientAddress({
    headers: clientHeaders,
    ...(transport?.remoteAddress ? { remoteAddress: transport.remoteAddress } : {}),
  });

  // The vendored library's OWN client-address reader (session `ip_address`,
  // the sign-in audit fingerprint, its per-address rate limiter) reads only
  // the platform-owned header (`vendorClientAddressOptions`, composed in
  // `createAuthInstance`). Written HERE, from the address just established,
  // after dropping any copy the caller sent — so the library answers the same
  // address the D5 allow-list judged, or none. See `client-address-vendor.ts`.
  request = withVendorClientAddress(request, clientAddress);

  // Dev DX: better-auth's CSRF protection rejects state-changing requests
  // (e.g. `/sign-in/email`) with a 403 when neither `Origin` nor `Referer`
  // is present. Browsers always send one; non-browser API clients (curl,
  // fetch from a script, integration tests) often don't, so they hit an
  // opaque 403 in local dev. A request with *no* Origin header is never a
  // browser-driven cross-site attack — CSRF is fundamentally cross-origin —
  // so in non-production we synthesize a same-origin `Origin` from the
  // request URL. It matches the dev localhost trusted-origins set, so the
  // CSRF check passes without weakening protection in production (gated on
  // NODE_ENV, the same dev signal used for the fallback auth secret above).
  if (
    process.env.NODE_ENV !== 'production' &&
    !request.headers.get('origin') &&
    !request.headers.get('referer')
  ) {
    try {
      const headers = new Headers(request.headers);
      headers.set('origin', new URL(request.url).origin);
      request = new Request(request, { headers });
    } catch {
      /* malformed URL — leave the request untouched */
    }
  }

  const auth = await this.getOrCreateAuth();

  // [#8243] Let a bearer client carry the `admin_session` recovery credential
  // back out of impersonation. better-auth's `/admin/stop-impersonating`
  // resolves the admin through the `admin_session` COOKIE alone, so in a
  // cookie-blocked deployment — the exact context `bearer()` exists for — the
  // exit path is dead. We accept the credential on a header and write it into
  // the request's own `Cookie` before better-auth sees it; the vendor route
  // then runs completely unmodified, checking everything it always checked.
  //
  // The REQUEST seam, not a before-hook: `bearer()`'s before-hook rebuilds
  // the header set from `c.request.headers`, so a `Cookie` injected by any
  // hook is clobbered by whichever hook sorts after it. Written into the
  // request itself, `bearer()`'s parse-mutate-serialize keeps it.
  if (this.betterAuthEndpointPath(request) === STOP_IMPERSONATING_PATH) {
    try {
      const authContext: any = await (auth as any).$context;
      const adminCookieName: string | undefined =
        authContext?.createAuthCookie?.(ADMIN_SESSION_COOKIE_KEY)?.name;
      if (adminCookieName) {
        request = await withBearerAdminSessionRecovery(request, adminCookieName);
      }
    } catch {
      // Cookie name unresolvable (e.g. a dynamic-baseURL context we cannot
      // reach here) → leave the request alone. The vendor route then answers
      // exactly as it does today for a missing cookie: a loud failure, never
      // a silent wrong identity.
    }
  }

  // better-auth's HTTP entrypoint (`createBetterAuth.handler`) wraps execution
  // in `runWithAdapter` but NOT `runWithRequestState`. Endpoints that read
  // request-state via `defineRequestState()` (e.g. `should-session-refresh`,
  // `oauth`) therefore throw "No request state found" when reached via HTTP.
  // The `customSession` plugin triggers this by invoking the inner
  // `getSession()` endpoint directly, bypassing `to-auth-endpoints`'
  // auto-wrap. We establish the ALS store here so all downstream endpoint
  // calls inherit a valid request-state WeakMap.
  const { runWithRequestState } = await import('@better-auth/core/context');
  // [#4586] Open the actor-attribution scope around the WHOLE request, so
  // every write better-auth makes on the way — adapter writes, the
  // membership reconciler in `user.create.after`, anything a plugin hook
  // triggers — can be credited to the human who made the request. Opening it
  // costs nothing: the scope starts empty, the before-hook drops a resolver
  // in, and the session is looked up only if some write asks. Attribution
  // only — the authorization subject of those writes is unchanged (system).
  // `await`, not a bare return: both scope helpers are generic over their
  // callback, so the composed call is typed `Promise< Promise< Response > >`.
  // The previous single call site flattened it with the `await` below.
  const runHandler = async (): Promise<Response> =>
    await runWithAuthActorScope(() =>
      runWithRequestState(
        new WeakMap<object, unknown>(clientAddressStateEntries(clientAddress)),
        () => auth.handler(request),
      ),
    );

  // [#7724] A subject-erasure request is ONE unit of work, and better-auth
  // does not treat it as one: `internalAdapter.deleteUser` deletes the
  // sessions, then the accounts, then the user, in three unrelated adapter
  // calls with no transaction. Measured 2026-08-20 against the installed
  // better-auth 1.7.1: `deleteUser` at `dist/db/internal-adapter.mjs:233-247`
  // is three separate `deleteManyWithHooks` / `deleteWithHooks` calls
  // (session `:235`, account `:239`, user `:243`), and the string
  // "transaction" does not occur anywhere in that file — a zero result that
  // means something because "deleteManyWithHooks" occurs 8 times in it, so
  // the search does reach the text. (The session call is now conditional on
  // `!secondaryStorage || storeSessionInDatabase`; ObjectStack wires no
  // `secondaryStorage` — deliberately, see `session-tombstone.ts` — so all
  // three fire here.) Anything
  // that refuses the LAST of those three leaves the first two committed: the
  // credential rows are gone, the `sys_user` row is not, and the deployment
  // is left with an identity that still occupies the org roster and can no
  // longer sign in. Nothing tells the operator, and there is no way back.
  const endpointPath = this.betterAuthEndpointPath(request);

  // [#3653 / #14522] A SCIM protocol request (`/scim/v2/*`) runs inside
  // `scimRequestScope`, which is what makes the adapter's `transaction`
  // config open a REAL engine transaction around the vendor's provisioning
  // multi-writes (`objectql-adapter.ts`, the scoping note there). Opened
  // HERE, with `run(...)` around the whole request, for the same reason the
  // actor-attribution scope above is: `run` has a callback boundary that
  // every `als.run` the vendor performs underneath nests inside. The stamp
  // used to be an `enterWith` inside the SCIM plugin's `verifyBearerToken`
  // callback, and it never reached the writes — the vendor resumes the
  // endpoint handler from a continuation captured before the verifier ran
  // (measured on 1.7.2: zero `engine.transaction` calls across
  // `POST /Users` + `PATCH /Users/{id}`). Keyed on the endpoint path prefix
  // so it is exactly as narrow as before — SCIM protocol requests only; the
  // non-SCIM flows keep their sequential posture, which the scoping note
  // records as load-bearing. Pinned by `scim-transaction-scope.test.ts`.
  const runRequest = isScimProtocolPath(endpointPath)
    ? async (): Promise<Response> => {
        const { scimRequestScope } = await import('./scim-connection-service.js');
        return scimRequestScope.run({ scim: true }, runHandler);
      }
    : runHandler;
  // [#24948] An organization delete is one unit of work on the same terms:
  // better-auth clears the caller's active organization and deletes the
  // members and invitations before the organization row, with no
  // transaction, and the engine's refusal on that last row used to leave the
  // organization standing with no owner.
  const vendorResponse =
    endpointPath !== undefined &&
    (SESSION_ERASURE_PATHS.has(endpointPath) || endpointPath === ORGANIZATION_DELETE_PATH)
      ? await this.runSubjectErasureAtomically(runRequest)
      : await runRequest();

  // [#10349] The better-auth-native `/admin/` routes refuse an anonymous
  // caller through the vendor's `adminMiddleware`
  // (`APIError.fromStatus('UNAUTHORIZED')`, no body argument), so the refusal
  // reaches the client as a 401 that announces `application/json` and carries
  // the EMPTY STRING — no envelope, nothing to branch on. The ObjectStack raw
  // `/admin/*` mounts answer the identical question with the ADR-0112
  // envelope and `code: 'UNAUTHENTICATED'` (`platform-admin-gate.ts`), and
  // which of the two a caller gets depends only on which implementation
  // happens to serve that route — an implementation detail, not a contract.
  //
  // This is the ONE seam every vendor route passes through, which is why the
  // normalization belongs here and not in ten routes we do not own. It is
  // scoped to the `/admin/` NAMESPACE (option C): the prefix test costs no new
  // concept, because this method already discriminates on `endpointPath` twice
  // above — `STOP_IMPERSONATING_PATH` and `SESSION_ERASURE_PATHS`.
  //
  // Status and admission are untouched; see the module header for the three
  // narrowings and the measurement behind each.
  const enveloped = await envelopeVendorAdminRefusal(endpointPath, vendorResponse);

  // [#17238] And the anonymous `/get-session` answer becomes the same
  // declared refusal. better-auth serves `200` + the literal JSON `null`
  // when no session backs the request, which is a value no
  // `SessionResponse` can express — so `ObjectStackClient.auth.me()`, which
  // declares `Promise<SessionResponse>`, resolved OUTSIDE its own type on
  // the most ordinary call a logged-out caller makes. Ruled by the director
  // seat (batch #117 item 4): the code moves, the published schema does not.
  //
  // Same seam and same reason as the `/admin/` normalization above — this is
  // the ONE place every vendor route passes through — but ⚠️ NOT the same
  // kind of change: that one is forbidden to move admission and this one IS
  // the admission move (`200` -> `401`). `anonymous-session-refusal.ts`
  // carries the three narrowings that keep every other answer identical.
  const response = await refuseAnonymousSession(endpointPath, enveloped);

  if (response.status >= 500) {
    try {
      const body = await response.clone().text();
      console.error('[AuthManager] better-auth returned error:', response.status, body);
    } catch {
      console.error('[AuthManager] better-auth returned error:', response.status, '(unable to read body)');
    }
  }

  return response;
}

/** The body of `AuthManager#ownsRoute`; the method's docblock there is its contract. */
export async function ownsRoute(this: Pick<RequestRoutingHost, 'betterAuthEndpointPath' | 'getOrCreateAuth' | 'routeOwnership' | 'routeOwnershipFor'>, request: Request): Promise<boolean> {
  const endpointPath = this.betterAuthEndpointPath(request);
  if (endpointPath === undefined) return false;
  try {
    const auth = await this.getOrCreateAuth();
    if (this.routeOwnershipFor !== auth || !this.routeOwnership) {
      this.routeOwnership = buildBetterAuthRouteOwnership((auth as any)?.api);
      this.routeOwnershipFor = auth;
    }
    return this.routeOwnership.owns(request.method, endpointPath);
  } catch {
    return false;
  }
}

/** The body of `AuthManager#betterAuthEndpointPath`; the method's docblock there is its contract. */
export function betterAuthEndpointPath(this: Pick<RequestRoutingHost, 'getBasePath'>, request: Request): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return undefined;
  }
  const base = this.getBasePath();
  if (!pathname.startsWith(base)) return undefined;
  const endpoint = pathname.slice(base.length).replace(/\/+$/, '');
  return endpoint.startsWith('/') ? endpoint : undefined;
}
