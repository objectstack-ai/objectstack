// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #18669 — maintainer ruling A (2026-09-17, decision batch #151 item 4):
// `FileValue.duration` names a media length and carried its unit in no channel
// at all — no `.describe()`, no JSDoc, no unit token in the key. Renamed to
// `durationSeconds`; the value is unchanged and DELIBERATELY not narrowed — a
// fractional second is a legal media length, so the ruling refused both a
// closed `DurationSeconds` type and an `.int()` floor. The name is
// `durationSeconds` rather than the gate's mechanical `durationSec`/`lengthSeconds`
// because `durationSeconds` is the spelling this spec already landed on for a
// length of time (`ConversationAnalytics`, the three `system/metrics.zod.ts`
// window lengths and `MetricsConfig.retention`), so the media length now reads
// alike with every other one. Tombstoned with `retiredKey()`: `FileValueSchema`
// is the one deliberate `z.looseObject` in this file, so a bare deletion would
// wave the old spelling through as an unrecognised extra rather than prescribe
// the rename. No D2 conversion: `FileValueSchema` is the ADR-0104 D3 wave-2
// EXPANDED READ form, derived at read time from a `sys_file` id — the stored
// form is `FileReferenceIdValueSchema`, an opaque string — so it is never
// authored, never a stored `sys_metadata` row, and the chain has no seam that
// would ever see one. See `data-file-value-duration-unit-in-key`.
export const entry = 'data/FileValue:duration';
