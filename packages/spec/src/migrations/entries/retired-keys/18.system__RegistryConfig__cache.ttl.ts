// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `RegistryConfig.cache.ttl` said
// "Cache TTL in seconds" in prose and nothing else, next to a `maxSize` in the
// same cache block measured in BYTES. Renamed to `ttlSeconds`; the value and the
// 3600 default are unchanged. Tombstoned with `retiredKey()`. No D2 conversion:
// not a stack collection member, not a stored row.
// See `system-registry-config-durations-unit-in-key`.
export const entry = 'system/RegistryConfig:cache.ttl';
