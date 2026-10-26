/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which member-management affordances the ACTIVE member may use — one predicate
 * per server gate, so a screen can omit what would 403 instead of letting the
 * rejection be the UI (objectui#4475).
 *
 * ## Why three predicates and not one `isOwner`
 *
 * The obvious fix for #4475 is a single owner check. It is wrong in both
 * directions, and the server is what says so. These three affordances sit
 * behind three DIFFERENT better-auth permissions, and the roles holding them
 * are three different sets:
 *
 *   | affordance        | route                           | permission              |
 *   |-------------------|---------------------------------|-------------------------|
 *   | invite a member   | `/organization/invite-member`   | `invitation:["create"]` |
 *   | remove a member   | `/organization/remove-member`   | `member:["delete"]`     |
 *   | cancel invitation | `/organization/cancel-invitation` | `invitation:["cancel"]` |
 *
 * Measured against better-auth 1.6.26's
 * `plugins/organization/access/statement.mjs` — `ownerAc` and `adminAc` both
 * carry `invitation: ["create","cancel"]` and `member: [...,"delete"]`, while
 * `memberAc` carries `invitation: []` and `member: []` — plus the fourth role
 * the framework registers on top of them (objectstack
 * `packages/plugins/plugin-auth/src/auth-manager.ts`):
 *
 *     built[MEMBERSHIP_ROLE_DELEGATED_ADMIN] = defaultAc.newRole({
 *       ...memberAc.statements,          // member: [] — may NOT remove anyone
 *       invitation: ['create'],          // …but MAY invite
 *     });
 *
 * `delegated_admin` is the row a single boolean cannot express: it may invite
 * and may not remove, and it deliberately has no `cancel` — the framework's own
 * comment records why (better-auth's cancel route checks only the permission
 * and never invitation attribution, so granting it would mean "cancel anyone's
 * pending invitation in the org"). Mirroring that asymmetry is the whole point;
 * flattening it back into one check is the bug returning.
 *
 * ## These NARROW, they never decide
 *
 * Same contract as `invitableOrgRoles` / `assignableOrgRoles` next door in
 * `@object-ui/auth`: the server re-checks every one of these routes, so the
 * console is free to be helpful without being load-bearing. And they fail
 * toward LESS — an absent or unreadable role grades below a plain member
 * (`orgRoleGrade`'s documented floor), so an unverified caller is offered
 * nothing.
 *
 * ## Where this lives
 *
 * The grade ladder itself stays in `@object-ui/auth`'s `org-roles.ts`, and this
 * module composes it rather than restating it — `orgRoleGrade` and the role
 * names are imported, never re-derived, so the closed ADR-0108 vocabulary keeps
 * exactly one definition.
 */

import { ORG_ROLE_ADMIN, ORG_ROLE_DELEGATED_ADMIN, orgRoleGrade } from '@object-ui/auth';

/**
 * The grade at which better-auth's administrative permissions begin, asked of
 * the ladder rather than written down as a number — `orgRoleGrade`'s scale is
 * its own business and only `owner`/`admin` are auto-elevated server-side.
 */
const ADMIN_GRADE = orgRoleGrade(ORG_ROLE_ADMIN);

/**
 * `sys_member.role` is a COMMA-SEPARATED list server-side — better-auth's own
 * routes do `member.role.split(",")` — so a role string may name several roles
 * at once. Parsed the same way `orgRoleGrade` parses it, because a value it
 * grades and a value we scan for `delegated_admin` must be the same value.
 */
function orgRoleNames(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

/** Holds `invitation:["create"]` — owner, admin, or a delegated admin. */
export function canInviteMembers(actorRole: unknown): boolean {
  if (orgRoleGrade(actorRole) >= ADMIN_GRADE) return true;
  // The delegated grade is invisible to the ladder by design: it carries no
  // ObjectStack authority, so it must NOT grade as an admin. It is exactly one
  // reachable endpoint, and this is that endpoint.
  return orgRoleNames(actorRole).includes(ORG_ROLE_DELEGATED_ADMIN);
}

/**
 * Holds `member:["delete"]` — owner and admin only. A `delegated_admin` is
 * built from `memberAc.statements`, whose `member` list is empty.
 */
export function canRemoveMembers(actorRole: unknown): boolean {
  return orgRoleGrade(actorRole) >= ADMIN_GRADE;
}

/**
 * Holds `invitation:["cancel"]` — owner and admin only. Deliberately NOT the
 * same set as {@link canInviteMembers}: the framework grants the delegated
 * grade `create` without `cancel`.
 */
export function canCancelInvitations(actorRole: unknown): boolean {
  return orgRoleGrade(actorRole) >= ADMIN_GRADE;
}
