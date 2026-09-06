// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. The second of the two
// byte-identical `window.size` declarations in `metrics.zod.ts`; it carries the
// same prose and takes the same new name, `durationSeconds`, for the reason
// recorded on its twin (`system/MetricAggregationConfig:window.size`). Registered
// as its own row because the authorable surface is per DEF, not per source line:
// an author migrating an SLI never reads the aggregation-config entry. The value
// is unchanged. Tombstoned with `retiredKey()`; no D2 conversion.
// See `system-metrics-window-durations-unit-in-key`.
export const entry = 'system/ServiceLevelIndicator:window.size';
