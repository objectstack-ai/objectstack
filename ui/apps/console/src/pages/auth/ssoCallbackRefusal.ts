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

const SIGN_IN_NOT_FOUND: RefusalCopy = {
  key: 'auth.login.errors.ssoSignInNotFound',
  defaultValue:
    'This sign-in took too long or was started in another browser window. Start again from this page.',
};

const GENERIC: RefusalCopy = {
  key: 'auth.login.errors.oauthCallbackFailed',
  defaultValue:
    'Single sign-on could not be completed — the sign-in link expired or was already used. Please try again.',
};

/**
 * Callback `error` code → the end-user sentence. Keys are the codes the
 * server actually redirects with, as written: the audience gate's
 * ADR-0112 code for an uninvited person under `invite_only` with
 * just-in-time provisioning off, better-auth's lowercase OAuth callback codes,
 * and `@better-auth/sso`'s SAML codes. A code missing here keeps the generic
 * sentence.
 */
const SSO_CALLBACK_REFUSALS: Readonly<Record<string, RefusalCopy>> = {
  SELF_REGISTRATION_CLOSED: ACCOUNT_NOT_INVITED,
  account_not_linked: ACCOUNT_NOT_LINKED,
  saml_error: RESPONSE_REJECTED,
  invalid_saml_response: RESPONSE_REJECTED,
  state_not_found: SIGN_IN_NOT_FOUND,
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
