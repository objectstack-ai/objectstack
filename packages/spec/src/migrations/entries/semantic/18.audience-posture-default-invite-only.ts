// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'audience-posture-default-invite-only',
  surface: 'system.AuthConfig.audience',
  replacement:
    "explicit `auth: { audience: { posture: 'open' | 'email_domain', selfRegistrationPermissionSet: '<set>' } }` " +
    '(deployments that intend open self-registration only)',
  reason:
    'The default audience posture flipped in #11739: an UNDECLARED `audience` now means ' +
    '`invite_only` — email/password self-registration (and social-provider JIT sign-up) is ' +
    'refused with 403 SELF_REGISTRATION_CLOSED unless the address holds a pending invitation. ' +
    'Previously the emergent default was open self-registration with no email verification. ' +
    'Whether a deployment truly means to admit strangers (public portal) or was open only by ' +
    'accident is a security judgment no transform can make — and a posture that opens ' +
    'self-registration must also DECLARE the permission set a self-registrant receives and ' +
    'accepts forced email verification, neither of which can be invented mechanically.',
  acceptanceCriteria:
    'A deployment that relies on open self-registration declares `audience.posture` ' +
    "('open', or 'email_domain' with `allowedEmailDomains`) plus `selfRegistrationPermissionSet`, " +
    'and its sign-up flow still works end to end (verification email delivered, registrant holds ' +
    'the declared permission set). Every other deployment verifies operators can still add users ' +
    '(invitation, admin create-user / import, SCIM, or an operator-registered identity provider) ' +
    'and that anonymous sign-up now answers 403 SELF_REGISTRATION_CLOSED.',
};
