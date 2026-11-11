---
'@objectstack/spec': minor
'@objectstack/service-job': minor
'@objectstack/runtime': minor
'@objectstack/service-automation': minor
---

feat(sync-in): a pull's run record names the job run that drove it, and why that run started (ADR-0153 D7)

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: none — no published skill teaches `JobHandler`'s context, `pullConnectorSource` or `sys_sync_run` today (`git grep` over `skills/` finds none); the hand-written guide this change made incomplete, `content/docs/automation/jobs.mdx` ("Pulling a mapping"), is corrected in the same change

A job's handler is now told which run it is executing, and a sync-in pull keeps that on its `sys_sync_run` row.

- **`JobHandler`'s context** (`@objectstack/spec/contracts`) gains two optional members: `runId`, the job service's run-history id of the attempt, and `trigger`, why the run started — `schedule` for a timer's fire, `manual` for `trigger()` (and `replay()`, which runs through it). The new `JobRunTrigger` type spells the two values. Both are optional: a handler that reads neither, and a job service that sends neither, are unchanged.
- **The shipped job adapters send them** (`@objectstack/service-job`). `CronJobAdapter` and `IntervalJobAdapter` say `schedule` on a scheduled fire and `manual` on `trigger()`. `DbJobAdapter` adds the id of the `sys_job_run` row it wrote for the attempt, so a retried run hands each attempt its own id; with `recordRuns: false` it writes no row and sends no id.
- **A pull job forwards them** (`@objectstack/runtime`): the job binder hands `pullConnectorSource` the run id as `jobRunId` and the trigger, each only as the contract spells it.
- **`ConnectorSourcePullRequest`** (`@objectstack/spec/contracts`) gains optional `jobRunId` and `trigger`.
- **`sys_sync_run` keeps them** (`@objectstack/service-automation`): `job_run_id`, text and not a lookup, so the job ledger's own retention never reaches a pull's history, and `trigger` (`schedule` / `manual`), both written when the run opens, so a pull refused before it reads keeps them too. Both are empty for a pull no job drove. `@objectstack/service-automation` exports the `SyncRunOrigin` type; `SyncRunLedger.open` takes it as an optional third argument.
