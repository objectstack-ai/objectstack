// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'export-schedule-cron-retired',
  surface:
    'export-schedule cron positions: `ScheduledExport.schedule.cronExpression` / '
    + '`ScheduleExportRequest.schedule.cronExpression` (`api/export.zod.ts`)',
  replacement:
    'nothing to re-declare — delete the key. No export scheduler exists on the platform: '
    + 'rest-server serves no `/api/v1/data/export` route, `IExportService` has no provider '
    + 'binding, and nothing ever read the cron, so there is no live mechanism to declare an '
    + 'export cadence to. The one cron slot the platform evaluates is `Job.schedule.expression` '
    + '(`system/job.zod.ts`, evaluated by `croner` through service-job): a recurring export is a '
    + 'job whose handler performs the export. The `schedule` block and its `timezone` stay on '
    + 'both schemas — the ruling retires the cron position, not the block',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-06 on #15954 (director decision '
    + 'batch #56, option A — retire — per family), executed by #16320. Two positions in the '
    + 'declared export-job API contract carried a `CronExpressionInputSchema` slot that the parse '
    + 'normalized into the `{ dialect: \'cron\', source }` envelope and NOTHING read: the whole '
    + '`ExportJobApiContracts` family has zero consumers, rest-server serves no '
    + '`/api/v1/data/export` route, and `IExportService` has no provider — so '
    + '`POST /api/v1/data/export/schedules` is a declared contract nothing implements, and an '
    + 'author who wrote `cronExpression: \'0 6 * * MON\'` reasonably expected a weekly export '
    + 'that never ran (the ADR-0058 D7 ledger row `cron-declared-unwired` recorded exactly '
    + 'this, `unevaluated`). Why D3 semantic and not a D2 conversion: the chain walks a '
    + 'normalized STACK and `applyConversionsToStoredItem` maps a metadata type onto one of its '
    + 'collections; an export schedule is an API request/response body and is neither, so a '
    + 'conversion would be a transform with no seam that ever runs (the '
    + '`kernel/MetadataPluginConfig:additionalTypes` precedent). The prescriptions therefore '
    + 'carry no `os migrate meta` sentence.',
  acceptanceCriteria:
    'No `ScheduledExport` or `ScheduleExportRequest` literal carries `schedule.cronExpression`. '
    + 'TypeScript authors get the refusal at compile time (the key is typed `never`); a value '
    + 'reaching the parse is refused with the prescription (`invalid_type` at path '
    + '`schedule.cronExpression`). `schedule.timezone` still parses and still defaults to '
    + '`UTC`. ⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: '
    + 'nothing ever read the keys, so removing them removes no behaviour — no export ran on a '
    + 'schedule before and none runs after.',
};
