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
 *    because the provider does not allow IdP-initiated sign-in.
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
};

/**
 * The sentence an end user reads for a refused single sign-on. It never
 * carries the technical cause (the code and the server's description, which
 * are written for administrators); the page shows those behind a details
 * toggle instead.
 */
export function ssoCallbackRefusalMessage(t: TranslateFn, code: string): string {
  const copy = Object.prototype.hasOwnProperty.call(SSO_CALLBACK_REFUSALS, code)
    ? SSO_CALLBACK_REFUSALS[code]
    : GENERIC;
  return t(copy.key, { defaultValue: copy.defaultValue });
}

/** The technical cause, for the details toggle: the code, then the server's description when it sent one. */
export function ssoCallbackTechnicalDetail(error: SsoCallbackError): string {
  return error.description ? `${error.code}: ${error.description}` : error.code;
}
