// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25083] The refusals a cloud-managed environment answers at plugin-auth's
 * local identity doors.
 *
 * A hosted environment is managed (the maintainer's ruling on
 * objectstack-ai/cloud#3132, cloud ADR-0024 D5.2, mirrored here as ADR-0135
 * D5.2): its people sign in through the hosting organisation's identity
 * provider — added ahead of their first sign-in in Setup → Users as pending
 * people (#33181, `pending-sso-users.ts`), or arriving on it — and authorization —
 * positions, permission sets — stays in the environment. Whether this process
 * is one is `isCloudManaged()` from `@objectstack/core` (`OS_CLOUD_MANAGED=1`
 * on the cloud's containers); every door below asks it and nothing else.
 * Self-hosted deployments never set the variable, so there every door answers
 * exactly as it did before.
 *
 * Every door that sets a local password is closed to everyone. A hosted
 * environment sets no local password for anyone and has no local break-glass
 * administrator (ruling 10 of objectstack-ai/cloud#4465, recorded on
 * objectstack#33203): `admin/set-user-password` refuses every target, an
 * `env_native` row included; `set-initial-password` refuses every signed-in
 * caller, a platform administrator included; and the two self-service reset
 * doors (`/reset-password`, `/phone-number/reset-password`, each of which
 * creates the credential when the user holds none) refuse every request, with
 * the two doors that send their link or code (`/request-password-reset`,
 * `/phone-number/request-password-reset`), so nobody is sent a link the reset
 * door would refuse; and the one-step invitation acceptance
 * (`/organization/accept-invitation-one-step`, `invitation-mailbox-proof.ts`),
 * which creates an account with a password or sets one on an unverified
 * account, refuses every request that carries the invitation mail's proof,
 * before the proof is read. A password set before stays where it is (changing one is
 * `/change-password`'s, objectstack-ai/cloud#4471). ADR-0135 D5.2's
 * break-glass clause, which kept a local credential reachable by population,
 * holds on self-hosted deployments only.
 *
 * Membership and membership tiers are the hosting organisation's too. Every
 * organization-family door that writes or deletes an organization membership
 * row refuses every request, as `/organization/invite-member` does:
 * `/organization/remove-member`, `/organization/update-member-role` (Make
 * Owner included, which sends the owner tier to it), `/organization/leave`,
 * `/organization/accept-invitation`, `/organization/create` (it makes the
 * caller the new organization's owner) and `/organization/delete` (it ends
 * every membership of the organization). The one door left open is
 * `/organization/add-member`: it admits exactly a platform administrator,
 * adding a membership, and is the operator's way to restore one the
 * environment lost. The rest of the family writes no membership row (team
 * rows, invitation rows, the session's active organization, the
 * organization's own fields) or only reads, and answers as before.
 *
 * Every refusal is `409 RESOURCE_CONFLICT`, no code minted — the answer
 * cloud-connection's platform-managed doors give, on the same rule: the
 * refusal comes from the runtime's state, not from the request (ADR-0112's
 * catalog). Each message says what was not done and where it is done instead.
 */

import type { StandardErrorCode } from '@objectstack/spec/api';

/** The ADR-0112 code every cloud-managed refusal carries. */
export const CLOUD_MANAGED_REFUSAL_CODE: StandardErrorCode = 'RESOURCE_CONFLICT';

/** The status every cloud-managed refusal answers. */
export const CLOUD_MANAGED_REFUSAL_STATUS = 409;

/** One message per door, keyed by the door. */
export const CLOUD_MANAGED_REFUSAL_MESSAGES = {
  // [#33181] The four sentences below point to Setup → Users, where a
  // managed environment now adds a person (`admin/add-sso-user`,
  // `admin/import-sso-users`): the person signs in through the hosting
  // organisation's identity provider. Kept together so the wording can be
  // swapped in one place.
  invitation:
    'This environment is cloud-managed: the people who use it sign in through the identity provider of the organisation '
    + 'that hosts it, so an invitation cannot be created here. Add them in Setup → Users instead; they sign in through '
    + 'that identity provider. No invitation was created.',
  // [#27843] `sys_invitation.copy_invitation_link`: the invitation's accept
  // link, which adding the person in Setup → Users replaces here.
  invitationLink:
    'This environment is cloud-managed: the people who use it sign in through the identity provider of the organisation '
    + 'that hosts it, so an invitation link is not handed out here. Add them in Setup → Users instead; they sign in '
    + 'through that identity provider. No link was returned.',
  createUser:
    'This environment is cloud-managed: its users sign in through the identity provider of the organisation that hosts '
    + 'it, so a user with a local password cannot be created here. Add the person in Setup → Users instead; they sign '
    + 'in through that identity provider. No user was created.',
  importUsers:
    'This environment is cloud-managed: its users sign in through the identity provider of the organisation that hosts '
    + 'it, so users with local passwords cannot be imported here. Import them in Setup → Users instead; they sign in '
    + 'through that identity provider. No user was imported.',
  setUserPassword:
    "This environment is cloud-managed: everyone who uses it signs in through the hosting organisation's identity "
    + 'provider, and no local password is set here for anyone, an administrator included. No password was changed.',
  setInitialPassword:
    "This environment is cloud-managed: you sign in through the hosting organisation's identity provider, and no "
    + 'local password is set here for anyone, an administrator included. No password was set.',
  // [#33203] `/reset-password` and `/phone-number/reset-password`.
  resetPassword:
    "This environment is cloud-managed: you sign in through the hosting organisation's identity provider, and no "
    + 'local password is set or reset here for anyone, an administrator included. No password was set.',
  // [#33203] `/request-password-reset` and `/phone-number/request-password-reset`.
  requestPasswordReset:
    "This environment is cloud-managed: you sign in through the hosting organisation's identity provider, and no "
    + 'local password is set or reset here for anyone, an administrator included. No reset link or code was sent.',
  // `/organization/accept-invitation-one-step` with the invitation mail's proof.
  acceptInvitationOneStep:
    "This environment is cloud-managed: you sign in through the hosting organisation's identity provider, and no "
    + 'local password is set here for anyone, so an invitation is not accepted with a new password. Sign in through '
    + 'that identity provider instead. No account or password was changed.',
  // `/organization/remove-member` (`sys_member.remove_member`).
  removeMember:
    'This environment is cloud-managed: its members and their roles are managed in the organisation that hosts it, '
    + 'so a member cannot be removed here. Remove them in that organisation instead. No member was removed.',
  // `/organization/update-member-role` (`sys_member.update_member_role` and
  // `sys_member.transfer_ownership`, which sends the owner role to it).
  updateMemberRole:
    'This environment is cloud-managed: its members and their roles are managed in the organisation that hosts it, '
    + "so a member's role cannot be changed here. Change it in that organisation instead. No role was changed.",
  // `/organization/leave` (`sys_organization.leave_organization`).
  leaveOrganization:
    'This environment is cloud-managed: its members and their roles are managed in the organisation that hosts it, '
    + 'so you cannot leave it here. Ask that organisation to remove you instead. No membership was ended.',
  // `/organization/accept-invitation` (`sys_invitation.accept_invitation`).
  acceptInvitation:
    'This environment is cloud-managed: its members and their roles are managed in the organisation that hosts it, '
    + 'so an invitation cannot be accepted here. Ask that organisation to add you instead. No membership was created.',
  // `/organization/create` (`sys_organization.create_organization`), which
  // makes the caller the new organization's owner.
  createOrganization:
    'This environment is cloud-managed: its members and their roles are managed in the organisation that hosts it, '
    + 'so an organization, which would make you its owner, cannot be created here. No organization was created.',
  // `/organization/delete` (`sys_organization.delete_organization`), which
  // ends every membership of the organization.
  deleteOrganization:
    'This environment is cloud-managed: its members and their roles are managed in the organisation that hosts it, '
    + 'so an organization, and every membership in it, cannot be deleted here. No organization was deleted.',
} as const;

/** The doors a cloud-managed environment narrows. */
export type CloudManagedDoor = keyof typeof CLOUD_MANAGED_REFUSAL_MESSAGES;

/** The ADR-0112 envelope a raw route hands back for `door`. */
export function cloudManagedRefusal(door: CloudManagedDoor): {
  status: typeof CLOUD_MANAGED_REFUSAL_STATUS;
  body: { success: false; error: { code: StandardErrorCode; message: string } };
} {
  return {
    status: CLOUD_MANAGED_REFUSAL_STATUS,
    body: {
      success: false,
      error: { code: CLOUD_MANAGED_REFUSAL_CODE, message: CLOUD_MANAGED_REFUSAL_MESSAGES[door] },
    },
  };
}
