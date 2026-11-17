---
'@objectstack/formula': patch
---

fix(formula): a flow condition that hands `timestamp()` a date field through `record.FIELD` or `previous.FIELD` is now refused, as the bare field name already was

Clause-②: no
Metadata-protocol: none

In a flow condition (a start, edge or `decision` branch condition) the run binds the record's fields under their bare names and also as `record` (and the row before the write as `previous`). The date-text checks judged only the bare name. `timestamp(borrow_date) < now()` over a `date` field was refused, but `timestamp(record.borrow_date) < now()` passed `os validate` and the publish door. The flow then failed on every run, because a date field reaches the run as its `YYYY-MM-DD` text, which `timestamp()` does not parse.

A `record.FIELD` / `previous.FIELD` read in a flow condition now gets the same date-text checks as its bare name, with the same code and outcome arm (`date-text-call-run-fails` on a record-triggered flow, `-run-may-fail` elsewhere). The message names the read as written and prescribes `date(record.FIELD)`, or `isoDate(addDays(record.FIELD, N))` to shift by whole days. This covers the calls the text cannot take (`timestamp(record.FIELD)` over a `date` field, `isoDate(record.FIELD)` over a `date` or `datetime` field) and arithmetic on the text (`record.end_date - record.start_date`). The shapes stay what they were: `timestamp()` over a `datetime` field still passes, and a shape the Timestamp typing already faults on (`record.due_date + 1`) is not this check's.

`registerFlow` logs the finding as an advisory, as it does for the bare name, and still registers the flow. A stored flow that carries such a condition is refused at its next publish. To fix it, write `date(record.FIELD) < now()`, or compare whole days with `daysBetween` / `addDays`.
