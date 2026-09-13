// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `exporter.batch.exportTimeout`
// said "Export timeout in milliseconds" in a source JSDoc and carried NO
// `.describe()` at all, so the published reference page showed a bare 30000.
// Renamed to `exportTimeoutMs`; the value and the 30000 default are unchanged.
// Tombstoned with `retiredKey()`: the nested `batch` object is not strict, so a
// bare deletion would silently strip the key. No D2 conversion: not a stack
// collection member, not a stored row. See
// `system-tracing-otel-exporter-durations-unit-in-key`.
export const entry = 'system/OpenTelemetryCompatibility:exporter.batch.exportTimeout';
