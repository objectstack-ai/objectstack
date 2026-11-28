---
'@objectstack/formula': minor
---

fix(formula)!: a flow condition that hands `timestamp()` a date field through `record.FIELD` or `previous.FIELD` is now refused, as the bare field name already was

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-formula/SKILL.md` already states the `date-text-call` rule (a `date` / `datetime` field handed to a timestamp-only call, and `timestamp()` over a `date` field) with `record.FIELD` spellings and names no site it is limited to, so it now holds for a flow condition's root reads as written

<!-- adr-0087: not-required (already-registered formula-timestamp-date-only-refused, formula-date-text-call-refused, formula-date-subtraction-refused) The three semantic entries already carry these verdicts, their codes and their rewrites to the upgrade guide, and each entry's surface already names flow conditions among the CEL predicates judged with the object's field types, with record.FIELD spellings as its examples. This change makes that text true for a flow condition that reads the field through record or previous, where only the bare field name was judged before; the verdicts, codes, rewrites and acceptance criteria are the entries' own. No id is added, no key is added, removed or re-shaped, and nothing an author wrote is rewritten. -->

**BREAKING** accept-set narrowing, shipped as `minor`. In a flow condition (a start, edge or `decision` branch condition) the run binds the record's fields under their bare names and also as `record`, with the row before the write as `previous`. The date-text checks judged only the bare name. `timestamp(borrow_date) < now()` over a `date` field was refused, but `timestamp(record.borrow_date) < now()` passed `os validate` and the publish door. The flow then failed on every run, because a date field reaches the run as its `YYYY-MM-DD` text, which `timestamp()` does not parse.

- **The verdicts.** A `record.FIELD` / `previous.FIELD` read in a flow condition now gets the date-text checks its bare name gets, with the same code and outcome arm (`date-text-call-run-fails` / `date-text-arithmetic-run-fails` on a record-triggered flow or a sweep of the typed object, `-run-may-fail` elsewhere). The message names the read as written and prescribes `date(record.FIELD)`, or `isoDate(addDays(record.FIELD, N))` to shift by whole days. This covers the calls the text cannot take (`timestamp(record.FIELD)` over a `date` field, `isoDate(record.FIELD)` over a `date` or `datetime` field) and arithmetic on the text (`record.end_date - record.start_date`).
- **Where.** `os validate` / `os build` (`validateStackExpressions`) report an `error`, and the flow publish door refuses the publish with `INVALID_METADATA` (422). `registerFlow` logs it as an advisory, as it does for the bare name, and still registers the flow, so a stored flow keeps running until it is next published.
- **Not refused.** `timestamp()` over a `datetime` field. A shape the Timestamp typing already faults on (`record.due_date + 1`), which is another verdict's. An `input.FIELD` read. The run-time evaluator is unchanged.

## FROM → TO

| FROM | TO |
|:---|:---|
| `timestamp(record.borrow_date) < now()` | `date(record.borrow_date) < now()` |
| `timestamp(previous.borrow_date) < now()` | `date(previous.borrow_date) < now()` |
| `isoDate(record.picked_up_at) == '2026-11-16'` | `isoDate(date(record.picked_up_at)) == '2026-11-16'` |

One-line fix: in a flow condition, parse a date field with `date(record.FIELD)` before comparing it with a timestamp, never `timestamp(record.FIELD)`.
