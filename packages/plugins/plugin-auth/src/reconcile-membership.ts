// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Membership reconciler — the single owner of the "every new user gets an
 * organization membership" invariant (ADR-0093 D1/D2).
 *
 * Before this, the invariant was re-implemented (or forgotten) per creation
 * path: invite / add-member / SSO JIT / the cloud host hook created a
 * `sys_member` row; `/admin/create-user` and `/admin/import-users` did not,
 * leaving member-less users who — in single-org mode — log in with a null
 * active organization and are missing from the Members list.
 *
 * This reconciler is composed into better-auth's `user.create.after` database
 * hook (see auth-manager `composeDatabaseHooks`), the one seam every creation
 * path flows through — email signup, admin create, bulk import, SSO JIT, and
 * any future path. It:
 *   - yields to any pre-existing membership (so a host hook that already bound
 *     the user — e.g. the cloud's personal-org provisioning — wins, and there
 *     is never a double membership);
 *   - honors the deployment's `membershipPolicy` (`auto` binds; `invite-only`
 *     never auto-binds);
 *   - binds only to an unambiguous target org (single-org's default org;
 *     `multi` mode returns none — invite / JIT own membership there);
 *   - is idempotent (keyed on the `(organization_id, user_id)` unique index)
 *     and never throws (a failed bind must not fail user creation — the
 *     kernel:ready backfill is the self-healing net).
 */

import { authSystemWriteContext } from './auth-actor-attribution.js';

export type MembershipPolicy = 'auto' | 'invite-only';

export type ReconcileOutcome =
  /** Inserted a `sys_member` row binding the user to the target org. */
  | 'bound'
  /** The user already had a membership — respected it, wrote nothing. */
  | 'yielded'
  /** `membershipPolicy: 'invite-only'` — auto-bind is off by policy. */
  | 'policy-skip'
  /** No unambiguous target org (multi mode, or single mode not bootstrapped). */
  | 'no-target-org'
  /** An error occurred and was swallowed (never fails user creation). */
  | 'failed'
  /** Preconditions unmet (no engine / no user id). */
  | 'skipped';

export interface ReconcileMembershipDeps {
  /** Deployment membership policy. Default `'auto'` at the call site. */
  policy: MembershipPolicy;
  /**
   * Resolve the organization to bind the user to. Single-org → the default org;
   * multi-org → `null` (the framework never guesses). Typically
   * `tenancy.defaultOrgId`.
   */
  resolveTargetOrg: () => Promise<string | null>;
  logger?: { info?: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void };
}

const SYSTEM_CTX = { isSystem: true };

function genMemberId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `mem_${ts}${rand}`;
}

async function findRows(
  engine: any,
  object: string,
  where: Record<string, unknown>,
  limit: number,
): Promise<any[]> {
  if (!engine || typeof engine.find !== 'function') return [];
  try {
    const rows = await engine.find(object, { where, limit }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : [];
  } catch {
    return [];
  }
}

async function insertMembership(engine: any, organizationId: string, userId: string): Promise<void> {
  await engine.insert(
    'sys_member',
    { id: genMemberId(), organization_id: organizationId, user_id: userId, role: 'member' },
    // [#4586] The bind runs inside better-auth's `user.create.after`, so when
    // the creation was an ADMIN action (`/admin/create-user`, bulk import) the
    // acting human is in scope and the membership row's history names them
    // instead of "system". Self sign-up resolves nothing (no session yet) and
    // records as the system — correct, nobody else acted. `isSystem` is
    // constructed here regardless: this is a platform write to a
    // better-auth-managed table, and attribution never changes that.
    { context: await authSystemWriteContext() },
  );
}

/**
 * Reconcile membership for one freshly-created user. Safe to call from a
 * better-auth `user.create.after` hook — never throws, always resolves to a
 * structured outcome. See the module doc for the decision order.
 */
export async function reconcileMembership(
  engine: any,
  userId: string | undefined,
  deps: ReconcileMembershipDeps,
): Promise<{ outcome: ReconcileOutcome; organizationId?: string }> {
  if (!engine || typeof engine.find !== 'function' || typeof engine.insert !== 'function' || !userId) {
    return { outcome: 'skipped' };
  }
  if (deps.policy === 'invite-only') {
    return { outcome: 'policy-skip' };
  }
  try {
    // Yield to ANY existing membership (a host hook may have just bound the
    // user; a retry may have already run). This is what makes host composition
    // safe by construction — no ordering negotiation beyond "host first".
    const existingAny = await findRows(engine, 'sys_member', { user_id: userId }, 1);
    if (existingAny.length > 0) {
      return { outcome: 'yielded', organizationId: existingAny[0]?.organization_id };
    }

    const organizationId = await deps.resolveTargetOrg();
    if (!organizationId) {
      return { outcome: 'no-target-org' };
    }

    // Re-check the exact pair right before insert to avoid tripping the
    // (organization_id, user_id) unique index on a race.
    const existingPair = await findRows(
      engine,
      'sys_member',
      { organization_id: organizationId, user_id: userId },
      1,
    );
    if (existingPair.length > 0) {
      return { outcome: 'yielded', organizationId };
    }

    await insertMembership(engine, organizationId, userId);
    deps.logger?.info?.('[membership] bound user to organization', { userId, organizationId });
    return { outcome: 'bound', organizationId };
  } catch (error) {
    deps.logger?.warn?.('[membership] reconcile failed (user creation unaffected)', {
      userId,
      error: (error as Error)?.message ?? String(error),
    });
    return { outcome: 'failed' };
  }
}

export interface BackfillMembershipsResult {
  scanned: number;
  bound: number;
  skipped: number;
  reason?: 'policy' | 'no-target-org' | 'engine-unavailable';
}

/**
 * One-shot backfill for pre-existing member-less users (ADR-0093 D6). Run on
 * `kernel:ready` in single mode with `membershipPolicy: 'auto'` only — multi-org
 * backfill is refused by design (there is no correct guess, and a wrong org in a
 * tenant-isolated deployment is a data-exposure bug, not a convenience).
 *
 * Bounded, idempotent, failure-isolated per user. Ordered after the default-org
 * bootstrap so a target org exists.
 */
export async function backfillMemberships(
  engine: any,
  deps: ReconcileMembershipDeps & { limit?: number },
): Promise<BackfillMembershipsResult> {
  const summary: BackfillMembershipsResult = { scanned: 0, bound: 0, skipped: 0 };
  if (!engine || typeof engine.find !== 'function' || typeof engine.insert !== 'function') {
    return { ...summary, reason: 'engine-unavailable' };
  }
  if (deps.policy !== 'auto') {
    return { ...summary, reason: 'policy' };
  }
  const organizationId = await deps.resolveTargetOrg();
  if (!organizationId) {
    return { ...summary, reason: 'no-target-org' };
  }

  const limit = deps.limit ?? 5000;
  const users = await findRows(engine, 'sys_user', {}, limit);
  const members = await findRows(engine, 'sys_member', {}, limit);
  const membered = new Set(members.map((m: any) => String(m?.user_id ?? '')).filter(Boolean));

  for (const user of users) {
    const uid = String(user?.id ?? '');
    if (!uid) continue;
    summary.scanned += 1;
    if (membered.has(uid)) {
      summary.skipped += 1;
      continue;
    }
    try {
      await insertMembership(engine, organizationId, uid);
      summary.bound += 1;
      membered.add(uid);
    } catch (error) {
      summary.skipped += 1;
      deps.logger?.warn?.('[membership] backfill bind failed for user', {
        userId: uid,
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  deps.logger?.info?.('[membership] backfill complete', { organizationId, ...summary });
  return summary;
}
