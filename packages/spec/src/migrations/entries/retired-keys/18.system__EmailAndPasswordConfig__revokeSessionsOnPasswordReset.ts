// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #29909 — ADR-0049 enforce-or-remove, by the maintainer's ruling on that card:
// a completed self-service password reset always ends every session the
// account holds, and there is no setting. plugin-auth made the behaviour
// unconditional first (it sets better-auth's own option itself and refused an
// explicit `false`), which left `EmailAndPasswordConfig.revokeSessionsOnPasswordReset`
// able to hold one value only. Tombstoned with `retiredKey()`. No D2
// conversion: host plugin configuration, not a stack collection member, not a
// stored row. The D3 record is `email-and-password-revoke-sessions-on-reset-retired`.
export const entry = 'system/EmailAndPasswordConfig:revokeSessionsOnPasswordReset';
