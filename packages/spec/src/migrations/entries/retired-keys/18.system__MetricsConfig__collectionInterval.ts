// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `MetricsConfig.collectionInterval`
// said "Collection interval in seconds" in a source JSDoc and carried no
// `.describe()` at all, so the reference page published a bare 15. Renamed to
// `collectionIntervalSeconds` and not to a bare `intervalSeconds`: the qualifier
// distinguishes it from `MetricExportConfig.intervalSeconds`, a different cadence
// one def over that this same card renames, and the qualifier-plus-IntervalSeconds
// compound is the attested form (`syncIntervalSeconds`, `refreshIntervalSeconds`,
// `healthCheckIntervalSeconds`). The 15 default is unchanged. Tombstoned with
// `retiredKey()`: this object is not strict, so a bare deletion would silently
// strip the key. A TOP-LEVEL site, so the authorable-surface ratchet moves: the
// row becomes `system/MetricsConfig:collectionInterval [RETIRED]` beside a new
// `system/MetricsConfig:collectionIntervalSeconds`, and the authorable-defaults
// row moves with it. No D2 conversion: `stack.zod.ts` declares no metrics
// collection and a metrics config is not a stored metadata row.
// See `system-metrics-jsdoc-durations-unit-in-key`.
export const entry = 'system/MetricsConfig:collectionInterval';
