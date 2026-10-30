// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The help under every role picker that grants an organization membership
 * role: the four `invite_user` mirrors (sys_user, sys_member, sys_invitation,
 * sys_organization), `sys_member.add_member` and `sys_member.update_member_role`.
 *
 * Declared as the param's `helpText`, not inherited from the field: the field
 * help differs per object (`sys_member.role` describes the stored column,
 * `sys_invitation.role` the role an invitation confers), so a dialog reached
 * from two entry points used to explain the same choice two ways and name none
 * of the roles. One line per role of the closed vocabulary (ADR-0108), in its
 * display order; the param dialog keeps the line breaks.
 */
export const MEMBERSHIP_ROLE_PARAM_HELP = [
  'Owner: full control of the organization, including deleting it.',
  'Admin: manages members, invitations, teams and organization settings.',
  'Delegated Admin: invites people and places them only where an administrator has delegated that.',
  'Member: works in the organization\'s apps with the access their permission sets give.',
  'External: someone from outside the organization, such as a supplier or customer, who sees only what is shared with them.',
].join('\n');
