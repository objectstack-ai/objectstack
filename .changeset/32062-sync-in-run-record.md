---
'@objectstack/service-automation': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(sync-in): every pull leaves a `sys_sync_run` row, and a datasource pull reads on from the position the last run committed (ADR-0153 D7)

Clause-②: yes (widening)
Metadata-protocol: semantic
Skills-docs: none — no published skill teaches `connectorSource`, `datasourceSource` or `sys_sync_run` today (`git grep` over `skills/` finds none); the hand-written guide this change made false, `content/docs/automation/jobs.mdx` ("Pulling a mapping"), is corrected in the same change, and the sync-in guide and skills are ADR-0153's P3 guide + skills child

A pull now keeps a record and a read position. Every call of `IAutomationService.pullConnectorSource` — a job's `pull`, either source — writes one row of the new platform object `sys_sync_run` (`@objectstack/service-automation`, registered beside `sys_automation_run`), and a `datasourceSource` pull starts where the last one stopped instead of at `watermark.start`.

- **The run record.** One row per pull, in the job's organization: the mapping, the source kind, the federated object or connector it read, the datasource and read path, the watermark field, where the read started, the rows read, created, updated and refused, the position it committed, when it started and ended, and how it ended — `completed`, `degraded` (the import runner refused rows) or `failed`, with the refusal's `reason` and the platform's sentence (never a driver's or an upstream's own text). Reads are open through the data API (`get`, `list`); only the pull writes it.
- **The read position (ADR-0153 D2, invariants 8 and 9).** A datasource pull stores the position it reached at the end of each window, and the next pull of the mapping in the same organization starts there: it reads the rows written since, plus the rows sharing that position, which the keyed upsert writes again harmlessly. A run that is refused or stops part-way keeps the position of its last finished window. The first run, a run whose stored position came from another source object or watermark field, and every run of a mapping that declares `full: true` read from `watermark.start`; no run reads below it. `datasourceSource.full` is live and no longer warns its author. A connector source keeps reading its starting point from the target, as before.
- **Retention.** Rows are telemetry kept 30 days, the job ledger's window, except the one row per mapping and organization that holds the read position (`holds_position`) and any row still `running`.
- **An interrupted run** — one a stopped server left `running` — is closed `failed` with the reason `interrupted` when the automation plugin next starts. Its committed position stands.
- **One log line per pull**, when it ends: `info` with the counts and the committed position, or `warn` with the refusal and the counts so far.
- **A new refusal reason, `run_record_unavailable`** (`SERVICE_UNAVAILABLE`, 503): the run row cannot be written when the pull opens it (nothing is read), or the read position cannot be stored at a window's end (the windows finished before stay written). A pull with no run store at all — no data engine, or no manifest service to register the object — runs as before, keeps no position, and says so once at `warn`.
- `@objectstack/service-automation` exports `SysSyncRun`, `ObjectStoreSyncRunLedger`, `closeInterruptedSyncRuns`, `SYNC_RUN_OBJECT`, `SYNC_RUN_INTERRUPTED` and the ledger types; `ConnectorPullDeps` takes an optional `runs` ledger. `@objectstack/spec` lists `sys_sync_run` among `service-automation`'s platform objects (`PLATFORM_OBJECTS_BY_PACKAGE`). `@objectstack/cli`'s organization-ownership inventory gives it a fate (attribution, like `sys_connector_connection`).
- Not recorded yet, each with the slice that can fill it: the job run that drove the pull and its trigger (`schedule` / `manual`), and the marked-deleted and NULL-watermark counts (ADR-0153 D3).
