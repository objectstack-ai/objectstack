/**
 * The query key an arrival at `/verify-email-prompt` sets when the server has
 * already sent the verification mail (objectstack#34706).
 *
 * Only the sign-up arrival sets it: the sign-up sends the mail itself when it
 * answers that verification is required. The sign-in arrival (a refused
 * `EMAIL_NOT_VERIFIED`, which sends nothing unless the deployment opts into
 * `emailVerification.sendOnSignIn`) and the accept-invitation arrivals (a
 * refused accept, which sends nothing) leave it out, so the prompt's standing
 * copy asks the person to send the link rather than saying it was sent.
 * Absent is the default on purpose: a page that cannot tell must not claim a
 * mail went out.
 */
export const VERIFICATION_SENT_PARAM = 'sent';
