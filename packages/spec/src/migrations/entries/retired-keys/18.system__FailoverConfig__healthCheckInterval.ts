// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `FailoverConfig.healthCheckInterval`
// said "Health check interval in seconds" in prose and nothing else. Renamed to
// `healthCheckIntervalSeconds`; the value and the 30 default are unchanged.
// ⚠️ Its neighbour `FailoverConfig.dns.ttl` on this same schema keeps its bare
// name and is NOT part of this rename — that key carries an `externalVocabulary`
// marker because it mirrors the DNS resource-record TTL field (RFC 1035 §4.1.3),
// spelled `ttl` by every provider API it is forwarded to. This one mirrors
// nothing outside the repo. Tombstoned with `retiredKey()`. No D2 conversion:
// not a stack collection member, not a stored row.
// See `system-failover-health-check-interval-unit-in-key`.
export const entry = 'system/FailoverConfig:healthCheckInterval';
