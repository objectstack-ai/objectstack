// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29909 — ADR-0049 enforce-or-remove — the D3 entry for the retired
// `system/EmailAndPasswordConfig:revokeSessionsOnPasswordReset`. No D2
// conversion carries it: the key lives in the configuration a host hands the
// auth plugin, never in a stack collection or a stored row, so there is no
// source `os migrate meta` could rewrite and the deletion is the author's.
export const entry: SemanticMigration = {
  id: 'email-and-password-revoke-sessions-on-reset-retired',
  surface: 'auth emailAndPassword.revokeSessionsOnPasswordReset — whether a completed password reset ends the account\'s sessions',
  replacement:
    'Nothing: delete the key. A completed password reset always ends every session the account '
    + 'holds, on every reset door (the emailed link and the phone OTP reset alike), the same as an '
    + 'administrator\'s forced reset, and no setting turns that off.',
  reason:
    'The key could hold only one value. A configuration that wrote `true` asked for what the '
    + 'platform does anyway, so deleting it changes no behaviour; one that wrote `false` was already '
    + 'refused at boot by the auth plugin before this retirement, so it cannot be running. Both '
    + 'spellings are now refused: by `tsc` and the schema parse where the configuration is typed or '
    + 'parsed, and by the auth plugin where a host hands it an unparsed object. What no tool can '
    + 'check is whether something the deployment maintains reads the key — a settings form, a '
    + 'generated configuration file or a script that writes it — and must stop writing it.',
  acceptanceCriteria:
    'No configuration the deployment hands the auth plugin carries '
    + '`emailAndPassword.revokeSessionsOnPasswordReset`, and the deployment boots. A user signed in '
    + 'on a second device before a password reset is signed out there (the session answers 401) '
    + 'once the reset completes.',
};
