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
 * Any other host failure refuses a deactivation (`503`, nothing written):
 * only the host can say whether the person is an organization owner or
 * admin, whom ruling 5 keeps out of reach from the environment side. It
 * never blocks a reactivation, which goes ahead with `host: { notified:
 * false, … }` on the answer. The event names the administrator, the one at
 * the keyboard on an impersonation session, and their cloud user id read
 * from their linked `objectstack-cloud` account, never from the request.
 *
 * ── What a ban ends beside the ban ─────────────────────────────────────────
 *
 * A banned account keeps nothing running in its name
 * (`removed-account-registrations.ts`, `service-account-owner-leaves.ts`).
 * After the ban write, the door suspends every AI service account the person
 * is accountable for (`banned`, reason `Accountable owner banned by an
 * administrator`), disables every OAuth application the account registered
 * and revokes every SCIM credential it minted, each revoke recorded against
 * the administrator as a reset records it. It answers what it ended under
 * `revoked`, as the administrator's forced reset does: counts only, `failed`
 * and `complete`. The ban has landed by then, so a step that fails does not
 * undo it: the answer says it is not complete, it is reported once to `warn`,
 * and banning the account again retries it. An unban lifts the ban only: no
 * account is resumed, no application enabled, no credential restored.
 *
 * ── The admin audit row ─────────────────────────────────────────────────────
 *
 * A ban or an unban that committed writes the sibling doors' admin audit row
 * (`writeAdminAudit`, action `update`, event `user.admin_banned` /
 * `user.admin_unbanned`); a refused one writes none. plugin-audit's mirror row
 * for the column write names the administrator on both writers (the engine
 * one through `authSystemWriteContext`), but carries neither the event nor
 * `hostNotified`, so it does not stand in for this row.
 */

import {
  isLastLocalCredentialHolder,
  LAST_LOCAL_CREDENTIAL_CODE,
  LAST_LOCAL_CREDENTIAL_MESSAGE,
  type CredentialAccountAdapter,
} from './last-local-credential.js';
import { writeAdminAudit, type AdminActor, type EndpointResult } from './admin-user-endpoints.js';
import { applyUserBan, applyUserUnban, type UserBanWriter } from './user-ban-write.js';
import { endRegistrationsOfARemovedAccount } from './removed-account-registrations.js';
import { suspendAccountsOfBannedOwner } from './service-account-owner-leaves.js';
import { readJsonRequestBody } from './request-json-body.js';
import { readUserSource } from './sso-only-local-password.js';
import {
  environmentUserAttribution,
  notifyEnvironmentUserHost,
  type EnvironmentUserActor,
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
  actor: AdminActor & EnvironmentUserActor,
): Promise<EnvironmentUserHostOutcome | EnvironmentUserHostRefused | undefined> {
  if (!deps.host) return undefined;
  const row = (user && typeof user === 'object' ? user : {}) as { email?: unknown; name?: unknown };
  const engine = deps.getDataEngine?.();
  const source = engine ? await readUserSource(engine, userId) : undefined;
  const attribution = await environmentUserAttribution(engine, actor, deps.logger);
  return notifyEnvironmentUserHost(
    deps.host,
    kind,
    {
      userId,
      email: typeof row.email === 'string' ? row.email : '',
      name: typeof row.name === 'string' ? row.name : '',
      source: source?.ok && typeof source.value === 'string' ? source.value : null,
      ...attribution,
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

/** The answer when a wired host could not be asked whether the person may be deactivated. */
const HOST_UNANSWERED_DEACTIVATION: EndpointResult = {
  status: 503,
  body: {
    success: false,
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message:
        'The hosting organisation could not be asked whether this person may be deactivated, so they were not. '
        + 'Nothing was changed; try again.',
    },
  },
};

/** What a ban ended beside the ban itself, answered as the forced reset answers its `revoked`. */
export interface BanEnded {
  /** The AI service accounts the person is accountable for, suspended by this ban. */
  serviceAccounts: number;
  /** The OAuth applications the account registered, now disabled. */
  ownedApps: number;
  /** The SCIM connection credentials the account minted, now revoked. */
  scimCredentials: number;
  /** The steps that could not finish (a read or a write refused). */
  failed: number;
  /** `true` only when every step finished; never for a step that could not be measured. */
  complete: boolean;
}

/**
 * End what the banned account ran in its name (module header): suspend the AI
 * service accounts it is accountable for, disable the OAuth applications it
 * registered and revoke the SCIM credentials it minted. Never throws.
 */
async function endWhatTheBannedAccountRan(deps: AdminBanEndpointDeps, actor: AdminActor, userId: string): Promise<BanEnded> {
  const warn = (message: string): void => deps.logger?.warn(message);
  const engine = deps.getDataEngine?.();
  if (!engine || typeof engine.find !== 'function') {
    warn(
      `[AuthPlugin] ban of user ${userId}: the AI service accounts they are accountable for, the OAuth applications `
        + 'they registered and the SCIM credentials they minted were NOT ended: the data engine offers no read '
        + 'surface. The ban itself landed. Remedy: wire the ObjectQL engine into the auth plugin, then ban again.',
    );
    return { serviceAccounts: 0, ownedApps: 0, scimCredentials: 0, failed: 0, complete: false };
  }
  const suspension = await suspendAccountsOfBannedOwner(engine, userId);
  const registrations = await endRegistrationsOfARemovedAccount(engine, userId, {
    actorId: actor.id,
    act: 'banning an account',
    warn,
  });
  const failed = suspension.failed.length + (suspension.readError !== undefined ? 1 : 0)
    + (registrations.error !== undefined ? 1 : 0);
  const ended: BanEnded = {
    serviceAccounts: suspension.suspended.length,
    ownedApps: registrations.ownedApps.length,
    scimCredentials: registrations.scimCredentials.length,
    failed,
    complete: failed === 0,
  };
  if (!ended.complete) {
    warn(
      `[AuthPlugin] ban of user ${userId}: ending what the account ran INCOMPLETE — ${ended.serviceAccounts} AI `
        + `service account(s) suspended, ${ended.ownedApps} registered OAuth application(s) disabled, `
        + `${ended.scimCredentials} minted SCIM credential(s) revoked, ${failed} step(s) refused`
        + `${registrations.error !== undefined ? ` (${registrations.error})` : ''}. The ban itself landed; what was `
        + 'not ended still works. Remedy: ban the user again, or suspend the remaining AI service accounts whose '
        + 'accountable_user_id is this user, disable the remaining OAuth applications and revoke the remaining SCIM '
        + 'credentials by hand.',
    );
  }
  return ended;
}

/** The admin audit row for a ban or an unban that committed; never fails the answer. */
const auditBan = (
  deps: AdminBanEndpointDeps,
  actor: AdminActor,
  userId: string,
  event: 'user.admin_banned' | 'user.admin_unbanned',
  host: EnvironmentUserHostOutcome | undefined,
  ended?: BanEnded,
): Promise<void> =>
  writeAdminAudit(
    { getDataEngine: () => deps.getDataEngine?.(), logger: deps.logger },
    {
      action: 'update',
      actor,
      recordId: userId,
      metadata: {
        event,
        hostNotified: host?.notified === true,
        // What the ban ended beside itself, counts only, as the forced reset records them.
        ...(ended
          ? {
              suspendedServiceAccounts: ended.serviceAccounts,
              revokedOwnedApps: ended.ownedApps,
              revokedScimCredentials: ended.scimCredentials,
              revocationComplete: ended.complete,
            }
          : {}),
      },
    },
  );

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
  // A wired host that did not answer: the owner / admin question is open, so
  // the deactivation does not happen (ruling 5).
  if (host && !host.notified && host.reason === 'host_failed') return HOST_UNANSWERED_DEACTIVATION;

  await applyUserBan(await banWriterFor(deps, ctx), userId, {
    banReason,
    ...(banExpires ? { banExpires } : {}),
  });
  // Sign the banned user out everywhere, exactly as the vendor handler does.
  await ctx.internalAdapter.deleteUserSessions(userId);
  // ...and end what the account ran in its name; an unban restores none of it.
  const revoked = await endWhatTheBannedAccountRan(deps, actor, userId);
  await auditBan(deps, actor, userId, 'user.admin_banned', host, revoked);

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
        revoked,
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
  await auditBan(deps, actor, userId, 'user.admin_unbanned', host);

  return { status: 200, body: { success: true, data: { userId, banned: false, ...(host ? { host } : {}) } } };
}
