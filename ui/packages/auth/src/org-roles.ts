/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Organization membership roles — the console's ONE entry point for them.
 *
 * These are better-auth's organization roles as the ObjectStack framework
 * registers them, stored in `sys_member.role` / `sys_invitation.role`. Before
 * this module the vocabulary was inlined as `type Role = 'owner' | 'admin' |
 * 'member'` in both `MembersPage` and `InviteMemberDialog`, so a role the
 * server had learned about was still unreachable from either screen.
 *
 * ## The vocabulary is CLOSED — and derived, not mirrored
 *
 * [framework ADR-0108 / objectstack#3723] The spec's names are the WHOLE list,
 * and the framework owns them. An application cannot add one: the server
 * used to register every declared `position` / `permission` name as an
 * organization role, and that was retired, because every value stored in
 * `sys_member.role` is projected into `current_user.positions` — so a business
 * role handed out this way was capability with none of the position system's
 * controls (no `granted_by`, no validity window, no scope check). A membership
 * role is an organization GRADE (what you may reach); what a person may DO is
 * a position, granted through `sys_user_position` or an invitation's placement
 * (framework ADR-0105 D8).
 *
 * The names below are re-exports of `BUILTIN_MEMBERSHIP_ROLES` from
 * `@objectstack/spec` — the same constant the enforced `sys_member.role` /
 * `sys_invitation.role` selects are built from — so this list cannot drift
 * from what the server accepts, by construction.
 *
 * What stays LOCAL, deliberately: `ORG_ROLE_LABELS` and the grade ladder
 * (`orgRoleGrade` / `invitableOrgRoles` / `assignableOrgRoles`). They are
 * console concerns — i18n keys and screen-narrowing rules — and folding them
 * into the name list would be the modeling error ADR-0108 D4 warns about:
 * *what names exist* is a list; *which names mean authority* and *how a name
 * projects* are rules that belong next to what they govern.
 */

import {
  BUILTIN_MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLE_OWNER as ORG_ROLE_OWNER,
  MEMBERSHIP_ROLE_ADMIN as ORG_ROLE_ADMIN,
  MEMBERSHIP_ROLE_DELEGATED_ADMIN as ORG_ROLE_DELEGATED_ADMIN,
  MEMBERSHIP_ROLE_MEMBER as ORG_ROLE_MEMBER,
  MEMBERSHIP_ROLE_EXTERNAL as ORG_ROLE_EXTERNAL,
  type BuiltinMembershipRole,
} from '@objectstack/spec';

// Kept under the console's own names so call sites read as org-screen
// vocabulary. `ORG_ROLE_DELEGATED_ADMIN` is ADR-0105 D8's delegated issuer
// grade: it may reach `/organization/invite-member` WITHOUT being an org
// admin, and carries no authority of its own — what a delegate may actually
// *place* comes from a separately-granted `adminScope`, surfaced to this
// console by `describeDelegableScope()`.
//
// `ORG_ROLE_EXTERNAL` is the external population's grade (objectstack#25233,
// ruling of record 6355206139, letter B): portal users admitted through the
// organization invite, who reach less than a `member` — no organization
// endpoint, no member directory, data only through explicit grants. It is
// exclusive (the server refuses it beside any other role) and never placed in
// a business unit.
export {
  ORG_ROLE_OWNER,
  ORG_ROLE_ADMIN,
  ORG_ROLE_DELEGATED_ADMIN,
  ORG_ROLE_MEMBER,
  ORG_ROLE_EXTERNAL,
};

export type OrgRole = BuiltinMembershipRole;

/** Display order: most privileged first, as the spec ships it and the screens list it. */
export const ORG_ROLES: readonly OrgRole[] = [...BUILTIN_MEMBERSHIP_ROLES];

/** i18n key + English fallback for a role, so every screen labels it identically. */
export const ORG_ROLE_LABELS: Record<OrgRole, { key: string; defaultValue: string }> = {
  [ORG_ROLE_OWNER]: { key: 'organization.roles.owner', defaultValue: 'Owner' },
  [ORG_ROLE_ADMIN]: { key: 'organization.roles.admin', defaultValue: 'Admin' },
  [ORG_ROLE_DELEGATED_ADMIN]: {
    key: 'organization.roles.delegatedAdmin',
    defaultValue: 'Delegated Admin',
  },
  [ORG_ROLE_MEMBER]: { key: 'organization.roles.member', defaultValue: 'Member' },
  [ORG_ROLE_EXTERNAL]: { key: 'organization.roles.external', defaultValue: 'External' },
};

const GRADE_UNRESOLVED = 0;
const GRADE_MEMBER = 1;
const GRADE_ADMIN = 2;
const GRADE_OWNER = 3;

/**
 * Grade ladder, mirroring the framework's invitation role cap. Anything
 * unrecognized — `member`, `delegated_admin`, `external`, an app-registered
 * role — grades as an ordinary member; only better-auth's two administrative
 * roles outrank it, because only they are auto-elevated to
 * `organization_admin` server-side.
 *
 * `external` gets no rung of its own, on purpose. The ladder answers one
 * question — does this role carry administrative authority — and the cap's
 * ladder (plugin-auth `invitation-role-cap.ts`) grades `external` exactly as
 * it grades `member`. That it reaches LESS than a member is enforced where it
 * is decided, server-side (no endpoint statement, the external baseline set);
 * a rung below `member` here would have no reader, and every reader that
 * exists compares against the admin and owner grades, which `external` never
 * reaches.
 *
 * An absent/unreadable role grades BELOW a plain member: the fail-closed floor,
 * so an unverified caller is offered nothing privileged.
 */
export function orgRoleGrade(raw: unknown): number {
  if (typeof raw !== 'string') return GRADE_UNRESOLVED;
  const roles = raw
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (roles.length === 0) return GRADE_UNRESOLVED;
  let grade = GRADE_MEMBER;
  for (const role of roles) {
    if (role === ORG_ROLE_OWNER) grade = Math.max(grade, GRADE_OWNER);
    else if (role === ORG_ROLE_ADMIN) grade = Math.max(grade, GRADE_ADMIN);
  }
  return grade;
}

/**
 * The roles every issuer may confer — the rows of the spec's invitation grant
 * table (`INVITATION_ROLE_GRANTORS`, `@objectstack/spec/identity`) that read
 * `'any'`. `member` confers nothing to cap; `external` confers less than
 * `member` (ruling 6355206139, E3). The test pins the offer this set produces
 * to that table for every issuer grade, so the copy here cannot drift from the
 * cap without going red.
 */
const ANY_ISSUER_ROLES: ReadonlySet<string> = new Set([ORG_ROLE_MEMBER, ORG_ROLE_EXTERNAL]);

/**
 * The roles `issuerRole` may confer through an INVITATION — mirroring the
 * framework's `beforeCreateInvitation` role cap:
 *
 *  - an invited role may never outrank the issuer's own;
 *  - an issuer below admin grade may invite as `member` or `external` only, the
 *    two roles any issuer may confer (an app-registered role projects into
 *    `current_user.positions` and may be bound to permission sets, so it is a
 *    capability channel too — a delegate's channel for capability is the
 *    invitation's *placement*, which the D12 gate allowlists).
 *
 * Same property as the placement picker: this NARROWS, it does not decide. The
 * server re-checks and rejects out-of-cap invitations, so the console is free to
 * be helpful without being load-bearing — and it fails toward *less*: an
 * unresolvable issuer role offers the any-issuer roles alone, which the cap
 * admits for an unverified issuer too.
 */
export function invitableOrgRoles(issuerRole: unknown): OrgRole[] {
  const grade = orgRoleGrade(issuerRole);
  if (grade < GRADE_ADMIN) return ORG_ROLES.filter((r) => ANY_ISSUER_ROLES.has(r));
  return ORG_ROLES.filter((r) => orgRoleGrade(r) <= grade);
}

/**
 * The roles `actorRole` may SET on an existing member — a different gate from
 * invitation, mirroring better-auth's `update-member-role` route rather than the
 * framework's cap:
 *
 *  - the route requires the `member: ["update"]` permission, which only
 *    `owner`/`admin` hold (`delegated_admin` is built from `memberAc`, so it has
 *    `member: []` and may not re-role anyone);
 *  - only an owner may SET `owner`, and only an owner may modify a member who
 *    already IS one (better-auth's `creatorRole` protection).
 *
 * `external` is offered like any other role. Two framework refusals are not
 * pre-empted here, because this screen cannot see what they read: a role list
 * that carries `external` beside another role (the picker sets one role, so it
 * never builds one), and re-roling to `external` a member who is placed in a
 * business unit (ruling 6355206139, E5 and E6). The server's refusal reaches
 * the screen through the same error path as any other.
 *
 * Returns an empty list when the actor may not re-role at all, so the screen can
 * omit the affordance instead of offering items that would 403.
 */
export function assignableOrgRoles(actorRole: unknown, targetRole?: unknown): OrgRole[] {
  const actor = orgRoleGrade(actorRole);
  if (actor < GRADE_ADMIN) return [];
  const actorIsOwner = actor >= GRADE_OWNER;
  // An existing owner is owner-editable only.
  if (!actorIsOwner && orgRoleGrade(targetRole) >= GRADE_OWNER) return [];
  return ORG_ROLES.filter((r) => (r === ORG_ROLE_OWNER ? actorIsOwner : true));
}
