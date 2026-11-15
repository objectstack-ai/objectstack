// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pending marker of a person added before their first sign-in on a
 * cloud-managed environment, and the refusal every password door answers for
 * it. The doors that add such a person, and why, are `pending-sso-users.ts`.
 * A leaf module: the password doors import it without importing the doors.
 *
 * The sentences an administrator or a person reads are collected in
 * {@link PENDING_SSO_MESSAGES} so the wording can move in one place.
 */

import type { StandardErrorCode } from '@objectstack/spec/api';

/** The `sys_user.source` value of a person added here who has not signed in yet. */
export const PENDING_SSO_SOURCE = 'idp_pending';

/** Is `source` the pending marker? */
export function isPendingSsoSource(source: unknown): boolean {
  return source === PENDING_SSO_SOURCE;
}

/** The ADR-0112 code every pending refusal and conflict carries (registered; no code minted). */
export const PENDING_SSO_REFUSAL_CODE: StandardErrorCode = 'RESOURCE_CONFLICT';

/** The status every pending refusal and conflict answers. */
export const PENDING_SSO_REFUSAL_STATUS = 409;

/**
 * Every sentence this module's doors and refusals answer, in one place.
 * Each says what was not done and what to do instead.
 */
export const PENDING_SSO_MESSAGES = {
  notManaged:
    "This environment is not cloud-managed, so there is no hosting organisation's sign-in for a pending person to "
    + 'arrive through. Create the user with a password or an invitation instead (admin/create-user, '
    + 'admin/import-users). No user was added.',
  alreadyExists:
    'A user with this email address already exists in this environment, so no one was added. Change the existing '
    + "user's positions, permission sets or manager on their record instead.",
  setUserPassword:
    "This person has not signed in yet: they were added to sign in through the hosting organisation's identity "
    + 'provider, and a local password cannot be set for them. No password was changed.',
  setInitialPassword:
    "Your account was added to sign in through the hosting organisation's identity provider, so a local password "
    + 'cannot be set for it. Sign in with single sign-on. No password was set.',
  resetPassword:
    "This account was added to sign in through the hosting organisation's identity provider, so it has no local "
    + 'password to reset. Sign in with single sign-on. No password was set.',
  session:
    "This account was added to sign in through the hosting organisation's identity provider and has not done so "
    + 'yet. Sign in with single sign-on first; until then no other sign-in method opens a session.',
} as const;

/** The doors whose pending refusal is a `409` envelope. */
export type PendingSsoPasswordDoor = 'setUserPassword' | 'setInitialPassword' | 'resetPassword';

/** The ADR-0112 envelope a raw route answers when `door` meets a pending row. */
export function pendingSsoPasswordRefusal(door: PendingSsoPasswordDoor): {
  status: typeof PENDING_SSO_REFUSAL_STATUS;
  body: { success: false; error: { code: StandardErrorCode; message: string } };
} {
  return {
    status: PENDING_SSO_REFUSAL_STATUS,
    body: { success: false, error: { code: PENDING_SSO_REFUSAL_CODE, message: PENDING_SSO_MESSAGES[door] } },
  };
}
