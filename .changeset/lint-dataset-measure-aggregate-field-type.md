---
'@objectstack/lint': minor
---

Refuse a dataset measure whose `aggregate` the field's declared type cannot carry, at authoring time

A dataset measure pairs an `aggregate` with a `field`, and
`AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec`) declares which of those pairs every
backend answers the same way. Nothing in the authoring path read that table, so `avg` over a
`datetime` field validated clean and shipped: one SQL family coerces the column's canonical UTC
text and returns a plausible number (the average *year*), another has no such function and fails at
query time — the answer decided by the deployment rather than by the document. The analytics service
refuses the pair when a query is built (`400 DATASET_INVALID`); this is the same verdict, from the
same table, at the door the author is standing in front of.

New rule `measure-aggregate-field-type-refused`, gating (`error`), on `os validate` / `os build` /
`os lint`. It resolves the field's declared type on the object graph lint already indexes — including
a dotted `relationship.field` path, whose leaf type the compile leg cannot see — and refuses the
pair when `isAggregateCompatibleWithFieldType` says no. The message names the aggregate, the field,
its declared type and the accepted set, and the hint names the aggregates that type *does* accept,
both computed from the table rather than restated. It stays silent wherever the type cannot be
resolved (an object this stack does not define, a field path that resolves to nothing, an untyped
field, an aggregate outside the closed `AggregationFunction` vocabulary) rather than guessing.

**BREAKING**: metadata that passed `os validate` / `os build` / `os lint` before can now fail. Every
pair this refuses is one the analytics service already refuses at query time, so nothing that
*worked* stops working — but a build that did not fail now does.

Migration, per refused pair — FROM the aggregate the field's type cannot carry, TO one it accepts:

- `avg` / `sum` over a `date` / `datetime` / `time` field → `min` / `max`, which return a real
  instant of the field's own type, or `count` / `count_distinct`. A DURATION is not recoverable from
  an aggregate over instants: store it as a number (a computed "days open" field) and aggregate that.
- `sum` over a `percent` field → `avg`. A rate does not add; the total routinely exceeds 100%.
- `min` / `max` over the string, option, reference, file, structured-JSON or `formula` classes →
  `count` / `count_distinct` for "how many distinct values", or a SORT on the record list for "the
  first / last record". String order is collation-dependent, so two backends answer two different
  "smallest" values for one document.
- Any other refused pair → read the row for your aggregate in
  `AGGREGATE_FIELD_TYPE_COMPATIBILITY`; the refusal message prints it.

A `derived` measure whose `of` names a refused measure is fixed by fixing that measure, not the
`derived` one. A `date` / `datetime` / `text` field used as a DIMENSION — grouping, bucketing,
filtering — is untouched: this is about aggregation only.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (already-registered dataset-measure-aggregate-field-type-refused, dataset-measure-selecting-aggregate-field-type-refused) The two entries register this exact surface — dataset measure `aggregate` x `field` pairs the table refuses — with the prescription above; #16099 likewise declared not-required against the first id when it widened the same leg. This change adds no surface of its own: it is the second consumer of that one table, at the authoring door. -->
