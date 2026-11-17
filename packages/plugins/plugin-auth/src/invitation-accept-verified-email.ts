// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34272] `POST /organization/accept-invitation` — while this deployment
 * delivers mail, a session whose address is NOT verified may not accept an
 * invitation.
 *
 * ## The rule
 *
 * While mail is live, accepting an invitation needs a verified address,
 * because an unverified address is not proof of the invited mailbox.
 *
 *  - **While email delivery is live** (`AuthManager.isEmailDeliveryLive`, the
 *    one reader of `IEmailService.isConfigured()`, read at call time): an
 *    unverified session is refused, `403
 *    EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION`.
 *    Nothing is written. The person verifies the address (the mail can reach
 *    them) and accepts again.
 *  - **While it is not live** the door is unchanged: an unverified session
 *    accepts, as before. Nothing on such a deployment can ever verify an
 *    address, so refusing there would dead-end every invitation — the reason
 *    `requireEmailVerificationOnInvitation` is declared `false` in
 *    `auth-manager-organization-plugin.ts`, which still holds there.
 *
 * Unchanged: `get-invitation`, `reject-invitation` and
 * `list-user-invitations` (they write no membership: reading or declining an
 * invitation addressed to you takes nothing), the one-step door
 * (`invitation-mailbox-proof.ts`, whose proof mode verifies the address
 * before it accepts and whose session mode already answers `verify_email` for
 * an unverified session), and a verified session everywhere.
 *
 * ## Why this seam: the vendor's own `beforeAcceptInvitation`
 *
 * The rule is asked from `organizationHooks.beforeAcceptInvitation`, which
 * better-auth 1.7.12 calls inside the accept endpoint
 * (`dist/plugins/organization/routes/crud-invites.mjs`), after its own
 * not-found / expiry / status, recipient and membership-limit checks and
 * before the invitation row or the membership is written.
 *
 *  - **The user is the vendor's.** The hook receives `session.user` as the
 *    endpoint's session middleware resolved it, cookie and bearer token alike
 *    — the very object the vendor's own verification check reads
 *    (`!session.user.emailVerified`). No second session read, no user read.
 *    A global before-hook could not say the same: it runs before `bearer()`
 *    turns a bearer credential into a session.
 *  - **Nothing is retyped.** The vendor's recipient and expiry checks run
 *    first, so a session that is not the invitee still gets the vendor's
 *    `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`, and an unknown id its
 *    `INVITATION_NOT_FOUND`; this refusal tells only the invitee, about their
 *    own address.
 *  - **Only accept.** The vendor's option governs accept, reject and
 *    get-invitation together; turning it on would refuse reading and
 *    declining too. This hook fires on accept alone.
 *
 * ## Refusal envelope — the vendor's, on purpose
 *
 * better-auth's flat `{ message, code }` with the vendor's OWN code, the one
 * its accept route throws when the option is on, so a client that already
 * handles the vendor's refusal handles this one. Read off the plugin's
 * `$ERROR_CODES` where the caller has it; the local restatement below is the
 * fallback, and `invitation-accept-verified-email.test.ts` pins it equal to
 * the vendor's. No new public error code is minted, so nothing here reaches
 * the spec error-code ledger.
 */

/** The vendor's path for accepting an invitation by id. */
export const ACCEPT_INVITATION_PATH = '/organization/accept-invitation';

/**
 * better-auth's
 * `ORGANIZATION_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION`,
 * restated locally as the fallback for a plugin object carrying no
 * `$ERROR_CODES` (the vendor does not export the constant from a public entry).
 */
export const EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION = {
  code: 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION',
  message: 'Email verification required before accepting or rejecting invitation',
} as const;

/**
 * The accept door's half of the rule: refuse an unverified `user` while email
 * delivery is live. A no-op for a verified user and while delivery is not
 * live. The verified test is the vendor's own (`!user.emailVerified`), on the
 * user the vendor's endpoint resolved.
 *
 * `verificationRequired` is the plugin's own `$ERROR_CODES` entry when the
 * caller has it.
 */
export async function refuseUnverifiedAcceptWhileMailIsLive(
  user: { emailVerified?: unknown } | null | undefined,
  deps: {
    isEmailDeliveryLive: () => boolean;
    verificationRequired?: { code: string; message: string };
  },
): Promise<void> {
  if (user?.emailVerified) return;
  if (!deps.isEmailDeliveryLive()) return;
  const { APIError } = await import('better-auth/api');
  throw APIError.from(
    'FORBIDDEN',
    deps.verificationRequired ?? EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION,
  );
}
