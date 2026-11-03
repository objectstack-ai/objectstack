// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A completed password reset ends the account's other sessions.
 *
 * ## The rule
 *
 * Every self-service reset door — the emailed link (`POST /reset-password`)
 * and the phone OTP reset (`POST /phone-number/reset-password`) — ends every
 * session the account holds when it sets the new password, the same as an
 * administrator's forced reset does (`forced-reset-revocation.ts`). It is not a
 * deployment option: no setting turns it off. The person who reset the
 * password signs in again with it.
 *
 * ## How it is wired
 *
 * Each of those doors runs better-auth's `resetCredentialPassword` (better-auth
 * 1.7.12, `dist/utils/password.mjs`; the email-OTP reset, which this platform
 * does not mount, runs it too). It deletes the user's sessions
 * (`internalAdapter.deleteUserSessions`) in the same unit as the token spend
 * and the password write, ahead of the write, whenever
 * `emailAndPassword.revokeSessionsOnPasswordReset` is set — and better-auth's
 * own default is unset. So the auth instance sets it, always
 * (`auth-manager-auth-instance.ts`), and every door that sets a password from a
 * reset token or code inherits the rule without a door of its own.
 *
 * A session a password reset ends leaves a revocation trail. Every reset door
 * — the two above, and the email-OTP door on its own path — is in the
 * interactive-revoke ledger (`session-tombstone.ts`,
 * `INTERACTIVE_REVOKE_REASON`) with the value `password_reset`, and is not an
 * erasure path. better-auth's bulk delete reaches the adapter's per-row
 * reconcile, so each session row is stamped in place rather than deleted —
 * `expires_at` a second in the past, `revoked_at`, `revoke_reason:
 * password_reset` — and is hidden from better-auth's session reads, so the
 * session answers 401. The value is not the forced reset's
 * `admin_password_reset`: the row says who ended the session. No `logout`
 * audit row is written — `logoutEventFor` (`auth-session-audit.ts`) records a
 * `/sign-out` alone. And the account's API keys are untouched; the forced
 * reset's key revocation is its own switch.
 *
 * ## The declared key
 *
 * `emailAndPassword.revokeSessionsOnPasswordReset` is still declared by the
 * published configuration schema (`@objectstack/spec`,
 * `EmailAndPasswordConfigSchema`). `true` is what the platform does anyway and
 * is accepted. An explicit `false` asks for something the platform no longer
 * does, so {@link assertPasswordResetEndsSessions} REFUSES it where the
 * configuration enters the manager — at construction, which stops the boot, and
 * on a configuration patch, where the standing configuration keeps ruling —
 * rather than overriding it silently: a declaration that reads as in force and
 * is not is the ADR-0049 hazard, and refusing is how this plugin treats every
 * other declaration it will not honour (`assertAudienceConfig`,
 * `assertScimAdminCoherence`).
 */

import type { EmailAndPasswordConfig } from '@objectstack/spec/system';

/**
 * Refuse an `emailAndPassword` block that asks a completed password reset to
 * keep the account's other sessions. Absent and `true` pass; see the header.
 */
export function assertPasswordResetEndsSessions(
  emailAndPassword: Pick<NonNullable<EmailAndPasswordConfig>, 'revokeSessionsOnPasswordReset'> | undefined,
): void {
  if (emailAndPassword?.revokeSessionsOnPasswordReset === false) {
    throw new Error(
      '[auth] emailAndPassword.revokeSessionsOnPasswordReset: false is not supported: a completed ' +
        "password reset always ends the account's other sessions, on every reset door, the same as " +
        "an administrator's forced reset. Remove the key (true is accepted and changes nothing). " +
        'Refused rather than ignored, so the configuration never reads as keeping sessions it does not keep.',
    );
  }
}
