// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7725] Membership adoption — reconcile better-auth's insert-only membership
 * write with the platform's own "every user is already bound" invariant.
 *
 * ## The defect this closes
 *
 * `POST /api/v1/auth/organization/accept-invitation` returned a **bodyless HTTP
 * 500** and left the `sys_invitation` row `pending` forever. The server log
 * named the cause exactly:
 *
 * ```
 * insert into sys_member … UNIQUE constraint failed: sys_member.organization_id, sys_member.user_id
 * ```
 *
 * Two platform decisions collide, and both are individually correct:
 *
 *  1. **ADR-0093 D1/D2** — every user is auto-bound to the deployment's default
 *     organization at sign-up, by the membership reconciler
 *     (`reconcile-membership.ts`, composed into `user.create.after`).
 *  2. **`sys_member` declares `{ organization_id, user_id }` unique** — one
 *     membership per (org, user) pair, which is the platform's identity key for
 *     a membership, not merely a constraint.
 *
 * better-auth's built-in accept-invitation route (`crud-invites.mjs`) assumes an
 * invitee is never already a member: after flipping the invitation to
 * `accepted` it calls `adapter.createMember(...)` unconditionally, inside a
 * transaction whose `catch` rolls the invitation **back to `pending`** and
 * rethrows. So a single-org deployment — where the reconciler has already bound
 * the invitee to the very org they are being invited into — could never accept
 * an invitation at all. The reconciler yields to a pre-existing row
 * (`insertMembership` checks first); better-auth's insert does not go through
 * that seam.
 *
 * ## Why the seam is HERE, at the better-auth → ObjectQL adapter
 *
 * The three hook seams the framework already owns on this route all run at the
 * wrong moment or with the wrong reach. Measured 2026-08-20 against the
 * installed better-auth `1.7.1`, whose
 * `dist/plugins/organization/routes/crud-invites.mjs` still calls
 * `adapter.createMember(...)` unconditionally at `:324` and, in the `.catch`
 * at `:332-339`, rolls the invitation back to `"pending"` and rethrows —
 * `beforeAcceptInvitation` fires ahead of all of it at `:280`:
 *
 *  - `organizationHooks.beforeAcceptInvitation` fires *before* `createMember`
 *    and can only throw or mutate. The one mutation that would make the insert
 *    succeed is deleting the pre-existing row — which destroys the membership's
 *    `created_at`/history, opens a window in which the invitee belongs to
 *    nothing, and reaches straight into `sys_member`'s `deleteBehavior`, which
 *    is a different card's decision surface (#7724). Refused.
 *  - `hooks.before` (the global route-boundary middleware in `auth-manager.ts`)
 *    has the endpoint ctx, but `ctx.context` is the **shared** `AuthContext`
 *    singleton (`to-auth-endpoints.mjs`: `context: authContext`, where
 *    `authContext` is the awaited instance-wide context), so per-request state
 *    parked there leaks across concurrent requests — an adapter swap parked
 *    there most of all. Refused.
 *  - Re-implementing the route (own the "already a member" branch at the route
 *    boundary) would duplicate better-auth's recipient / expiry / status /
 *    membership-limit / email-verification checks. Duplicated security checks
 *    are where bypasses live; an invitee who is already a member would be
 *    adjudicated by *our* copy of those rules. Refused.
 *
 * What is left — and what is actually the honest layer — is the adapter that
 * bridges better-auth's `member` model onto `sys_member`. That adapter is
 * already the place where better-auth's model is reconciled with the platform's
 * object: it maps model and field names, normalises dates and identifiers. This
 * adds one more reconciliation, and it is stated as the platform's own rule
 * rather than as leniency: **the declared unique index IS the identity of a
 * membership**, so a `create` naming an (org, user) pair that already exists is
 * not a second membership — it is that membership.
 *
 * Blast radius, measured against the installed better-auth (re-measured on
 * 1.7.1) rather than assumed — accept-invitation is the ONLY `member` create
 * that can reach an existing pair:
 *
 *  - The vendor's `addMember` is SERVER-ONLY (declared with no HTTP path;
 *    reachable over HTTP only through ObjectStack's platform-admin-gated
 *    `POST /organization/add-member` mount, #9941 — see
 *    organization-add-member.ts), and it pre-checks and refuses first
 *    (`crud-members.mjs`: `findMemberByEmail` →
 *    `USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`, a 400).
 *  - `POST /organization/create-organization` mints a fresh organization id, so
 *    no pair can pre-exist.
 *  - The reconciler and its backfill write through `engine.insert` directly, not
 *    through this adapter, and already yield to an existing row.
 *
 * ## What adoption does to the ROLE — the part that is not "don't throw"
 *
 * Not throwing is the smaller half. An invitation carries an intent, and the
 * reconciler's auto-created row carries the deployment default (`member`); if
 * adoption silently kept the default, a `delegated_admin` invitation would be
 * accepted and confer nothing. So adoption WRITES the invitation's role onto the
 * adopted row — with exactly one exception, {@link decideAdoptedRole}:
 *
 * **Adoption never lowers a grade.** If the existing membership outranks the
 * invitation's role, the existing role is kept and the adoption is recorded as
 * `kept-higher`. Acceptance is an ADMISSION instrument — `invitation-role-cap.ts`
 * states the same posture from the other side ("an invitation may add a person,
 * never authority above the issuer's own") — while DEMOTION has its own governed
 * route, `POST /organization/update-member-role`, which is where
 * `last-admin-guard.ts` stands. Without this exception, inviting an
 * organization's sole `owner` as a `member` and having them accept would demote
 * them through a path that guard never sees, and the organization would lose its
 * last owner with every gate reporting success. Equal grades take the
 * invitation's value (a lateral move — `member` → `delegated_admin` is grade-flat
 * by `orgRoleGrade`, since `delegated_admin` is reach, not authority), which is
 * what keeps the invitation's intent from being dropped in the ordinary case.
 *
 * ## Attribution
 *
 * Nothing extra to do, and that is deliberate. The adoption writes through the
 * same `withSystemContext`-wrapped engine as every other adapter write, whose
 * `update` carries `attributedUserId` (#4586) — here, the invitee who accepted.
 * `sys_member` is `trackHistory: true`, so the adoption lands in history as a
 * role change attributed to the acceptor, next to the `create` the reconciler
 * recorded at sign-up. A fresh insert would have recorded a `create` attributed
 * to the same person; the adopted row records an `update` instead. The
 * membership's `created_at` is deliberately NOT rewritten — the membership
 * really did begin at sign-up.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { orgRoleGrade, parseOrgRoles } from './invitation-role-cap.js';

/** What adoption decided to do with the incoming role. */
export type MembershipAdoptionVerdict =
  /** The incoming role was written onto the adopted row. */
  | 'applied'
  /** Incoming and existing roles are the same value — nothing to write. */
  | 'unchanged'
  /**
   * The existing membership outranks the incoming role, so the existing role was
   * KEPT. Acceptance admits; it does not demote (see the module doc).
   */
  | 'kept-higher';

export interface MembershipAdoptionDecision {
  /** The role the adopted row should end up carrying. */
  role: unknown;
  verdict: MembershipAdoptionVerdict;
}

/** Normalised comparable form of a better-auth role value (`"owner,admin"`). */
function normaliseRole(raw: unknown): string {
  return parseOrgRoles(raw).sort().join(',');
}

/**
 * Decide the role an adopted membership should carry.
 *
 * @param existingRole the role already on the `sys_member` row
 * @param incomingRole the role better-auth's `createMember` was about to write —
 *                     i.e. the invitation's role
 */
export function decideAdoptedRole(
  existingRole: unknown,
  incomingRole: unknown,
): MembershipAdoptionDecision {
  const incoming = normaliseRole(incomingRole);
  // Nothing was asked for (better-auth's body schema requires a role, so this is
  // a caller that is not the invitation flow) — keep what is there.
  if (incoming.length === 0) return { role: existingRole, verdict: 'unchanged' };

  const existing = normaliseRole(existingRole);
  if (existing === incoming) return { role: existingRole, verdict: 'unchanged' };

  // The one refusal: never lower a grade through acceptance. `update-member-role`
  // owns demotion, and `last-admin-guard.ts` stands on that route, not this one.
  if (orgRoleGrade(incomingRole) < orgRoleGrade(existingRole)) {
    return { role: existingRole, verdict: 'kept-higher' };
  }

  return { role: incomingRole, verdict: 'applied' };
}

/**
 * The minimum engine surface adoption needs. Deliberately narrow so a caller
 * cannot hand this function delete/insert reach it has no business having.
 */
export interface MembershipAdoptionEngine {
  findOne(object: string, query?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
}

export interface AdoptMembershipOptions {
  /** Override for tests; defaults to `console`. */
  logger?: { info?: (msg: string, meta?: any) => void };
}

/**
 * Adopt the `sys_member` row a `create` would have collided with, or return
 * `null` to let the caller insert normally.
 *
 * `null` means "not an adoption case" and is the common answer: a different
 * object, an unidentifiable pair, or simply no existing row. The caller must
 * treat `null` as "carry on and insert" — this function never suppresses a
 * genuine insert.
 *
 * @param engine  a system-context engine (the adapter's `withSystemContext` one)
 * @param object  the protocol object name the create targets
 * @param payload the snake_case row better-auth is about to insert
 */
export async function adoptExistingMembership(
  engine: MembershipAdoptionEngine,
  object: string,
  payload: Record<string, any>,
  options: AdoptMembershipOptions = {},
): Promise<Record<string, any> | null> {
  if (object !== SystemObjectName.MEMBER) return null;

  const organizationId = payload?.organization_id;
  const userId = payload?.user_id;
  // Both halves of the declared unique key must be present and non-empty for the
  // pair to identify anything. A null/absent `organization_id` is left alone on
  // purpose: ADR-0120 D3 folds NULL into the `'__global__'` bucket for uniqueness
  // and this function would have to reproduce that folding to be correct there —
  // an unrelated surface, and the reconciler never mints such a row.
  if (typeof organizationId !== 'string' || organizationId.length === 0) return null;
  if (typeof userId !== 'string' || userId.length === 0) return null;

  const existing = await engine.findOne(SystemObjectName.MEMBER, {
    where: { organization_id: organizationId, user_id: userId },
  });
  if (!existing?.id) return null;

  const decision = decideAdoptedRole(existing.role, payload.role);
  let adopted: Record<string, any> = existing;
  if (decision.verdict === 'applied') {
    const updated = await engine.update(SystemObjectName.MEMBER, {
      id: existing.id,
      role: decision.role,
    });
    // ObjectQL returns the updated row; fall back to a local merge so adoption
    // still reports the state it just wrote if an engine returns nothing.
    adopted = updated ?? { ...existing, role: decision.role };
  }

  const log = options.logger?.info ?? ((msg: string, meta?: any) => console.info(msg, meta));
  log(
    `[membership] adopted the existing sys_member row instead of inserting a second one ` +
      `(${decision.verdict}) — the (organization_id, user_id) pair is unique by declaration [#7725]`,
    {
      memberId: existing.id,
      organizationId,
      userId,
      existingRole: existing.role,
      incomingRole: payload.role,
      resultingRole: adopted.role,
      verdict: decision.verdict,
    },
  );

  return adopted;
}
