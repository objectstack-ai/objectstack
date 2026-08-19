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

  await ctx.internalAdapter.updateUser(userId, {
    banned: true,
    banReason,
    ...(banExpires ? { banExpires } : {}),
    updatedAt: new Date(),
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

  await ctx.internalAdapter.updateUser(userId, {
    banned: false,
    banReason: null,
    banExpires: null,
    updatedAt: new Date(),
  });

  return { status: 200, body: { success: true, data: { userId, banned: false } } };
}
