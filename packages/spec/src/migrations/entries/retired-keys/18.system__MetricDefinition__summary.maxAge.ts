// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `summary.maxAge` said "Max
// age of observations in seconds" in a source JSDoc and carried no
// `.describe()` at all, so the reference page published a bare 600 and the
// gate listed the key among the duration-shaped ones without judging it.
// Renamed to `maxAgeSeconds`, the same token `AccessControlConfig.maxAgeSeconds`
// on `system/object-storage.zod.ts` already carries after this same rule renamed
// it — NOT `durationSeconds`, the spelling the three window lengths on this file
// take, because the sibling key `ageBuckets` counts buckets of this very age and
// dropping the `age` stem would orphan the pair. The value is unchanged.
// Tombstoned with `retiredKey()`: the nested `summary` object is not strict, so
// a bare deletion would silently strip the key. A NESTED site: the
// authorable-surface ratchet walks top-level def properties only, so no
// `[RETIRED]` row exists for it and gate (b) of `build-schemas.ts` neither
// demands nor refuses this entry — it is here for the spec-changes /
// upgrade-guide projection. No D2 conversion: `stack.zod.ts` declares no metrics
// collection and a metric definition is not a stored metadata row.
// See `system-metrics-jsdoc-durations-unit-in-key`.
export const entry = 'system/MetricDefinition:summary.maxAge';
