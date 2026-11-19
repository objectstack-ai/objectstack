---
'@objectstack/platform-objects': minor
'@objectstack/spec': patch
'@objectstack/cli': patch
---

feat: working calendars in Setup — `sys_work_calendar` and `sys_work_calendar_exception` (ADR-0157, part two of two)

Clause-②: yes (widening)
Metadata-protocol: added

Not released alone: this ships in the same release as the calendar service and its arithmetic (the first half of this change), the working-day formula functions (#35356) and the approval escalation's working-time clock (#35357), ADR-0157 D4.

- **Two platform objects** (`@objectstack/platform-objects`). `sys_work_calendar` holds a calendar's `code` (unique per organization, snake_case), `name`, required IANA `timezone`, `is_default` (one per organization), the required `maintained_from` .. `maintained_through` span its holidays are entered for, and one period column per weekday (`monday_periods` … `sunday_periods`, `HH:mm-HH:mm` periods separated by commas, blank for a day off). `sys_work_calendar_exception` holds dated overrides: `calendar`, `date`, `kind` (`off`, no periods; `on`, that date's full periods), `periods` and `note`, one row per calendar and date. Both are organization data an administrator keeps, audited, like `sys_exchange_rate`; a package may seed rows under the existing seed contract and name a calendar by code. Their names join the platform object name list (`@objectstack/spec`).
- **Setup.** Two entries under Exchange Rates: Working Calendars (with a Needs Maintenance list of every calendar whose maintained span ends within 60 days) and Calendar Exceptions, whose list page imports a year of holidays from a file; the `calendar` column names a calendar by its code or name. Labels and help text ship in all eleven locales.
- **Organization ownership** (`@objectstack/cli`). Both objects are organization-owned; an exception reaches its organization through its calendar.
