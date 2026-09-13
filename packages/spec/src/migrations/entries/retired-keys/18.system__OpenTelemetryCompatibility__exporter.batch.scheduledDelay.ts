// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `exporter.batch.scheduledDelay`
// said "Scheduled delay in milliseconds" in a source JSDoc and carried NO
// `.describe()` at all, so the published reference page showed a bare 5000.
// Renamed to `scheduledDelayMs`, the plain suffix: the Delay-plus-Ms pairing is
// already the family spelling on this tree (`maxDelayMs`, `initialDelayMs`,
// `retryDelayMs`, `delayMs`, `debounceDelayMs`) and no competing form exists.
// The value and the 5000 default are unchanged. Tombstoned with `retiredKey()`:
// the nested `batch` object is not strict, so a bare deletion would silently
// strip the key. No D2 conversion: not a stack collection member, not a stored
// row. See `system-tracing-otel-exporter-durations-unit-in-key`.
export const entry = 'system/OpenTelemetryCompatibility:exporter.batch.scheduledDelay';
