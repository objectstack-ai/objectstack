// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0112 envelope for the better-auth-native `/admin/` refusals (#10349).
 *
 * ## The defect, measured
 *
 * `/api/v1/auth/admin/*` is served by TWO implementations and answers the same
 * question in two shapes. ObjectStack's raw Hono mounts (`create-user`,
 * `set-user-password`, `unlock-user`, `import-users`, `ban-user`, `unban-user`,
 * `oauth2/toggle-disabled`, `sso/*`) run `judgePlatformAdmin` and refuse an
 * anonymous caller with the declared envelope — `401 { success: false, error: {
 * code: 'UNAUTHENTICATED', message } }` (see `platform-admin-gate.ts`). The
 * routes better-auth serves itself refuse the same caller through the vendor's
 * `adminMiddleware`, which is `getAuthoritativeSessionFromCtx(ctx)` followed by
 * `APIError.fromStatus('UNAUTHORIZED')` — no body argument at all.
 *
 * Measured on the then-installed better-auth 1.7.1, anonymous, through
 * `AuthManager.handleRequest`, ten vendor-lane routes answered:
 *
 *     POST /admin/impersonate-user     -> 401 content-type: application/json  body ''
 *     POST /admin/set-role             -> 401 content-type: application/json  body ''
 *     POST /admin/revoke-user-sessions -> 401 content-type: application/json  body ''
 *     POST /admin/revoke-user-session  -> 401 content-type: application/json  body ''
 *     POST /admin/list-user-sessions   -> 401 content-type: application/json  body ''
 *     POST /admin/update-user          -> 401 content-type: application/json  body ''
 *     GET  /admin/list-users           -> 401 content-type: application/json  body ''
 *     GET  /admin/get-user             -> 401 content-type: application/json  body ''
 *     POST /admin/has-permission       -> 401 content-type: application/json  body ''
 *     POST /admin/stop-impersonating   -> 401 content-type: application/json  body ''
 *
 * The body is the EMPTY STRING, not an empty JSON object — which is why this
 * module ADDS an envelope and never rewrites one. The `content-type` still
 * announces `application/json`, so a client that believes the header and calls
 * `JSON.parse` throws on the refusal instead of branching on it. A consumer
 * cannot tell 401-means-sign-in from 401-means-anything-else without knowing,
 * per route, which of the two implementations happens to serve it — and that
 * split is an implementation detail, not a contract.
 *
 * ## What is normalized, and what is deliberately left alone
 *
 * Scope is the `/admin/` NAMESPACE only (triage's option C, not option B).
 * Statuses are unchanged and admission is unchanged: this module never turns a
 * 2xx into a refusal and never turns a refusal into a 2xx. It fills in a body
 * that was empty, and nothing else.
 *
 * Three deliberate narrowings, each of which a broader rule would have broken:
 *
 *  1. **Empty body only.** A vendor refusal that DID say something keeps saying
 *     it byte-for-byte — the signed-in non-admin's
 *     `403 {"message":…,"code":"YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS"}` is
 *     the vendor's own denial vocabulary and is what `admin-route-nonadmin-
 *     refusal.dogfood.test.ts` asserts on. Rewriting it would be a second,
 *     larger contract change smuggled in behind this one.
 *  2. **Refusal statuses only** (401 / 403). `/admin/oauth2/*` answers 404 with
 *     an empty body when the `oidcProvider` plugin is off, and a 404 discloses
 *     nothing that needs a code; a semantic 4xx the vendor owns (409, 400) is
 *     not this seam's to name.
 *  3. **The `/admin/` prefix.** Non-`/admin/` vendor routes are untouched, which
 *     is what makes this option C. `POST /sign-in/email` already answers
 *     `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_
 *     PASSWORD"}` and stays exactly that.
 *
 * ## Why the code is DERIVED rather than written down here
 *
 * `standardErrorCodeForHttpStatus` (`@objectstack/spec/api`) is the one place a
 * code is spelled for a producer that knows only a status — ADR-0112's own
 * derived-code map, `401 -> UNAUTHENTICATED`, `403 -> PERMISSION_DENIED`. Using
 * it means this module registers no vocabulary of its own and cannot drift from
 * the catalog: there is no string literal here to drift.
 *
 * The messages come from `platform-admin-gate.ts`, the module that already owns
 * ObjectStack's refusal wording. That is not decoration — it is what makes the
 * two lanes answer an anonymous caller with BYTE-IDENTICAL bodies rather than
 * with two independently-maintained strings that merely look alike today.
 */

import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { PLATFORM_ADMIN_REFUSAL_MESSAGES } from './platform-admin-gate.js';

/**
 * The `/admin/` namespace, in better-auth's own `ctx.path` spelling — the same
 * spelling `AuthManager.betterAuthEndpointPath` returns and the same one
 * `SESSION_ERASURE_PATHS` and the stop-impersonating recovery seam are keyed
 * on. The trailing slash is load-bearing: it addresses the namespace and not a
 * hypothetical route literally named `/admin`.
 */
export const VENDOR_ADMIN_PATH_PREFIX = '/admin/';

/**
 * The statuses this seam will name. Exactly the two `judgePlatformAdmin`
 * itself emits, and exactly the two the `/admin/` dogfood sweep asserts a
 * non-admin receives.
 *
 * 403 is included although no bodyless 403 occurs on the installed vendor
 * version (measured: the signed-in non-admin's 403 carries the vendor's
 * `YOU_ARE_NOT_ALLOWED_*` body). One rule over both refusal statuses means a
 * vendor change that starts refusing bodylessly with the other one cannot
 * silently re-open this hole — which is the failure mode the card records:
 * the gap was known, documented, and tracked by nothing.
 */
const NORMALIZED_REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/** Is `endpointPath` inside the better-auth `/admin/` namespace? */
export function isVendorAdminPath(endpointPath: string | undefined): boolean {
  return endpointPath !== undefined && endpointPath.startsWith(VENDOR_ADMIN_PATH_PREFIX);
}

/**
 * Give a bodyless vendor-lane `/admin/` refusal the ADR-0112 envelope.
 *
 * Returns the response UNCHANGED — the same object, not a copy — whenever any
 * of the three narrowings above applies, so the untouched paths are untouched
 * by identity and a test can assert that with `toBe`.
 *
 * Headers are carried over rather than rebuilt: better-auth attaches
 * `Set-Cookie` to refusals on some paths, and dropping them would change
 * behaviour well outside this card. Only `content-type` is asserted (the
 * vendor already claims `application/json`; now it is telling the truth) and
 * `content-length` is dropped, since the body length changed.
 */
export async function envelopeVendorAdminRefusal(
  endpointPath: string | undefined,
  response: Response,
): Promise<Response> {
  if (!isVendorAdminPath(endpointPath)) return response;
  if (!NORMALIZED_REFUSAL_STATUSES.has(response.status)) return response;

  let body: string;
  try {
    body = await response.clone().text();
  } catch {
    // Unreadable body (already-disturbed stream) → leave it exactly as it is.
    // A refusal we cannot inspect is not one we may rewrite.
    return response;
  }
  if (body !== '') return response;

  const code = standardErrorCodeForHttpStatus(response.status);
  const message =
    PLATFORM_ADMIN_REFUSAL_MESSAGES[response.status as 401 | 403] ??
    /* istanbul ignore next — unreachable while the set above holds two members */
    'Refused';

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');

  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
