---
'@objectstack/spec': minor
'@objectstack/plugin-approvals': minor
'@objectstack/lint': minor
'@object-ui/console': minor
'@object-ui/i18n': minor
---

feat(approvals): an escalation deadline can count working time on an organization's working calendar (`escalation.clock: 'working_time'`)

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-automation/references/state-machines-and-approvals.md

An approval node's `escalation` gains two optional keys (ADR-0157 D5):

- **`clock`**: `'wall_clock'` (the default) or `'working_time'`. Under `wall_clock` nothing changes: `timeoutHours` counts elapsed hours from `created_at`, nights, weekends and holidays included, and every request already open keeps its deadline (a stored snapshot carries no `clock`). Under `working_time` the hours count only the working periods of a working calendar (`sys_work_calendar`), skipping its holidays and counting its make-up workdays: a request opened at 17:00 on a Friday with `timeoutHours: 4`, on 09:00-12:00 and 13:00-18:00 periods, escalates at 12:00 on the next working day.
- **`calendar`**: the code of the working calendar to count on. Left out, the request organization's default calendar counts. There is never a fallback to wall-clock hours.

The approvals sweep and the request read share one deadline function. A `working_time` deadline is counted again on every sweep and every read and is never stored, so a holiday entered after a request opened moves its deadline; an escalation that already fired stays fired (single-shot, ADR-0042). When the calendar cannot count the deadline (no calendar has the code, the organization has no default, or the calendar is not maintained as far as the deadline needs), the request does not escalate, the next sweep tries again, and the request read carries a new additive field, `sla_due_refusal` (`code`, `reason` or `date`, `message`), in place of `sla_due_at`. The approvals inbox shows "Calendar can't compute" with the reason where the SLA countdown sits, in every console language.

`@objectstack/lint` refuses a `calendar` written beside the wall clock (`approval-escalation-calendar-without-working-time`, error): nothing would read it. Whether the named calendar exists is the organization's runtime data and is never checked at publish. The Studio approval inspector offers the clock and, under working time only, the calendar.

Not released alone: this ships in the same release as the working-calendar objects and service and the working-day formula functions (ADR-0157 D4).
