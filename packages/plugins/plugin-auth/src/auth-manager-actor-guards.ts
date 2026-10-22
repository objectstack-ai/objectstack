// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 1] The actor and organization guards of `AuthManager` — the
 * acting-user resolution its before-hook gates share, the platform-admin
 * binding, the held-actor refusal, and the admission gates of organization
 * delete, member removal, session revocation and the invitation role cap —
 * moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same reads, the same verdicts, the same
 * refusals with the same codes, failing open or closed exactly where they did.
 * The one module-level declaration only these bodies read moved with them,
 * also unedited: the invitation role cap's read-fault answer and its code.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method. The class keeps
 * every method — the published `dist/*.d.ts` lists each one's name,
 * docblock and position — and each body is one literal of exactly the
 * {@link ActorGuardHost} members that method reads, plus a `.call`; a body
 * that reads no member takes no host and is called directly. The methods are
 * no longer `async`: each returns the moved function's own promise, so a
 * caller awaits the same promise the body settles, with no extra wrapper. A
 * method is handed over as a closure that calls it on the manager at call
 * time, so a test double or spy set on the manager is still the one the body
 * reaches — `resolveActor` included, which three of the guards ask through
 * the manager rather than calling the function here directly.
 *
 * Each field was checked on its own: `orgRolesMap` and
 * `organizationDeleteStandingJudge` go as GETTERS. The class reassigns both
 * after construction (the first on every plugin-list build, the second when
 * `AuthPlugin` hands the last-administrator guard over), and the guards read
 * them after an `await`, so a value copied when the guard was called could
 * part from the field the body used to read.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { AuthManager } from './auth-manager.js';
import type { StandardErrorCode } from '@objectstack/spec/api';
// [#10348] The ONE id-shaped platform-admin predicate (ADR-0068 D2).
// `auth-manager` used to re-derive that standing itself, in two spellings
// that had drifted from the declared authority and from each other; both
// now ask the authority. Nothing in this file reads the grant tables.
import { hasPlatformAdminStanding } from '@objectstack/core';
import { resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { withSystemReadContext } from './objectql-adapter.js';
import { judgeHeldSession } from './platform-admin-gate.js';
import {
  DEFAULT_CREATOR_ROLE,
  REMOVE_MEMBER_DENIAL_CODE,
  REMOVE_MEMBER_DENIAL_MESSAGE,
  isSoleOwnerGuardTerritory,
  removalBlockedByOwnerTarget,
} from './remove-member-permission-guard.js';
import {
  REVOKE_SESSION_NOT_FOUND_CODE,
  REVOKE_SESSION_NOT_FOUND_MESSAGE,
  revokeTargetsCallerSession,
} from './revoke-session-match-guard.js';
import {
  ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE,
  ADMIN_REVOKE_USER_SESSION_NOT_FOUND_MESSAGE,
  adminMayRevokeUserSessions,
  anySessionCarriesToken,
} from './admin-revoke-user-session-match-guard.js';
import {
  ORGANIZATION_DELETE_READ_FAULT_CODE,
  ORGANIZATION_DELETE_REFUSAL_CODE,
  defaultOrganizationDeleteRefusal,
  isDefaultOrganizationTarget,
  organizationDeleteReadFaultBody,
  organizationDeleteRefusal,
  organizationNotEmptyBody,
} from './organization-delete.js';

/** [#23945] The standard ADR-0112 code a store outage answers with — the status's own name. */
const INVITATION_ROLE_CAP_READ_FAULT_CODE: StandardErrorCode = 'SERVICE_UNAVAILABLE';

/**
 * [#23945] The invitation role cap's answer when its one read — the issuer's
 * `sys_member` rows — cannot answer: `503 SERVICE_UNAVAILABLE`, as the slug
 * guard's read fault answers ({@link slugGuardReadFaultApiError}).
 *
 * Not the cap's `403 INVITE_ISSUER_UNVERIFIED`: that code is a verdict — the
 * store answered and established no role — while a read that threw reached no
 * verdict, so it must not wear the refusal's code. Still fail-closed: the
 * throw ends the endpoint, so no invitation row is written. Like the slug
 * guard's body (#24243), this one carries the code too, so every answer from
 * the invitation endpoint has one. The driver's own failure rides `cause`.
 */
async function invitationRoleCapReadFaultApiError(cause: unknown): Promise<Error> {
  const { APIError } = await import('better-auth/api');
  const err = new APIError('SERVICE_UNAVAILABLE', {
    message:
      'The invitation role cap could not read `sys_member`, so the role the issuer holds was never ' +
      'determined, and no invitation was created. This is a server-side outage, not a refusal of the ' +
      'invitation: retry once the data store is reachable.',
    code: INVITATION_ROLE_CAP_READ_FAULT_CODE,
  });
  (err as { cause?: unknown }).cause = cause;
  return err;
}

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why the two fields are getters.
 */
export interface ActorGuardHost {
  readonly orgRolesMap: AuthManager['orgRolesMap'];
  readonly organizationDeleteStandingJudge: AuthManager['organizationDeleteStandingJudge'];
  computeAuthGate: AuthManager['computeAuthGate'];
  getDataEngine: AuthManager['getDataEngine'];
  resolveActor: AuthManager['resolveActor'];
}

/** The body of `AuthManager#resolveActor`; the method's docblock there is its contract. */
export async function resolveActor(
  ctx: any,
  options?: { failedReadThrows?: boolean },
): Promise<{ userId: string; activeOrgId?: string } | null> {
  try {
    const { getSessionFromCtx } = await import('better-auth/api');
    const s: any = await getSessionFromCtx(ctx as any);
    const userId = s?.user?.id ?? s?.session?.userId;
    if (userId) {
      return {
        userId: String(userId),
        activeOrgId:
          s?.session?.activeOrganizationId ?? s?.activeOrganizationId ?? undefined,
      };
    }
  } catch { /* fall through to explicit token resolution */ }
  let failedRead: { cause: unknown } | undefined;
  try {
    const hdr = (k: string): string =>
      ((ctx?.headers?.get?.(k) ?? ctx?.request?.headers?.get?.(k)) as string) || '';
    let token: string | undefined;
    // `session.token` stores the UNSIGNED value, but a credential reaches us
    // in either spelling: `bearer()` hands clients the SIGNED `<token>.<sig>`
    // in `set-auth-token` (and accepts both back), while the cookie always
    // carries the signed form. Strip the signature on BOTH branches — the
    // cookie branch always did, and a bearer branch that did not silently
    // resolved nothing for the exact credential the documented API lane hands
    // out, which is indistinguishable from "not signed in".
    const unsigned = (v: string): string => v.split('.')[0];
    const bm = /^Bearer\s+(.+)$/i.exec(hdr('authorization'));
    if (bm?.[1]) token = unsigned(bm[1].trim());
    if (!token) {
      const cm = /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=([^;]+)/.exec(hdr('cookie'));
      if (cm?.[1]) token = unsigned(decodeURIComponent(cm[1]));
    }
    if (token) {
      let sess: any;
      try {
        sess = await (ctx as any).context.adapter.findOne({
          model: 'session',
          where: [{ field: 'token', value: token }],
        });
      } catch (cause) {
        // A token carrying a control character is none the store holds, and
        // a read of it can fail on the request's own bytes (PostgreSQL
        // refuses U+0000 in a text parameter): that failure stays no session.
        const storable = !Array.from(token).some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
        if (options?.failedReadThrows && storable) failedRead = { cause };
        throw cause;
      }
      const exp = sess?.expiresAt ?? sess?.expires_at;
      if (sess && (!exp || new Date(exp).getTime() > Date.now())) {
        const userId = String(sess.userId ?? sess.user_id ?? '');
        if (userId) {
          return {
            userId,
            activeOrgId:
              sess.activeOrganizationId ?? sess.active_organization_id ?? undefined,
          };
        }
      }
    }
  } catch { /* unresolved → null */ }
  if (failedRead) throw failedRead.cause;
  return null;
}

/** The body of `AuthManager#isPlatformAdminUserId`; the method's docblock there is its contract. */
export async function isPlatformAdminUserId(this: Pick<ActorGuardHost, 'getDataEngine'>, userId: string): Promise<boolean> {
  if (!userId) return false;
  const engine = this.getDataEngine();
  if (!engine) return false;
  return hasPlatformAdminStanding(engine, userId);
}

/** The body of `AuthManager#assertActorNotHeld`; the method's docblock there is its contract. */
export async function assertActorNotHeld(this: Pick<ActorGuardHost, 'computeAuthGate'>, actor: { userId: string; activeOrgId?: string }): Promise<void> {
  const held = judgeHeldSession({
    authGate: await this.computeAuthGate(actor.userId, actor.activeOrgId, false),
  });
  if (!held) return;
  const { APIError } = await import('better-auth/api');
  // The judge's own record: its object literal (`judgeHeldSession`) carries
  // the posture `code`, from the closed `AuthGateCodeSchema` vocabulary.
  const { body } = held;
  throw new APIError('FORBIDDEN', body);
}

/** The body of `AuthManager#assertOrganizationDeletable`; the method's docblock there is its contract. */
export async function assertOrganizationDeletable(this: Pick<ActorGuardHost, 'getDataEngine' | 'orgRolesMap' | 'organizationDeleteStandingJudge' | 'resolveActor'>, ctx: any): Promise<void> {
  const engine = this.getDataEngine();
  if (!engine) return;
  const organizationId = typeof ctx?.body?.organizationId === 'string' ? ctx.body.organizationId : '';
  if (!organizationId) return;

  const sys = withSystemReadContext(engine);
  const read = async <T>(object: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (cause) {
      const { APIError } = await import('better-auth/api');
      const err = new APIError('SERVICE_UNAVAILABLE', {
        code: ORGANIZATION_DELETE_READ_FAULT_CODE,
        ...organizationDeleteReadFaultBody(object),
      });
      (err as { cause?: unknown }).cause = cause;
      throw err;
    }
  };

  // The session read refuses on failure too, so a session the store could
  // not read is never taken for no session; no session at all still falls
  // through.
  const actor = await read('sys_session', () => this.resolveActor(ctx, { failedReadThrows: true }));
  if (!actor?.userId) return; // the vendor answers 401
  const callerRow: any = await read('sys_member', () =>
    sys.findOne('sys_member', { where: { organization_id: organizationId, user_id: actor.userId } }),
  );
  if (!callerRow) return; // the vendor answers USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION
  let permitted: boolean;
  try {
    const { hasPermission } = await import('better-auth/plugins/organization');
    permitted = await hasPermission(
      {
        role: callerRow.role,
        options: (this.orgRolesMap ? { roles: this.orgRolesMap } : {}) as any,
        permissions: { organization: ['delete'] },
        organizationId,
      } as any,
      ctx,
    );
  } catch {
    // Not a read: handed a roles map and no dynamic access control, the
    // vendor's predicate reads nothing, so it throws only on the member row
    // itself (a role that is no string, or names an inherited object
    // member), and the vendor's identical call on that row throws too,
    // before its first write. The vendor answers this.
    return;
  }
  if (!permitted) return; // the vendor answers YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION
  const organization: any = await read('sys_organization', () =>
    sys.findOne('sys_organization', { where: { id: organizationId } }),
  );
  if (!organization) return; // the vendor answers 400

  // Which of the two refusals below applies is part of the guard, so a
  // lookup that fails deciding it refuses too, never hands the request to
  // the vendor unasked.
  const walled = postureEnforcesWall(resolveTenancyPosture());
  const defaultOrganization = await read('sys_organization', () =>
    isDefaultOrganizationTarget(engine, organization, walled),
  );

  // The Default Organization is asked the last-administrator guard's
  // question first, HERE, before the vendor's first write, so its refusal
  // leaves every member and invitation as it was on any driver, with or
  // without transactions. The guard fails closed on a lookup it cannot
  // complete, so this never passes for want of an answer. When it admits
  // the delete, the record count below is asked before the vendor's first
  // write too, leaving out only what the vendor removes (members and
  // invitations): plugin-auth removes none of the Default Organization's
  // structure, so its teams and grants count.
  if (defaultOrganization && this.organizationDeleteStandingJudge) {
    try {
      await this.organizationDeleteStandingJudge(organizationId);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== 'PERMISSION_DENIED') throw err;
      const { APIError } = await import('better-auth/api');
      throw new APIError('FORBIDDEN', { message: (err as Error).message, code: 'PERMISSION_DENIED' });
    }
  }

  const owned = defaultOrganization
    ? await defaultOrganizationDeleteRefusal(engine, organizationId)
    : await organizationDeleteRefusal(engine, organizationId);
  if (owned && owned.length > 0) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('CONFLICT', { code: ORGANIZATION_DELETE_REFUSAL_CODE, ...organizationNotEmptyBody(owned) });
  }
}

/** The body of `AuthManager#assertRemoveMemberPermitted`; the method's docblock there is its contract. */
export async function assertRemoveMemberPermitted(this: Pick<ActorGuardHost, 'getDataEngine' | 'orgRolesMap' | 'resolveActor'>, ctx: any): Promise<void> {
  const engine = this.getDataEngine();
  if (!engine) return;

  const memberIdOrEmail =
    typeof ctx?.body?.memberIdOrEmail === 'string' ? ctx.body.memberIdOrEmail : '';
  if (!memberIdOrEmail) return;

  try {
    const actor = await this.resolveActor(ctx);
    // No resolvable session → better-auth's `sessionMiddleware` issues the
    // 401. Not ours to pre-empt.
    if (!actor?.userId) return;

    const orgId =
      (typeof ctx?.body?.organizationId === 'string' && ctx.body.organizationId) ||
      actor.activeOrgId;
    // No org in play → the vendor answers NO_ACTIVE_ORGANIZATION.
    if (!orgId) return;

    const sys = withSystemReadContext(engine);

    const callerRow: any = await sys.findOne('sys_member', {
      where: { organization_id: orgId, user_id: actor.userId },
    });
    if (!callerRow) return; // vendor answers MEMBER_NOT_FOUND

    // Resolve the target exactly the way better-auth's org adapter does:
    // an `@` means "by email" (lower-cased), anything else is a member id.
    let targetRow: any = null;
    if (memberIdOrEmail.includes('@')) {
      const user: any = await sys.findOne('sys_user', {
        where: { email: memberIdOrEmail.toLowerCase() },
      });
      if (user?.id) {
        targetRow = await sys.findOne('sys_member', {
          where: { organization_id: orgId, user_id: user.id },
        });
      }
    } else {
      targetRow = await sys.findOne('sys_member', { where: { id: memberIdOrEmail } });
    }
    if (!targetRow) return; // vendor answers MEMBER_NOT_FOUND

    const creatorRole =
      (typeof ctx?.context?.orgOptions?.creatorRole === 'string' &&
        ctx.context.orgOptions.creatorRole) ||
      DEFAULT_CREATOR_ROLE;

    // (1) The sole-owner invariant's territory — never answer over it.
    if (
      isSoleOwnerGuardTerritory(
        String(actor.userId),
        String(targetRow.user_id ?? ''),
        callerRow.role,
        creatorRole,
      )
    ) {
      return;
    }

    // (2) The vendor's (3a) predicate: an owner target and a non-owner
    // caller. A permission refusal — say so, with the right status.
    if (removalBlockedByOwnerTarget(callerRow.role, targetRow.role, creatorRole)) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('FORBIDDEN', {
        message: REMOVE_MEMBER_DENIAL_MESSAGE,
        code: REMOVE_MEMBER_DENIAL_CODE,
      });
    }

    // (3) The vendor's (4): the real `member: ['delete']` check, decided by
    // the vendor's own function so there is only ever one answer to it. Only
    // the envelope differs — better-auth reports this one as 401.
    const { hasPermission } = await import('better-auth/plugins/organization');
    const permitted = await hasPermission(
      {
        role: callerRow.role,
        options: (this.orgRolesMap ? { roles: this.orgRolesMap } : {}) as any,
        permissions: { member: ['delete'] },
        organizationId: orgId,
      } as any,
      ctx,
    );
    if (!permitted) {
      const { APIError } = await import('better-auth/api');
      throw new APIError('FORBIDDEN', {
        message: REMOVE_MEMBER_DENIAL_MESSAGE,
        code: REMOVE_MEMBER_DENIAL_CODE,
      });
    }
  } catch (error) {
    // Our own refusal must propagate; anything else is a lookup that did not
    // complete, and per the fail-open contract above that hands the request
    // back to better-auth unchanged.
    const { isAPIError } = await import('better-auth/api');
    if (isAPIError(error)) throw error;
  }
}

/** The body of `AuthManager#assertRevokeSessionIdentifiesRecord`; the method's docblock there is its contract. */
export async function assertRevokeSessionIdentifiesRecord(this: Pick<ActorGuardHost, 'resolveActor'>, ctx: any): Promise<void> {
  const token = ctx?.body?.token;
  if (typeof token !== 'string') return; // vendor's body schema answers 400

  let admitted: boolean;
  try {
    const actor = await this.resolveActor(ctx);
    // No resolvable caller → the vendor's sensitiveSessionMiddleware issues
    // the 401. Not ours to pre-empt (and answering 404 here would grade an
    // anonymous probe's question before its authentication).
    if (!actor?.userId) return;

    const found = await ctx.context.internalAdapter.findSession(token);
    admitted = revokeTargetsCallerSession(found, actor.userId);
  } catch {
    // A lookup that did not complete hands the request back to the vendor
    // unchanged — an engine hiccup must not invent a "not found".
    return;
  }

  if (!admitted) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('NOT_FOUND', {
      message: REVOKE_SESSION_NOT_FOUND_MESSAGE,
      code: REVOKE_SESSION_NOT_FOUND_CODE,
    });
  }
}

/** The body of `AuthManager#assertAdminRevokeUserSessionIdentifiesRecord`; the method's docblock there is its contract. */
export async function assertAdminRevokeUserSessionIdentifiesRecord(ctx: any): Promise<void> {
  const token = ctx?.body?.sessionToken;
  if (typeof token !== 'string') return; // vendor's body schema answers 400

  let admitted: boolean;
  try {
    // The vendor's own session resolution — the exact call adminMiddleware
    // makes (authoritative: a role graded off the cookie cache could admit
    // a demoted caller the vendor is about to refuse).
    const { getAuthoritativeSessionFromCtx } = await import('better-auth/api');
    const s: any = await getAuthoritativeSessionFromCtx(ctx).catch(() => null);
    // No resolvable caller → the vendor's adminMiddleware issues the 401.
    if (!s?.user?.id) return;

    // The vendor's own permission question, with the vendor's own inputs:
    // the LIVE admin-plugin options (the object the mounted plugin retains)
    // and its exported defaultRoles as the fallback. A caller this refuses
    // gets the vendor's 403 — never this guard's 404.
    const adminOptions = ((ctx?.context?.options?.plugins ?? []) as any[]).find(
      (p: any) => p?.id === 'admin',
    )?.options;
    const { defaultRoles } = await import('better-auth/plugins/admin/access');
    if (!adminMayRevokeUserSessions(s.user, adminOptions, defaultRoles as any)) return;

    const found = await ctx.context.internalAdapter.findSession(token);
    admitted = anySessionCarriesToken(found);
  } catch {
    // A lookup that did not complete hands the request back to the vendor
    // unchanged — an engine hiccup must not invent a "not found".
    return;
  }

  if (!admitted) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('NOT_FOUND', {
      message: ADMIN_REVOKE_USER_SESSION_NOT_FOUND_MESSAGE,
      code: ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE,
    });
  }
}

/** The body of `AuthManager#resolveMembershipRole`; the method's docblock there is its contract. */
export async function resolveMembershipRole(
  this: Pick<ActorGuardHost, 'getDataEngine'>,
  userId: unknown,
  orgId: unknown,
): Promise<string | null> {
  const uid = typeof userId === 'string' && userId !== '' ? userId : null;
  const oid = typeof orgId === 'string' && orgId !== '' ? orgId : null;
  if (!uid || !oid) return null;
  const engine = this.getDataEngine();
  if (!engine) return null;
  let members: unknown;
  try {
    members = await withSystemReadContext(engine).find('sys_member', {
      where: { user_id: uid, organization_id: oid },
      limit: 10,
    });
  } catch (err) {
    throw await invitationRoleCapReadFaultApiError(err);
  }
  const roles = (Array.isArray(members) ? members : [])
    .map((m: any) => (typeof m?.role === 'string' ? m.role : ''))
    .filter((r: string) => r.length > 0);
  return roles.length > 0 ? roles.join(',') : null;
}
