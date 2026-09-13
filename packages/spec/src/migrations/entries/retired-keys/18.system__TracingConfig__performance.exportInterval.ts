// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `performance.exportInterval`
// said "Background export interval in milliseconds" in a source JSDoc and
// carried NO `.describe()` at all, so the published reference page showed a bare
// 5000. Renamed to `exportIntervalMs`; the value and the 5000 default are
// unchanged. `intervalMs` is the family spelling already attested 14 times in key
// position on this tree, so the suffix lands on a name the surface uses.
// Tombstoned with `retiredKey()`: the nested `performance` object is not strict,
// so a bare deletion would silently strip the key and hand a background exporter
// its default period. No D2 conversion: not a stack collection member, not a
// stored row. See `system-tracing-otel-exporter-durations-unit-in-key`.
export const entry = 'system/TracingConfig:performance.exportInterval';
