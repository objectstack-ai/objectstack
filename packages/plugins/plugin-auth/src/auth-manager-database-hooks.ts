// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 4] The better-auth database hooks of `AuthManager` — the
 * account, user and session hooks it composes around a host's own
 * `databaseHooks`: the unlink records, the walled owner-verified stamp, the
 * ADR-0093 D2 membership reconciler on `user.create.after`, the ADR-0093 D9
 * default active organization on `session.create.before`, the `login` and
 * `logout` audit rows and the principal-session renewal hold — and the
 * `sys_user.source` provenance stamp (cloud ADR-0024 D4) that
 * `account.create.after` runs, moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same hooks, chained with a host's in the same
 * order, the same writes, failing open and closed exactly where they did.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which `auth-manager-actor-guards.ts`,
 * `auth-manager-sign-in-lockout.ts` and
 * `auth-manager-password-session-policy.ts` follow, applied per method. The
 * class keeps both methods — the published `dist/*.d.ts` lists each one's
 * name, docblock and position — and each body is one literal of exactly the
 * {@link DatabaseHooksHost} members that method reads, plus a `.call`.
 * `stampIdentitySource` is no longer `async`: it returns the moved function's
 * own promise, so a caller awaits the same promise the body settles, with no
 * extra wrapper. In `composeDatabaseHooks` the literal is named `hookHost`,
 * because the method's own parameter is already named `host` (the host
 * stack's `databaseHooks`).
 *
 * The hooks run long after `composeDatabaseHooks` returned: better-auth calls
 * them on each account, user and session write. So every member is handed
 * over to be read when a hook runs, never once when the hooks were composed.
 * A method goes as a closure that calls it on the manager at call time, so a
 * test double or spy set on the manager is still the one a hook reaches —
 * `stampIdentitySource` included, which `account.create.after` asks through
 * the manager rather than calling the function here directly. `config` goes
 * as a GETTER: the class reassigns it after construction (`setRuntimeBaseUrl`
 * and `applyConfigPatch`), and the hooks read its `dataEngine`, `logger` and
 * `getAuditSink` when they run, so a value copied at composition could part
 * from the field the body used to read. `idpLocale` goes as a getter too, so
 * a hook reads the field the manager holds when it runs.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { BetterAuthOptions } from 'better-auth';
import type { AuthManager } from './auth-manager.js';
import {
  clearUnlinkTombstone,
  clearUserUnlinkTombstones,
  recordUnlinkTombstone,
} from './implicit-account-linking.js';
import { withSystemReadContext } from './objectql-adapter.js';
import { emitAuthSessionAuditEvent, loginEventFor, logoutEventFor } from './auth-session-audit.js';
import { holdPrincipalSessionExpiry } from './principal-session-mint.js';
import { canonicalClientAddress } from './client-address-canonical.js';
import { readRequestClientAddress } from './request-client-address.js';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` and `idpLocale` are getters.
 */
export interface DatabaseHooksHost {
  readonly config: AuthManager['config'];
  readonly idpLocale: AuthManager['idpLocale'];
  audienceLogError: AuthManager['audienceLogError'];
  getDataEngine: AuthManager['getDataEngine'];
  isCreatedInThisRequest: AuthManager['isCreatedInThisRequest'];
  linkingContext: AuthManager['linkingContext'];
  logDurabilityDegradation: AuthManager['logDurabilityDegradation'];
  settleMembership: AuthManager['settleMembership'];
  settleSelfRegistrationGrant: AuthManager['settleSelfRegistrationGrant'];
  stampIdentitySource: AuthManager['stampIdentitySource'];
  takeOwnerVerifiedStamp: AuthManager['takeOwnerVerifiedStamp'];
}

/** The body of `AuthManager#composeDatabaseHooks`; the method's docblock there is its contract. */
export function composeDatabaseHooks(
  this: Pick<DatabaseHooksHost, 'audienceLogError' | 'config' | 'idpLocale' | 'isCreatedInThisRequest' | 'linkingContext' | 'settleMembership' | 'settleSelfRegistrationGrant' | 'stampIdentitySource' | 'takeOwnerVerifiedStamp'>,
  host?: BetterAuthOptions['databaseHooks'],
): BetterAuthOptions['databaseHooks'] {
  // A landed link ends a standing unlink record (implicit-account-linking.ts,
  // rule 3). While the record stands an implicit link is refused, so a link
  // that lands here is an explicit one. Failure to clear is functional (the
  // user sees a refusal on their next implicit sign-in and can re-link), so
  // it is reported at `warn` and never fails the link. It runs FIRST, ahead
  // of the identity-source stamp, so a stamp failure can never leave a
  // landed link still refused.
  const resolveLinkingAdapter = () => this.linkingContext();
  const clearUnlink = async (account: any, ctx: any) => {
    try {
      await clearUnlinkTombstone(account, ctx, resolveLinkingAdapter);
    } catch (e) {
      this.config.logger?.warn?.('[auth] could not clear the unlink record after a link', {
        error: (e as Error)?.message,
      });
    }
  };
  const stamp = async (account: any, ctx: any) => {
    await clearUnlink(account, ctx);
    await this.stampIdentitySource(account, ctx);
  };
  const hostAccountAfter = (host as any)?.account?.create?.after;
  const after = hostAccountAfter
    ? async (account: any, ctx: any) => {
        await stamp(account, ctx);
        return hostAccountAfter(account, ctx);
      }
    : stamp;

  // A user's unlink is recorded so the provider cannot re-link implicitly
  // (implicit-account-linking.ts, rule 3) — BEFORE the account row goes, so
  // that a record which cannot be written aborts the unlink: a throw from a
  // `delete.before` hook propagates out of better-auth's delete, the unlink
  // answers an error and the identity stays linked. Fail closed: an unlink
  // that answered success without its record would leave the provider free
  // to re-link on the next sign-in. Reported at `error`, once per refusal.
  // A host `delete.before` runs first; its `false` (abort) is honoured
  // before anything is recorded.
  const hostAccountDeleteBefore = (host as any)?.account?.delete?.before;
  const accountDeleteBefore = async (account: any, ctx: any) => {
    const result = hostAccountDeleteBefore ? await hostAccountDeleteBefore(account, ctx) : undefined;
    if (result === false) return false;
    try {
      await recordUnlinkTombstone(account, ctx, resolveLinkingAdapter);
    } catch (e) {
      this.audienceLogError(
        '[auth] unlink refused: its record could not be written, so the provider stays linked. ' +
          'Without the record the provider could re-link this account implicitly on its next sign-in. ' +
          'Check the auth store (sys_verification) is writable, then unlink again.',
        { providerId: account?.providerId, error: (e as Error)?.message },
      );
      throw e;
    }
    return result;
  };

  // A deleted user leaves no unlink record behind (implicit-account-linking.ts).
  // A record that outlives its user is inert — a new user never has the
  // deleted user's id — so a failure is reported at `warn` and never fails
  // the deletion.
  const clearUserUnlinks = async (user: any, ctx: any) => {
    try {
      await clearUserUnlinkTombstones(user, ctx, resolveLinkingAdapter);
    } catch (e) {
      this.config.logger?.warn?.('[auth] could not clear the unlink record of a deleted user', {
        error: (e as Error)?.message,
      });
    }
  };
  const hostUserDeleteAfter = (host as any)?.user?.delete?.after;
  const userDeleteAfter = async (user: any, ctx: any) => {
    const result = hostUserDeleteAfter ? await hostUserDeleteAfter(user, ctx) : undefined;
    await clearUserUnlinks(user, ctx);
    await this.idpLocale.forget(user, ctx);
    return result;
  };

  // ADR-0093 D9 — default active-org on session create. Without it, a user
  // with memberships logs in with `activeOrganizationId = null`: better-auth
  // org endpoints can't resolve an active org (single-org invite dead-end)
  // and `{current_org_id}` nav tokens fall back to list views. Resolve the
  // caller's sys_member row (owner-preferred, else oldest) and stamp the
  // draft. Host hook runs first and wins; errors are swallowed so login
  // never fails on this bookkeeping. Opt out via `autoActiveOrganization:
  // false`.
  const hostSessionBefore = (host as any)?.session?.create?.before;

  /**
   * The membership → active-org selection, in ONE place: owner-preferred,
   * else the oldest row. It is called twice below and both calls must select
   * identically — a second, "simpler" lookup after the settle would silently
   * make a freshly-bound user's active org depend on which path found it.
   */
  const selectActiveOrg = async (reader: any, userId: string): Promise<string | undefined> => {
    let row: any;
    try {
      row = await reader.findOne('sys_member', { where: { user_id: userId, role: 'owner' } });
    } catch {
      row = undefined;
    }
    if (!row?.organization_id) {
      try {
        row = await reader.findOne('sys_member', { where: { user_id: userId } });
      } catch {
        row = undefined;
      }
    }
    return row?.organization_id;
  };

  const defaultActiveOrg = async (session: any, ctx: any) => {
    try {
      if (!session || session.activeOrganizationId) return;
      const userId = session.userId;
      if (!userId) return;
      const engine = this.config.dataEngine;
      if (!engine) return;
      // sys_member is org/user-scoped in host stacks — read with the system
      // context so the pre-session lookup (no org on the caller yet) works.
      const reader = withSystemReadContext(engine);
      let orgId = await selectActiveOrg(reader, userId);

      // [#8247 rule 2 / #8245] SETTLE THE MEMBERSHIP, THEN LOOK AGAIN.
      //
      // The ADR-0093 D2 reconciler is composed into `user.create.after`, and
      // better-auth DEFERS that past the sign-up transaction. This hook runs
      // inside it. So a user's very FIRST session is minted BEFORE the
      // reconciler has bound them to anything, the lookup above finds no
      // `sys_member` row, and the session carries no active organization —
      // for every new user, on every deployment, structurally.
      //
      // That first session is not a harmless intermediate. Everything it
      // writes is tenant-less: its `login` audit row is derived from
      // `session.activeOrganizationId` (`auth-session-audit.ts`), so it lands
      // with a NULL tenant and the SecurityPlugin's RLS predicate hides it
      // from every reader FOREVER — nothing back-fills a written ledger row,
      // and the rows lost this way are exactly the ones describing account
      // creation (#8245).
      //
      // So the settle is hoisted HERE, to the seam that actually needs it,
      // rather than the ordering being left to better-auth's hook scheduling.
      //
      // ⛔ THIS DOES NOT WIDEN WHO GETS BOUND, and that is the property to
      // preserve if this is ever touched: it calls the SAME reconciler with
      // the SAME policy and the SAME target-org resolution that
      // `user.create.after` uses (one owner — `settleMembership`), so the
      // outcome is byte-for-byte what would have happened a moment later.
      // `invite-only` still binds nobody; multi-org still resolves no
      // unambiguous target and binds nobody. Those users keep minting
      // sessions with no active organization, which is the LEGAL state the
      // #8247 ruling declares — this removes a race, never a policy.
      //
      // ⛔ AND IT RUNS ONLY FOR A USER WHOSE CREATION IS IN THIS REQUEST.
      // ADR-0093 D7: membership is decided at creation. A member-less user
      // signing in later is not a race to close — whatever left them without
      // a membership (the policy, or an administrator) has already decided,
      // and a sign-in must not decide again. The creation seam
      // (the adapter's `create`, via `onRecordCreated`) stages the new
      // user's id in the request's endpoint context; only a session minted
      // in that same request for that same user settles here
      // (`isCreatedInThisRequest`).
      //
      // Cost is paid only where there is something to fix: a caller who
      // already holds a membership never reaches this branch, every other
      // sign-in stops at an in-memory lookup, and a deployment that
      // binds nobody stops at the reconciler's own policy / target-org check
      // without touching the store. The re-read is gated on an outcome that
      // means a membership now EXISTS, so the common no-bind login costs no
      // extra query at all.
      if (!orgId && this.isCreatedInThisRequest(ctx, userId)) {
        const outcome = await this.settleMembership(userId);
        if (outcome === 'bound' || outcome === 'yielded') {
          orgId = await selectActiveOrg(reader, userId);
        }
      }

      if (!orgId) return;
      return { data: { ...session, activeOrganizationId: orgId } };
    } catch {
      return; // never break session create
    }
  };
  const sessionActiveOrgBefore =
    this.config.autoActiveOrganization !== false
      ? async (session: any, ctx: any) => {
          let draft = session;
          if (hostSessionBefore) {
            const hostResult = await hostSessionBefore(session, ctx);
            if (hostResult && typeof hostResult === 'object' && 'data' in hostResult) {
              draft = (hostResult as any).data;
            }
            // The host hook fully handled it → keep its result shape.
            if (draft?.activeOrganizationId) return { data: draft };
          }
          return (await defaultActiveOrg(draft, ctx)) ?? (draft === session ? undefined : { data: draft });
        }
      : hostSessionBefore;

  // [#26638] The session row's `ip_address` is the address the server
  // established for this request (the client-address trust rule,
  // `client-address.ts`, carried in the request state by `handleRequest`), in
  // its RFC 5952 text (`client-address-canonical.ts`). better-auth fills the
  // field from its own reader, which re-derives that address and stores its
  // rate-limit bucket instead: an IPv6 address expanded and masked to its /64
  // network, an IPv4-mapped one unmapped. No established address (a
  // programmatic `auth.api.*` call) ⇒ better-auth's value, in the same text.
  // It runs FIRST, so the steps below — the host's included — see the
  // captured address, and a host that sets `ipAddress` itself still wins.
  const captureSessionAddress = async (session: any) => {
    const derived = typeof session?.ipAddress === 'string' ? session.ipAddress : undefined;
    const ipAddress = canonicalClientAddress((await readRequestClientAddress()) ?? derived);
    return ipAddress === derived ? session : { ...session, ipAddress };
  };
  const sessionBefore = async (session: any, ctx: any) => {
    const captured = await captureSessionAddress(session);
    const result = sessionActiveOrgBefore ? await sessionActiveOrgBefore(captured, ctx) : undefined;
    if (result === false) return false;
    if (result && typeof result === 'object' && 'data' in result) {
      return { data: { ...captured, ...(result as any).data } };
    }
    return captured === session ? result : { data: captured };
  };

  // [#8144] The `login` / `logout` audit writers (#7675 sub-issue A). See
  // `auth-session-audit.ts` for why these two hooks and no others, and why
  // logout reads the endpoint path from the hook's own `ctx` argument rather
  // than from the ambient auth context.
  //
  // Host hooks chain FIRST and keep their result, exactly as `sessionActiveOrgBefore`
  // above does: the audit row is an observation, never a participant in what
  // better-auth decides. Both emitters are awaited but cannot throw
  // (`emitAuthSessionAuditEvent` swallows), so neither can turn a valid
  // sign-in or sign-out into an error.
  const hostSessionCreateAfter = (host as any)?.session?.create?.after;
  const sessionCreateAfter = async (session: any, ctx: any) => {
    const result = hostSessionCreateAfter ? await hostSessionCreateAfter(session, ctx) : undefined;
    await emitAuthSessionAuditEvent(
      this.config.getAuditSink?.(),
      loginEventFor(session, typeof ctx?.path === 'string' ? ctx.path : undefined),
    );
    // An external sign-in's staged `locale` claim lands on the user the
    // session names, new or returning (`idp-locale-claim.ts`). Never throws.
    await this.idpLocale.settle(session, ctx);
    return result;
  };
  // [#23772] A minted principal session is NEVER renewed. better-auth's
  // `get-session` renews any session past `updateAge` to `now + expiresIn`,
  // a short session from its first read, and on the bearer lane nothing
  // client-side can stop it (no dont-remember cookie rides a bearer). Every
  // renewal is one `internalAdapter.updateSession`, so the guard sits on
  // that write — the cookie lane, the bearer lane and the in-process
  // `getSession` alike, under secondary storage too
  // (`principal-session-mint.ts`, `holdPrincipalSessionExpiry`). A host
  // hook chains FIRST and its `false` (abort) is honoured; the guard then
  // judges what the host left.
  const hostSessionUpdateBefore = (host as any)?.session?.update?.before;
  const sessionUpdateBefore = async (update: any, ctx: any) => {
    let draft = update;
    if (hostSessionUpdateBefore) {
      const hostResult = await hostSessionUpdateBefore(update, ctx);
      if (hostResult === false) return false;
      if (hostResult && typeof hostResult === 'object' && 'data' in hostResult) {
        draft = { ...draft, ...(hostResult as any).data };
      }
    }
    const held = holdPrincipalSessionExpiry(draft, ctx);
    if (held) return { data: held };
    return draft === update ? undefined : { data: draft };
  };

  const hostSessionDeleteAfter = (host as any)?.session?.delete?.after;
  const sessionDeleteAfter = async (session: any, ctx: any) => {
    const result = hostSessionDeleteAfter ? await hostSessionDeleteAfter(session, ctx) : undefined;
    await emitAuthSessionAuditEvent(
      this.config.getAuditSink?.(),
      logoutEventFor(session, typeof ctx?.path === 'string' ? ctx.path : undefined),
    );
    return result;
  };

  // ADR-0093 D2 — the single owner of the membership invariant. Composed into
  // `user.create.after`, the one seam EVERY creation path flows through
  // (email signup, admin create-user, bulk import, SSO JIT). Host hook (e.g.
  // the cloud's personal-org provisioning) chains FIRST and wins; the
  // reconciler then yields to whatever membership exists, so there is never a
  // double bind. Best-effort — never fails user creation.
  const hostUserAfter = (host as any)?.user?.create?.after;
  const membershipReconciler = async (user: any) => {
    await this.settleMembership(user?.id);
    // [#11739] The second half of an admitted SELF-registration: settle the
    // DECLARED permission-set grant staged by the validateUserInfo gate —
    // landed now, owned by the membership the line above bound, or held as
    // a claim until the first membership (ADR-0131 D3). Same seam as the
    // membership bind (the one every creation path flows through), same
    // never-throw posture — but a failure here is reported at the
    // durability level, because an admitted-but-ungranted self-registrant
    // is the declared≠enforced state this card closes.
    await this.settleSelfRegistrationGrant(user);
  };
  const userAfter = hostUserAfter
    ? async (user: any, ctx: any) => {
        const hostResult = await hostUserAfter(user, ctx);
        await membershipReconciler(user);
        return hostResult;
      }
    : async (user: any) => {
        await membershipReconciler(user);
      };

  // [#12751] Walled owner-verified stamp, the CONSUMING half: the admission
  // gate staged the decision (see `validateAudienceAdmission` and
  // `walled-owner-operator-stamp.ts`); this before-hook lands it, so the
  // declared owner's operator-provisioned row is BORN `emailVerified: true`
  // — the same at-creation shape as a trusted-SSO insert, and the creation
  // write then replays `bootstrapPlatformAdmin` (`shouldReplayBootstrapFor`,
  // `create` arm), which elevates it with no further verification step.
  // `user.create.before` is a seam only a CREATION traverses, so a later
  // email UPDATE to the owner address structurally cannot inherit the
  // stamp. Host hook chains FIRST and keeps its result shape, exactly as
  // `sessionActiveOrgBefore` above does; a host `false` (refuse the creation) is
  // honoured before the stamp is even consumed.
  const hostUserBefore = (host as any)?.user?.create?.before;
  const userBefore = async (user: any, ctx: any) => {
    let draft = user;
    if (hostUserBefore) {
      const hostResult = await hostUserBefore(user, ctx);
      if (hostResult === false) return false;
      if (hostResult && typeof hostResult === 'object' && 'data' in hostResult) {
        draft = { ...draft, ...(hostResult as any).data };
      }
    }
    const email = typeof draft?.email === 'string' ? draft.email : '';
    if (email && this.takeOwnerVerifiedStamp(email)) {
      return { data: { ...draft, emailVerified: true } };
    }
    return draft === user ? undefined : { data: draft };
  };

  return {
    ...(host ?? {}),
    account: {
      ...((host as any)?.account ?? {}),
      create: {
        ...((host as any)?.account?.create ?? {}),
        after,
      },
      delete: {
        ...((host as any)?.account?.delete ?? {}),
        before: accountDeleteBefore,
      },
    },
    user: {
      ...((host as any)?.user ?? {}),
      create: {
        ...((host as any)?.user?.create ?? {}),
        before: userBefore,
        after: userAfter,
      },
      delete: {
        ...((host as any)?.user?.delete ?? {}),
        after: userDeleteAfter,
      },
    },
    session: {
      ...((host as any)?.session ?? {}),
      create: {
        ...((host as any)?.session?.create ?? {}),
        before: sessionBefore,
        after: sessionCreateAfter,
      },
      update: {
        ...((host as any)?.session?.update ?? {}),
        before: sessionUpdateBefore,
      },
      delete: {
        ...((host as any)?.session?.delete ?? {}),
        after: sessionDeleteAfter,
      },
    },
  } as BetterAuthOptions['databaseHooks'];
}

/** The body of `AuthManager#stampIdentitySource`; the method's docblock there is its contract. */
export async function stampIdentitySource(this: Pick<DatabaseHooksHost, 'getDataEngine' | 'logDurabilityDegradation'>, account: any, _ctx?: unknown): Promise<void> {
  try {
    const providerId = account?.providerId ?? account?.provider_id;
    const userId = account?.userId ?? account?.user_id;
    if (!userId || !providerId) return;
    const engine = this.getDataEngine();
    if (!engine) return;
    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

    if (providerId === 'credential') {
      // Gained a local password → env-native. Only write if currently
      // managed (avoids a no-op history row on every local signup).
      const u = await engine.findOne('sys_user', {
        where: { id: userId }, fields: ['id', 'source'], context: SYSTEM_CTX,
      });
      if (u && u.source === 'idp_provisioned') {
        await engine.update('sys_user', { id: userId, source: 'env_native' }, { context: SYSTEM_CTX } as any);
      }
      return;
    }

    // Federated link → managed, unless a local credential already exists.
    const credentialCount = await engine.count('sys_account', {
      where: { user_id: userId, provider_id: 'credential' },
      context: SYSTEM_CTX,
    });
    if (typeof credentialCount === 'number' && credentialCount > 0) return;
    await engine.update('sys_user', { id: userId, source: 'idp_provisioned' }, { context: SYSTEM_CTX } as any);
  } catch (e) {
    // Provenance stamp must never break federated login — so the login still
    // succeeds. [#12981] What it must not do is vanish: the stamp IS the
    // managed-vs-native gate.
    this.logDurabilityDegradation(
      'AuthManager: the sys_user.source provenance stamp was NOT written — the account link '
        + 'succeeded and the sign-in is fine, so nothing looks broken, but this user keeps the '
        + 'PREVIOUS source value. A federated user still reading `env_native` is offered the '
        + 'password / identity-edit actions that are supposed to hide for a managed identity '
        + '(cloud ADR-0024 D4), which is how a managed user self-mints a local password that '
        + 'bypasses enforced SSO. Remedy: make the sys_user update land (write permission on '
        + '`source`, driver connectivity); the stamp is idempotent and the next account link '
        + 'for this user re-runs it.',
      e,
      { object: 'sys_user', field: 'source' },
    );
  }
}
