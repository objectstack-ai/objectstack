// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'export-job-family-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the export-job API family, retired whole: the twelve defs api/ExportJobStatus, '
    + 'api/CreateExportJobRequest, api/CreateExportJobResponse, api/ExportJobProgress, '
    + 'api/ScheduledExport, api/GetExportJobDownloadRequest, api/GetExportJobDownloadResponse, '
    + 'api/ListExportJobsRequest, api/ExportJobSummary, api/ListExportJobsResponse, '
    + 'api/ScheduleExportRequest and api/ScheduleExportResponse with every name '
    + 'api/export.zod.ts exported for them from @objectstack/spec/api (the Schema consts, '
    + 'their z.input aliases and their Parsed aliases) and the ExportApiContracts route map; '
    + 'the IExportService contract with its six types (CreateExportJobInput, '
    + 'CreateExportJobResult, ExportJobDownload, ListExportJobsOptions, ExportJobListResult, '
    + 'ScheduleExportInput) from @objectstack/spec/contracts; and automation/ScheduleState '
    + '(ScheduleStateSchema, ScheduleState, ScheduleStateParsed) from @objectstack/spec/automation',
  replacement:
    'nothing to re-declare for the job family — no route ever served it, so no caller holds '
    + 'a job id, a progress body or a download link to carry over. The export the platform '
    + 'DOES serve is the synchronous streaming door GET /api/v1/data/:object/export '
    + '(@objectstack/rest, the SDK method data.export): it answers the file itself as CSV, '
    + 'JSON or XLSX. ExportFormat stays published (ExportImportTemplate still references it). '
    + 'A recurring export is a Job (system/job.zod.ts) whose handler you write, with its '
    + 'cadence on Job.schedule.expression — the one cron slot the platform evaluates. A '
    + 'scheduled flow declares its cadence on its start node (config.schedule), and its run '
    + 'history is ExecutionLog / FlowRunSummary; ScheduleState had no counterpart to point at '
    + 'because no scheduler ever kept one. The import-job family in the same module '
    + '(ImportJob…, ListImportJobs…, ImportJobApiContracts) is served and is NOT part of this '
    + 'retirement',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling A of 2026-09-12 (retire the family, '
    + 'IExportService and ScheduleExportInput; ScheduleState retired with it unless a live '
    + 'consumer is measured), the landing route the maintainer ruled on 2026-09-24 (route A: '
    + 'objectui retires its own side of the unimplemented async-export path first, then this '
    + 'retirement), and a scope note the maintainer agreed on 2026-09-25 that folds in the '
    + 'declared limit / cursor of the export-job list — one of three sibling list doors found '
    + 'declaring them and never reading them. The family declared an '
    + 'asynchronous export API, create / progress / download / list / schedule / cancel under '
    + '/api/v1/data/export and a POST on /api/v1/data/:object/export, that NOTHING served: '
    + '@objectstack/rest mounts no /api/v1/data/export route and only the GET on '
    + '/api/v1/data/:object/export, IExportService recorded no evidenced provider binding, and '
    + 'the reader census over objectstack outside packages/spec, over objectui at the pinned '
    + 'sha (which carries objectui\'s own retirement) and over cloud main returned zero code '
    + 'files naming any of the forty-three exported names, each beside a lit control. An AI '
    + 'reading the contract found a complete, well-typed export-job API and wrote calls that '
    + 'answer 404 — and once the retirement of the cron-typed positions nothing read had '
    + 'deleted theirs, ScheduledExport / ScheduleExportRequest kept a REQUIRED schedule block that could hold no schedule, so an author who filled in '
    + 'its timezone believed they had scheduled something. ScheduleState described the '
    + 'runtime state of a scheduled flow that no scheduler wrote or read. Why D3 semantic and '
    + 'not a D2 conversion: the chain walks a normalized STACK and applyConversionsToStoredItem '
    + 'maps a metadata type onto one of its collections; none of these shapes is either — they '
    + 'are HTTP bodies, a route map, a service interface and an unpersisted runtime record — so '
    + 'a conversion would be a transform with no seam that ever runs, and with no carrier key '
    + 'there is no shape on which a tombstone could sit. Those earlier cron-position deletions '
    + 'on three of these defs registered nothing and stay unregistered; the defs themselves are '
    + 'now the RETIRED_DEFS_BY_MAJOR[18] entries.',
  acceptanceCriteria:
    'No code imports any of the twelve export-job Schema consts or their type aliases from '
    + '@objectstack/spec or @objectstack/spec/api, reads ExportApiContracts, implements or '
    + 'imports IExportService or its six types from @objectstack/spec/contracts, or imports '
    + 'ScheduleStateSchema / ScheduleState / ScheduleStateParsed from '
    + '@objectstack/spec/automation: every such import is TS2305 after upgrade, and there is no '
    + 'working replacement to point at because nothing ever served them. The thirteen defs are '
    + 'absent from json-schema.manifest/api.json and json-schema.manifest/automation.json, from '
    + 'the api-surface / declaration-map / export-origins shards and from the generated '
    + 'reference docs. ExportFormat, ExportImportTemplate, the import validation shapes and '
    + 'the whole import-job family (including ImportJobApiContracts) are unaffected. ⚠️ Runtime '
    + 'behaviour is deliberately UNCHANGED and must be verified as such: GET '
    + '/api/v1/data/:object/export answers exactly as before, and every request to a retired '
    + 'path answers exactly as it always did, because nothing ever mounted one. ⚠️ Readers '
    + 'outside objectstack, objectui and cloud are NOT MEASURED — @objectstack/spec is '
    + 'published.',
};
