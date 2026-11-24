// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27843, ruling E on #27797] The success copy of the invite actions, per the
 * delivery `outcome` invite-member answers beside the invitation row (plugin-auth
 * `invitation-delivery-outcome.ts`): `sent` when the deployment delivers mail,
 * `link_only` when it does not (the `log` transport, or no email service), and
 * only the invitation's accept link can reach the invitee.
 *
 * One spelling for the four `invite_user` mirrors (sys_user, sys_member,
 * sys_invitation, sys_organization), so one translation serves each, and one
 * for `sys_invitation.resend_invitation`. ⛔ A `link_only` message never says
 * the invitation was sent: nothing left the server.
 *
 * ⛔ Nor does it hand the admin Copy Invite Link as the way in. Accepting,
 * declining and listing an invitation need a verified email address, and
 * without mail a password account cannot verify one: the copied link admits
 * the sign-up and nothing more. So the `link_only` copy states that rule, the
 * one exception (an invitee whose social or SSO sign-in verifies the address),
 * and the operator path for everyone else, a platform administrator creating
 * the account, as `content/docs/deployment/self-hosting.mdx` documents it.
 *
 * `{{ result.email }}` is an `outcomeMessages` `template` hole over `result`,
 * the payload invite-member answers (#27948): the invitee's address on the row.
 */

/** `invite_user.outcomeMessages`, on all four mirrors. */
export const INVITE_USER_OUTCOME_MESSAGES = {
  sent: 'Invitation sent to {{ result.email }}',
  link_only:
    'Invitation created for {{ result.email }}. Mail is not configured on this server, so no email went out. '
    + 'Accepting needs a verified email address: without mail, only an invitee whose social or SSO sign-in '
    + 'verifies the address can accept. For anyone else, a platform administrator creates the account.',
} as const;

/** `sys_invitation.resend_invitation.outcomeMessages`. */
export const RESEND_INVITATION_OUTCOME_MESSAGES = {
  sent: 'Invitation resent to {{ result.email }}',
  link_only:
    'Invitation renewed for {{ result.email }}. Mail is not configured on this server, so no email went out. '
    + 'Accepting needs a verified email address: without mail, only an invitee whose social or SSO sign-in '
    + 'verifies the address can accept. For anyone else, a platform administrator creates the account.',
} as const;
