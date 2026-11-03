/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { TranslateFn } from '@object-ui/i18n';

/**
 * Sign-in refusal `code` → localized text, for `LoginForm`'s `errorMessages`.
 *
 * `LoginForm` falls back to the server's own `message` for a code missing
 * here, and that message is English in every language. It is the one map both
 * login pages pass — the console app's and `DefaultLoginPage` (objectui#11058),
 * the sign-in twin of `signUpRefusalMessages`. The console page's extra
 * handling of `EMAIL_NOT_VERIFIED` (a redirect to its own verify-email route,
 * run from `onError`) is page behaviour, not text, so it stays on that page.
 */
export function signInRefusalMessages(t: TranslateFn): Record<string, string> {
  return {
    INVALID_EMAIL_OR_PASSWORD: t('auth.login.errors.invalidCredentials', {
      defaultValue: 'Invalid email or password. Please try again.',
    }),
    EMAIL_NOT_VERIFIED: t('auth.login.errors.emailNotVerified', {
      defaultValue: 'Please verify your email address before signing in.',
    }),
    // objectstack#29105 — refusals of the two-factor step (better-auth's
    // `twoFactor()` codes). A wrong code is shown on the step itself; a spent
    // or expired challenge (the third and fourth) on the password step it
    // returns to.
    INVALID_CODE: t('auth.login.errors.twoFactorInvalidCode', {
      defaultValue: 'That code is not valid. Check your authenticator app and try again.',
    }),
    INVALID_BACKUP_CODE: t('auth.login.errors.twoFactorInvalidBackupCode', {
      defaultValue: 'That backup code is not valid or has already been used.',
    }),
    TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: t('auth.login.errors.twoFactorTooManyAttempts', {
      defaultValue: 'Too many incorrect codes. Sign in with your password again.',
    }),
    INVALID_TWO_FACTOR_COOKIE: t('auth.login.errors.twoFactorExpired', {
      defaultValue: 'This sign-in has expired. Sign in with your password again.',
    }),
    ACCOUNT_TEMPORARILY_LOCKED: t('auth.login.errors.twoFactorLocked', {
      defaultValue: 'Too many failed attempts. Your account is temporarily locked. Try again later.',
    }),
  };
}
