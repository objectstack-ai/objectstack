---
'@objectstack/spec': minor
---

**BREAKING** — the export-job API family, the `IExportService` contract and `ScheduleState` leave the public surface (#17158).

A `major`-class change, recorded as `minor` under the launch-window convention. Maintainer ruling A (decision batch #122 item 3, 「同意」), landing route A (decision batch #221 item 2, 「同意」: objectui retired its side first, in objectui#10247), and a scope note (「同意」) that puts the export-job list pair in; ADR-0049 enforce-or-remove.

**Why.** `@objectstack/spec` declared a complete asynchronous export API — create a job, poll its progress, fetch a download link, list jobs, schedule a recurring export, cancel — and nothing on the platform served any of it. `@objectstack/rest` mounts no `/api/v1/data/export` route and no `POST` on `/api/v1/data/:object/export`; `IExportService` had no provider; and no package, example, app or skill in this repository, in objectui at the pinned sha, or in cloud read any of the names. An AI following the generated API reference wrote calls that answer `404`. The scheduled-export shapes were worse than unserved: after the cron positions were deleted earlier in this release line, `ScheduledExport.schedule` and `ScheduleExportRequest.schedule` were REQUIRED blocks that could hold no schedule, so an author who filled in the `timezone` believed they had scheduled something. `ScheduleState` described the runtime state of a scheduled flow that no scheduler ever wrote or read.

### FROM → TO

| removed | from | what to write instead |
| --- | --- | --- |
| `ExportJobStatus`, `CreateExportJobRequestSchema` / `CreateExportJobResponseSchema`, `ExportJobProgressSchema` (with their types and `…Parsed` aliases) | `@objectstack/spec/api` | nothing — no route ever created or tracked an export job. To export records, call the served synchronous door `GET /api/v1/data/:object/export` (the SDK's `data.export`), which answers the file itself; its format vocabulary is `ExportFormat`, which stays. |
| `GetExportJobDownloadRequestSchema` / `GetExportJobDownloadResponseSchema`, `ListExportJobsRequestSchema` / `ListExportJobsResponseSchema`, `ExportJobSummarySchema` (with their types and `…Parsed` aliases) | `@objectstack/spec/api` | nothing — no job ever existed to download or list. |
| `ScheduledExportSchema`, `ScheduleExportRequestSchema` / `ScheduleExportResponseSchema` (with their types and `…Parsed` aliases) | `@objectstack/spec/api` | a `Job` (`system/job.zod.ts`) whose handler performs the export, with its cadence on `Job.schedule.expression` — the one cron slot the platform evaluates. |
| `ExportApiContracts` | `@objectstack/spec/api` | nothing — every route it named was unserved. |
| `IExportService`, `CreateExportJobInput`, `CreateExportJobResult`, `ExportJobDownload`, `ListExportJobsOptions`, `ExportJobListResult`, `ScheduleExportInput` | `@objectstack/spec/contracts` | nothing — no provider ever bound the contract. |
| `ScheduleStateSchema`, `ScheduleState`, `ScheduleStateParsed` | `@objectstack/spec/automation` | nothing — a scheduled flow declares its cadence on its start node (`config.schedule`), and its run history is `ExecutionLog` / `FlowRunSummary`. |

**The one-line fix: delete every import of the names above, and every request to `/api/v1/data/export/…` or `POST /api/v1/data/:object/export`.** The compiler finds the imports (`TS2305: Module '"@objectstack/spec/api"' has no exported member …`); a hard-coded path has to be searched for. No behaviour is lost — none of those requests was ever answered.

**What stays.** `ExportFormat`, `ExportImportTemplateSchema`, the import validation shapes and the whole import-job family in the same module — `ImportJobStatus`, `CreateImportJob…`, `ImportJobProgress…`, `ListImportJobs…`, `ImportJobApiContracts` — are served and unchanged, as is `GET /api/v1/data/:object/export`.

**Read together with the cron-positions retirement in this release.** That entry says `ScheduledExport.schedule` / `ScheduleExportRequest.schedule` keep their `timezone` and `ScheduleState` keeps `timezone`, `status` and `nextRunAt`; this retirement removes those defs whole, so none of those shapes remains to carry them.

⚠️ Runtime behaviour is deliberately **unchanged**: nothing ever mounted a retired path or parsed a retired shape, so every request answers exactly as before. The removal retracts a false claim, not a capability. **No deprecation window** (startup-stage posture: retirements take effect immediately).

⚠️ **The out-of-repo consumer population is NOT MEASURED.** Inside this repository the names occurred only in their declarations, their own tests, generated artifacts and prose; objectui at the pinned sha names none of them in code (it retired its unimplemented async-export path in objectui#10247), and cloud names none; `@objectstack/spec` is published, so readers elsewhere were not measured.

The ADR-0087 D3 semantic entry `export-job-family-retired` carries the judgement, and the thirteen defs are registered in `RETIRED_DEFS_BY_MAJOR[18]`: none of these shapes is a stack collection or a metadata type, so there is no source for a D2 conversion to rewrite and no carrier key for a tombstone.

Clause-②: no

<!-- adr-0087: registered export-job-family-retired -->
