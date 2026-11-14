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
 * hook (`BANNED_USER`), which is untouched. The write itself lives in the
 * package-internal `user-ban-write.ts` (#14360), shared with the SCIM
 * deprovisioning hook in `auth-manager.ts` — one write, two callers. The default ban reason is
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
 *
 * ── Without the admin plugin ────────────────────────────────────────────────
 *
 * A kernel without the vendor admin plugin (a Free or Team hosted
 * environment, where it mounts only with SCIM) has no `banReason` /
 * `banExpires` fields on better-auth's user model, so `internalAdapter`
 * cannot land the write, and no vendor session hook reads `banned`. There the
 * mount passes `getBanWriter`, which writes the same three columns through
 * the data engine (`engineUserBanWriter`), and the session refusal in
 * `user-session-admission.ts` enforces the ban with the vendor's own answer.
 *
 * ── The host seam ───────────────────────────────────────────────────────────
 *
 * With an environment-user host wired (`environment-user-host.ts`), a ban
 * asks it to deactivate the person and an unban to reactivate them, BEFORE
 * the write and outside any transaction. A typed host refusal (an
 * organization owner or admin, `409`; the developer member cap, `403`)
 * refuses the whole operation with the host's answer and nothing is written.
 * Any other host failure never blocks the ban: it goes ahead and the answer
 * carries `host: { notified: false, … }`. The event names the administrator
 * and their cloud user id, read from their linked `objectstack-cloud`
 * account, never from the request.
 */

import {
  isLastLocalCredentialHolder,
  LAST_LOCAL_CREDENTIAL_CODE,
  LAST_LOCAL_CREDENTIAL_MESSAGE,
  type CredentialAccountAdapter,
} from './last-local-credential.js';
import type { AdminActor, EndpointResult } from './admin-user-endpoints.js';
import { applyUserBan, applyUserUnban, type UserBanWriter } from './user-ban-write.js';
import { readJsonRequestBody } from './request-json-body.js';
import { readUserSource } from './sso-only-local-password.js';
import {
  notifyEnvironmentUserHost,
  readActorCloudUserId,
  type EnvironmentUserEventKind,
  type EnvironmentUserHostAccessor,
  type EnvironmentUserHostOutcome,
  type EnvironmentUserHostRefused,
} from './environment-user-host.js';

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
  /**
   * The writer the ban columns land through, when it is not better-auth's
   * `internalAdapter`: the engine-backed one on a kernel without the admin
   * plugin. Absent, or answering `undefined`, means the `internalAdapter`.
   */
  getBanWriter?(): Promise<UserBanWriter | undefined>;
  /** The environment-user host, asked before a ban (deactivated) or an unban (reactivated). */
  host?: EnvironmentUserHostAccessor;
  /** Reads the row's `source` and the administrator's linked cloud account for the host event. */
  getDataEngine?(): any;
  logger?: { warn(msg: string): void };
}

async function banWriterFor(deps: AdminBanEndpointDeps, ctx: AuthBanContextLike): Promise<UserBanWriter> {
  return (await deps.getBanWriter?.()) ?? ctx.internalAdapter;
}

/**
 * Ask the host, when one is wired; `undefined` leaves the answer as it was.
 * A typed refusal comes back as `{ refused }` for the door to answer.
 */
async function askHost(
  deps: AdminBanEndpointDeps,
  kind: EnvironmentUserEventKind,
  user: unknown,
  userId: string,
  actor: AdminActor,
): Promise<EnvironmentUserHostOutcome | EnvironmentUserHostRefused | undefined> {
  if (!deps.host) return undefined;
  const row = (user && typeof user === 'object' ? user : {}) as { email?: unknown; name?: unknown };
  const engine = deps.getDataEngine?.();
  const source = engine ? await readUserSource(engine, userId) : undefined;
  const actorCloudUserId = await readActorCloudUserId(engine, actor.id, deps.logger);
  return notifyEnvironmentUserHost(
    deps.host,
    kind,
    {
      userId,
      email: typeof row.email === 'string' ? row.email : '',
      name: typeof row.name === 'string' ? row.name : '',
      source: source?.ok && typeof source.value === 'string' ? source.value : null,
      actorId: actor.id,
      ...(actorCloudUserId ? { actorCloudUserId } : {}),
      occurredAt: new Date().toISOString(),
    },
    deps.logger,
  );
}

/** The door's answer for a host's typed refusal: its status, code and sentence; nothing was written. */
const hostRefusal = ({ refused }: EnvironmentUserHostRefused): EndpointResult => ({
  status: refused.status,
  body: { success: false, error: { code: refused.code, message: refused.message } },
});

const isRefused = (outcome: unknown): outcome is EnvironmentUserHostRefused =>
  !!outcome && typeof outcome === 'object' && 'refused' in outcome;

const invalid = (message: string): EndpointResult => ({
  status: 400,
  body: { success: false, error: { code: 'INVALID_REQUEST', message } },
});

const notFound = (): EndpointResult => ({
  status: 404,
  body: { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found' } },
});

/**
 * [#24032] The body, or the refusal message for a declared-JSON body that does
 * not parse: it was read as `{}`, which answered "userId is required" for a
 * body that carried `userId` (see request-json-body.ts). A well-formed body
 * that is not an object still reads as no fields, as before.
 */
async function parseJson(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return reading;
  const parsed = reading.body;
  return { ok: true, body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {} };
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
  const read = await parseJson(request);
  if (!read.ok) return invalid(read.message);
  const body = read.body;
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
  const target = await ctx.internalAdapter.findUserById(userId);
  if (!target) return notFound();

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

  // The host first: an organization owner or admin it refuses is not deactivated at all.
  const host = await askHost(deps, 'deactivated', target, userId, actor);
  if (isRefused(host)) return hostRefusal(host);

  await applyUserBan(await banWriterFor(deps, ctx), userId, {
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
        ...(host ? { host } : {}),
      },
    },
  };
}

/** `POST /api/v1/auth/admin/unban-user` — the caller is already gated. */
export async function runAdminUnbanUser(
  deps: AdminBanEndpointDeps,
  actor: AdminActor,
  request: Request,
): Promise<EndpointResult> {
  const read = await parseJson(request);
  if (!read.ok) return invalid(read.message);
  const userId = readUserId(read.body);
  if (!userId) return invalid('userId is required');

  const ctx = await deps.getAuthContext();
  const target = await ctx.internalAdapter.findUserById(userId);
  if (!target) return notFound();

  // The host first: a reactivation it refuses (the member cap) leaves the person deactivated.
  const host = await askHost(deps, 'reactivated', target, userId, actor);
  if (isRefused(host)) return hostRefusal(host);

  await applyUserUnban(await banWriterFor(deps, ctx), userId);

  return { status: 200, body: { success: true, data: { userId, banned: false, ...(host ? { host } : {}) } } };
}
