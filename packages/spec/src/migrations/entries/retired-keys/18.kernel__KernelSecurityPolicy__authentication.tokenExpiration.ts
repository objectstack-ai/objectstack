// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B.
// `KernelSecurityPolicy.authentication.tokenExpiration` said "Token expiration
// in seconds" in prose and nothing else — on a policy whose rate-limit window
// two blocks above was ALREADY spelled `windowMs`, so one policy document
// carried both conventions. Renamed to `tokenExpirationSeconds`; the value is
// unchanged. Tombstoned with `retiredKey()`. No D2 conversion: a
// `KernelSecurityPolicy` is a plugin security manifest's policy block, never a
// stack collection member. See `kernel-plugin-security-durations-unit-in-key`.
export const entry = 'kernel/KernelSecurityPolicy:authentication.tokenExpiration';
