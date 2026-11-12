---
'@objectstack/service-job': patch
---

fix(service-job): a job run's history row records the trigger of the call that ran it, and a replay is one row

Clause-②: no
Metadata-protocol: none

`DbJobAdapter` writes one `sys_job_run` row per attempt, and its `trigger` column is documented as `schedule` | `manual` | `replay`. The wrapper that writes the row used to fix that value when the job was scheduled, so every row said `schedule`:

- a manual `trigger(name)` was recorded as a scheduled tick (`trigger: 'schedule'`);
- a `replay(name)` landed two rows for one run: a `replay` row of its own beside the wrapper's `schedule` row.

The value is now read per call: a scheduled fire writes `schedule`, `trigger()` writes `manual`, and `replay()` writes one `replay` row per attempt, settled to the run's real status (`success`, `failed`, `timeout` or `degraded`). The handler's context is unchanged: a replayed handler is still told `trigger: 'manual'`, and its `runId` now names the `replay` row, so a replayed sync-in pull names that row on its `sys_sync_run` record.

What an operator sees: in `sys_job_run`, manual runs now read `manual`, and a replay is one row instead of two, so run counts read from the table no longer count a replay twice. Rows written before this release keep the values they were written with.
