// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17158 — `api/ScheduledExport`, retired whole with the export-job API family
// (ADR-0049 enforce-or-remove; maintainer ruling A, landing route A — objectui
// retired its side first in objectui#10247). It declared
// a recurring export definition (`schedule`, `delivery`, `nextRunAt`). #16320
// had already deleted its `schedule.cronExpression`, leaving a required
// `schedule` block that could hold no schedule; no scheduler ever read it.
// Zero readers in objectstack, in objectui at the pinned sha, and in cloud.
// No carrier key and no authored document, so no tombstone and no D2
// conversion — this table plus the D3 semantic entry
// `export-job-family-retired` are the declaration.
export const entry = 'api/ScheduledExport';
