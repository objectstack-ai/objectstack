---
'@objectstack/formula': minor
'@objectstack/spec': minor
---

fix(formula)!: a flow condition that does date arithmetic on `record.FIELD` or `previous.FIELD` is now refused, as the bare field name already was

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered flow-condition-record-date-arithmetic-refused -->

**BREAKING** accept-set narrowing. In a flow condition (a start, edge or `decision` branch condition) the run binds the record's fields under their bare names and also as `record`, with the row before the write as `previous`. The date-arithmetic check judged only the bare name: `due_date + 1 > 5` over a `date` field was refused, but `record.due_date + 1 > 5` passed `os validate` and the publish door. The flow then failed on every run, because a date field reaches the run as its `YYYY-MM-DD` text and the evaluator cannot add a number to it.

- **The verdict.** A `record.FIELD` / `previous.FIELD` read of a `date` or `datetime` field in arithmetic against a number now gets the verdict its bare name gets, with the same code and outcome arm (`date-arithmetic-run-fails` on a record-triggered flow or a sweep of the typed object, `date-arithmetic-run-may-fail` elsewhere). A root read keeps the row's arm where bare names are unproven or a flow variable shadows the bare name. The message names the read as written and prescribes `daysBetween(a, b)` or `addDays(d, n)`.
- **Where.** `os validate` / `os build` (`validateStackExpressions`) report an `error`, and the flow publish door refuses the publish with `INVALID_METADATA` (422). `registerFlow` logs it as an advisory, as it does for the bare name, and still registers the flow, so a stored flow keeps its run-time behaviour until it is next published.
- **Not refused.** An ordering of the field (`record.due_date < today()`), `daysBetween` / `addDays` over it, and the date-text shapes, which keep their own verdicts. Formula fields and validation rules read `record.FIELD` already and were refused before. The run-time evaluator is unchanged.

## FROM → TO

| FROM | TO |
|:---|:---|
| `record.due_date + 1 > 5` | `daysBetween(record.due_date, today()) > 5` (days past due) or `addDays(record.due_date, 1) < today()` (a shifted date) |
| `previous.due_date - 7 < today()` | `addDays(previous.due_date, -7) < today()` |

One-line fix: in a flow condition, never add or subtract a number on a date field read through `record` or `previous`; use `daysBetween(a, b)` for a span and `addDays(d, n)` to shift a date.
