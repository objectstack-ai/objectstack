// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `exporter.timeout` said
// "Timeout in milliseconds" in a source JSDoc and carried NO `.describe()` at
// all, so the `content/docs/references/**` page published a bare 10000 with no
// unit anywhere on it. Renamed to `timeoutMs`; the value and the 10000 default
// are unchanged. It keeps the plain suffix even though its `exporter.batch`
// sibling becomes `exportTimeoutMs`: the two are the OpenTelemetry exporter's
// own request deadline and the batch processor's export deadline, two distinct
// knobs the shape already spelled apart, and the nesting keeps every read point
// unambiguous. Tombstoned with `retiredKey()`: the nested `exporter` object is
// not strict, so a bare deletion would silently strip the key and let a 10000 ms
// default land on an exporter deadline the operator had deliberately changed.
// No D2 conversion: not a stack collection member, not a stored row. See
// `system-tracing-otel-exporter-durations-unit-in-key`.
export const entry = 'system/OpenTelemetryCompatibility:exporter.timeout';
