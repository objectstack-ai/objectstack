/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { TranslateFn } from '@object-ui/i18n';

/**
 * The `?error=` / `?error_description=` pair a refused single sign-on lands
 * on this login page with: better-auth's error URL (`onAPIError.errorURL`) is
 * this page, and every refusal of the OIDC callback and the SAML ACS is
 * redirected there with the vendor's `error` code.
 */
export interface SsoCallbackError {
  code: string;
  description: string | null;
}

interface RefusalCopy {
  key: string;
  defaultValue: string;
}

const ACCOUNT_NOT_INVITED: RefusalCopy = {
  key: 'auth.login.errors.ssoAccountNotInvited',
  defaultValue: "Your account isn't set up for this system yet. Ask your administrator to invite you.",
};

const ACCOUNT_NOT_LINKED: RefusalCopy = {
  key: 'auth.login.errors.ssoAccountNotLinked',
  defaultValue:
    "An account with your email already exists here, but it isn't connected to single sign-on. Sign in another way, or ask your administrator to connect it.",
};

const RESPONSE_REJECTED: RefusalCopy = {
  key: 'auth.login.errors.ssoResponseRejected',
  defaultValue:
    "Your organization's sign-in service sent a response this system could not accept. Ask your administrator to check the single sign-on setup.",
};

const START_FROM_LOGIN_PAGE: RefusalCopy = {
  key: 'auth.login.errors.ssoStartFromLoginPage',
  defaultValue:
    "Sign-in has to start from this system's login page. Enter your work email here and choose Sign in with SSO.",
};

const DIRECT_SIGN_IN_UNAVAILABLE: RefusalCopy = {
  key: 'auth.login.errors.directSignInUnavailable',
  defaultValue:
    "Single sign-on could not be started for this system. Ask your administrator to check which sign-in service it uses.",
};

const DIRECT_SIGN_IN_RATE_LIMITED: RefusalCopy = {
  key: 'auth.login.errors.directSignInRateLimited',
  defaultValue: 'Too many sign-ins were started from this network just now. Wait a few seconds, then try again.',
};

const NETWORK_NOT_ALLOWED: RefusalCopy = {
  key: 'auth.login.errors.networkNotAllowed',
  defaultValue:
    "This system does not allow sign-in from your network. Connect from an allowed network (for example your organization's office network or VPN), or ask your administrator.",
};

const ACCESS_DENIED: RefusalCopy = {
  key: 'auth.login.errors.ssoAccessDenied',
  defaultValue:
    "The account you signed in with does not have access to this environment. Sign in with an account that has access, or ask an administrator of this environment's organization to add you as a member.",
};

/**
 * `access_denied` with the host's reason (plugin-auth
 * `oauth-authorize-refusal.ts`, carried across this environment's callback by
 * `oauth-callback-refusal-reason.ts`): the reasons this page has a sentence for.
 * Any other reason, or none, keeps {@link ACCESS_DENIED}. The organization's
 * name is not on the URL as a field; it is only inside the host's own
 * sentence, which stays under the technical details.
 */
const ACCESS_DENIED_BY_REASON: Readonly<Record<string, RefusalCopy>> = {
  not_member: {
    key: 'auth.login.errors.ssoAccessDeniedNotMember',
    defaultValue:
      "The account you signed in with is not a member of this environment's organization. Sign in with an account that is, or ask an administrator of the organization to invite you.",
  },
  invitation_pending: {
    key: 'auth.login.errors.ssoAccessDeniedInvitationPending',
    defaultValue:
      "You have been invited to this environment's organization, but the invitation has not been accepted yet. Accept the invitation from your email, then sign in again.",
  },
};

/** The parameter the host's reason arrives on, beside `error=access_denied`. */
export const REFUSAL_REASON_PARAM = 'objectstack_error_reason';

const EMAIL_DOMAIN_NOT_ALLOWED: RefusalCopy = {
  key: 'auth.login.errors.ssoEmailDomainNotAllowed',
  defaultValue:
    "No account was created: your email address isn't at a domain this system accepts new accounts from. Use your organization email, or ask your administrator.",
};

const EMAIL_NOT_AN_ADDRESS: RefusalCopy = {
  key: 'auth.login.errors.ssoEmailNotAnAddress',
  defaultValue:
    "No account was created: your organization's sign-in service did not send a usable email address for you. Ask your administrator to check the single sign-on setup.",
};

const GENERIC: RefusalCopy = {
  key: 'auth.login.errors.oauthCallbackFailed',
  defaultValue:
    'Single sign-on could not be completed — the sign-in link expired or was already used. Please try again.',
};

/**
 * Callback `error` code → the end-user sentence. Keys are the codes the
 * server actually redirects with, as written:
 *
 *  - `SELF_REGISTRATION_CLOSED`: the audience gate refused a person with no
 *    account and no invitation (`invite_only`, just-in-time provisioning off);
 *  - `account_not_linked`: better-auth refused to attach the sign-in to a
 *    local account with the same email;
 *  - `saml_error`, `invalid_saml_response`: `@better-auth/sso` refused the
 *    SAML response (an unverifiable signature, a wrong audience or recipient);
 *  - `state_not_found`: the OIDC callback carried no `state`, which is an
 *    identity-provider-initiated sign-in the provider does not allow, or a
 *    callback URL opened again later;
 *  - `unsolicited_response`: the SAML ACS refused an identity-provider-
 *    initiated response (a sign-in started from the provider's app tile)
 *    because the provider does not allow IdP-initiated sign-in;
 *  - `direct_sign_in_unavailable`: the direct sign-in door found no single
 *    identity provider to start, or the provider's start was refused
 *    (`./directSignIn`);
 *  - `IP_NOT_ALLOWED`: the deployment's IP allow-list refused this client at
 *    the direct sign-in door, which sends a browser here instead of answering
 *    the raw `403` body (plugin-auth `direct-sign-in.ts`
 *    `directSignInNetworkRefusal`). Nothing was started, and every sign-in
 *    this page offers is refused the same way from this network, so the
 *    sentence names the network and the administrator, not a retry;
 *  - `access_denied` (RFC 6749 §4.1.2.1): the identity provider refused the
 *    signed-in account for this relying party. The ObjectStack provider sends
 *    it when its environment-access gate refuses an account that is not a
 *    member of the environment's organization (plugin-auth
 *    `oauth-authorize-refusal.ts`), and the callback hands it on unchanged.
 *    Its sentence says the same as that provider's own refusal page, and the
 *    page offers the same two ways on ({@link accessDeniedExits}).
 *  - `EMAIL_DOMAIN_NOT_ALLOWED`: two emitters send it here. With SSO domain
 *    verification on, an identity provider asked for a new account whose
 *    email is not at a domain it has proven (plugin-auth
 *    `sso-account-at-proven-domain.ts`); and the `email_domain` audience
 *    posture refused a self-serve creation, a social sign-up included, whose
 *    email is not on the approved-domain list (plugin-auth
 *    `audience-posture.ts`). The sentence is true of both: nothing was
 *    created, the address is not at a domain this system accepts new accounts
 *    from, and a second attempt meets the same rule, so it names the
 *    organization email and the administrator, not trying again;
 *  - `INVALID_EMAIL`: the provider asked for a new account and the sign-in
 *    resolved to a value that is not an email address (no email attribute or
 *    claim mapped). Nothing was created; only the administrator can fix the
 *    mapping.
 *
 * A code missing here keeps the generic sentence.
 */
const SSO_CALLBACK_REFUSALS: Readonly<Record<string, RefusalCopy>> = {
  SELF_REGISTRATION_CLOSED: ACCOUNT_NOT_INVITED,
  account_not_linked: ACCOUNT_NOT_LINKED,
  saml_error: RESPONSE_REJECTED,
  invalid_saml_response: RESPONSE_REJECTED,
  unsolicited_response: START_FROM_LOGIN_PAGE,
  state_not_found: START_FROM_LOGIN_PAGE,
  direct_sign_in_unavailable: DIRECT_SIGN_IN_UNAVAILABLE,
  direct_sign_in_rate_limited: DIRECT_SIGN_IN_RATE_LIMITED,
  IP_NOT_ALLOWED: NETWORK_NOT_ALLOWED,
  access_denied: ACCESS_DENIED,
  EMAIL_DOMAIN_NOT_ALLOWED: EMAIL_DOMAIN_NOT_ALLOWED,
  INVALID_EMAIL: EMAIL_NOT_AN_ADDRESS,
};

/**
 * The sentence an end user reads for a refused single sign-on. It never
 * carries the technical cause (the code and the server's description, which
 * are written for administrators); the page shows those behind a details
 * toggle instead.
 */
export function ssoCallbackRefusalMessage(t: TranslateFn, code: string, reason?: string | null): string {
  const byReason =
    code === ACCESS_DENIED_CODE && typeof reason === 'string' && Object.prototype.hasOwnProperty.call(ACCESS_DENIED_BY_REASON, reason)
      ? ACCESS_DENIED_BY_REASON[reason]
      : undefined;
  const copy = byReason
    ?? (Object.prototype.hasOwnProperty.call(SSO_CALLBACK_REFUSALS, code) ? SSO_CALLBACK_REFUSALS[code] : GENERIC);
  return t(copy.key, { defaultValue: copy.defaultValue });
}

const LINK_EMAIL_MISMATCH: RefusalCopy = {
  key: 'auth.login.errors.linkEmailMismatch',
  defaultValue:
    "The account was not linked: its email address doesn't match the one on the account you're signed in with. Link an account that uses the same email address.",
};

const LINK_ALREADY_LINKED_TO_OTHER_USER: RefusalCopy = {
  key: 'auth.login.errors.linkAlreadyLinkedToOtherUser',
  defaultValue:
    'The account was not linked: it is already linked to a different user of this system. Link a different account, or sign in as the user it is linked to and unlink it there first.',
};

const LINK_UNABLE_TO_LINK: RefusalCopy = {
  key: 'auth.login.errors.linkUnableToLink',
  defaultValue:
    'The account could not be linked. Check that its email address is verified with that sign-in service, then try again. If it still fails, ask your administrator.',
};

/**
 * Callback `error` code → the sentence for a person who is ALREADY signed in.
 *
 * Linking another sign-in to your own account (`POST /link-social`, then the
 * provider's round trip) lands on the same error URL as a sign-in when the
 * callback refuses the link, but the person is still signed in, so this page
 * never draws its form for them: it sends them on to the console. The sentence
 * goes with them and is shown where they land (`../../components/LinkRefusalNotice`).
 *
 *  - `email_does_not_match`: better-auth refused to link a provider account
 *    whose email differs from the signed-in account's
 *    (`accountLinking.allowDifferentEmails` is off). No account row is written.
 *  - `account_already_linked_to_different_user`: the provider account is
 *    already linked to another user here (its email now matches the
 *    signed-in account's, or different emails are allowed). Nothing is
 *    moved. The sentence names no one.
 *  - `unable_to_link_account`: better-auth would not link it, chiefly because
 *    a provider that is not trusted did not assert the email as verified
 *    (also when linking is turned off, or the account row cannot be written).
 *
 * All three are `linkOAuthAccount`'s refusals (better-auth
 * `oauth2/link-account.mjs`), redirected by the callback to the error URL.
 *
 * Only these codes travel; any other `error` a signed-in person arrives with
 * is left where it was, and nothing from the URL is ever shown as it came.
 */
const SIGNED_IN_LINK_REFUSALS: Readonly<Record<string, RefusalCopy>> = {
  email_does_not_match: LINK_EMAIL_MISMATCH,
  account_already_linked_to_different_user: LINK_ALREADY_LINKED_TO_OTHER_USER,
  unable_to_link_account: LINK_UNABLE_TO_LINK,
};

/** Whether `code` is a link refusal a signed-in person is told about where they land. */
export function isSignedInLinkRefusal(code: string | null | undefined): code is string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(SIGNED_IN_LINK_REFUSALS, code);
}

/** The sentence for a link refusal ({@link isSignedInLinkRefusal}), or `null` for any other code. */
export function signedInLinkRefusalMessage(t: TranslateFn, code: string): string | null {
  if (!isSignedInLinkRefusal(code)) return null;
  const copy = SIGNED_IN_LINK_REFUSALS[code];
  return t(copy.key, { defaultValue: copy.defaultValue });
}

/** The technical cause, for the details toggle: the code, then the server's description when it sent one. */
export function ssoCallbackTechnicalDetail(error: SsoCallbackError): string {
  return error.description ? `${error.code}: ${error.description}` : error.code;
}

/** RFC 6749 §4.1.2.1: the identity provider refused the signed-in account. */
export const ACCESS_DENIED_CODE = 'access_denied';

/**
 * The control plane's RP-initiated logout (`@better-auth/oauth-provider`'s
 * `/oauth2/end-session`), under the framework's auth mount. The same door the
 * provider's own refusal page links as "Switch account".
 */
export const CONTROL_PLANE_END_SESSION_PATH = '/api/v1/auth/oauth2/end-session';

/** The two ways on from an `access_denied` return, both on the control plane. */
export interface AccessDeniedExits {
  /** Ends the account's session at the identity provider, so the next sign-in asks who you are. */
  switchAccountUrl: string;
  /** The control plane's console. */
  consoleUrl: string;
}

/**
 * The ways on from an `access_denied` return, or `null` when this page cannot
 * name them.
 *
 * Signing out of this environment cannot switch the account: the refusal came
 * before any session here, and the account that was refused is the one still
 * signed in at the identity provider, which would hand it straight back on the
 * next sign-in. Switching means ending THAT session, at the provider's
 * end-session door. The page can name that door only where it knows the
 * provider: an environment the control plane runs (`features.cloudManaged`
 * from `/auth/config`), whose people arrive through the control plane's
 * identity provider, with the control plane's address served as the runtime
 * config's `cloudUrl`. Anywhere else (a self-hosted deployment, an enterprise
 * identity provider) the code may come from a provider this page cannot
 * address, so it offers neither link rather than a wrong one.
 *
 * The door is opened without `id_token_hint` or `client_id`: the provider then
 * asks the person to confirm, ends the session, and stays on its own page, so
 * the page opens it in a new tab and the person signs in again here.
 */
export function accessDeniedExits(input: {
  code: string;
  cloudManaged: boolean | undefined;
  cloudBase: string;
}): AccessDeniedExits | null {
  if (input.code !== ACCESS_DENIED_CODE || input.cloudManaged !== true) return null;
  const base = input.cloudBase.trim().replace(/\/+$/, '');
  if (!base) return null;
  try {
    const { protocol } = new URL(base);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return { switchAccountUrl: `${base}${CONTROL_PLANE_END_SESSION_PATH}`, consoleUrl: base };
}
