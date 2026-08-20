// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8243 — impersonation must actually take effect for a bearer client.
 *
 * ## The defect
 *
 * better-auth's `bearer()` plugin authenticates a request by OVERWRITING the
 * request's session cookie with the bearer token (a before-hook calling
 * `setRequestCookie(headers, authCookies.sessionToken.name, decodedToken)` —
 * `dist/plugins/bearer/index.mjs:46` — measured 2026-08-20 against the
 * installed better-auth `1.7.1`). The admin plugin's
 * `POST /admin/impersonate-user` does the opposite: it mints an impersonation
 * session and hands it over as a *cookie* (`setSessionCookie`), parking the
 * admin's own session token in a signed `admin_session` cookie for the exit
 * path.
 *
 * For a cookie client those two compose: the browser replaces its session
 * cookie and every later request is the impersonated principal. For a bearer
 * client they collide. The client keeps replaying `Authorization: Bearer
 * <admin token>`, the before-hook keeps converting it back into the ADMIN's
 * session cookie, and the impersonation cookie never gets a chance to be read.
 * The endpoint answers 200 and does nothing — and because the framework's data
 * routes resolve identity through the very same seam
 * (`runtime/src/security/resolve-session-principal.ts`), every write made
 * "while impersonating" is attributed to the admin.
 *
 * A silent 200 no-op on a security-relevant admin endpoint is the worst
 * available shape: nothing anywhere reports that impersonation did not happen.
 *
 * ## The fix — rotation, not refusal (maintainer ruling, 2026-08-13)
 *
 * Refusing bearer-authenticated impersonation was considered and REJECTED: it
 * would leave cookie-blocked deployments — the exact context `bearer()` exists
 * for — permanently unable to impersonate at all.
 *
 * So we rotate instead. When the caller of `/admin/impersonate-user`
 * authenticated with a bearer, the token it is holding is INVALIDATED as part
 * of impersonation:
 *
 *   1. mint a rotated admin session, carrying the admin's selected organization
 *      across so they do not land somewhere else on the way back;
 *   2. hand the caller the rotated session as an `admin_session` RECOVERY
 *      credential, both as the signed cookie the vendor already sets and — for
 *      the cookie-blocked lane — as a `set-admin-session-token` response
 *      header, mirroring how `bearer()` emits `set-auth-token`;
 *   3. delete the admin's original session, LAST.
 *
 * After that the only token that resolves is the impersonated one better-auth
 * already emitted via `set-auth-token`. A client that adopts the rotation is
 * the impersonated principal; a client that ignores it gets a loud 401 on the
 * next request. "Impersonation succeeded but did not take effect" stops being
 * expressible.
 *
 * Step order is the failure design. The rotated session exists and the caller
 * has been handed its recovery value BEFORE the old session dies, so any throw
 * on the way leaves the admin signed in with impersonation refused — never an
 * admin locked out of a session they can no longer name.
 *
 * ## The exit path — also ruled, and shipped together
 *
 * `POST /admin/stop-impersonating` resolves the admin through the
 * `admin_session` COOKIE only. In a cookie-blocked deployment that cookie
 * never comes back, so the exit path is dead in precisely the deployments this
 * card is about — an entry path without a working exit is not a fix. So the
 * recovery value is accepted back on an `x-admin-session-token` REQUEST
 * header and injected into the request's `Cookie` header before better-auth
 * sees it; the vendor route then runs completely unmodified.
 *
 * ## Why these seams
 *
 * No fork, no vendoring, no patched dependency (ruled). Two wrappers around
 * the vendor route:
 *
 * - Rotation rides better-auth's global `hooks.after`, which is the one place
 *   where the admin's session (`ctx.context.session`, set by the route's
 *   `sessionMiddleware`) and the adapter are both in hand after the route has
 *   succeeded.
 * - Recovery ingestion rides the REQUEST seam (`AuthManager.handleRequest`),
 *   NOT a before-hook, and that is load-bearing. `bearer()`'s own before-hook
 *   rebuilds the header set from `c.request.headers` — the untouched original
 *   — so any `Cookie` a before-hook injects is overwritten by whichever hook
 *   runs later. Injecting into the request itself puts the cookie somewhere
 *   `bearer()` preserves: its `setRequestCookie` is parse-mutate-serialize and
 *   keeps every cookie it did not set. This is the same reasoning that put
 *   `runSubjectErasureAtomically` at the request seam rather than in a route.
 *
 * Upstream: the overwrite is vendor behaviour, reported upstream — see the
 * issue link recorded on #8243.
 */

/** better-auth's admin plugin, entry path. */
export const IMPERSONATE_USER_PATH = '/admin/impersonate-user';

/** better-auth's admin plugin, exit path. */
export const STOP_IMPERSONATING_PATH = '/admin/stop-impersonating';

/** The vendor's cookie name key for the parked admin session. */
export const ADMIN_SESSION_COOKIE_KEY = 'admin_session';

/**
 * Response header carrying the `admin_session` recovery credential, emitted on
 * a bearer-authenticated impersonation. Deliberately shaped like `bearer()`'s
 * own `set-auth-token`, because the client handling is identical: read it off
 * the impersonation response, store it, replay it on the way out.
 */
export const ADMIN_SESSION_RECOVERY_RESPONSE_HEADER = 'set-admin-session-token';

/** Request header a bearer client replays the recovery credential on. */
export const ADMIN_SESSION_RECOVERY_REQUEST_HEADER = 'x-admin-session-token';

/**
 * The session token a request's `Authorization: Bearer` header resolves to, or
 * `undefined` when there is no bearer.
 *
 * Mirrors `bearer()`'s own decoding so the comparison against the resolved
 * session is exact: the plugin percent-decodes the token when it needs to and
 * installs it as the session cookie, whose value is `<token>.<signature>`.
 * An unsigned token has no `.` and survives the split unchanged.
 */
function bearerSessionToken(ctx: any): string | undefined {
  const raw: string =
    ((ctx?.request?.headers?.get?.('authorization') ??
      ctx?.headers?.get?.('authorization')) as string) || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  if (!match?.[1]) return undefined;
  let token = match[1].trim();
  if (token.includes('%')) {
    try {
      token = decodeURIComponent(token);
    } catch {
      /* not percent-encoded after all — use it verbatim, as bearer() does */
    }
  }
  return token.split('.')[0] || undefined;
}

/** Every `Set-Cookie` currently staged on the response, however the runtime spells it. */
function stagedSetCookies(headers: Headers | undefined): string[] {
  if (!headers) return [];
  const viaGetter = (headers as any).getSetCookie?.();
  if (Array.isArray(viaGetter)) return viaGetter;
  const joined = headers.get('set-cookie');
  return joined ? [joined] : [];
}

/**
 * Drop the vendor's `admin_session` `Set-Cookie`, which names the session we
 * are about to delete. Ours is appended when this hook's headers are merged,
 * so the response carries exactly one — a stale duplicate would be applied
 * first and shadowed, which works but reads as a bug to the next person.
 */
function dropStaleAdminSessionCookie(ctx: any, cookieName: string): void {
  const headers: Headers | undefined = ctx?.context?.responseHeaders;
  if (!headers) return;
  const staged = stagedSetCookies(headers);
  if (staged.length === 0) return;
  const kept = staged.filter((cookie) => !cookie.startsWith(`${cookieName}=`));
  if (kept.length === staged.length) return;
  headers.delete('set-cookie');
  for (const cookie of kept) headers.append('set-cookie', cookie);
}

/**
 * Add a header to `Access-Control-Expose-Headers` without dropping what is
 * already there. A cross-origin console reads the recovery credential off the
 * response, so an unexposed header is the same as no header at all. `bearer()`
 * does exactly this for `set-auth-token` in its own after-hook, which runs
 * after ours and therefore preserves what we add here.
 */
function exposeResponseHeader(ctx: any, name: string): void {
  const current: string =
    (ctx?.context?.responseHeaders?.get?.('access-control-expose-headers') as string) || '';
  const exposed = new Set(
    current
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  exposed.add(name);
  ctx.setHeader('Access-Control-Expose-Headers', Array.from(exposed).join(', '));
}

/** Did the impersonation route actually succeed? */
async function impersonationSucceeded(ctx: any): Promise<boolean> {
  const returned = ctx?.context?.returned;
  if (!returned) return false;
  try {
    const { isAPIError } = await import('better-auth/api');
    if (isAPIError(returned)) return false;
  } catch {
    if (returned instanceof Error) return false;
  }
  return Boolean((returned as any)?.session);
}

/**
 * Rotate the caller's bearer as part of a successful `/admin/impersonate-user`,
 * so the impersonated session is the only one that resolves afterwards.
 *
 * A no-op for every other path, for a failed impersonation, and for a caller
 * that did NOT authenticate with a bearer — a cookie client's session cookie
 * was already replaced by the route, so its behaviour is unchanged byte for
 * byte, and there is no stale credential in the client's hands to invalidate.
 *
 * Throws `APIError` if rotation cannot be completed. That is deliberate: the
 * one outcome this card exists to make impossible is a 200 that did nothing,
 * so a rotation we could not finish must not be reported as success.
 */
export async function rotateCallerBearerOnImpersonation(ctx: any): Promise<void> {
  if (ctx?.path !== IMPERSONATE_USER_PATH) return;
  if (!(await impersonationSucceeded(ctx))) return;

  const adminSession = ctx?.context?.session?.session;
  const adminToken: unknown = adminSession?.token;
  const adminUserId: unknown = adminSession?.userId;
  if (typeof adminToken !== 'string' || !adminToken) return;
  if (typeof adminUserId !== 'string' || !adminUserId) return;

  // Bearer callers only, and only when the bearer is what authenticated THIS
  // request. A bearer that failed better-auth's HMAC check never became the
  // session, and rotating on its mere presence would kill a cookie session the
  // caller is legitimately using.
  if (bearerSessionToken(ctx) !== adminToken) return;

  const { APIError } = await import('better-auth/api');
  const { parseSetCookieHeader } = await import('better-auth/cookies');

  const secret = ctx.context.secret;
  const authCookies = ctx.context.authCookies;
  const adminCookie = ctx.context.createAuthCookie(ADMIN_SESSION_COOKIE_KEY);
  // Read the same way the vendor route reads it, so `dontRememberMe` survives
  // the rotation with the meaning the exit path will give it.
  const dontRememberMe = await ctx.getSignedCookie(
    authCookies.dontRememberToken.name,
    secret,
  );

  // ── 1. mint the rotated admin session ───────────────────────────────────
  // Exactly ONE field rides across, deliberately: the active organization the
  // admin had selected, which is the only piece of session state they would
  // notice losing on the way back. Everything else is re-derived for a session
  // minted now — `ipAddress`/`userAgent` from this request, and
  // `activeOrganizationId` itself by ADR-0093 D9's `session.create.before`
  // stamp when the admin had not switched away from their default.
  //
  // Spreading the whole old row here instead would be handing the producer a
  // set of keys nobody reasoned about — a shape an in-memory test double
  // accepts happily and a real ObjectQL insert can refuse. Narrow on purpose.
  const activeOrganizationId = (adminSession as any)?.activeOrganizationId;
  const rotated = await ctx.context.internalAdapter.createSession(
    adminUserId,
    !!dontRememberMe,
    activeOrganizationId ? { activeOrganizationId } : undefined,
    false,
  );
  const rotatedToken: unknown = rotated?.token;
  if (typeof rotatedToken !== 'string' || !rotatedToken || rotatedToken === adminToken) {
    throw new APIError('INTERNAL_SERVER_ERROR', {
      message:
        'Impersonation could not rotate your session and was refused. ' +
        'Nothing was changed; you are still signed in as yourself.',
      code: 'IMPERSONATION_ROTATION_FAILED',
    });
  }

  // ── 2. hand the caller its recovery credential ──────────────────────────
  // Same value shape the vendor parks in the cookie (`<token>:<dontRememberMe>`),
  // signed the same way — so the exit path reads one thing whichever lane it
  // arrived on. Note the signed form is NOT usable as a bearer: everything
  // before the signature is `<token>:<dontRememberMe>`, which matches no
  // session row.
  dropStaleAdminSessionCookie(ctx, adminCookie.name);
  const serialized: string = await ctx.setSignedCookie(
    adminCookie.name,
    `${rotatedToken}:${dontRememberMe || ''}`,
    secret,
    authCookies.sessionToken.attributes,
  );
  const signedValue = parseSetCookieHeader(serialized).get(adminCookie.name)?.value;
  if (!signedValue) {
    throw new APIError('INTERNAL_SERVER_ERROR', {
      message:
        'Impersonation could not issue an admin-session recovery credential and ' +
        'was refused. Nothing was changed; you are still signed in as yourself.',
      code: 'IMPERSONATION_ROTATION_FAILED',
    });
  }
  ctx.setHeader(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER, signedValue);
  exposeResponseHeader(ctx, ADMIN_SESSION_RECOVERY_RESPONSE_HEADER);

  // ── 3. invalidate the token the caller is holding — last ────────────────
  await ctx.context.internalAdapter.deleteSession(adminToken);
}

/**
 * Accept the `admin_session` recovery credential a bearer client replays on
 * `x-admin-session-token`, by writing it into the request's `Cookie` header
 * before better-auth sees the request.
 *
 * The vendor's `/admin/stop-impersonating` then resolves the admin exactly as
 * it always has — this adds a lane, it does not loosen a check. A real
 * `admin_session` cookie still wins, so cookie deployments are untouched, and
 * a bogus recovery value fails the vendor's own session lookup rather than
 * anything of ours.
 *
 * Returns the request unchanged whenever there is nothing to do.
 */
export async function withBearerAdminSessionRecovery(
  request: Request,
  adminSessionCookieName: string,
): Promise<Request> {
  const recovery = request.headers.get(ADMIN_SESSION_RECOVERY_REQUEST_HEADER);
  if (!recovery) return request;
  try {
    const { parseCookies, setRequestCookie } = await import('better-auth/cookies');
    // A deployment whose cookies work already has the credential; do not let a
    // header override the cookie the browser is holding.
    if (parseCookies(request.headers.get('cookie') || '').get(adminSessionCookieName)) {
      return request;
    }
    const headers = new Headers(request.headers);
    setRequestCookie(headers, adminSessionCookieName, recovery);
    return new Request(request, { headers });
  } catch {
    // A request we cannot clone is left alone; the vendor route then answers
    // the same way it does for a missing cookie today.
    return request;
  }
}
