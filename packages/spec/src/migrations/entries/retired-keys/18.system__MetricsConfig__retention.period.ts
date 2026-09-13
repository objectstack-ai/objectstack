// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `MetricsConfig.retention.period`
// said "Retention period in seconds" in a source JSDoc and carried no
// `.describe()` at all, so the reference page published a bare 604800. Renamed to
// `durationSeconds`, not to the mechanical `periodSeconds`: `period` is calendar
// vocabulary elsewhere in this spec — `ServiceLevelObjective.period.type` selects
// rolling or calendar and `PluginRegistryEntry.pricing.billingPeriod` is monthly
// or yearly — so `periodSeconds` would have kept the ambiguous half of the name
// and bolted a unit onto it, the same objection #15679 raised against
// `sizeSeconds`. `durationSeconds` is what this file already calls a length of
// time, in three places. The 604800 (7 day) default is unchanged. Tombstoned with
// `retiredKey()`: the nested `retention` object is not strict, so a bare deletion
// would silently strip the key. A NESTED site: the authorable-surface ratchet
// walks top-level def properties only — the top-level row is
// `system/MetricsConfig:retention` and it does not move — so gate (b) of
// `build-schemas.ts` neither demands nor refuses this entry. No D2 conversion:
// `stack.zod.ts` declares no metrics collection and a metrics config is not a
// stored metadata row.
// See `system-metrics-jsdoc-durations-unit-in-key`.
export const entry = 'system/MetricsConfig:retention.period';
