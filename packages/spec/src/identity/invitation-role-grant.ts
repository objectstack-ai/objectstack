// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  BUILTIN_MEMBERSHIP_ROLES,
  BUILTIN_MEMBERSHIP_ROLE_OPTIONS,
  MEMBERSHIP_ROLE_ADMIN,
  MEMBERSHIP_ROLE_DELEGATED_ADMIN,
  MEMBERSHIP_ROLE_MEMBER,
  MEMBERSHIP_ROLE_OWNER,
  type BuiltinMembershipRole,
} from './membership-role';
import { mapMembershipRole } from './eval-user.zod';

/**
 * # Invitation role grant — which issuer grade may invite as which role
 *
 * The invitation role cap (plugin-auth `invitation-role-cap.ts`, ADR-0105 D8)
 * refuses an invitation that would confer more than its issuer may hand out.
 * This module is the table that cap reads, and the one the invite dialog's
 * role picker reads, so the offer and the refusal come from one source and
 * cannot drift.
 *
 * Each row names a role an invitation may confer and the issuer grades that
 * may confer it:
 *
 * - `owner` — only an owner (an invitation never confers a grade above the
 *   issuer's own).
 * - `admin`, `delegated_admin` — an owner or an admin. A grade below admin may
 *   not hand out a membership role beyond `member`: a delegate's channel for
 *   capability is the invitation's PLACEMENT, which the ADR-0090 D12 gate
 *   authorizes position by position, not the membership role.
 * - `member` — `'any'`: every issuer, including one whose own membership could
 *   not be resolved. A plain-member invitation confers nothing to cap.
 *
 * A role the closed vocabulary does not list (ADR-0108) is graded by
 * {@link invitationRoleGrantors} like `delegated_admin`: administrative
 * issuers only.
 *
 * Issuer grades are better-auth membership roles, matched on the issuer's own
 * `sys_member.role`. The cap holds one more rule the table does not restate:
 * an issuer below admin grade confers nothing beyond a single plain-member
 * invitation, so an `'any'` row admits a below-admin issuer only when it is
 * the invitation's one role.
 *
 * ## The two readers
 *
 * - **The door** — the cap, on every invitation, server-side. It is the
 *   authority.
 * - **The offer** — {@link INVITATION_ROLE_OPTIONS}: each option of the
 *   `invite_user` action's `role` param carries a per-option `visibleWhen`
 *   built by {@link invitationRoleGrantPredicate}, one
 *   `'<projected grade>' in current_user.positions` term per grade, the
 *   projection `mapMembershipRole` performs. That is UI courtesy, not
 *   authorization: the picker follows the door, and the door stays the
 *   authority (the same split `membership-reach.ts` draws for the button).
 *
 * This module carries constants and pure helpers only (Prime Directive #2).
 */

/** Every issuer may confer the role: the row needs no issuer at all. */
export const INVITATION_ROLE_ANY_ISSUER = 'any';

/** The issuer grades that may confer one role, or {@link INVITATION_ROLE_ANY_ISSUER}. */
export type InvitationRoleGrantors = readonly BuiltinMembershipRole[] | typeof INVITATION_ROLE_ANY_ISSUER;

const ADMINISTRATIVE_ISSUERS = [MEMBERSHIP_ROLE_OWNER, MEMBERSHIP_ROLE_ADMIN] as const;

/** The grant table — one row per role in the closed membership vocabulary. */
export const INVITATION_ROLE_GRANTORS = {
  [MEMBERSHIP_ROLE_OWNER]: [MEMBERSHIP_ROLE_OWNER],
  [MEMBERSHIP_ROLE_ADMIN]: ADMINISTRATIVE_ISSUERS,
  [MEMBERSHIP_ROLE_DELEGATED_ADMIN]: ADMINISTRATIVE_ISSUERS,
  [MEMBERSHIP_ROLE_MEMBER]: INVITATION_ROLE_ANY_ISSUER,
} as const satisfies Record<BuiltinMembershipRole, InvitationRoleGrantors>;

/**
 * The issuer grades that may confer `role` (already lower-cased and trimmed,
 * as the cap's role parser hands it over). A role outside the closed
 * vocabulary — a stored app role from before ADR-0108 — takes the
 * administrative row: it may carry capability of its own.
 */
export function invitationRoleGrantors(role: string): InvitationRoleGrantors {
  return Object.prototype.hasOwnProperty.call(INVITATION_ROLE_GRANTORS, role)
    ? INVITATION_ROLE_GRANTORS[role as BuiltinMembershipRole]
    : ADMINISTRATIVE_ISSUERS;
}

/**
 * The CEL gate for offering `role` in the invite dialog: one
 * `'<name>' in current_user.positions` term per grantor grade, joined with
 * `||`, where `<name>` is what `mapMembershipRole` projects the grade to.
 * Grade order follows {@link BUILTIN_MEMBERSHIP_ROLES}. `undefined` for an
 * `'any'` row: that option is always offered.
 */
export function invitationRoleGrantPredicate(role: BuiltinMembershipRole): string | undefined {
  const grantors = INVITATION_ROLE_GRANTORS[role];
  if (grantors === INVITATION_ROLE_ANY_ISSUER) return undefined;
  const grades: readonly string[] = grantors;
  return BUILTIN_MEMBERSHIP_ROLES
    .filter((grade) => grades.includes(grade))
    .map((grade) => `'${mapMembershipRole(grade)}' in current_user.positions`)
    .join(' || ');
}

/** One option of the invite dialog's role picker. */
export type InvitationRoleOption = Readonly<{ label: string; value: string; visibleWhen?: string }>;

/**
 * The `invite_user` action's `role` param options:
 * {@link BUILTIN_MEMBERSHIP_ROLE_OPTIONS}, in the same order and with the same
 * labels, each gated by {@link invitationRoleGrantPredicate}. An action param
 * declares these itself rather than inheriting the field's list, because a
 * per-option `visibleWhen` on the FIELD would narrow every picker over
 * `sys_member.role`, not only the invitation.
 */
export const INVITATION_ROLE_OPTIONS: readonly InvitationRoleOption[] = BUILTIN_MEMBERSHIP_ROLE_OPTIONS.map(
  (option) => {
    const visibleWhen = invitationRoleGrantPredicate(option.value as BuiltinMembershipRole);
    return visibleWhen === undefined ? { ...option } : { ...option, visibleWhen };
  },
);
