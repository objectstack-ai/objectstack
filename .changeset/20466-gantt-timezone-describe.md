---
"@objectstack/spec": patch
---

fix(spec): correct `GanttConfig.timeZone`'s describe — persisted gantt drops on a `date` field are not "real instants" (#20466)

Clause-②: no

The `GanttConfig` `timeZone` member's `.describe()` said "persisted data stays real
instants" for every field. That is false for a `Field.date` column: per the spec's own
storage rule (`temporalStorageForm` / ADR-0053), a gantt drop on a `date` field writes the
calendar day it landed on, as a timezone-naive `YYYY-MM-DD`, while a `datetime` field
still writes the real instant. Only the false clause is replaced — "a datetime value is
still written as the real instant, and a date value as the calendar day it was dropped on
in this zone's calendar (`YYYY-MM-DD`)" — the rest of the describe, and every other
member, is unchanged.

No key moves and no verdict moves: this corrects a published describe's prose to match
the contract it already had, it does not add, remove or re-scope anything authorable. The
JSON Schema and reference docs regenerate from the corrected source.
