---
'@objectstack/formula': minor
'@objectstack/objectql': patch
'@objectstack/lint': patch
'@object-ui/core': patch
'@objectstack/skills': patch
---

feat(formula): `addWorkingDays()`, `workingDaysBetween()` and `addWorkingHours()` count with the organization's working calendar (ADR-0157 D4)

Clause-②: yes (widening)
Metadata-protocol: added — a formula field's or a stored field's `expression` may now call `addWorkingDays(...)`, `workingDaysBetween(...)` and `addWorkingHours(...)`
Skills-docs: updated here — skills/objectstack-formula/SKILL.md teaches the three functions and eval 8 of skills/objectstack-project/evals/project-process.json exercises them (the card's order names both)

Not released alone: it ships in the same release as the working calendar service and objects (#35355) and the approval escalation's working-time clock (#35357), ADR-0157 D4.

- **Three formula functions** (`@objectstack/formula`). `addWorkingDays(day, n[, code])` answers the calendar day `n` working days after `day` (before it, for a negative `n`); `day` itself never counts and `0` answers `day`. `workingDaysBetween(start, end[, code])` counts the working days after `start` up to and including `end`, negative when `end` is earlier, and is the inverse of `addWorkingDays`. `addWorkingHours(start, hours[, code])` answers the instant `hours` of working time after `start`, counted as elapsed time in the calendar's time zone (D11); a start outside working time begins at the next working period. All three step over the calendar's weekends and holidays and onto its make-up working days. Without `code` a call counts with the organization's default calendar; `code` names a calendar and is written as a quoted literal. They join the advertised standard library (`CEL_STDLIB_FUNCTIONS`).
- **Where they count** (`@objectstack/objectql`). A `formula` field and a stored field's `expression` count with the record's own organization's calendars, which the engine loads through the calendar service before it evaluates them: only the calendars the expressions name, once per organization per read, from the service's cache. A formula field counts again on its next read after a calendar edit; a stored due time keeps the value of its last write.
- **When the calendar cannot answer** (D8). With no default calendar in the organization, a code the organization has no calendar for, or a count that reaches past the span the calendar is maintained for, the formula reads `null` and the server logs one line naming the object, the field and the reason. A stored field's `expression` stores blank and the write goes through; the blank stays until that record's next write, and a write made while the calendar refuses blanks a value that was valid before. Nothing counts on the weekly pattern or the wall clock instead.
- **No calendar arithmetic as a filter.** A query filter, a sharing rule's condition and every filter compiled from CEL refuse the three functions with a message that prescribes the stored due-time field (D6).
- **Build refusals** (`@objectstack/lint`). `os build` / `os validate` refuse the three functions at every expression site but a formula field's and a stored field's `expression` (validation rules, visibility, action conditions, flow conditions and values, sharing rules, a field's expression `defaultValue` and a seed value), and refuse a calendar code that is not a quoted literal, with a branch between literal calls as the way to pick a calendar per record.
- **Forms** (`@object-ui/core`). A form does not compute a formula that calls one of the three: its calendar is loaded for the server's read, never handed to the form, so the field is unservable there as on the server's write-path check.
- **Teaching** (`@objectstack/skills`). objectstack-formula documents the three functions; the platform catalog moves working-day formulas from Planned into what the platform ships; the project-process eval for business-hours SLAs now expects the functions.
