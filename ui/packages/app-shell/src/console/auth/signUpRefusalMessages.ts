/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { AuthInvitationPreview } from '@object-ui/auth';
import type { TranslateFn } from '@object-ui/i18n';

/** The register page's invitation, when its `?redirect=` is one (#27509). */
export interface SignUpRefusalInvitation {
  /** The signed-out preview (`useInvitationArrival`), or `null` while unknown. */
  preview: AuthInvitationPreview | null;
}

/**
 * Sign-up refusal `code` → localized text, for `RegisterForm`'s `errorMessages`.
 *
 * `RegisterForm` falls back to the server's own `message` for a code missing
 * here; that message is English and may name internal configuration, so every
 * refusal an end user can meet at `/sign-up/email` belongs in this map
 * (objectui#10998). It is the one map both register pages pass — the console
 * app's and `DefaultRegisterPage` (objectui#11030). `AUTH_CONFIG_ERROR` is left
 * out on purpose: its message is written for the operator.
 *
 * `invitation` is passed by a register page opened from an invitation link
 * (#27509). Under a posture closed to strangers the server admits that
 * visitor only with the invited address, so its `SELF_REGISTRATION_CLOSED`
 * means "not the address this invitation was sent to" (or the invitation went
 * away, which the page learns by re-reading the preview), never "ask for an
 * invitation": the visitor is holding one. The refusal then names the masked
 * address the preview returned, or, without a preview, says that only the
 * invited address can accept it.
 */
export function signUpRefusalMessages(
  t: TranslateFn,
  invitation?: SignUpRefusalInvitation,
): Record<string, string> {
  const userExists = t('auth.register.errors.userExists', {
    defaultValue: 'An account with this email already exists. Try signing in instead.',
  });
  return {
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: userExists,
    USER_ALREADY_EXISTS: userExists,
    // The server's audience gate: the environment admits new accounts by
    // invitation only, or only from allowlisted email domains.
    SELF_REGISTRATION_CLOSED: !invitation
      ? t('auth.register.errors.selfRegistrationClosed', {
          defaultValue:
            'Self-registration is not open on this system. Ask an administrator for an invitation.',
        })
      : invitation.preview
        ? t('auth.register.errors.invitationSentTo', {
            defaultValue:
              'This invitation was sent to {{email}}. Register with that address to accept it.',
            email: invitation.preview.email,
          })
        : t('auth.register.errors.invitationAddressOnly', {
            defaultValue:
              'This invitation can only be accepted with the address it was sent to. Register with that address.',
          }),
    EMAIL_DOMAIN_NOT_ALLOWED: t('auth.register.errors.emailDomainNotAllowed', {
      defaultValue:
        "This email's domain is not allowed to register here. Use your organization email, or ask an administrator for an invitation.",
    }),
  };
}
