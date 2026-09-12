// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0112 envelope for the anonymous `/get-session` answer (#17238).
 *
 * ## The defect, measured
 *
 * `GET /api/v1/auth/get-session` answered an UNAUTHENTICATED caller with
 * `200` and the literal JSON `null`. Measured on the installed better-auth
 * (default plugin set) through `AuthManager.handleRequest`, anonymous:
 *
 *     GET  /get-session  (no credential)        -> 200  application/json  body 'null'
 *     GET  /get-session  (unknown cookie)       -> 200  application/json  body 'null'
 *     GET  /get-session  (signed in)            -> 200  application/json  body {user,session}
 *     POST /get-session  (no credential)        -> 404  (no content-type)  body ''
 *
 * `ObjectStackClient.auth.me()` declares `Promise<SessionResponse>`, and
 * `SessionResponseSchema` is `BaseResponseSchema.extend({ data: { session,
 * user, token? } })` — it REQUIRES `data.session` and `data.user`. So there is
 * no value of `SessionResponse` meaning "nobody is signed in", and the most
 * ordinary call a logged-out caller can make resolved to something outside the
 * method's own declared type. That is a declared contract the runtime does not
 * deliver, on the return side.
 *
 * ## What is ruled, and why the code is the thing that moves
 *
 * Director seat, decision batch #117 item 4 (2026-09-12), maintainer verbatim
 * 「17238 B」 — the server answers the platform's standard ADR-0112 failure
 * envelope with HTTP 401 instead of `200` + `null`, and
 * `SessionResponseSchema` is UNTOUCHED. The charter rule quoted in that ruling:
 * 「spec 与代码不一致默认改代码,改协议单独立卡非选项」. A `null` on the most
 * ordinary call is the implementation's quirk (better-auth's bare answer), not
 * a shape the platform's published contract should grow a nullable arm to
 * accommodate forever.
 *
 * ⇒ Every value `auth.me()` RETURNS is now inside `SessionResponse`. The
 * anonymous case is delivered as a rejection instead: the SDK's `fetch`
 * wrapper throws on a non-2xx and hands the caller an error carrying
 * `code: 'UNAUTHENTICATED'` and `httpStatus: 401`. Refusal by envelope, not by
 * a value the declared type cannot express.
 *
 * ## What is normalized, and what is deliberately left alone
 *
 * This module CHANGES ADMISSION on exactly one answer — that is the point of
 * the card, and it is the one way this seam differs from its sibling
 * `vendor-admin-refusal-envelope.ts`, which is forbidden to. Everything else
 * is held still by three narrowings, each of which a broader rule would break:
 *
 *  1. **The `/get-session` endpoint only.** Not a prefix, not the session
 *     family: the exact path, in better-auth's own `ctx.path` spelling. The
 *     sibling routes that also read a session (`/list-sessions`,
 *     `/revoke-session`, the `/admin/` lane) answer their own way and are not
 *     this card's.
 *  2. **`200` only.** A `/get-session` that is already refusing, redirecting or
 *     failing is better-auth's own answer and reaches the caller untouched. In
 *     particular the `404` that `POST /get-session` produces above is NOT
 *     converted into a 401 — this seam never invents a route.
 *  3. **A body that is exactly the JSON `null`.** A body carrying a session is
 *     returned UNCHANGED — the same object, not a copy, so a test can assert it
 *     with `toBe`. This is what keeps the signed-in answer byte-identical and
 *     keeps `SessionResponseSchema` parsing it exactly as it did before.
 *
 * ⛔ It does not touch better-auth's JS API. `auth.api.getSession()` — the seam
 * `resolve-execution-context.ts`, the `/admin/` gates and the SSO bridges read
 * — still answers `null` for an anonymous caller, because that is a function
 * return value and not an HTTP answer. Only the wire shape moves.
 *
 * ## Why the code is DERIVED rather than written down here
 *
 * `standardErrorCodeForHttpStatus` (`@objectstack/spec/api`) is the one place a
 * code is spelled for a producer that knows only a status — ADR-0112's own
 * derived-code map, `401 -> UNAUTHENTICATED`. `UNAUTHENTICATED` is an existing
 * member of the STANDARD catalog (`StandardErrorCode`, `errors.zod.ts`), so
 * this card registers no vocabulary: nothing is minted, `ERROR_CODE_LEDGER` is
 * untouched, and there is no string literal here to drift from the catalog.
 *
 * The message comes from `platform-admin-gate.ts`, the module that already owns
 * ObjectStack's refusal wording, for the same reason its sibling seam reuses it:
 * an anonymous caller refused by this route and one refused by a raw `/admin/`
 * mount get BYTE-IDENTICAL bodies, rather than two strings that merely look
 * alike today.
 */

import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { PLATFORM_ADMIN_REFUSAL_MESSAGES } from './platform-admin-gate.js';

/**
 * The session-read endpoint, in better-auth's own `ctx.path` spelling — the
 * same spelling `AuthManager.betterAuthEndpointPath` returns and the same one
 * `SESSION_ERASURE_PATHS` and the stop-impersonating recovery seam are keyed
 * on. ⛔ No trailing slash and no prefix semantics: this addresses ONE route.
 */
export const GET_SESSION_PATH = '/get-session';

/** The status this seam answers an unauthenticated caller with (ADR-0112). */
export const ANONYMOUS_SESSION_REFUSAL_STATUS = 401;

/**
 * The exact body better-auth serves when no session backs the request. Compared
 * after `trim()` so insignificant whitespace around the JSON literal cannot
 * make the rule miss — and compared as TEXT rather than by parsing, so a body
 * that merely PARSES to something falsy (`'0'`, `'""'`, `'false'`) is left
 * alone. Only the literal `null` means "nobody is signed in".
 */
const ANONYMOUS_BODY = 'null';

/** Is `endpointPath` the session-read route this seam owns? */
export function isGetSessionPath(endpointPath: string | undefined): boolean {
  return endpointPath === GET_SESSION_PATH;
}

/**
 * Refuse an anonymous `/get-session` with the declared ADR-0112 envelope.
 *
 * Returns the response UNCHANGED — the same object, not a copy — whenever any
 * of the three narrowings in the module header applies, so every untouched path
 * is untouched by identity.
 *
 * Headers are carried over rather than rebuilt: better-auth attaches
 * `Set-Cookie` to some session answers, and dropping them would change
 * behaviour well outside this card. Only `content-type` is re-asserted and
 * `content-length` is dropped, since the body length changed.
 */
export async function refuseAnonymousSession(
  endpointPath: string | undefined,
  response: Response,
): Promise<Response> {
  if (!isGetSessionPath(endpointPath)) return response;
  if (response.status !== 200) return response;

  let body: string;
  try {
    body = await response.clone().text();
  } catch {
    // Unreadable body (already-disturbed stream) → leave it exactly as it is.
    // An answer we cannot inspect is not one we may convert into a refusal.
    return response;
  }
  if (body.trim() !== ANONYMOUS_BODY) return response;

  const status = ANONYMOUS_SESSION_REFUSAL_STATUS;
  const code = standardErrorCodeForHttpStatus(status);
  const message = PLATFORM_ADMIN_REFUSAL_MESSAGES[status];

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');

  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers,
  });
}
