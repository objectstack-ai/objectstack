// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #18669 — maintainer ruling A (2026-09-17, decision batch #151 item 4):
// `FileValue.duration` names a media length and carried its unit in no channel
// at all — no `.describe()`, no JSDoc, no unit token in the key. Renamed to
// `durationSeconds`; the value is unchanged and DELIBERATELY not narrowed — a
// fractional second is a legal media length, so the ruling refused both a
// closed `DurationSeconds` type and an `.int()` floor. The name is
// `durationSeconds` rather than the gate's mechanical `durationSec`/`lengthSeconds`
// because `durationSeconds` is the spelling this spec already landed on for a
// length of time in SIX places, ENUMERATED rather than counted because a bare
// number in shipped prose cannot be re-checked against the tree:
// `ai/conversation.zod.ts` `ConversationAnalytics.durationSeconds`; and on
// `system/metrics.zod.ts` `MetricAggregationConfig.window.durationSeconds`,
// `ServiceLevelIndicator.window.durationSeconds`,
// `ServiceLevelObjective.period.durationSeconds`,
// `ServiceLevelObjective.errorBudget.burnRateWindows[].durationSeconds` and
// `MetricsConfig.retention.durationSeconds`. The media length is therefore the
// SEVENTH spelling of one vocabulary, not the first of a second one. The
// semantic entry `data-file-value-duration-unit-in-key` carries the same six keys
// in the same order, so the two surfaces that state one fact cannot drift apart.
// ⚠️ Read `metrics.zod.ts`'s own `burnRateWindows` JSDoc beside this list: it
// calls itself "The fourth window length on this file", which is the sentence
// that falsifies any shorter count of that file.
// Tombstoned with `retiredKey()`: `FileValueSchema`
// is the one deliberate `z.looseObject` in this file, so a bare deletion would
// wave the old spelling through as an unrecognised extra rather than prescribe
// the rename. No D2 conversion: `FileValueSchema` is the ADR-0104 D3 wave-2
// EXPANDED READ form, derived at read time from a `sys_file` id — the stored
// form is `FileReferenceIdValueSchema`, an opaque string — so it is never
// authored, never a stored `sys_metadata` row, and the chain has no seam that
// would ever see one. See `data-file-value-duration-unit-in-key`.
export const entry = 'data/FileValue:duration';
