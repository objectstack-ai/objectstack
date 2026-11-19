---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
'@objectstack/objectql': minor
'@objectstack/core': patch
'@objectstack/cli': patch
---

feat: working calendars — `sys_work_calendar` and `sys_work_calendar_exception`, the calendar service and the Setup pages (ADR-0157)

Clause-②: yes (widening)
Metadata-protocol: added

Not released alone: this ships in the same release as the working-day formula functions and the approval escalation's working-time clock (ADR-0157 D4).

- **Two platform objects** (`@objectstack/platform-objects`). `sys_work_calendar` holds a calendar's `code` (unique per organization, snake_case), `name`, required IANA `timezone`, `is_default` (one per organization), the required `maintained_from` .. `maintained_through` span its holidays are entered for, and one period column per weekday (`monday_periods` … `sunday_periods`, `HH:mm-HH:mm` periods separated by commas, blank for a day off). `sys_work_calendar_exception` holds dated overrides: `calendar`, `date`, `kind` (`off`, no periods; `on`, that date's full periods), `periods` and `note`, one row per calendar and date. Both are organization data an administrator keeps, audited, like `sys_exchange_rate`; a package may seed rows under the existing seed contract and name a calendar by code.
- **Setup.** Two entries under Exchange Rates: Working Calendars (with a Needs Maintenance list of every calendar whose maintained span ends within 60 days) and Calendar Exceptions, whose list page imports a year of holidays from a file; the `calendar` column names a calendar by its code or name.
- **The write door** (`@objectstack/objectql`). A calendar or exception write is refused `400 VALIDATION_FAILED` when a period crosses midnight, is malformed or overlaps another (`24:00` is a legal end), an `off` row carries periods or an `on` row carries none, `maintained_through` is before `maintained_from`, or a second calendar is marked the default. A create that leaves `timezone` out takes the organization's Localization time zone.
- **The calendar service** (`@objectstack/objectql`, registered as `work-calendar`). `resolve({ organizationId, calendar })` takes the named code, else the organization default, else refuses `ERR_WORK_CALENDAR_UNRESOLVED`; it never falls back to wall-clock time. `isWorkingTime`, `addWorkingDays`, `workingDaysBetween` and `addWorkingHours` compute over the resolved calendar, and a computation that needs a date outside the maintained span is refused `ERR_WORK_CALENDAR_NOT_MAINTAINED`. It reads in the organization the caller names, elevated, and caches until a calendar or exception row is written.
- **The arithmetic and the time-zone rule** (`@objectstack/spec/data`). The four computations, the period parser and the refusal classes are exported as pure functions over a resolved calendar, so a formula can count synchronously. `zonedWallClockToUtcMs`, `wallClockToUtcMs` and `WallClockParts` move here from `@objectstack/core`, unchanged; `@objectstack/core` re-exports all three, so no import changes. Three codes are registered in the error-code ledger: `ERR_WORK_CALENDAR_UNRESOLVED`, `ERR_WORK_CALENDAR_NOT_MAINTAINED` and `ERR_WORK_CALENDAR_INVALID`.
