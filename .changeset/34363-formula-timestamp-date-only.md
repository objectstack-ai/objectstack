---
'@objectstack/formula': minor
'@objectstack/spec': minor
---

fix(formula)!: the authoring gate refuses `timestamp()` over a date-only field, which faults on every row, and names the `isoDate(addDays(…))` shift

Clause-②: yes (narrowing) — narrowed: the author-time gate (`os validate`, `os build`, `os lint`, the object save door and the flow publish door, wherever an expression is judged with the object's field types) refuses `timestamp(<date field>)`, alone or inside `+ duration(…)` arithmetic, which it accepted before. Widened: the published `ExpressionRefusalParams` type gains one optional param, `shift`, on the `date-text-call*` codes, present exactly when the message carries the new shift clause. No new refusal code.
Metadata-protocol: narrowed

<!-- adr-0087: registered formula-timestamp-date-only-refused -->

**BREAKING** accept-set narrowing at the authoring type-soundness gate (`@objectstack/formula` `validateExpression`), shipped as `minor`. `timestamp(s)` is CEL's string overload, so the gate's date-text check, which declares a date field as the text the runtime holds, passed `timestamp(record.borrow_date)`. The runtime holds a `date` field as its `YYYY-MM-DD` text, and `timestamp()` parses only a full ISO-8601 instant: the evaluator answers `timestamp() requires a string in ISO 8601 format` on every record with a value (and finds no overload for `timestamp(null)` on every record without one). A formula read `null`; a flow condition failed the run; a fail-closed rule refused the write.

- **The verdict.** The existing `date-text-call` code (and its `-run-fails`, `-run-may-fail`, `-fail-closed` and `-fail-open` arms) now names `timestamp(<date field>)`, with `date(<field>)` as the parse in place of the call and a new sentence naming the whole-day shift that keeps the result a date: `isoDate(addDays(<field>, N))`.
- **Not refused.** `timestamp()` over a `datetime` field, whose text is an ISO-8601 instant that `timestamp()` parses, and `timestamp()` over a literal.
- **Where it is judged.** Every site the gate types with the object's field types: formula fields, validation rules, field rule predicates, and flow start, edge and `decision` conditions. A flow's value envelope (`assignment` values, `create_record` / `update_record` field values) is judged without field types, as before, so this verdict does not reach it.
- **`@objectstack/spec`.** The upgrade guide entry `formula-timestamp-date-only-refused` (a semantic migration: the shift in days is the author's, and the refused expression never produced a value to preserve).

## FROM → TO

| FROM | TO |
|:---|:---|
| `isoDate(timestamp(record.borrow_date) + duration('168h'))` | `isoDate(addDays(record.borrow_date, 7))` |
| `timestamp(record.borrow_date)` | `date(record.borrow_date)` |

One-line fix: shift a date field by whole days with `isoDate(addDays(record.<date field>, N))`, never `timestamp(record.<date field>) + duration(…)`.
