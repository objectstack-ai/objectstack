// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D8 / #3697] Invitation role cap — an invitation may add a person,
 * never authority above the issuer's own.
 *
 * Registering `delegated_admin` with `invitation: ["create"]` (the half that
 * gives D8's scope gate a caller) is exploitable on its own, because the ONLY
 * role-level cap better-auth applies to *what role you may invite someone as*
 * is its `creatorRole` check (`crud-invites.mjs`):
 *
 * ```js
 * if (!member.role.split(",").includes(creatorRole) && roles.split(",").includes(creatorRole))
 *   throw YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE
 * ```
 *
 * `creatorRole` defaults to `"owner"`. It blocks inviting an **owner**; it does
 * not block inviting an **admin**. So a subtree-scoped delegate could invite
 * someone as `admin`, acceptance would write `sys_member(role='admin')`, and
 * `auto-org-admin-grant.ts` would auto-elevate that membership to
 * `organization_admin` → wildcard `modifyAllRecords` → `isTenantAdmin()`. A
 * delegate scoped to one plant would have manufactured a **tenant admin**.
 * Every existing defense is off that path: `DelegatedAdminGate`'s
 * `GOVERNED_OBJECTS` does not cover `sys_member`, and the acceptance-time
 * membership write runs under better-auth's own context, not the issuer's.
 *
 * Hence this cap, applied in the framework's own `beforeCreateInvitation` hook:
 *
 *  1. **Grade ceiling** — the invited role may never outrank the issuer's own.
 *     `creatorRole` cannot express this: it is single-valued, so it can name
 *     one protected role, not a ladder.
 *  2. **Delegates invite plain members only** — an issuer below admin grade may
 *     issue exactly `member`. Not merely "not admin/owner": an app-registered
 *     role (`sales_manager`, …) projects into `current_user.positions` via
 *     `mapMembershipRole` and may be bound to permission sets, so it is a
 *     capability channel too. A delegate's channel for capability is the
 *     invitation's PLACEMENT intent, which the D12 gate allowlists
 *     position-by-position — not the membership role, which nothing gates.
 *
 * Applies to EVERY invitation, placement-carrying or not: the escalation is
 * independent of placement. Fail-closed by construction — an issuer role that
 * cannot be resolved grades as nothing, so anything above a plain member
 * invitation is refused.
 */

/** better-auth's built-in organization roles. */
export const MEMBERSHIP_ROLE_OWNER = 'owner';
export const MEMBERSHIP_ROLE_ADMIN = 'admin';
export const MEMBERSHIP_ROLE_MEMBER = 'member';

/** Grade ladder. Anything unrecognized — `member`, `delegated_admin`, an
 *  app-registered role — grades as an ordinary member; only better-auth's two
 *  administrative roles outrank it, because only they are auto-elevated to
 *  `organization_admin` by `auto-org-admin-grant.ts`. */
const GRADE_UNRESOLVED = 0;
const GRADE_MEMBER = 1;
const GRADE_ADMIN = 2;
const GRADE_OWNER = 3;

/** Split a better-auth role value (`"admin"`, `"owner,admin"`, `["a","b"]`). */
export function parseOrgRoles(raw: unknown): string[] {
  const flat = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof flat !== 'string') return [];
  return flat
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.length > 0);
}

/**
 * Grade of a role value. `GRADE_UNRESOLVED` (0) only for an absent/unreadable
 * value — the fail-closed floor, deliberately BELOW a plain member so an
 * unverifiable issuer authorizes nothing.
 */
export function orgRoleGrade(raw: unknown): number {
  const roles = parseOrgRoles(raw);
  if (roles.length === 0) return GRADE_UNRESOLVED;
  let grade = GRADE_MEMBER;
  for (const role of roles) {
    if (role === MEMBERSHIP_ROLE_OWNER) grade = Math.max(grade, GRADE_OWNER);
    else if (role === MEMBERSHIP_ROLE_ADMIN) grade = Math.max(grade, GRADE_ADMIN);
  }
  return grade;
}

/**
 * Is this invitation exactly a plain `member`? Such an invitation can never
 * trip the cap, so the hook skips resolving the issuer's membership row — the
 * common path costs no extra query.
 */
export function isPlainMemberInvitation(requestedRole: unknown): boolean {
  const roles = parseOrgRoles(requestedRole);
  return roles.length === 1 && roles[0] === MEMBERSHIP_ROLE_MEMBER;
}

/**
 * The cap itself. Returns a human-readable refusal reason, or `null` when the
 * invitation is within the issuer's grade.
 *
 * @param requestedRole the role(s) the invitation would confer on acceptance
 * @param issuerRole    the issuer's own `sys_member.role`; `null`/absent when it
 *                      could not be resolved (graded as nothing — fail closed)
 */
export function invitationRoleCapFailure(
  requestedRole: unknown,
  issuerRole: unknown,
): string | null {
  const requested = parseOrgRoles(requestedRole);
  // No role at all: better-auth's body schema requires one, so this is not a
  // reachable invitation shape. Nothing to cap — the route rejects it upstream.
  if (requested.length === 0) return null;
  if (isPlainMemberInvitation(requestedRole)) return null;

  const issuerGrade = orgRoleGrade(issuerRole);
  const requestedGrade = orgRoleGrade(requestedRole);

  // Fail-closed floor, reported as itself: an issuer whose membership could not
  // be read is not "outranked", they are unverified — say so, or an operator
  // chasing a refusal reads a grade comparison against a role that was never
  // established.
  if (issuerGrade === GRADE_UNRESOLVED) {
    return (
      `[Security] Access denied: your organization membership could not be verified, so this ` +
      `invitation may confer no role beyond '${MEMBERSHIP_ROLE_MEMBER}' ` +
      `(ADR-0090 D12: an unverifiable issuer confers nothing).`
    );
  }

  if (requestedGrade > issuerGrade) {
    return (
      `[Security] Access denied: you may not invite a member as '${requested.join(', ')}' — ` +
      `an invitation can never confer a role above the issuer's own ` +
      `(ADR-0090 D12: administration is a scoped capability).`
    );
  }

  if (issuerGrade < GRADE_ADMIN) {
    return (
      `[Security] Access denied: a delegated issuer may invite only as ` +
      `'${MEMBERSHIP_ROLE_MEMBER}' — '${requested.join(', ')}' is an organization role that can ` +
      `carry capability of its own. Grant capability through the invitation's placement ` +
      `(business unit + positions), which is authorized against your adminScope.`
    );
  }

  return null;
}
