// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { BUILTIN_MEMBERSHIP_ROLE_OPTIONS, type BuiltinMembershipRole } from '@objectstack/spec/identity';

/**
 * What each role of the closed membership vocabulary (ADR-0108) lets a member
 * do. Keyed by the spec's role type, so a role the vocabulary gains fails to
 * compile here until it is explained.
 */
const MEMBERSHIP_ROLE_DUTIES: Record<BuiltinMembershipRole, string> = {
  owner: 'full control of the organization, including deleting it.',
  admin: 'manages members, invitations, teams and organization settings.',
  delegated_admin: 'invites people and places them only where an administrator has delegated that.',
  member: 'works in the organization\'s apps with the access their permission sets give.',
  external: 'someone from outside the organization, such as a supplier or customer, who sees only what is shared with them.',
};

/**
 * The help under every role picker that grants an organization membership
 * role: the four `invite_user` mirrors (sys_user, sys_member, sys_invitation,
 * sys_organization), `sys_member.add_member` and `sys_member.update_member_role`.
 *
 * Declared as the param's `helpText`, not inherited from the field: the field
 * help differs per object (`sys_member.role` describes the stored column,
 * `sys_invitation.role` the role an invitation confers), so a dialog reached
 * from two entry points would explain the same choice two ways and name none
 * of the roles. One line per role, labelled and ordered as the pickers'
 * options are; the param dialog keeps the line breaks.
 */
export const MEMBERSHIP_ROLE_PARAM_HELP = BUILTIN_MEMBERSHIP_ROLE_OPTIONS
  .map((option) => `${option.label}: ${MEMBERSHIP_ROLE_DUTIES[option.value as BuiltinMembershipRole]}`)
  .join('\n');
