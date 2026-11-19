---
'@objectstack/objectql': patch
---

fix(objectql): the engine's aggregate door answers a `sum` / `avg` / `min` / `max` over a `formula` with the stored-field remedy, not "count the rows"

Clause-②: no
Metadata-protocol: none

`engine.aggregate` already refused a value-reading aggregation over a `formula` field with `INVALID_FIELD` / 400 before any driver ran, but its route told the author to "aggregate a field of one of those types, or count the rows with count" — and a count substituted for a total is a plausible wrong number. The route for that pair is now the spec's one prescription, `VIRTUAL_FIELD_AGGREGATE_REMEDY` (`@objectstack/spec/data`, judged by `virtualFieldAggregateRemedy`): make it a field of its return type with the same `expression` (computed and stored on write) and aggregate that. It still comes right after "The query was NOT run.", inside the 500 characters the REST door keeps.

Which pairs are refused does not change, nor does any other pair's wording: a refused `sum` over a `text`, `select` or JSON-stored field keeps its accepted-types route.
