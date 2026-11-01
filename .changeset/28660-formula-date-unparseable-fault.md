---
'@objectstack/formula': patch
'@objectstack/objectql': patch
---

fix(objectql,formula): a formula field whose `date()` / `datetime()` is handed text it cannot parse is a reported evaluation fault, not a silent null

Clause-②: no
Metadata-protocol: none

A formula field such as `date(record.first)` on a row whose `first` holds text that is not a date (`"grace"`) read `null`, the same bytes an empty `first` gives, and nothing was logged. `date()` / `datetime()` answer an invalid Date for such text, the evaluator reports that as a success, and the invalid Date serializes to `null`, so the once-per-field formula fault line never fired.

- **The field now reports it.** The read path (`find`, `findOne` and a write's response) treats that invalid Date as an evaluation fault: the field reads `null` exactly as before, and the engine's logger gets the one `warn` line per object and field per engine instance that every other formula fault gets. The line says that `date()` / `datetime()` take ISO text, a timestamp or epoch milliseconds. The record's text is not quoted in the log. A date function over the bad value (`addDays(date(record.first), 1)`) reports the same way.
- **An empty source is not a fault.** `null`, empty or blank text still reads `null` with no line.
- **Predicates are unchanged.** `date()` still answers the same invalid Date, so `date(record.d) == today()` over non-date text is still `false`, and `visibleWhen`, validation rules and filters answer as before. `isoDate()` and `daysBetween()` over it still refuse at evaluation.
- **`@objectstack/formula` gains `isUnparseableDate(value)`**: `true` for the invalid Date `date()` / `datetime()` (or `addDays` / `addMonths` over it) answered for non-empty text they could not parse, `false` for everything else, including an invalid Date from an empty source. It reads a weakly held mark and never changes what any function returns.
- **What a read returns over the wire does not move.** In process, `ObjectQL#find` now hands back `null` for such a field where it handed back an invalid `Date`; serialized, both are `null`.
