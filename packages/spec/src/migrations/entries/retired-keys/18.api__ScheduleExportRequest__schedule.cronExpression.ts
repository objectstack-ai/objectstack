// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16320 — the export-schedule family's second position,
// `ScheduleExportRequest.schedule.cronExpression`: the same cron slot on the
// request body of `POST /api/v1/data/export/schedules`, which no server route
// implements. Same reading, same route (a `retiredKey()` tombstone on a
// non-strict `z.object`, ADR-0104), same major, same absence of a D2
// conversion (an API request body is not a stack collection member — the
// `kernel/MetadataPluginConfig:additionalTypes` precedent), same nested
// spelling (no authorable-surface row of its own; `api/ScheduleExportRequest:schedule`
// is the row). See `18.api__ScheduledExport__schedule.cronExpression.ts` for
// the retirement record.
// D3 semantic entry: `export-schedule-cron-retired`.
export const entry = 'api/ScheduleExportRequest:schedule.cronExpression';
