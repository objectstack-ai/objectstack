---
'@objectstack/platform-objects': minor
'@objectstack/spec': patch
'@objectstack/cli': patch
'@objectstack/objectql': patch
'@object-ui/plugin-form': patch
---

feat: working calendars in Setup — `sys_work_calendar` and `sys_work_calendar_exception` (ADR-0157, part two of two)

Clause-②: yes (widening)
Metadata-protocol: added

Not released alone; pair #35641/#35642. The first half, #35641 (the calendar service and its arithmetic), is merged; this half ships in the same release as it, with the working-day formula functions (#35356) and the approval escalation's working-time clock (#35357), ADR-0157 D4.

- **Two platform objects** (`@objectstack/platform-objects`). `sys_work_calendar` holds a calendar's `code` (unique per organization, snake_case), `name`, required IANA `timezone`, `is_default` (one per organization), the required `maintained_from` .. `maintained_through` span its holidays are entered for, and one period column per weekday (`monday_periods` … `sunday_periods`, `HH:mm-HH:mm` periods separated by commas, blank for a day off). `sys_work_calendar_exception` holds dated overrides: `calendar`, `date`, `kind` (`off`, no periods; `on`, that date's full periods), `periods` and `note`, one row per calendar and date. Both are organization data an administrator keeps, audited, like `sys_exchange_rate`; a package may seed rows under the existing seed contract and name a calendar by code. Their names join the platform object name list (`@objectstack/spec`).
- **Setup.** Two entries under Exchange Rates: Working Calendars (with a Needs Maintenance list of every calendar whose maintained span ends within 60 days) and Calendar Exceptions, whose list page imports a year of holidays from a file; the `calendar` column names a calendar by its code or name. Labels and help text ship in all eleven locales.
- **Time zone on create** (`@object-ui/plugin-form`, ADR-0157 D7). A create form opens a required time-zone field that declares no default (`valueDomain: 'iana_time_zone'`) on the organization's time zone, as it opens a record-currency field on the organization's currency; the user can change it. A create that leaves the calendar's `timezone` out takes the same zone on the server. An optional time-zone field, where blank means "take the parent's", is not prefilled.
- **Refusal wording** (`@objectstack/objectql`). The refusal of a create that marks a calendar the default in another organization no longer assumes the writer is working in an organization.
- **A calendar stays in its organization** (`@objectstack/objectql`). An update that changes the organization of a calendar or of an exception date is refused with `400 VALIDATION_FAILED` on `organization_id` (`invalid_value`), before any read and for every writer, system writes included. To have a calendar in another organization, create it there. An edit that leaves `organization_id` out or repeats the stored one is judged as before; a predicate update is judged row by row, and one matched row whose organization would change refuses it.
- **Organization ownership** (`@objectstack/cli`). Both objects are organization-owned; an exception reaches its organization through its calendar.
