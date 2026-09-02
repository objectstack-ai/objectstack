// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Admin ban / unban endpoints — ObjectStack raw mounts carrying the ADR-0068
 * platform-admin gate, shadowing better-auth's native `/admin/ban-user` and
 * `/admin/unban-user`.
 *
 *   POST /api/v1/auth/admin/ban-user    — ban a user, revoking their sessions
 *   POST /api/v1/auth/admin/unban-user  — lift a ban
 *
 * They join `create-user` / `set-user-password` / `unlock-user` /
 * `import-users` / `oauth2/toggle-disabled`, which are ObjectStack mounts for
 * the same reason.
 *
 * ── WHY these are re-implemented rather than configured (the measurement) ────
 *
 * better-auth's `admin` plugin authorizes every `/admin/*` route through
 * `hasPermission({ userId, role, options, permissions })`, whose only two
 * authorization inputs are:
 *
 *   1. `options.adminUserIds` — a `string[]` frozen into the plugin's options
 *      object at CONSTRUCTION time; and
 *   2. `session.user.role` — the persisted legacy scalar.
 *
 * ObjectStack's platform-admin predicate is neither: it is a per-request read
 * of `sys_user_permission_set` for a row pointing at `admin_full_access` with
 * `organization_id = null`. A construction-time id array cannot express a
 * predicate that changes while the process runs, and every trick to make the
 * array dynamic either grants a demoted admin a stale pass (fail-OPEN — the
 * one direction that turns a broken-capability bug into a security bug) or
 * needs an async answer where the vendor calls a synchronous one.
 *
 * And the remaining door — synthesizing the role onto the SESSION-scoped user
 * object at request time, without persisting anything — is mechanically shut
 * on the installed version: every one of these routes mounts `adminMiddleware`,
 * which calls `getAuthoritativeSessionFromCtx`, which on any deployment with a
 * `database` (i.e. every ObjectStack deployment) sets `ctx.context.session =
 * null` and re-reads the session from the DB with the cookie cache disabled.
 * Anything ObjectStack writes onto the in-memory session user is discarded
 * before `hasPermission` ever sees it. `customSession` is not a door either —
 * it overrides the `/get-session` ENDPOINT, not the session the admin routes
 * resolve internally.
 *
 * So the vendor cannot be pointed at the predicate, and ADR-0068 D2 forbids
 * producing the scalar it can be pointed at. Re-implementation is what is left
 * (maintainer ruling 2026-08-18: Option 1 if the vendor can express it, else
 * Option 2; re-synthesizing `user.role = 'admin'` is permanently vetoed).
 *
 * ── Fidelity to the handler being shadowed ──────────────────────────────────
 *
 * The writes mirror better-auth's own handlers field for field — `banned` /
 * `banReason` / `banExpires` / `updatedAt`, then `deleteUserSessions` — so a
 * banned user is signed out and refused at sign-in by the vendor's OWN session
 * hook (`BANNED_USER`), which is untouched. The default ban reason is
 * `'No reason'` because ObjectStack configures no `defaultBanReason`.
 *
 * ⚠️ Shadowing a vendor route detaches every better-auth hook keyed on its
 * path. `/admin/ban-user` carried one: the break-glass last-local-credential
 * guard in `auth-manager.ts`. It is re-run here from the shared module
 * (`last-local-credential.ts`) rather than reimplemented — see that file's
 * header for why it is a module now.
 *
 * The refusal envelope is ObjectStack's (ADR-0112 `{success,error:{code}}`),
 * NOT better-auth's flat `{message,code}`: these routes are ObjectStack's, and
 * the dogfood sweep distinguishes the two envelopes on purpose.
 */

import {
  isLastLocalCredentialHolder,
  LAST_LOCAL_CREDENTIAL_CODE,
  LAST_LOCAL_CREDENTIAL_MESSAGE,
  type CredentialAccountAdapter,
} from './last-local-credential.js';
import type { AdminActor, EndpointResult } from './admin-user-endpoints.js';

/**
 * Minimal better-auth `$context` surface these two routes touch. Mirrors what
 * the stock handlers use, minus their role check (the mount gates instead).
 */
export interface AuthBanContextLike {
  internalAdapter: {
    findUserById(id: string): Promise<unknown | null>;
    updateUser(id: string, data: Record<string, unknown>): Promise<unknown>;
    deleteUserSessions(userId: string): Promise<unknown>;
  };
  adapter: CredentialAccountAdapter;
}

export interface AdminBanEndpointDeps {
  getAuthContext(): Promise<AuthBanContextLike>;
}

/**
 * [#14360] The `sys_user` ban write, as ONE callable both ban paths share.
 *
 * Two callers land a disable on this platform: the `/admin/ban-user` mount
 * below, and — since `@better-auth/scim` 1.7.0 stopped writing `banned`
 * itself and handed the host an `identity.reconcileUser` callback instead —
 * the SCIM `active: false` deprovisioning hook in `auth-manager.ts`
 * (`reconcileScimUserLifecycle`). Field for field this is the write
 * better-auth's own `banUser` handler makes (`banned` / `banReason` /
 * `banExpires` / `updatedAt`), so the vendor's `session.create` hook
 * (`BANNED_USER`) enforces both halves identically. The break-glass
 * last-administrator guard (ADR-0024 D5.2, `last-admin-guard.ts`) judges the
 * write at the ENGINE, so it holds on both callers by construction — neither
 * can reach the column without passing it.
 *
 * `UserBanWriter` is the narrowest surface the write needs, and both callers
 * already hold one: better-auth's `internalAdapter` satisfies it directly; the
 * SCIM hook adapts the vendor's transaction-bound `DBTransactionAdapter`, so
 * its write commits — or rolls back — with the SCIM mutation it belongs to.
 *
 * Session revocation is deliberately NOT part of the write: the admin mount
 * revokes explicitly (below), and the SCIM vendor revokes after its callback
 * returns (`deleteUserSessions` on `active: false`, measured on 1.7.2).
 */
export interface UserBanWriter {
  updateUser(id: string, data: Record<string, unknown>): Promise<unknown>;
}

/**
 * The reason the SCIM deactivation path stamps on the row — the exact string
 * `@better-auth/scim` wrote itself through 1.6.x
 * (`resolveSCIMActiveDeactivation`, `dist/index.mjs` at 1.6.30), kept verbatim
 * so a row the vendor banned before the 1.7.0 decoupling and a row the host
 * hook bans are the same fact. It is also how the reactivation half
 * recognises its OWN ban: an `active: true` from the IdP lifts a ban carrying
 * this reason and leaves an administrator's ban (any other reason) in place.
 */
export const SCIM_DEACTIVATION_BAN_REASON = 'Deactivated via SCIM';

export interface UserBanFields {
  banReason: string;
  /** `undefined` leaves the column untouched; `null` clears a prior expiry. */
  banExpires?: Date | null;
}

/** Disable `userId` — the vendor-shaped ban write, on whichever writer the caller is inside. */
export async function applyUserBan(
  writer: UserBanWriter,
  userId: string,
  ban: UserBanFields,
): Promise<void> {
  await writer.updateUser(userId, {
    banned: true,
    banReason: ban.banReason,
    ...(ban.banExpires !== undefined ? { banExpires: ban.banExpires } : {}),
    updatedAt: new Date(),
  });
}

/** Re-enable `userId` — clears the three ban columns, exactly as the vendor's `unbanUser` does. */
export async function applyUserUnban(writer: UserBanWriter, userId: string): Promise<void> {
  await writer.updateUser(userId, {
    banned: false,
    banReason: null,
    banExpires: null,
    updatedAt: new Date(),
  });
}

const invalid = (message: string): EndpointResult => ({
  status: 400,
  body: { success: false, error: { code: 'INVALID_REQUEST', message } },
});

const notFound = (): EndpointResult => ({
  status: 404,
  body: { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found' } },
});

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Read the target user id. Both spellings are accepted because the console's
 * `recordIdParam: 'userId'` sends the camelCase one while the shadowed
 * ObjectStack siblings (`unlock-user`) have always also read `user_id`.
 */
function readUserId(body: Record<string, unknown>): string | undefined {
  const raw = body.userId ?? body.user_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** `POST /api/v1/auth/admin/ban-user` — the caller is already gated. */
export async function runAdminBanUser(
  deps: AdminBanEndpointDeps,
  actor: AdminActor,
  request: Request,
): Promise<EndpointResult> {
  const body = await parseJson(request);
  const userId = readUserId(body);
  if (!userId) return invalid('userId is required');

  // Same refusal better-auth makes (`YOU_CANNOT_BAN_YOURSELF`): an admin who
  // bans themselves is immediately signed out and cannot undo it.
  if (userId === actor.id) return invalid('You cannot ban yourself');

  const banReason =
    typeof body.banReason === 'string' && body.banReason.length > 0 ? body.banReason : 'No reason';

  // Seconds until the ban lifts; absent means it never expires.
  let banExpires: Date | undefined;
  if (body.banExpiresIn !== undefined) {
    const seconds = Number(body.banExpiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return invalid('banExpiresIn must be a positive number of seconds');
    }
    banExpires = new Date(Date.now() + seconds * 1000);
  }

  const ctx = await deps.getAuthContext();
  if (!(await ctx.internalAdapter.findUserById(userId))) return notFound();

  // Break-glass — the guard the shadowed vendor route used to inherit from
  // `auth-manager.ts`'s before-hook, which a raw mount no longer reaches.
  if (await isLastLocalCredentialHolder(ctx.adapter, userId)) {
    return {
      status: 409,
      body: {
        success: false,
        error: { code: LAST_LOCAL_CREDENTIAL_CODE, message: LAST_LOCAL_CREDENTIAL_MESSAGE },
      },
    };
  }

  await applyUserBan(ctx.internalAdapter, userId, {
    banReason,
    ...(banExpires ? { banExpires } : {}),
  });
  // Sign the banned user out everywhere, exactly as the vendor handler does.
  await ctx.internalAdapter.deleteUserSessions(userId);

  return {
    status: 200,
    body: {
      success: true,
      data: {
        userId,
        banned: true,
        banReason,
        ...(banExpires ? { banExpires: banExpires.toISOString() } : {}),
      },
    },
  };
}

/** `POST /api/v1/auth/admin/unban-user` — the caller is already gated. */
export async function runAdminUnbanUser(
  deps: AdminBanEndpointDeps,
  _actor: AdminActor,
  request: Request,
): Promise<EndpointResult> {
  const body = await parseJson(request);
  const userId = readUserId(body);
  if (!userId) return invalid('userId is required');

  const ctx = await deps.getAuthContext();
  if (!(await ctx.internalAdapter.findUserById(userId))) return notFound();

  await applyUserUnban(ctx.internalAdapter, userId);

  return { status: 200, body: { success: true, data: { userId, banned: false } } };
}
