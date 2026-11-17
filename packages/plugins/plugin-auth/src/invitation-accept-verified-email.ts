// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Accepting or declining an organization invitation needs a verified email
 * address — on every deployment, whether or not it delivers mail.
 *
 * ## The rule
 *
 * The invitation's id is no proof of the invited mailbox: its accept link
 * carries it, `copy_invitation_link` answers it and the invitation row holds
 * it. What proves the mailbox is a verified address: a password account
 * verifies it by the mail round trip, and an account a social or SSO provider
 * made counts only when the provider verified it (that is what the vendor
 * stores on the account it creates). So:
 *
 *  - `POST /organization/accept-invitation` and
 *    `POST /organization/reject-invitation` refuse a session whose address is
 *    not verified, `403
 *    EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION`.
 *    Nothing is written: no membership, and the invitation stays pending.
 *  - `GET /organization/list-user-invitations` refuses it too
 *    (`list-user-invitations-verification.ts`), so the listing never hands an
 *    invitation's id to such a session.
 *  - `GET /organization/get-invitation` stays open to the recipient, so the
 *    accept page can name the invitation before the person verifies.
 *  - The one-step door (`invitation-mailbox-proof.ts`) verifies the address
 *    with the proof only the invitation mail carries before it accepts, and
 *    its signed-in mode answers `verify_email` for an unverified session.
 *
 * Nothing here reads whether mail is live, so no state of the mail transport
 * (live, absent, or one whose liveness cannot be read) relaxes the rule. A
 * deployment that cannot deliver the verification mail cannot onboard anyone
 * by invitation link; the self-hosting docs name the operator's alternatives.
 *
 * ## Why these seams: the vendor's own `beforeAcceptInvitation` and `beforeRejectInvitation`
 *
 * better-auth 1.7.12 calls both hooks inside its endpoints
 * (`dist/plugins/organization/routes/crud-invites.mjs`), after its own
 * not-found / expiry / status and recipient checks and before the invitation
 * row or a membership is written.
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
 *  - **Not the vendor's option.** `requireEmailVerificationOnInvitation`
 *    governs accept, reject and get-invitation together, so turning it on
 *    would close the read the accept page needs. It stays declared `false`
 *    (`auth-manager-organization-plugin.ts`) and the two hooks carry the rule.
 *
 * ## Refusal envelope — the vendor's, on purpose
 *
 * better-auth's flat `{ message, code }` with the vendor's OWN code, the one
 * its accept and reject routes throw when the option is on, so a client that
 * already handles the vendor's refusal handles this one. Read off the plugin's
 * `$ERROR_CODES` where the caller has it; the local restatement below is the
 * fallback, and `invitation-accept-verified-email.test.ts` pins it equal to
 * the vendor's. No new public error code is minted, so nothing here reaches
 * the spec error-code ledger.
 */

/** The vendor's path for accepting an invitation by id. */
export const ACCEPT_INVITATION_PATH = '/organization/accept-invitation';

/** The vendor's path for declining an invitation by id. */
export const REJECT_INVITATION_PATH = '/organization/reject-invitation';

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
 * The accept and decline doors' half of the rule: refuse a `user` whose
 * address is not verified. The verified test is the vendor's own
 * (`!user.emailVerified`), on the user the vendor's endpoint resolved; an
 * absent user is refused.
 *
 * `verificationRequired` is the plugin's own `$ERROR_CODES` entry when the
 * caller has it.
 */
export async function refuseUnverifiedInvitationAnswer(
  user: { emailVerified?: unknown } | null | undefined,
  deps: { verificationRequired?: { code: string; message: string } } = {},
): Promise<void> {
  if (user?.emailVerified) return;
  const { APIError } = await import('better-auth/api');
  throw APIError.from(
    'FORBIDDEN',
    deps.verificationRequired ?? EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_INVITATION,
  );
}
