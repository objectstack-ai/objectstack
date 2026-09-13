// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `MetricExportConfig.interval`
// said "Export interval in seconds" in a source JSDoc and carried no
// `.describe()` at all — one of the three sites the #15939 filing named — so the
// reference page published a bare 60, a plausible number of seconds and a
// plausible number of milliseconds. Renamed to `intervalSeconds`, the token
// every seconds-valued cadence in this spec already carries (`intervalSeconds`
// on `ai/model-registry`, `api/auth-endpoints`, `data/driver/turso` and
// `integration/connector`); no competing `intervalSec` or `intervalS` spelling
// exists. The 60 default is unchanged. Tombstoned with `retiredKey()`: this
// object is not strict, so a bare deletion would silently strip the key. A
// TOP-LEVEL site, so the authorable-surface ratchet moves: the row becomes
// `system/MetricExportConfig:interval [RETIRED]` beside a new
// `system/MetricExportConfig:intervalSeconds`, and the authorable-defaults row
// moves with it. No D2 conversion: `stack.zod.ts` declares no metrics collection
// and an export config is not a stored metadata row.
// See `system-metrics-jsdoc-durations-unit-in-key`.
export const entry = 'system/MetricExportConfig:interval';
