// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The saved-report stack and the `report` metadata kind shared a word and
// nothing else; this retires the stack and leaves the kind untouched.
export const entry: SemanticMigration = {
  id: 'saved-report-stack-retired',
  surface:
    'the saved-report stack, whole: the `reports` platform capability token (`requires: '
    + '[\'reports\']`, its `PLATFORM_CAPABILITY_TOKENS` member and its '
    + '`PLATFORM_CAPABILITY_PROVIDERS` row); the saved-report service contract in '
    + '`@objectstack/spec/contracts` (`IReportService`, `SavedReport`, `ReportSchedule`, '
    + '`ReportQuery`, `ReportRunResult`, `SaveReportInput`, `ScheduleReportInput`); the '
    + '`sys_saved_report` and `sys_report_schedule` platform objects (`SysSavedReport` / '
    + '`SysReportSchedule` in `@objectstack/platform-objects/audit`) and their names in '
    + '`PLATFORM_PROVIDED_OBJECT_NAMES`; the eight `/api/v1/reports` routes (list, save, get, '
    + 'delete, run, schedule, list schedules, unschedule); the `reports` namespace of '
    + '`@objectstack/client`; and the `@objectstack/plugin-reports` package that served them. '
    + 'NOT the `report` metadata kind (`ReportSchema`, `/meta/report`, datasets, analytics), '
    + 'which is unchanged.',
  replacement:
    'Delete `\'reports\'` from `requires` — `defineStack` now refuses it with this '
    + 'prescription. A report is `report` metadata: `ReportSchema` over a dataset (ADR-0021), '
    + 'served by the analytics service every server mounts. A saved ad-hoc object query — '
    + 'what a `sys_saved_report` row held — is a ListView on that object. Code that imported '
    + 'the contract types or called the client namespace deletes those lines; there is no '
    + 'successor API and no scheduled-delivery replacement.',
  reason:
    'Maintainer ruling 2026-09-25 (verbatim: 「A. 退役」, then 「你直接派发处理这个退役任务。」). '
    + 'The stack persisted a raw object query (`object_name` plus `{filter, fields, orderBy, '
    + 'limit, groupBy}`) with a render format and an owner — the same object-plus-raw-query '
    + 'shape ADR-0021 removed from the `report` kind as its legacy inline query form, alive in '
    + 'a parallel table under the same word. Measured on the main branch of all three repos '
    + 'before removal: zero callers of the routes, the client namespace or the service '
    + 'contract outside their own tests, and no app declaring the capability. A declared '
    + 'capability with no consumer is a surface an author (most often a model) reaches for '
    + 'and confuses with the real report kind, so it is retired at once, with no '
    + 'deprecation window.',
  acceptanceCriteria:
    '`defineStack({ requires: [\'reports\'] })` throws `STACK_CAPABILITY_UNKNOWN` (422) whose '
    + 'message names the retirement and the replacement; `classifyRequiredCapability` answers '
    + '`unknown` for the token; every `/api/v1/reports` path answers the standard unmounted-route '
    + '404; nothing imports the retired contract types or objects (TS2305 after upgrade). '
    + 'Existing `sys_saved_report` / `sys_report_schedule` tables in deployed databases are left '
    + 'in place untouched — no backfill, no reaper, no drop (the platform never drops a table '
    + 'that metadata stops declaring); `os migrate plan` lists them in its informational '
    + 'unmanaged-tables section, and dropping them is the operator\'s decision.',
};
