// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `Span.duration` said "Duration in
// milliseconds" in prose and nothing else, on a shape that already spells its two
// instants `startTime` / `endTime`. Renamed to `durationMs`; the value is
// unchanged. Not an `externalVocabulary` mirror: OpenTelemetry, which this shape
// follows, carries span length as a start/end nanosecond PAIR and declares no key
// named `duration` at all, so there is no external spelling to mirror here.
// Tombstoned with `retiredKey()`. No D2 conversion: a span is a runtime-emitted
// measurement, never authored metadata and never a stored `sys_metadata` row.
// See `system-tracing-span-duration-unit-in-key`.
export const entry = 'system/Span:duration';
