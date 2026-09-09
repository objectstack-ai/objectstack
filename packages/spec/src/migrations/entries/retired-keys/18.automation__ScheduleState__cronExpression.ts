// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16320 — ADR-0049 enforce-or-remove on the seven cron-typed positions nothing
// reads (#15954 ruling, decision batch #56, 2026-09-06: option A — retire — per
// family). Automation family: `ScheduleState.cronExpression`, the schema's
// REQUIRED cron, read by NOTHING — `ScheduleStateSchema` has no consumer outside
// `packages/spec`, and the schedule trigger that does run reads a flow start
// node's `config.schedule` through `trigger-schedule/schedule-trigger.ts`
// `normalizeSchedule`, a different shape this key never reached. Tombstoned
// with `retiredKey()` (non-strict `z.object`, ADR-0104); the requiredness
// leaves with the key, since a tombstone accepts only absence.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`: runtime schedule
// state is not a stack collection member and `scheduleState` is no metadata
// type, so a MetadataConversion would be a transform with no seam that ever
// runs (the `kernel/MetadataPluginConfig:additionalTypes` precedent). No
// `os migrate meta` sentence, for the same reason.
// D3 semantic entry: `schedule-state-cron-expression-retired`.
export const entry = 'automation/ScheduleState:cronExpression';
