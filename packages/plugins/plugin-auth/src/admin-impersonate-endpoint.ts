// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /admin/impersonate-user`, re-authorized on the ADR-0068 D2 platform-admin
 * predicate — as a better-auth **plugin endpoint**, never a raw Hono mount.
 *
 * ## Why this file is not `admin-ban-endpoints.ts`
 *
 * Every other ObjectStack `/admin/*` route is a raw Hono mount carrying
 * `judgePlatformAdmin` (see `platform-admin-gate.ts`). Ban/unban re-implement
 * that way cleanly because they are DATA WRITES: two `internalAdapter` calls
 * each, nothing about the caller's own session changes.
 *
 * Impersonation is not a data write. It mints a session and rewrites cookies
 * using helpers that exist ONLY inside a better-auth endpoint context —
 * `ctx.getSignedCookie` / `ctx.setSignedCookie` against `ctx.context.secret`,
 * `ctx.context.createAuthCookie`, `deleteSessionCookie(ctx)`,
 * `setSessionCookie(ctx, …)`. A raw mount has none of them, so re-implementing
 * there means hand-rolling better-auth's signed-cookie format. And the exact
 * `admin_session` payload is a CONTRACT with `/admin/stop-impersonating`, which
 * parses `adminCookie.split(':')` and answers 500 if the shape is off: a subtly
 * wrong signature is either a broken exit path or a forgeable cookie.
 *
 * Second, independent reason — and the one no test would have caught. Shadowing
 * a vendor path with a raw mount silently detaches every better-auth hook keyed
 * on that path. `/admin/impersonate-user` carries one:
 * `rotateCallerBearerOnImpersonation` (#8243) in `auth-manager.ts`'s global
 * `hooks.after`. Without it, `bearer()` converts the caller's token back into
 * the ADMIN's session on every later request and impersonation is a silent 200
 * no-op. A raw mount would reintroduce #8243 with nothing turning red.
 *
 * ⛔ A raw Hono mount for this route is FORBIDDEN (maintainer ruling,
 * 2026-08-20). This module is the shape that ruling names.
 *
 * ## The measurement this shape rests on
 *
 * Whether better-auth 1.7.1 permits overriding a path another plugin registers
 * was explicitly UNMEASURED when this was ruled. Measured now, on the installed
 * `better-auth@1.7.1`:
 *
 *  - `checkEndpointConflicts` (`dist/api/index.mjs`) builds its registry by
 *    iterating `options.plugins[].endpoints` and, on a duplicate path+method,
 *    calls `logger.error(...)` — it does **not** throw. A second plugin
 *    registering `/admin/impersonate-user` therefore BOOTS, serves, and prints
 *    `Endpoint path conflicts detected!` on every start.
 *  - `getEndpoints` merges with `{...acc, ...plugin.endpoints}` (key-keyed), and
 *    `better-call`'s router calls rou3 `addRoute` per endpoint in object order,
 *    where a later entry for the same method+path REPLACES the earlier one.
 *
 * So a second plugin works but is permanently noisy. This module takes the
 * strictly better door the same measurement opens: it replaces the endpoint
 * **on the admin plugin's own `endpoints` record**, so exactly ONE plugin ever
 * registers the path. `checkEndpointConflicts` sees one entry, logs nothing,
 * and the route is served by an endpoint built with `createAuthEndpoint` —
 * inside the endpoint context, with every cookie helper and `$context` present,
 * on the same path, so the #8243 hook still fires.
 *
 * ## What actually changed vs. the vendor handler
 *
 * The endpoint is rebuilt from the vendor endpoint's OWN `options` object
 * (`method`, `body` schema, `use: [adminMiddleware, …]`, `metadata`), passed
 * through untouched. So the request contract, the 401-for-anonymous, the
 * OpenAPI entry and the body validation are the vendor's, and they cannot drift
 * from it on a dependency bump — there is no second copy to drift.
 *
 * Only the AUTHORIZATION changes, in the two places the vendor asks it:
 *
 *  1. **Caller.** `hasPermission({ role: session.user.role, … })` → the ADR-0068
 *     D2 predicate. The vendor's only two authorization inputs are a
 *     construction-time `adminUserIds` array and the persisted legacy `role`
 *     scalar; ObjectStack's platform admin is neither (it is a
 *     `sys_user_permission_set` row pointing at `admin_full_access` with
 *     `organization_id = null`), and ADR-0068 D2 forbids synthesizing the
 *     scalar the vendor can read. That mismatch is the whole defect: a platform
 *     admin and a plain member receive byte-identical
 *     `403 YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS`.
 *
 *  2. **Target.** The vendor refuses to impersonate an admin-grade target by
 *     reading `targetUser.role` against `adminRoles` (default `['admin']`).
 *     On any post-ADR-0068-D2 deployment NOTHING writes that scalar, so that
 *     guard is INERT — "you cannot impersonate admins" is currently a promise
 *     the code does not keep. It is re-asked here through the same ADR-0068
 *     predicate, so it means something again.
 *
 * Direction matters and is asserted in both: the caller set only ever GROWS by
 * platform admins (the legacy `role === 'admin'` reading is retained exactly as
 * `platform-admin-gate.ts` retains it, so a deployment still carrying the
 * pre-D2 scalar is not locked out), and the protected-target set only ever
 * GROWS. Neither predicate admits anyone the vendor admitted and we now refuse,
 * and neither refuses anyone the vendor admitted.
 *
 * ⛔ The vendor's `allowImpersonatingAdmins` / `impersonate-admins` escape is
 * deliberately NOT carried over: ObjectStack constructs `admin({ schema })` and
 * configures neither, and the escape's own check reads the same dead scalar.
 * Re-adding it would be adding a door nothing asked for.
 *
 * ## Refusal envelope — the vendor's, on purpose
 *
 * These refusals keep better-auth's flat `{ message, code }` shape and the
 * vendor's OWN code constants, read off the plugin's `$ERROR_CODES` rather than
 * retyped. This route is a better-auth endpoint, not an ObjectStack raw mount,
 * and the dogfood sweep distinguishes the two envelopes on purpose (see
 * `admin-ban-endpoints.ts`). Keeping them also mints no new public error code,
 * so nothing here reaches the spec error-code ledger.
 */

import { isPlatformAdminUser } from './platform-admin-gate.js';
import { IMPERSONATE_USER_PATH, ADMIN_SESSION_COOKIE_KEY } from './impersonation-bearer-rotation.js';

/**
 * Answers ADR-0068 D2's "is this user id a platform admin?" — a
 * `sys_user_permission_set` row pointing at `admin_full_access` with
 * `organization_id = null`.
 *
 * Injected rather than imported so this module never reaches for a data engine
 * itself. MUST fail CLOSED (resolve `false`) on any lookup error: it backs a
 * security gate, and an unverifiable actor must never pass.
 */
export type PlatformAdminOracle = (userId: string) => Promise<boolean>;

/** The slice of better-auth's `admin` plugin this module rewrites. */
export interface AdminPluginLike {
  id: string;
  endpoints: Record<string, any>;
  $ERROR_CODES?: Record<string, { code: string; message: string }>;
}

/**
 * Impersonation session lifetime, seconds — the vendor's default for a plugin
 * constructed WITHOUT `impersonationSessionDuration`, which is how
 * `auth-manager.ts` constructs it (`admin({ schema })`). Pinned rather than
 * inherited because the vendor never exposes the resolved option.
 */
export const IMPERSONATION_SESSION_SECONDS = 3600;

/**
 * better-auth's `BASE_ERROR_CODES.USER_NOT_FOUND`, restated locally.
 *
 * ⛔ NOT read from `import('better-auth')` — that is the package ROOT entry, and
 * pulling it in here makes admin-plugin CONSTRUCTION depend on it. Several
 * suites in this package mock the root (`vi.mock('better-auth', …)`) to capture
 * the `betterAuth()` config, and vitest THROWS on a missing export from a
 * mocked module. Measured: the whole `admin` plugin was then swallowed by
 * `addOptionalPlugin`'s catch and silently disabled — a plugin lost to a
 * constant. The subpath entries this module does import
 * (`better-auth/api|cookies|db`) are not mocked anywhere and stay real.
 *
 * A restated constant is only safe if it cannot drift, so it does not rely on
 * being remembered: `admin-impersonate-endpoint.test.ts` pins it equal to the
 * vendor's own value, and a vendor rename turns that red.
 */
export const USER_NOT_FOUND = { code: 'USER_NOT_FOUND', message: 'User not found' } as const;

/**
 * Replace `admin`'s `/admin/impersonate-user` with the ADR-0068-authorized
 * endpoint, in place, on the plugin's own `endpoints` record.
 *
 * Returns the SAME plugin object (mutated), so the plugin's id, schema, hooks,
 * `$ERROR_CODES` and every other endpoint stay exactly as the vendor built
 * them, and only one plugin ever claims the path.
 *
 * A vendor bump that renames or drops the endpoint leaves the plugin untouched
 * and reports `false` — loudly handled by the caller — rather than silently
 * adding a second endpoint nobody routes to.
 */
export async function applyPlatformAdminImpersonation(
  plugin: AdminPluginLike,
  isPlatformAdmin: PlatformAdminOracle,
): Promise<boolean> {
  const vendor = plugin?.endpoints?.impersonateUser;
  if (!vendor || vendor.path !== IMPERSONATE_USER_PATH || !vendor.options) return false;

  const [{ createAuthEndpoint, APIError }, { deleteSessionCookie, setSessionCookie }, { parseUserOutput }] =
    await Promise.all([
      import('better-auth/api'),
      import('better-auth/cookies'),
      import('better-auth/db'),
    ]);

  const ERR = plugin.$ERROR_CODES ?? {};
  const notAllowed = ERR.YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS ?? {
    code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
    message: 'You are not allowed to impersonate users',
  };
  const cannotImpersonateAdmins = ERR.YOU_CANNOT_IMPERSONATE_ADMINS ?? {
    code: 'YOU_CANNOT_IMPERSONATE_ADMINS',
    message: 'You cannot impersonate admins',
  };
  const failedToCreate = ERR.FAILED_TO_CREATE_USER ?? {
    code: 'FAILED_TO_CREATE_USER',
    message: 'Failed to create user',
  };

  // The vendor's own options object — method, body schema, `use`
  // (adminMiddleware: authoritative session or 401) and OpenAPI metadata — is
  // handed straight back to `createAuthEndpoint`. Nothing about the request
  // contract is retyped here, so nothing about it can drift.
  plugin.endpoints.impersonateUser = createAuthEndpoint(
    IMPERSONATE_USER_PATH,
    vendor.options,
    async (ctx: any) => {
      const caller = ctx.context.session?.user;
      const callerId = typeof caller?.id === 'string' ? caller.id : '';

      // ── THE changed predicate (1/2): who may impersonate ─────────────────
      // `isPlatformAdminUser` reads the session user we already hold — which
      // inside an endpoint is the RAW row (better-auth's `adminMiddleware`
      // re-reads the session from the database with the cookie cache disabled,
      // so `customSession`'s derived `positions[]` / `isPlatformAdmin` are NOT
      // on it). It therefore contributes only the legacy `role === 'admin'`
      // back-compat reading, and the oracle does the real ADR-0068 lookup.
      const callerAdmitted =
        isPlatformAdminUser(caller) || (callerId ? await isPlatformAdmin(callerId) : false);
      if (!callerAdmitted) throw APIError.from('FORBIDDEN', notAllowed);

      const targetUser = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
      if (!targetUser) throw APIError.from('NOT_FOUND', USER_NOT_FOUND);

      // ── THE changed predicate (2/2): who is protected FROM impersonation ──
      // Same question the vendor asks against `adminRoles`, asked so it is not
      // inert after ADR-0068 D2 stopped writing the scalar it read.
      const targetId = typeof targetUser.id === 'string' ? targetUser.id : String(targetUser.id);
      const targetProtected =
        isPlatformAdminUser(targetUser) || (await isPlatformAdmin(targetId));
      if (targetProtected) throw APIError.from('FORBIDDEN', cannotImpersonateAdmins);

      // ── everything below is the vendor handler, unchanged ────────────────
      const session = await ctx.context.internalAdapter.createSession(
        targetUser.id,
        true,
        {
          impersonatedBy: callerId,
          expiresAt: new Date(Date.now() + IMPERSONATION_SESSION_SECONDS * 1000),
        },
        true,
      );
      if (!session) throw APIError.from('INTERNAL_SERVER_ERROR', failedToCreate);

      const authCookies = ctx.context.authCookies;
      deleteSessionCookie(ctx);
      const dontRememberMeCookie = await ctx.getSignedCookie(
        authCookies.dontRememberToken.name,
        ctx.context.secret,
      );
      const adminCookieProp = ctx.context.createAuthCookie(ADMIN_SESSION_COOKIE_KEY);
      await ctx.setSignedCookie(
        adminCookieProp.name,
        `${ctx.context.session.session.token}:${dontRememberMeCookie || ''}`,
        ctx.context.secret,
        authCookies.sessionToken.attributes,
      );
      await setSessionCookie(ctx, { session, user: targetUser }, true);

      return ctx.json({
        session,
        user: parseUserOutput(ctx.context.options, targetUser),
      });
    },
  );

  return true;
}
