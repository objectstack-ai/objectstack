// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15784] When a membership ends, the session's claim on that organization
 * ends with it — the COURTESY half of #15409's ruling.
 *
 * ## ⛔ This is not the enforcement, and must never be treated as one
 *
 * #15409 closed the security hole PER REQUEST: `resolve-authz-context.ts` asks,
 * on every single request, whether the session's `activeOrganizationId` is
 * still backed by a `sys_member` row, and drops the claim when it is not. That
 * check covers every removal path **by construction**, including the ones this
 * module cannot see.
 *
 * This module is an EVENT trigger, and an event trigger covers exactly the
 * paths someone remembered to wire. Its own census (posted on #15784) measured
 * one production path it does NOT cover, and there will be others:
 *
 *   - cloud's package-uninstall sample-data purge calls the RAW DRIVER with an
 *     object name taken from the package manifest (`envDriver.delete(objectName,
 *     id)`), so it lands below every engine hook — measured firing NOTHING here
 *     while the row really disappeared. Filed as cloud#2003.
 *
 * ⇒ ⛔ **Never weaken, bypass or "optimise away" the per-request check on the
 * strength of this trigger existing** (scope item 3, verbatim). A trigger can
 * be missed; an evaluation cannot. A missed path here costs a stale login
 * session — never access.
 *
 * ## Ruled shape: act on the ORGANIZATION'S CLAIM, never on the user
 *
 * Maintainer ruling, decision batch #49 item 4 (2026-09-05), option **B** — the
 * same principle #15409 landed:
 *
 *   - a session whose `active_organization_id` points at the organization the
 *     membership just ended in loses THAT claim: re-pointed to a membership the
 *     user still holds, or cleared;
 *   - a user with **no remaining membership** has nothing left to be signed
 *     into, so the session is revoked through the existing
 *     `sys_session.revoked_at` / `revoke_reason` mechanism with
 *     {@link MEMBERSHIP_ENDED_REVOKE_REASON};
 *   - ⛔ revoking EVERY session of the user was rejected — it signs people out
 *     of organizations they legitimately belong to;
 *   - ⛔ doing nothing was rejected — the admin was told the person was removed.
 *
 * ## Why the seam is an ENGINE HOOK and not the endpoint
 *
 * Measured, not assumed (#15784's census, a probe registered on `sys_member`
 * driven against a real booted stack):
 *
 * ```
 * PATH 0  engine.delete (direct)                  -> beforeDelete,afterDelete   (firing control)
 * PATH 1  better-auth /organization/remove-member  -> HTTP 200; row gone; beforeDelete,afterDelete
 * PATH 2  engine.delete multi:true                 -> beforeDelete,afterDelete
 * PATH 3  cascade via sys_user delete              -> row gone; beforeDelete,afterDelete
 * PATH 4  driver.delete (raw)                      -> row gone; NOTHING
 * PATH 5  engine.update re-point organization_id   -> beforeUpdate,afterUpdate
 * ```
 *
 * A hook on `/organization/remove-member` would have covered exactly one row of
 * that table. This is also the precedent already in this package:
 * `last-admin-guard.ts` enforces its invariant with `beforeUpdate` /
 * `beforeDelete` on `sys_member` for the same stated reason — an HTTP guard
 * protects only the endpoint it is attached to.
 *
 * ## Why REVOKING ends the session, with no client change
 *
 * `session-tombstone.ts` already made a revoked row invisible to better-auth's
 * own session reads, and this write uses the same shape the automatic controls
 * use (`enforceSessionControls` / `enforceConcurrentCap`): `expires_at` a
 * second into the past, plus both audit columns. `findSession` then answers
 * `null`, the next request is unauthenticated, and the Console's existing
 * 401 → login redirect handles it.
 *
 * ## Best-effort, and LOUD about it
 *
 * A failed revocation must never turn a successful member removal into a 500 —
 * so every write is caught. But a control that silently stops running is a
 * control the operator still believes is on (#12981), so each catch reports
 * what did not happen and what it costs.
 */

import { SystemObjectName } from '@objectstack/spec/system';

/**
 * The `revoke_reason` a session ended by a membership removal records.
 *
 * ## Why this exact string
 *
 * Every reason on this column before it is a TIMER — `idle_timeout`,
 * `absolute_max`, `concurrent_cap` — or an interactive revoke —
 * `user_revoked`, `admin` (`session-tombstone.ts`). This is the first
 * AUTHORIZATION-EVENT reason, so it names the event and not a clock.
 *
 * It is deliberately the SAME string the API-key arm of this ruling family
 * already mints for the same event: `resolve-authz-context.ts` refuses an API
 * key whose backing membership ended with
 * `authRefusal.reason: 'organization_membership_ended'` (#15256, decision 1A).
 * One grep therefore finds every place the platform acts on a membership
 * ending, across both credential kinds — worth more than four saved
 * characters, and comfortably inside the column's `maxLength: 64`.
 */
export const MEMBERSHIP_ENDED_REVOKE_REASON = 'organization_membership_ended';

/**
 * How many of one user's sessions this sweep will consider.
 *
 * Mirrors `enforceConcurrentCap`'s ceiling. Overflow is REPORTED and the rest
 * are still processed — unlike `last-admin-guard`, which refuses on overflow
 * because it is an invariant. This is a courtesy: doing it for 200 sessions and
 * saying so beats doing it for none.
 */
const DEFAULT_MAX_SESSION_SCAN = 200;

/** System context for this module's reads and writes. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

type LoggerLike = {
  info?(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
};

/** The slice of the engine this module uses. */
export interface MembershipEndedSessionEngine {
  find(object: string, query: unknown, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
  registerHook(event: string, handler: (ctx: any) => unknown, options?: unknown): void;
  unregisterHooksByPackage?(packageId: string): void;
}

export interface MembershipEndedSessionOptions {
  /** Owning package id — used for `unregisterHooksByPackage` on re-bind. */
  packageId: string;
  logger?: LoggerLike;
  /** Ceiling on sessions considered per ended membership. */
  maxSessionScan?: number;
}

/** What this module did to one session. */
export type MembershipEndOutcome =
  /** The claim was re-pointed at an organization the user still belongs to. */
  | { action: 'repointed'; sessionId: string; from: string | null; to: string | null }
  /** The user held no remaining membership: the session was revoked. */
  | { action: 'revoked'; sessionId: string; from: string | null }
  /** A write was refused; the session is UNCHANGED. */
  | { action: 'failed'; sessionId: string; intended: 'repointed' | 'revoked' };

/** The end of one `(user, organization)` binding. */
export interface EndedMembership {
  userId: string;
  /** `null` in single-org deployments, where memberships carry no org id. */
  organizationId: string | null;
  /** The `sys_member` row that ended, so it is excluded from "what remains". */
  memberRowId?: string;
}

function rowsOf(result: unknown): Array<Record<string, any>> {
  if (Array.isArray(result)) return result as Array<Record<string, any>>;
  const records = (result as { records?: unknown } | null)?.records;
  return Array.isArray(records) ? (records as Array<Record<string, any>>) : [];
}

function idOf(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length > 0 ? s : null;
}

/**
 * Is this `sys_session` row still one a request could authenticate with?
 *
 * The same predicate `enforceConcurrentCap` uses: not already tombstoned, and
 * not already past its expiry.
 */
function isLiveSession(row: Record<string, any>, now: number): boolean {
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false;
  return true;
}

/**
 * Apply the ruling to every live session of `userId` that claims the
 * organization the membership just ended in.
 *
 * Exported so the behaviour is testable without a hook, and so a host that
 * removes memberships outside the engine (see the module header's known-open
 * path) can call it directly rather than re-implementing the rule.
 *
 * Never throws.
 */
export async function endSessionClaimsForEndedMembership(
  engine: MembershipEndedSessionEngine,
  ended: EndedMembership,
  opts: { logger?: LoggerLike; maxSessionScan?: number } = {},
): Promise<MembershipEndOutcome[]> {
  const { logger } = opts;
  const maxScan = opts.maxSessionScan ?? DEFAULT_MAX_SESSION_SCAN;
  const userId = idOf(ended.userId);
  if (!userId) return [];
  const endedOrg = ended.organizationId == null ? null : idOf(ended.organizationId);
  const outcomes: MembershipEndOutcome[] = [];

  try {
    // ── 1. What does this user still belong to? ──────────────────────────────
    //
    // Read AFTER the removal, so the ended row is already gone on the delete
    // path. On the re-point path the row survives with its NEW organization, so
    // it legitimately counts as a remaining membership — and is excluded only
    // from being its own re-point target when it still names the ended org.
    const stillHeld = rowsOf(
      await engine.find(
        SystemObjectName.MEMBER,
        { where: { user_id: userId }, fields: ['id', 'organization_id', 'created_at'], limit: maxScan + 1 },
        { context: SYSTEM_CTX },
      ),
    ).filter((m) => idOf(m.organization_id) !== endedOrg);

    // Oldest first, so the re-point target is deterministic and matches the
    // organization the platform's own active-org backfill would have chosen.
    const targets = stillHeld
      .filter((m) => idOf(m.organization_id) != null)
      .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
    const repointTo = targets.length > 0 ? idOf(targets[0].organization_id) : null;
    const holdsAnother = stillHeld.length > 0;

    // ── 2. Which of this user's live sessions claim the ended organization? ──
    const sessions = rowsOf(
      await engine.find(
        SystemObjectName.SESSION,
        {
          where: { user_id: userId },
          fields: ['id', 'active_organization_id', 'expires_at', 'revoked_at'],
          limit: maxScan + 1,
        },
        { context: SYSTEM_CTX },
      ),
    );
    if (sessions.length > maxScan) {
      logger?.warn(
        '[MembershipEndedSession] this user has more sessions than the sweep considers, so some '
          + 'sessions keeping a claim on the organization they were just removed from were NOT '
          + 'visited. They are not a security exposure — the per-request membership check '
          + 'drops the stale claim on their next request — but the courtesy this trigger '
          + 'provides did not reach them. Remedy: raise maxSessionScan.',
        { object: SystemObjectName.SESSION, userId, maxSessionScan: maxScan },
      );
    }

    const now = Date.now();
    const affected = sessions
      .slice(0, maxScan)
      .filter((s) => isLiveSession(s, now))
      .filter((s) => idOf(s.active_organization_id) === endedOrg);

    // ── 3. Act on the CLAIM, never on the user ──────────────────────────────
    for (const session of affected) {
      const sessionId = idOf(session.id);
      if (!sessionId) continue;
      const from = idOf(session.active_organization_id);

      if (holdsAnother) {
        // ⛔ Not a revocation: this person legitimately belongs somewhere else.
        // `repointTo` is null when every remaining membership carries a null
        // organization id (single-org mode) — clearing the claim is then the
        // "or cleared" half of the ruling, and the resolver treats a session
        // with no active organization as an existing, well-defined state.
        try {
          await engine.update(
            SystemObjectName.SESSION,
            { id: sessionId, active_organization_id: repointTo },
            { context: SYSTEM_CTX },
          );
          outcomes.push({ action: 'repointed', sessionId, from, to: repointTo });
        } catch (e) {
          outcomes.push({ action: 'failed', sessionId, intended: 'repointed' });
          logger?.warn(
            '[MembershipEndedSession] a session still naming the organization its owner was just '
              + 'removed from was NOT re-pointed — the removal itself succeeded, so nothing looks '
              + 'wrong. The session keeps a stale `active_organization_id`. This is NOT an access '
              + 'exposure: the per-request membership check in `resolve-authz-context` resolves '
            + 'that claim to no '
              + 'active organization on the very next request. What is lost is the courtesy — the '
              + 'user is not switched to an organization they do still belong to. Remedy: make the '
              + 'sys_session update land; check write permission on `active_organization_id`.',
            { object: SystemObjectName.SESSION, sessionId, userId, error: (e as Error)?.message },
          );
        }
        continue;
      }

      // No membership left anywhere ⇒ nothing to be signed into. Revoke through
      // the EXISTING mechanism, in the shape the automatic controls write.
      try {
        await engine.update(
          SystemObjectName.SESSION,
          {
            id: sessionId,
            // A second in the past, matching `enforceSessionControls` /
            // `enforceConcurrentCap`, so every `expiresAt < now` liveness check
            // in better-auth is strictly true even at millisecond resolution.
            expires_at: new Date(now - 1000),
            revoked_at: new Date(now),
            revoke_reason: MEMBERSHIP_ENDED_REVOKE_REASON,
          },
          { context: SYSTEM_CTX },
        );
        outcomes.push({ action: 'revoked', sessionId, from });
      } catch (e) {
        outcomes.push({ action: 'failed', sessionId, intended: 'revoked' });
        logger?.warn(
          '[MembershipEndedSession] the session of a user whose LAST membership just ended was '
            + 'NOT revoked — the removal itself succeeded, so nothing looks wrong, and the admin '
            + 'who clicked "Remove member" believes that person was signed out. They are still '
            + 'signed in, for up to the session\'s remaining lifetime. This is NOT an access '
            + 'exposure: with no backing membership the per-request membership check already '
            + 'resolves them to no active organization. Remedy: make the sys_session update land '
            + '— check write permission on `expires_at` / `revoked_at` / `revoke_reason`.',
          { object: SystemObjectName.SESSION, sessionId, userId, error: (e as Error)?.message },
        );
      }
    }
  } catch (e) {
    // The LOOKUP half failing. Same posture: never break the removal, never be
    // silent about a control that did not run.
    logger?.warn(
      '[MembershipEndedSession] the membership-ended session sweep did not run to completion — '
        + 'the member removal succeeded, so nothing looks wrong. Sessions holding a claim on the '
        + 'organization the membership ended in were neither re-pointed nor revoked. This is NOT '
        + 'an access exposure — the per-request membership check covers every removal path by '
        + 'construction — but the sign-out an admin expects did not happen. Remedy: this is the '
        + 'READ half, so check driver connectivity and read access on sys_member / sys_session.',
      { object: SystemObjectName.MEMBER, userId, error: (e as Error)?.message },
    );
  }

  return outcomes;
}

/**
 * Bind the trigger to an ObjectQL engine.
 *
 * TWO hooks, because the census measured two ways a membership ends:
 *
 *  - `afterDelete` on `sys_member` — the row is gone (better-auth's
 *    `/organization/remove-member`, a direct delete, a bulk delete, the cascade
 *    from a `sys_user` delete);
 *  - `afterUpdate` on `sys_member` — the row survives but its
 *    `organization_id` moved, which ends the membership in the organization it
 *    left just as surely.
 *
 * Both are AFTER hooks on purpose: a membership the platform refused to remove
 * (`last-admin-guard`'s `beforeDelete` at priority 20) must not have its
 * sessions touched.
 *
 * Idempotent per package, like the sibling guards: a caller re-binding after a
 * hot reload runs `unregisterHooksByPackage(packageId)` first.
 */
export function registerMembershipEndedSessionTrigger(
  engine: MembershipEndedSessionEngine,
  opts: MembershipEndedSessionOptions,
): void {
  const { packageId, logger } = opts;
  const maxSessionScan = opts.maxSessionScan ?? DEFAULT_MAX_SESSION_SCAN;

  const onDelete = async (ctx: any): Promise<void> => {
    if (ctx?.object !== SystemObjectName.MEMBER) return;
    // A delete carries no payload, so `previous` is the only source for WHO and
    // WHERE — the engine binds it for `afterDelete` precisely for this.
    const previous = ctx?.previous;
    const userId = idOf(previous?.user_id);
    if (!userId) return;
    await endSessionClaimsForEndedMembership(
      engine,
      { userId, organizationId: idOf(previous?.organization_id), memberRowId: idOf(ctx?.input?.id) ?? undefined },
      { logger, maxSessionScan },
    );
  };

  const onUpdate = async (ctx: any): Promise<void> => {
    if (ctx?.object !== SystemObjectName.MEMBER) return;
    const data = ctx?.input?.data as Record<string, unknown> | undefined;
    // Only a write that MOVED the organization ends a membership. A role
    // change does not — the person is still in the room.
    if (!data || !('organization_id' in data)) return;
    const previous = ctx?.previous;
    const before = idOf(previous?.organization_id);
    const after = idOf(data.organization_id);
    if (before === after) return;
    const userId = idOf(previous?.user_id) ?? idOf((data as any).user_id);
    if (!userId) return;
    await endSessionClaimsForEndedMembership(
      engine,
      { userId, organizationId: before, memberRowId: idOf(ctx?.input?.id) ?? undefined },
      { logger, maxSessionScan },
    );
  };

  if (packageId && typeof engine.unregisterHooksByPackage === 'function') {
    try {
      engine.unregisterHooksByPackage(packageId);
    } catch {
      /* first bind — nothing registered yet */
    }
  }

  // Default priority: this is an AFTER hook that writes a different table, so
  // it has no ordering relationship with the guards at 5 / 10 / 20.
  engine.registerHook('afterDelete', onDelete, { object: SystemObjectName.MEMBER, packageId });
  engine.registerHook('afterUpdate', onUpdate, { object: SystemObjectName.MEMBER, packageId });

  logger?.info?.(
    '[MembershipEndedSession] membership-ended session trigger registered on sys_member '
      + '(delete + organization re-point) — the COURTESY half of the membership-claim ruling. '
      + 'The per-request membership check remains the enforcement.',
  );
}
