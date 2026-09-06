// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `MetricAggregationConfig.window.size`
// said "Window size in seconds" in prose and nothing else. Renamed to
// `durationSeconds`, NOT to the gate's mechanical `sizeSeconds`: `size` is
// byte/row-count vocabulary everywhere else in this spec (`CacheTier.maxSize` is
// MB, `RegistryConfig.cache.maxSize` is bytes, this file's own `batch.size` is a
// row count), so `sizeSeconds` would have preserved the misleading half of the
// name and bolted a unit onto it. `windowSeconds` was rejected too — the parent
// key is already `window`, so it would read `window.windowSeconds`. The value is
// unchanged. Tombstoned with `retiredKey()`. No D2 conversion: `stack.zod.ts`
// declares no `metrics` collection and an aggregation config is not a stored
// metadata row. See `system-metrics-window-durations-unit-in-key`.
export const entry = 'system/MetricAggregationConfig:window.size';
