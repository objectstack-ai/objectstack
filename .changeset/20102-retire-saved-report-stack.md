---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
'@objectstack/rest': minor
'@objectstack/client': minor
'@objectstack/cli': minor
'@objectstack/metadata-protocol': patch
---

feat!: retire the saved-report stack — `sys_saved_report` / `sys_report_schedule`, `/api/v1/reports`, `client.reports`, `IReportService`, the `reports` capability and `@objectstack/plugin-reports` (#20102)

**BREAKING** — the saved-report stack is removed whole, with no deprecation window
(maintainer ruling 2026-09-25, 「A. 退役」). It persisted a raw object query
(`object_name` + `{ filter, fields, orderBy, limit, groupBy }`) with a render format
and an owner, and could e-mail it on a schedule. Measured on the main branch of this
repository, objectui and cloud before removal: zero callers of the routes, the SDK
namespace or the service contract outside their own tests, and no app declaring the
capability.

**NOT affected: the `report` metadata kind.** `ReportSchema`, `defineReport`,
`/meta/report`, datasets and the analytics service are unchanged. The two shared the
word "report" and nothing else.

FROM → TO, per surface:

- `requires: ['reports']` → **refused** by `defineStack` (`STACK_CAPABILITY_UNKNOWN`,
  422) with the prescription "requires: 'reports' was removed in @objectstack/spec
  17.5.0 … Delete the token." Fix: delete the token. `os serve` on an older artifact
  that still carries it warns with the same prescription and ignores it. The token is
  gone from `PLATFORM_CAPABILITY_TOKENS` and `PLATFORM_CAPABILITY_PROVIDERS`; the new
  `RETIRED_PLATFORM_CAPABILITY_GUIDANCE` (`@objectstack/spec/kernel`) carries the
  prescription.
- `IReportService`, `SavedReport`, `ReportSchedule`, `ReportQuery`, `ReportFormat`,
  `ReportRunResult`, `SaveReportInput`, `ScheduleReportInput`
  (`@objectstack/spec/contracts`) → removed, no replacement export. Fix: delete the
  import.
- `SysSavedReport`, `SysReportSchedule` (`@objectstack/platform-objects/audit`) and
  the names `sys_saved_report` / `sys_report_schedule` in
  `PLATFORM_PROVIDED_OBJECT_NAMES` → removed. A stack referencing either name is now
  flagged as a probable typo instead of resolving.
- `GET|POST /api/v1/reports`, `GET|DELETE /api/v1/reports/:id`,
  `POST /api/v1/reports/:id/run`, `POST /api/v1/reports/:id/schedule`,
  `GET /api/v1/reports/:id/schedules`, `DELETE /api/v1/reports/schedules/:scheduleId`
  → unmounted: each answers the standard unmatched-route `404`, byte-identical to a
  path that never existed. Their nine error codes (`REPORTS_LIST_FAILED`,
  `REPORT_DELETE_FAILED`, `REPORT_GET_FAILED`, `REPORT_NOT_FOUND`,
  `REPORT_RUN_FAILED`, `REPORT_SAVE_FAILED`, `REPORT_SCHEDULE_FAILED`,
  `SCHEDULES_LIST_FAILED`, `SCHEDULE_DELETE_FAILED`) leave `ERROR_CODE_LEDGER` with
  their only emitter.
- `client.reports.*` (`list`, `save`, `get`, `delete`, `run`, `schedule`,
  `listSchedules`, `unschedule`) → removed. Fix: delete the call. A report is `report`
  metadata, read through `meta.*` and queried through `analytics.*`; a saved ad-hoc
  object query is a ListView on that object.
- `RestServer`'s constructor keeps the position of the retired saved-report provider,
  typed `undefined`, so no later positional argument re-binds. Pass `undefined` there;
  passing a provider is a compile error.
- `@objectstack/plugin-reports` → no longer built or published from this repository,
  and `@objectstack/cli` no longer depends on it or mounts it. Fix: remove the
  dependency. There is no successor package and no scheduled-delivery replacement.

**Existing databases.** `sys_saved_report` / `sys_report_schedule` tables in a deployed
database are left in place, untouched — no backfill, no reaper, no drop — under the
repository's convention for a retired platform object: the platform never drops a
table that metadata stops declaring, and `os migrate plan` lists such a table in its
informational unmanaged-tables section so an operator can decide.

`@objectstack/metadata-protocol` (patch): the `INVALID_SORT` hint for a sort node
spelled `{ field, direction }` no longer names the retired saved-report contract as
the source of that vocabulary; it names the better-auth adapter's `sortBy`, which
still uses it. Code and status are unchanged.

Breaking ships as `minor` per the launch-window convention
(`scripts/check-changeset-no-major.mjs`).

**Clause-②: yes (narrowing)** — a published capability token, a service contract and
its types, two platform objects, eight routes, nine registered error codes and an SDK
namespace are removed; nothing previously refused is now accepted.

<!-- adr-0087: registered saved-report-stack-retired -->
