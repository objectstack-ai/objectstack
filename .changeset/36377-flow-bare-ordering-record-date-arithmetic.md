---
'@objectstack/formula': minor
'@objectstack/spec': minor
---

fix(formula)!: a flow condition that orders a bare date field against text before date arithmetic on `record.FIELD` or `previous.FIELD` is now refused, as its all-bare and all-root spellings already were

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-formula/SKILL.md` already states "The build refuses `end - start`, `date + n`, `today() + 30`" and names no site or spelling it is limited to, so it now holds for this flow-condition spelling as written

<!-- adr-0087: registered flow-condition-bare-ordering-before-record-date-arithmetic-refused -->

**BREAKING** accept-set narrowing. In a flow condition (a start, edge or `decision` branch condition) the run binds the record's fields under their bare names and also as `record`, with the row before the write as `previous`. A condition that first orders a `date` or `datetime` field's bare name against a text literal and then does arithmetic against a number on a `record.FIELD` / `previous.FIELD` read, such as `due_date > "2026-01-01" && record.due_date + 1 > 5`, passed `os validate` and the publish door with no finding. The flow then failed on every run, because the field reaches the run as its text and the evaluator cannot add a number to it. The all-bare spelling (`due_date > "2026-01-01" && due_date + 1 > 5`) and the all-root spelling (`record.due_date > "2026-01-01" && record.due_date + 1 > 5`) were refused already.

- **The verdict.** The mixed spelling now gets the all-root spelling's verdict: `date-text-arithmetic-run-fails` on a record-triggered flow or a sweep of the typed object, `date-text-arithmetic-run-may-fail` elsewhere, naming the read as written. A root read keeps the row's arm where bare names are unproven. Where a flow variable holds the bare name, the ordering is not the field's, and the root read's arithmetic takes `date-arithmetic-run-fails`, as `record.due_date + 1 > 5` alone does.
- **Where.** `os validate` / `os build` (`validateStackExpressions`) report an `error`, and the flow publish door refuses the publish with `INVALID_METADATA` (422). `registerFlow` logs it as an advisory and still registers the flow, so a stored flow keeps its run-time behaviour until it is next published.
- **Not refused.** The same bare ordering beside an ordering of the root read (`due_date > "2026-01-01" && record.due_date < today()`), and `daysBetween` / `addDays` over it. The run-time evaluator is unchanged.

## FROM → TO

| FROM | TO |
|:---|:---|
| `due_date > "2026-01-01" && record.due_date + 1 > 5` | `due_date > "2026-01-01" && daysBetween(record.due_date, today()) > 5` (days past due) or `due_date > "2026-01-01" && addDays(record.due_date, 1) < today()` (a shifted date) |
| `due_date > "2026-01-01" && previous.due_date - 7 < today()` | `due_date > "2026-01-01" && addDays(previous.due_date, -7) < today()` |

One-line fix: in a flow condition, never add or subtract a number on a date field read through `record` or `previous`, whatever precedes it; use `daysBetween(a, b)` for a span and `addDays(d, n)` to shift a date.
