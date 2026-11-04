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
 * — the two above, and the email-OTP door, unmounted, on its own path — is in
 * the interactive-revoke ledger (`session-tombstone.ts`,
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
 * ## The retired key
 *
 * `emailAndPassword.revokeSessionsOnPasswordReset` is RETIRED from the
 * published configuration schema (`@objectstack/spec`,
 * `EmailAndPasswordConfigSchema`): it could hold only one value, so it is a
 * `retiredKey()` tombstone, and a typed or parsed configuration that writes it
 * fails `tsc` or the parse with the prescription. The manager never parses its
 * configuration through that schema, so {@link assertPasswordResetEndsSessions}
 * holds the same line where the configuration enters the manager — at
 * construction, which stops the boot, and on a configuration patch, where the
 * standing configuration keeps ruling — and REFUSES the key at any value, with
 * the tombstone's own prescription. `true` asked for what the platform does
 * anyway and `false` for what it no longer does; either way the key is to be
 * deleted, and a declaration that reads as a setting when there is none is the
 * ADR-0049 hazard. Refusing is how this plugin treats every other declaration
 * it will not honour (`assertAudienceConfig`, `assertScimAdminCoherence`).
 * better-auth's own option of the same name is set by the auth instance, never
 * read from the host configuration.
 */

import { REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED } from '@objectstack/spec/system';

/** The retired configuration key this guard refuses. */
const RETIRED_KEY = 'revokeSessionsOnPasswordReset';

/**
 * Refuse an `emailAndPassword` block that still writes the retired
 * `revokeSessionsOnPasswordReset`, whatever it holds. An absent key (or one
 * holding `undefined`, which the schema's tombstone accepts too) passes; see
 * the header.
 */
export function assertPasswordResetEndsSessions(emailAndPassword: unknown): void {
  if (
    emailAndPassword !== null
    && typeof emailAndPassword === 'object'
    && (emailAndPassword as Record<string, unknown>)[RETIRED_KEY] !== undefined
  ) {
    throw new Error(`[auth] ${REVOKE_SESSIONS_ON_PASSWORD_RESET_RETIRED}`);
  }
}
