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
  };
}
