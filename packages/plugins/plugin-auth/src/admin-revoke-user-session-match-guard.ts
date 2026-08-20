// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10069] `POST /admin/revoke-user-session` — a revoke that identifies NO
 * record must not report success.
 *
 * ## The defect, and where it is minted
 *
 * Not here: the wrong answer comes out of the pinned vendor. better-auth
 * `1.7.1` (the installed line, re-read for this card),
 * `dist/plugins/admin/routes.mjs`, `revokeUserSession` runs, after its
 * `session: ["revoke"]` permission check:
 *
 * ```js
 * await ctx.context.internalAdapter.deleteSession(ctx.body.sessionToken);
 * return ctx.json({ success: true });
 * ```
 *
 * There is no match check at all — `deleteSession` on a token matching zero
 * rows deletes nothing and the endpoint answers `200 { success: true }`
 * unconditionally. Measured behaviourally on this repo's real pipeline
 * (AuthManager.handleRequest → better-auth 1.7.1 → ObjectQL adapter) before
 * the guard existed: a zero-match token answered `200 {"success":true}`, and
 * an ALREADY-REVOKED (tombstoned, #7732) token answered `200 {"success":true}`
 * as well. Same "security control no-ops while reporting success" class as the
 * `/revoke-session` guard (`revoke-session-match-guard.ts`), on the surface
 * where a false success matters most: an administrator revoking someone
 * else's session and being told it worked.
 *
 * ## NOT the sibling's predicate
 *
 * `/revoke-session` skips on an ownership mismatch, so its guard reproduces an
 * ownership predicate ("a session of YOURS carries this token"). This admin
 * route deletes blindly — the caller is an admin acting on arbitrary users, so
 * there is no ownership dimension. The admission predicate here is simply:
 * **does any session carry this token** ({@link anySessionCarriesToken}),
 * asked through the same `ctx.context.internalAdapter.findSession` seam the
 * sibling uses. Copying the sibling's ownership predicate would wrongly narrow
 * an admin's legitimate reach to their own sessions.
 *
 * ## Permission is graded BEFORE existence — the vendor's own question first
 *
 * The guard runs in the global `hooks.before`, AHEAD of the vendor's
 * `adminMiddleware` and its `hasPermission` check. Refusing 404 on a
 * zero-match token without first grading the caller would hand every
 * authenticated NON-admin an existence oracle the vendor never gave them
 * (guard-404 for a missing token vs vendor-403 for a live one). So the guard
 * asks the vendor's own permission question first, with the vendor's own
 * inputs, and falls through (to the vendor's 401/403) for any caller the
 * vendor would refuse:
 *
 *  - the caller's session is resolved via `getAuthoritativeSessionFromCtx` —
 *    the exact call the vendor's `adminMiddleware` makes (authoritative on
 *    purpose: never grade a role off the cookie cache);
 *  - the permission predicate ({@link adminMayRevokeUserSessions}) is
 *    better-auth's `has-permission.mjs` `hasPermission`, reproduced line for
 *    line because the vendor does not export it — but asked with the LIVE
 *    admin-plugin options read off `ctx.context.options.plugins` (the object
 *    the vendor itself retains) and with the vendor's own exported
 *    `defaultRoles` from `better-auth/plugins/admin/access` as the fallback,
 *    so `adminUserIds` / `defaultRole` / custom `roles` configured on the
 *    plugin are honoured without a second source of truth. (This repo's
 *    composition passes none of the three — `auth-manager.ts` constructs
 *    `admin({ schema })` only — and the integration tests pin both drift
 *    directions: a mirror gone loose answers this guard's 404 where the
 *    vendor's 403 belongs, a mirror gone strict resurfaces the vendor's false
 *    success.)
 *
 * ## The refusal shape
 *
 * **404 `RESOURCE_NOT_FOUND`** (ADR-0112: code AND status), for the same three
 * reasons recorded in `revoke-session-match-guard.ts`: `res.ok` callers,
 * DELETE-like semantics on an unidentifiable resource, and the standard
 * catalog member over a synonym extension.
 *
 * ## The existence-oracle question, RE-DECIDED for this surface
 *
 * The sibling made zero-match and foreign-token answers byte-identical to
 * avoid an existence oracle, because its caller is an arbitrary user. Here the
 * refusal is deliberately allowed to reveal "no session carries this token" —
 * but ONLY to callers who pass the vendor's own `session: ["revoke"]`
 * permission check. That caller class is already entitled to session
 * existence knowledge: the same default `admin` role statement grants
 * `session: ["list"]`, i.e. `/admin/list-user-sessions` over arbitrary users,
 * so the 404 tells an entitled admin nothing they cannot already query
 * directly. For everyone else the guard is silent by construction (permission
 * graded first), so the unauthenticated and unauthorized surfaces keep the
 * vendor's exact refusals (401 / 403) with no existence dimension. There is
 * no foreign-vs-missing pair to collapse on this route — any live session is
 * legitimately deletable by an entitled admin; only "no session at all" is
 * refused.
 *
 * ## What the guard deliberately does NOT decide
 *
 *  - **Unauthenticated / unresolvable callers fall through** — the vendor's
 *    `adminMiddleware` owns the 401.
 *  - **Callers its permission mirror refuses fall through** — the vendor's
 *    `hasPermission` owns the 403 (including the seeded platform admin whose
 *    `role` scalar is not `admin`, #9482 — this guard must not change that
 *    surface's recorded behaviour).
 *  - **A non-string `sessionToken` falls through** — the endpoint's zod body
 *    schema answers the 400.
 *  - **An adapter read failure falls through** — never convert "I could not
 *    look" into "it does not exist".
 *
 * ## Interaction with session tombstones (#7732)
 *
 * This route is in `INTERACTIVE_REVOKE_REASON` with reason `admin`, and
 * `hideRevokedSessionRow` makes a tombstoned row invisible to
 * `internalAdapter.findSession`. So revoking an ALREADY-REVOKED token now
 * answers 404 — consistent with the tombstone module's doctrine ("a revoked
 * session is not a session") and with the sibling guard; previously it was a
 * silent `{ success: true }` no-op (measured, see above). The admitted path
 * still tombstones with reason `admin`, untouched.
 *
 * ## Scope
 *
 * The SINGULAR route only. `/admin/revoke-user-sessions` (plural) matches by
 * user id and cannot mis-identify a single record — zero sessions to sweep is
 * genuinely "nothing to do", exactly the reason the sibling left its own
 * plural routes untouched.
 */

/** The refusal's wire code — standard catalog (ADR-0112), see header. */
export const ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE = 'RESOURCE_NOT_FOUND';

/**
 * The refusal's message. Deliberately NOT the sibling's "of yours" wording —
 * this route has no ownership dimension (see header).
 */
export const ADMIN_REVOKE_USER_SESSION_NOT_FOUND_MESSAGE =
  'No session matches the supplied token.';

/**
 * The permission the vendor's handler demands — `revokeUserSession` calls
 * `hasPermission({ …, permissions: { session: ["revoke"] } })`.
 */
export const ADMIN_REVOKE_USER_SESSION_PERMISSION: Readonly<Record<string, readonly string[]>> = {
  session: ['revoke'],
};

/** The vendor's `AccessControl` role shape, as much of it as the mirror reads. */
type AuthorizingRole = {
  authorize?: (permissions: unknown) => { success?: boolean } | undefined;
};

/**
 * better-auth's admin-plugin `hasPermission` (dist/plugins/admin/
 * has-permission.mjs), reproduced because the vendor does not export it. The
 * inputs are the vendor's own: `user` is the authoritative session's user,
 * `adminOptions` is the LIVE options object retained on the mounted admin
 * plugin, `fallbackRoles` is the vendor's exported `defaultRoles`. Anything
 * unreadable grades as not-permitted, which only ever means "fall through to
 * the vendor's own refusal" — never a refusal minted here.
 */
export function adminMayRevokeUserSessions(
  user: unknown,
  adminOptions: unknown,
  fallbackRoles: Record<string, AuthorizingRole | undefined>,
): boolean {
  const u = (user ?? {}) as { id?: unknown; role?: unknown };
  const opts = (adminOptions ?? {}) as {
    adminUserIds?: unknown;
    defaultRole?: unknown;
    roles?: unknown;
  };
  const userId = u.id == null ? '' : String(u.id);
  if (
    userId &&
    Array.isArray(opts.adminUserIds) &&
    opts.adminUserIds.some((x) => String(x) === userId)
  ) {
    return true;
  }
  const roleSource =
    (typeof u.role === 'string' && u.role) ||
    (typeof opts.defaultRole === 'string' && opts.defaultRole) ||
    'user';
  const acRoles: Record<string, AuthorizingRole | undefined> =
    opts.roles && typeof opts.roles === 'object'
      ? (opts.roles as Record<string, AuthorizingRole | undefined>)
      : fallbackRoles;
  for (const role of roleSource.split(',')) {
    try {
      if (acRoles[role]?.authorize?.(ADMIN_REVOKE_USER_SESSION_PERMISSION)?.success) return true;
    } catch {
      // an authorizer that throws grades as not-permitted — the vendor's own
      // call would throw the same way one moment later, on its own path.
    }
  }
  return false;
}

/**
 * The admission predicate: does `found` (the `internalAdapter.findSession`
 * result) name ANY session? Shape-tolerant like the sibling's — `findSession`
 * answers `{ session, user }` or `null`, and anything without a readable
 * `session` is "no match", which is also what the vendor's `deleteSession`
 * would have made of it (deletes nothing).
 */
export function anySessionCarriesToken(found: unknown): boolean {
  const session = (found as { session?: unknown } | null | undefined)?.session;
  return session != null && typeof session === 'object';
}
