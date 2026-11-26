---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the cube door refuses a total over a formula with the stored-field remedy, not a row count

Clause-②: no
Metadata-protocol: none

A cube measure that takes the `sum`, `avg`, `min` or `max` of a `formula` field (a configured cube's measure, or an inferred cube's suffix measure such as `expected_sum`) is still refused `INVALID_FIELD` / 400 before anything is read. Its message no longer ends "aggregate a field of one of those types, or count the rows with count": after the accepted set it now prints the spec's one prescription for a virtual field, `VIRTUAL_FIELD_AGGREGATE_REMEDY` ("Computed on read, the field stores no value: make it a field of its return type with the same `expression` (computed and stored on write) and aggregate that. Counting records is a different question."), the sentence the dataset compiler and the engine's aggregate door already print for the same pair. A count in place of a total is a plausible wrong number.

Which measures are refused, the error code, the status and the attached `member` / `field` / `object` are unchanged. A refused pair over a stored type (for example `sum` over `text`) keeps its wording.
