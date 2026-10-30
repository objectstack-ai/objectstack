// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25083] The refusals a cloud-managed environment answers at plugin-auth's
 * local identity doors.
 *
 * A hosted environment is managed (the maintainer's ruling on
 * objectstack-ai/cloud#3132, cloud ADR-0024 D5.2, mirrored here as ADR-0135
 * D5.2): the organisation that hosts it invites its people in the cloud, their
 * accounts arrive through the cloud's identity provider, and authorization —
 * positions, permission sets — stays in the environment. Whether this process
 * is one is `isCloudManaged()` from `@objectstack/core` (`OS_CLOUD_MANAGED=1`
 * on the cloud's containers); every door below asks it and nothing else.
 * Self-hosted deployments never set the variable, so there every door answers
 * exactly as it did before.
 *
 * The doors split by POPULATION, never switched off wholesale (ADR-0135 D5.2):
 * a password can still be set on a local (`env_native`) account, and a
 * platform administrator can still give themselves a local password, so the
 * break-glass administrator stays reachable when the identity provider is not.
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
  invitation:
    'This environment is cloud-managed: the people who use it are invited by the organisation that hosts it, in the cloud, '
    + 'so an invitation cannot be created here. Invite them from the organisation in the cloud console; their account '
    + 'arrives on their first sign-in. No invitation was created.',
  // [#27843] `sys_invitation.copy_invitation_link`: the invitation's accept
  // link, which the hosting organisation's cloud invitation replaces here.
  invitationLink:
    'This environment is cloud-managed: the people who use it are invited by the organisation that hosts it, in the cloud, '
    + 'so an invitation link is not handed out here. Invite them from the organisation in the cloud console; their account '
    + 'arrives on their first sign-in. No link was returned.',
  createUser:
    'This environment is cloud-managed: its users are invited by the organisation that hosts it, in the cloud, so a '
    + 'local user cannot be created here. Invite the person from the organisation in the cloud console; their account '
    + 'arrives on their first sign-in. No user was created.',
  importUsers:
    'This environment is cloud-managed: its users are invited by the organisation that hosts it, in the cloud, so users '
    + 'cannot be imported here. Invite them from the organisation in the cloud console. No user was imported.',
  setUserPassword:
    "This environment is cloud-managed and this user signs in through the hosting organisation's identity provider, so "
    + 'their password is managed there. A password can be set here only on a local account (source env_native), such '
    + 'as the break-glass administrator. No password was changed.',
  setInitialPassword:
    "This environment is cloud-managed: you sign in through the hosting organisation's identity provider, and a local "
    + "password here is reserved for a platform administrator's break-glass access. No password was set.",
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
