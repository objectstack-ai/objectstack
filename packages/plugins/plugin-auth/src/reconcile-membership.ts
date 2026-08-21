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
 *     never auto-binds; anything else is REFUSED, see below);
 *   - binds only to an unambiguous target org (single-org's default org;
 *     `multi` mode returns none — invite / JIT own membership there);
 *   - is idempotent (keyed on the `(organization_id, user_id)` unique index)
 *     and never throws (a failed bind must not fail user creation — the
 *     kernel:ready backfill is the self-healing net).
 *
 * ## Both entry points refuse an off-vocabulary policy (#5205)
 *
 * `reconcileMembership` and `backfillMemberships` are public exports of
 * `@objectstack/plugin-auth`, so a JavaScript caller or a host stack can hand
 * either one a policy the `MembershipPolicy` type would have rejected. They
 * used to disagree about what that means: the sign-up reconciler tested
 * `policy === 'invite-only'`, so a typo'd `'inviteOnly'` fell through to the
 * `auto` branch and **auto-bound anyway** (fail-open — a caller who believed
 * they had switched auto-binding off got it silently), while the backfill
 * tested `policy !== 'auto'` and refused (fail-safe). One input, two opposite
 * postures, and the dangerous one was on the per-sign-up path.
 *
 * Both now check {@link isMembershipPolicy} at the entry and return a distinct
 * `'invalid-policy'` outcome/reason naming the offending value. It is a
 * separate verdict on purpose rather than a reuse of `policy-skip`: reporting
 * "skipped by policy" for "your policy is not a policy" sends whoever is
 * debugging the auto-bind to read the deployment's setting, which is fine, and
 * find it looking exactly as they left it, which is not. This matches the
 * posture #5152 took one layer up at the settings boundary — an unrecognised
 * value is rejected loudly, never coerced to `auto`.
 */

import { authSystemWriteContext } from './auth-actor-attribution.js';

/**
 * The closed vocabulary of deployment membership policies (ADR-0093 D1).
 *
 * Exported as a runtime value, not just a type, because the policy also
 * arrives from the `auth.membership_policy` platform setting — an untyped
 * boundary (a stored row, or an `OS_AUTH_MEMBERSHIP_POLICY` env value that
 * never passes through the settings service's option-table validation). The
 * binding in `auth-plugin.ts` checks against THIS list and rejects anything
 * else loudly rather than coercing it, so only these two values can ever
 * reach a reconciler.
 */
export const MEMBERSHIP_POLICIES = ['auto', 'invite-only'] as const;

export type MembershipPolicy = (typeof MEMBERSHIP_POLICIES)[number];

/** Type guard over {@link MEMBERSHIP_POLICIES}. */
export function isMembershipPolicy(value: unknown): value is MembershipPolicy {
  return (MEMBERSHIP_POLICIES as readonly string[]).includes(value as string);
}

export type ReconcileOutcome =
  /** Inserted a `sys_member` row binding the user to the target org. */
  | 'bound'
  /** The user already had a membership — respected it, wrote nothing. */
  | 'yielded'
  /** `membershipPolicy: 'invite-only'` — auto-bind is off by policy. */
  | 'policy-skip'
  /**
   * The policy was not one of {@link MEMBERSHIP_POLICIES} — refused, nothing
   * bound (#5205). Distinct from `policy-skip`, which means a *valid* policy
   * said no; this one means the caller's policy value is unusable.
   */
  | 'invalid-policy'
  /** No unambiguous target org (multi mode, or single mode not bootstrapped). */
  | 'no-target-org'
  /** An error occurred and was swallowed (never fails user creation). */
  | 'failed'
  /** Preconditions unmet (no engine / no user id). */
  | 'skipped';

export interface ReconcileMembershipDeps {
  /**
   * Deployment membership policy. Default `'auto'` at the call site.
   *
   * Checked at runtime as well as declared: these functions are exported, so a
   * JS caller can pass anything. Anything outside {@link MEMBERSHIP_POLICIES}
   * is refused (`'invalid-policy'`), never coerced to `auto`.
   */
  policy: MembershipPolicy;
  /**
   * Resolve the organization to bind the user to. Single-org → the default org;
   * multi-org → `null` (the framework never guesses). Typically
   * `tenancy.defaultOrgId`.
   */
  resolveTargetOrg: () => Promise<string | null>;
  logger?: {
    info?: (msg: string, meta?: any) => void;
    /**
     * The GUARANTEED fallback channel (#9754). `error` stays optional — hosts do
     * inject reduced sinks — so `warn` is where a durability report lands when
     * `error` is absent, and a fallback that may itself be missing is not a
     * fallback. Call sites keep the `logger?.warn?.(…)` spelling as the backstop
     * for hosts the TYPE cannot reach; `SweepLogger` in plugin-email's
     * `outbox-sweep.ts` carries the full reasoning and the measurement.
     */
    warn: (msg: string, meta?: any) => void;
    error?: (msg: string, meta?: any) => void;
  };
}

const SYSTEM_CTX = { isSystem: true };

/**
 * Describe a rejected policy value for whoever reads the log, without trusting
 * it. The declared vocabulary is two short literals, so echoing a *string*
 * back is the entire point of the message — it is how the reader sees
 * `'inviteOnly'` where they expected `'invite-only'`. Anything else is a value
 * that arrived off the type contract, i.e. arbitrary caller data, and a log
 * line is the wrong place to find out it was an object carrying user fields:
 * those report as their `typeof` only. Strings are bounded for the same
 * reason — a policy is never 64 characters long, so anything longer is not a
 * typo and does not need to be reproduced in full to be diagnosed.
 */
function describePolicy(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 64 ? `'${value.slice(0, 64)}…' (truncated)` : `'${value}'`;
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return `[${typeof value}]`;
}

/**
 * Refuse an off-vocabulary policy the same way from both entry points (#5205):
 * one message, one log level, one returned description.
 *
 * `error`, not `warn`, for the reason #5152 gives at the settings boundary —
 * nothing looks broken afterwards. The bind simply does not happen, and if
 * this passed quietly the deployment would either keep auto-binding while an
 * operator believed it had stopped (the old sign-up behaviour) or stop binding
 * with no stated cause. Falls back to `warn` only because `error` is optional
 * on the logger shape and a caller passing a two-method logger should still
 * hear about it; the message is identical either way.
 */
function refuseInvalidPolicy(deps: ReconcileMembershipDeps, meta: Record<string, unknown>): string {
  const described = describePolicy(deps.policy as unknown);
  const message =
    `[membership] refusing to bind: membership policy ${described} is not a recognized value ` +
    `— expected one of: ${MEMBERSHIP_POLICIES.join(', ')}`;
  const log = deps.logger?.error ?? deps.logger?.warn;
  log?.(message, { ...meta, policy: described, expected: MEMBERSHIP_POLICIES });
  return message;
}

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
): Promise<{ outcome: ReconcileOutcome; organizationId?: string; error?: string }> {
  if (!engine || typeof engine.find !== 'function' || typeof engine.insert !== 'function' || !userId) {
    return { outcome: 'skipped' };
  }
  // #5205 — before any policy semantics, is this a policy at all? Testing
  // `=== 'invite-only'` alone let every other value fall through to the `auto`
  // branch and bind. The check is not dead code: the type says
  // `MembershipPolicy`, the export surface says a JS caller can say otherwise.
  if (!isMembershipPolicy(deps.policy)) {
    return { outcome: 'invalid-policy', error: refuseInvalidPolicy(deps, { userId }) };
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
  reason?: 'policy' | 'invalid-policy' | 'no-target-org' | 'engine-unavailable';
  /**
   * Present with `reason: 'invalid-policy'` — the refusal message, naming the
   * offending value. Carried on the result, not only logged, so the diagnosis
   * survives a caller that passed no logger (#5205).
   */
  error?: string;
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
  // #5205 — same order, same verdict as the sign-up path. This one already
  // refused an off-vocabulary value, but reported it as `'policy'`, which
  // reads as "the deployment's policy said no" and hides a caller bug.
  if (!isMembershipPolicy(deps.policy)) {
    return { ...summary, reason: 'invalid-policy', error: refuseInvalidPolicy(deps, { pass: 'backfill' }) };
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
