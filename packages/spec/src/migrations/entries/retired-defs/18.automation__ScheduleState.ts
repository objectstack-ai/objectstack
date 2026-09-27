// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17158 — `automation/ScheduleState`, retired whole with the export-job API family
// (ADR-0049 enforce-or-remove; maintainer ruling A, landing route A — objectui
// retired its side first in objectui#10247). It declared
// the runtime state of a scheduled flow (`timezone`, `status`, `nextRunAt`, run
// counters). No scheduler ever wrote or read one, and after #16320 deleted its
// required cron it no longer declared a cadence. Retired with the family under
// ruling item 2 ("unless a live consumer is measured" — none was, in
// objectstack, objectui at the pin, or cloud).
// Zero readers in objectstack, in objectui at the pinned sha, and in cloud.
// No carrier key and no authored document, so no tombstone and no D2
// conversion — this table plus the D3 semantic entry
// `export-job-family-retired` are the declaration.
export const entry = 'automation/ScheduleState';
