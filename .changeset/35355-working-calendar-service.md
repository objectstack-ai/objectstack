---
'@objectstack/spec': patch
'@objectstack/formula': patch
'@objectstack/objectql': patch
'@objectstack/core': patch
---

feat: the working-calendar service, its arithmetic and its refusal codes (ADR-0157, part one of two)

Clause-②: yes (widening)
Metadata-protocol: none

Not released alone; pair #35641/#35642. This ships in the same release as #35642 (the calendar objects and Setup pages, the second half of this change), the working-day formula functions (#35356) and the approval escalation's working-time clock (#35357), ADR-0157 D4.

- **The arithmetic** (`@objectstack/formula`). `isWorkingTime`, `addWorkingDays`, `workingDaysBetween` and `addWorkingHours` compute over a resolved calendar and its dated exceptions, as pure functions a formula can call synchronously, beside `parseWorkPeriods` (`HH:mm-HH:mm` periods; a period that crosses midnight is refused, `24:00` is a legal end), `buildWorkCalendar` (a frozen calendar) and the three error classes. A computation that needs a date outside the calendar's maintained span is refused rather than read from the weekly pattern.
- **The types, constants and time-zone rule** (`@objectstack/spec`). `WorkCalendar` and the column and code constants are in `@objectstack/spec/data`; the service contract is `IWorkCalendarService` in `@objectstack/spec/contracts`. `zonedWallClockToUtcMs`, `wallClockToUtcMs` and `WallClockParts` move to `@objectstack/spec/data` from `@objectstack/core`, unchanged; `@objectstack/core` re-exports all three, so no import changes.
- **Three error codes** in the ADR-0112 ledger: `ERR_WORK_CALENDAR_UNRESOLVED` (no calendar by that code, no organization default, two defaults, or no organization named outside the `single` posture), `ERR_WORK_CALENDAR_NOT_MAINTAINED` and `ERR_WORK_CALENDAR_INVALID`, each a 400.
- **The calendar service** (`@objectstack/objectql`, registered as `work-calendar`). `resolve({ organizationId, calendar })` takes the named code, else the organization default, else refuses; it never falls back to wall-clock time. It reads in the organization the caller names, elevated, and caches until a calendar or exception row is written. Outside the `single` tenancy posture, a computation that names no organization is refused before any read. Until the calendar objects are registered it refuses every resolution.
- **The write door** (`@objectstack/objectql`). Once the calendar objects exist, a calendar or exception write is refused `400 VALIDATION_FAILED` when a period crosses midnight, is malformed or overlaps another, an `off` row carries periods or an `on` row carries none, `maintained_through` is before `maintained_from`, a second calendar is marked the default, or a calendar created in an organization other than the one being worked in is marked the default (create it there, or set the default by an update); a calendar created without `timezone` takes the organization's Localization time zone. The hooks take the organization from the session.
