// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `circuitBreaker.resetTimeout`
// said "Seconds before half-open state" in prose only, while the `lockout` block
// three lines down on the SAME schema already spelled `lockTimeoutMs`. One shape,
// two conventions, and the two are not even the same unit. Renamed to
// `resetTimeoutSeconds`; the value and the 30 default are unchanged. Tombstoned
// with `retiredKey()`. No D2 conversion: not a stack collection member, not a
// stored row. See `system-cache-durations-unit-in-key`.
export const entry = 'system/CacheAvalanchePrevention:circuitBreaker.resetTimeout';
