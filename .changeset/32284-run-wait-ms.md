---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

feat(automation): a run record says how much of its duration the run spent suspended, so a resumed screen flow no longer reads as an 18-second execution

Clause-②: yes (widening)
Metadata-protocol: added

A run's `durationMs` is its total wall time, pauses included. A screen flow resumed after the user filled the screen in reported `durationMs: 18691`, almost all of it the user's wait, and nothing on the record told an admin that the run was waiting rather than slow.

`ExecutionLogSchema` (`@objectstack/spec/automation`), the run record served by `GET /api/v1/automation/:name/runs/:runId` and the runs list, gains an optional `waitMs`: the total time the run spent suspended at a `screen`, `approval`, `wait` or other pausing node, summed over all its pauses. `durationMs` keeps its meaning, so the time a run spent executing is `durationMs - waitMs`. A run that never paused carries `waitMs: 0`, a measured zero; a `paused` entry carries the wait up to the moment it was written. Absent means not recorded (a `missed` entry, or a run paused before this release), which is not the same as zero.

`@objectstack/service-automation` fills it on every run record: initial execution and its retries, resume (completed, refused, stranded, re-suspended), a paused run cancelled or failed where it waits, and the operator restore of a consumed suspension, which keeps the clock of the pause it re-arms. A suspension carries one number, `SuspendedRun.activeMs` (the time the run had executed when it paused), so the wait sums across any number of pauses and process restarts. `sys_automation_run` gains two nullable columns: `active_ms` on paused rows (and on a stranded row's consumed snapshot) and `wait_ms` on terminal rows.

Nothing to migrate: rows written before this release keep both columns empty and read `waitMs` as not recorded. A client that validates the run record with `ExecutionLogSchema` from an older `@objectstack/spec` strips the new member and reads the record as before.
