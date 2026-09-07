// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B.
// `KernelSecurityPolicy.auditLog.retention` said "Log retention in days" in
// prose and nothing else. Renamed to `retentionDays`; the value is unchanged.
// Tombstoned with `retiredKey()`. This is the THIRD bare `retention` this card
// renames and the second unit-bearing one to land on `retentionDays` — the
// spelling is now uniform across the kernel. No D2 conversion; see
// `kernel-plugin-security-durations-unit-in-key`.
export const entry = 'kernel/KernelSecurityPolicy:auditLog.retention';
