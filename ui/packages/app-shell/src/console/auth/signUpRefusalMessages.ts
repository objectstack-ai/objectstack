/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { TranslateFn } from '@object-ui/i18n';

/**
 * Sign-up refusal `code` → localized text, for `RegisterForm`'s `errorMessages`.
 *
 * `RegisterForm` falls back to the server's own `message` for a code missing
 * here; that message is English and may name internal configuration, so every
 * refusal an end user can meet at `/sign-up/email` belongs in this map
 * (objectui#10998). It is the one map both register pages pass — the console
 * app's and `DefaultRegisterPage` (objectui#11030). `AUTH_CONFIG_ERROR` is left
 * out on purpose: its message is written for the operator.
 */
export function signUpRefusalMessages(t: TranslateFn): Record<string, string> {
  const userExists = t('auth.register.errors.userExists', {
    defaultValue: 'An account with this email already exists. Try signing in instead.',
  });
  return {
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: userExists,
    USER_ALREADY_EXISTS: userExists,
    // The server's audience gate: the environment admits new accounts by
    // invitation only, or only from allowlisted email domains.
    SELF_REGISTRATION_CLOSED: t('auth.register.errors.selfRegistrationClosed', {
      defaultValue:
        'Self-registration is not open on this system. Ask an administrator for an invitation.',
    }),
    EMAIL_DOMAIN_NOT_ALLOWED: t('auth.register.errors.emailDomainNotAllowed', {
      defaultValue:
        "This email's domain is not allowed to register here. Use your organization email, or ask an administrator for an invitation.",
    }),
  };
}
