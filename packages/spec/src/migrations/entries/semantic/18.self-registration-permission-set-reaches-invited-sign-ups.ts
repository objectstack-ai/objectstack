// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the change of meaning the plugin-auth admission
// verdict landed (ruling record 7063136215, option A): one rule for an invited
// and an uninvited self-registration. No key of any schema is added, removed,
// renamed or re-shaped, so there is no tombstone and no D2 conversion: whether
// the declared set is the one an invited person should receive, and repairing
// a set that cannot be resolved, are the operator's to judge.
export const entry: SemanticMigration = {
  id: 'self-registration-permission-set-reaches-invited-sign-ups',
  surface:
    'system.AuthConfig.audience.selfRegistrationPermissionSet under the `open` posture, and under `email_domain` '
    + 'for an address on `allowedEmailDomains`: a self-serve sign-up that also holds a pending invitation',
  replacement:
    'Keep `selfRegistrationPermissionSet` naming a permission set that exists and is switched on, and confirm it '
    + 'is the access an invited person the posture admits should hold beside the membership and role the '
    + 'invitation names. A person who must join without that set is created by an administrator instead',
  reason:
    'The admission verdict read a pending invitation before the posture\'s own rule, so an invited sign-up the '
    + 'posture admits (any address under `open`, an address on the allowlist under `email_domain`) was admitted '
    + 'with no self-registration grant, whether or not the declared set could be resolved, while the membership '
    + 'settle already classified the same sign-up as admitted by the posture. It is now a self-registrant, '
    + 'invitation or not: it receives the declared set, and when the set cannot be resolved (not in the security '
    + 'catalog, or switched off in the activation ledger) it is refused 403 AUTH_CONFIG_ERROR like an uninvited '
    + 'sign-up; no account is created. Unchanged: under `invite_only`, and for an address off the allowlist under '
    + '`email_domain`, an invitation admits by itself and asks for no set. There is no mechanical rewrite: which '
    + 'set the operator meant is not in the stack',
  acceptanceCriteria:
    'Under the deployment\'s posture, an invited sign-up whose address the posture admits completes sign-up and '
    + 'holds the declared set (a `sys_user_permission_set` row naming it) beside the membership its accepted '
    + 'invitation writes, and with the set name pointed at a set that does not exist the same sign-up answers '
    + '403 AUTH_CONFIG_ERROR naming the set',
};
