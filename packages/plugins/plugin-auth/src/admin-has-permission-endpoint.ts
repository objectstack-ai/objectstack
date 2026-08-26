// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11900] `POST /admin/has-permission` — answer a platform admin's permission
 * QUERY from the ADR-0068 predicate, not the retired legacy scalar.
 *
 * ## The defect this shades away
 *
 * better-auth's `admin` plugin evaluates `hasPermission` against the legacy
 * `user.role === 'admin'` scalar (this repo constructs `admin({ schema })`
 * only, so the vendor default `adminRoles: ['admin']` applies), and ADR-0068
 * D2 deliberately stopped synthesizing that scalar. So the vendor's own
 * permission-query endpoint told a genuine ObjectStack platform admin "no" —
 * a `200 {"success":false}` byte-identical to a plain member's answer. Unlike
 * the `403`s of the #9652 family this is not a visible refusal: it is an
 * authoritative-looking WRONG ANSWER, and any caller that trusts it gets
 * wrong permission logic with no error to log. Maintainer ruling 2026-08-25
 * (option B per the card body's lettering): shade the route with the #9652
 * raw-mount pattern and answer from the ADR-0068 predicate, so a platform
 * admin's query returns the answer real execution would give.
 *
 * ## What the shading changes, and the ONE row it changes
 *
 * The raw mount in `auth-plugin.ts` intercepts the route ahead of the
 * catch-all and takes over EXACTLY ONE row of the behaviour table: a caller
 * who is a platform admin under ADR-0068 (`isPlatformAdminUser`, the same
 * predicate every shaded `/admin/*` mount trusts) sending a body the vendor's
 * own handler would EVALUATE. Every other caller and every other body shape
 * is DELEGATED through `AuthManager.handleRequest` — the #12029 gate-then-
 * delegate seam — so the vendor's native bytes stand: an anonymous caller
 * still gets the enveloped 401, a plain member still gets its own
 * `200 {"error":null,"success":false}` negative (pinned by the non-admin
 * dogfood sweep — a `true` there would be the leak), and a malformed body
 * still gets the vendor's own 400, in the vendor's own validation order.
 *
 * ## The answer is the vendor's own evaluation with the IDENTITY fixed
 *
 * ⛔ Not `success: true` unconditionally. The predicate decides WHO is an
 * admin; the vendor's access-control statements still decide WHAT an admin
 * may do, exactly as they would for a caller carrying the legacy scalar. The
 * evaluation mirrors the vendor's `hasPermission` (`dist/plugins/admin/
 * has-permission.mjs`, reproduced because the vendor does not export a
 * server-side entry for it — the same reading `admin-revoke-user-session-
 * match-guard.ts` records) with the role input replaced: instead of the
 * caller's stored `role` scalar, the roles the mounted plugin counts as admin
 * (`adminRoles`, default `['admin']`) are evaluated over the live plugin's
 * role table (`roles`, default: the vendor's exported `defaultRoles`). So a
 * granted statement answers `true`, and a permission set the vendor's admin
 * role does NOT grant — an unknown resource, an ungranted action — still
 * answers `false`, exactly as it would to a legacy-scalar admin. Answering
 * `true` to everything would replace one wrong-200 with another.
 *
 * ## Fail direction
 *
 * Two of the three uncertainties delegate: an unreadable body and a shape
 * outside the set the vendor evaluates. Delegation can only reproduce the
 * vendor's measured native behaviour — it can never mint a `true` for a
 * caller the predicate did not admit. The only path to `success: true` runs
 * through `isPlatformAdminUser` (or the vendor's own `adminUserIds`
 * short-circuit, mirrored below for option fidelity; this repo configures
 * none).
 *
 * The third — an unreadable live-options object — does NOT delegate. It is
 * caught in {@link answerPermissionQueryAsAdmin}, `adminOptions` becomes
 * `undefined`, and the evaluation answers from the vendor's exported
 * `defaultRoles` with `adminRoles = ['admin']`: on that path the
 * deployment's own `roles` / `adminRoles` are not the ones read. It is
 * reached only after `isPlatformAdminUser` has already admitted the caller,
 * so it still cannot answer for a caller the predicate refused.
 *
 * ## Why the evaluated-body set is spelled out here
 *
 * If this module's acceptance were LOOSER than the vendor's, a platform
 * admin would get `success: true` for a body the vendor refuses as invalid —
 * a new wrong-200 in the opposite direction. If it were STRICTER, the
 * delegated remainder would answer that admin from the legacy scalar — the
 * very defect this module exists to close, resurfacing on the excluded
 * shapes. So {@link readEvaluatedPermissionQuery} mirrors, key for key, the
 * set of bodies the installed vendor handler actually evaluates (zod schema
 * AND the handler's own `permissions` guard), and the integration test pins
 * both directions.
 */

/** What the evaluator needs from the plugin — the LIVE better-auth context. */
export interface AdminHasPermissionDeps {
  /**
   * `AuthManager.getAuthContext()` — better-auth's own `$context`, whose
   * `options.plugins` entry for `id: 'admin'` retains the very options object
   * the mounted plugin runs on. Read live so `adminUserIds` / `adminRoles` /
   * custom `roles` configured on the plugin are honoured without a second
   * source of truth (the `admin-revoke-user-session-match-guard.ts`
   * discipline).
   */
  getAuthContext(): Promise<unknown>;
}

/** The wire answer shape — the vendor's own, key order included. */
export interface AdminHasPermissionAnswer {
  error: null;
  success: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The permission-query bodies the installed vendor handler EVALUATES, and no
 * others (see the header for why both directions matter). Measured on
 * better-auth 1.7.1 (`dist/plugins/admin/routes.mjs`, `userHasPermission`):
 *
 *  - the zod body schema is `{ userId?: coerce.string, role?: string }`
 *    intersected with `xor(permission | permissions)`, each a
 *    `Record<string, string[]>` — so `permission` AND `permissions` together
 *    fail validation (400), and a non-string action element fails too;
 *  - the handler then evaluates ONLY `body.permissions` (plural): a
 *    singular-`permission` body passes zod but dies on the handler's own
 *    `no permission(s) were passed` 400 before any evaluation;
 *  - `userId` cannot fail coercion for any JSON value and is DEAD on the wire
 *    (the resolved session always wins in the vendor's own handler), so it is
 *    ignored here for the same reason;
 *  - `role` is read by the vendor only when NO session resolved, which cannot
 *    happen on this branch (the mount resolved one) — but a non-string `role`
 *    still fails zod ahead of that, so it must fail here too.
 *
 * Returns the `permissions` record to evaluate, or `undefined` for "not a
 * body the vendor evaluates — delegate, and let the vendor answer with its
 * own validation bytes".
 */
export function readEvaluatedPermissionQuery(
  body: unknown,
): Record<string, readonly string[]> | undefined {
  if (!isPlainObject(body)) return undefined;
  if ('permission' in body) return undefined; // xor half, or handler-400 — vendor's answer either way
  if ('role' in body && typeof body.role !== 'string') return undefined;
  const permissions = body.permissions;
  if (!isPlainObject(permissions)) return undefined;
  for (const actions of Object.values(permissions)) {
    if (!Array.isArray(actions)) return undefined;
    if (!actions.every((a) => typeof a === 'string')) return undefined;
  }
  return permissions as Record<string, readonly string[]>;
}

/** The vendor's `AccessControl` role shape, as much of it as the mirror reads. */
type AuthorizingRole = {
  authorize?: (permissions: unknown) => { success?: boolean } | undefined;
};

/**
 * Answer the query as the vendor would answer a caller carrying the plugin's
 * admin role(s) — the vendor's own `hasPermission` with only the identity
 * signal replaced (see header). `callerUserId` feeds the vendor's
 * `adminUserIds` short-circuit, mirrored for option fidelity.
 */
export async function answerPermissionQueryAsAdmin(
  deps: AdminHasPermissionDeps,
  callerUserId: string,
  permissions: Record<string, readonly string[]>,
): Promise<AdminHasPermissionAnswer> {
  let adminOptions: Record<string, unknown> | undefined;
  try {
    const ctx = (await deps.getAuthContext()) as {
      options?: { plugins?: Array<{ id?: string; options?: Record<string, unknown> }> };
    } | null;
    adminOptions = (Array.isArray(ctx?.options?.plugins) ? ctx.options.plugins : []).find(
      (p) => p?.id === 'admin',
    )?.options;
  } catch {
    // Unreadable live options → evaluate on the vendor's exported defaults
    // (`defaultRoles`, `adminRoles = ['admin']`) instead of this deployment's
    // configured ones. This path answers; it does not delegate (see the
    // header's "Fail direction").
    adminOptions = undefined;
  }
  const opts = (adminOptions ?? {}) as {
    adminUserIds?: unknown;
    adminRoles?: unknown;
    roles?: unknown;
  };

  // The vendor's first line, verbatim in spirit: adminUserIds are admins for
  // ANY query. (This repo configures none; mirrored so a deployment that does
  // gets the vendor's own answer, not a stricter one.)
  if (
    callerUserId &&
    Array.isArray(opts.adminUserIds) &&
    opts.adminUserIds.some((x) => String(x) === callerUserId)
  ) {
    return { error: null, success: true };
  }

  const { defaultRoles } = await import('better-auth/plugins/admin/access');
  const acRoles: Record<string, AuthorizingRole | undefined> =
    opts.roles && typeof opts.roles === 'object'
      ? (opts.roles as Record<string, AuthorizingRole | undefined>)
      : (defaultRoles as unknown as Record<string, AuthorizingRole | undefined>);
  // `adminRoles?: string | string[]`, comma-splittable when a string — the
  // vendor's own normalization (`admin.mjs`), default `['admin']`.
  const adminRoles = Array.isArray(opts.adminRoles)
    ? opts.adminRoles.map((r) => String(r))
    : typeof opts.adminRoles === 'string'
      ? opts.adminRoles.split(',')
      : ['admin'];

  let success = false;
  for (const role of adminRoles) {
    try {
      if (acRoles[role]?.authorize?.(permissions)?.success) {
        success = true;
        break;
      }
    } catch {
      // An authorizer that throws grades as not-permitted — the same reading
      // the revoke-guard mirror records.
    }
  }
  return { error: null, success };
}
