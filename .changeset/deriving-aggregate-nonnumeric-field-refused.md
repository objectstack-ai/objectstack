---
"@objectstack/service-analytics": minor
---

feat(service-analytics)!: a dataset measure applying `sum` or `avg` to a field whose declared type cannot carry it is refused at compile time, for every field type and not only the temporal class (#16099)

<!-- adr-0087: not-required (already-registered dataset-measure-aggregate-field-type-refused) the hand-migration prescription for this exact narrowing is already registered under protocol major 18 by #16778 — store the quantity as a numeric field and aggregate that — and this change widens which pairs reach it without changing what an affected author must do. ⚠️ That entry's `acceptanceCriteria` is scoped to a `date`/`datetime`/`time` field and says a field of any other class is "neither refused nor certified by this leg", which is no longer true at HEAD; widening that sentence is a `packages/spec` edit this card is fenced out of and is reported to the `domain:spec` seat rather than done here. -->

**BREAKING** — an accept-set narrowing on a published authoring surface, continuing the
one #16778 began. A dataset measure pairing `aggregate: 'sum'` with a `text` field (or
`avg` with a `select`, `json`, `lookup`, `formula`, … field) used to compile and reach
the backend; it is now refused by `compileDataset` with `DATASET_INVALID` / **400**
before any query is built. Shipped as `minor` under the repo's launch-window convention
for accept-set narrowings.

⛔ This changeset adds no rows to any table and restates none. The verdict is
`AGGREGATE_FIELD_TYPE_COMPATIBILITY`'s — the one table `@objectstack/spec` declared in
#16353 under the director ruling of decision batch #59 ("both legs, table in spec") —
read through `isAggregateCompatibleWithFieldType`.

## What was wrong

#16778 landed the compile leg SCOPED to temporal source fields, leaving "every other
non-temporal pair the table refuses" as a stated residual that had never been driven.
Driven on this card, through the real service door:

```
sum × text    the table refuses the pair   the compile leg does NOT throw   SQL IS emitted
sweep         6 aggregates × 49 field types = 294 pairs; 155 refused by the table;
              minus 6 temporal (#16778's) minus 42 `min`/`max` × the string classes;
              residual 107 — and 107 of 107 were ACCEPTED by the compile leg
control       avg × datetime / date / time → DATASET_INVALID / 400, no SQL emitted
```

The control is what makes that a reading of the tree rather than of a blind harness: the
same service, door and `sourceFieldMeta` hook sees the pairs #16778 enforces refused.

So `sum` over a `text` column reached whichever backend the object is bound to, and the
answer was a property of the dialect rather than of the data — the shape Prime Directive
#12 exists to remove, and the same shape #16778 closed for one field class.

## What it does now

- `compileDataset` judges a measure whose aggregate DERIVES a number (`sum` / `avg`)
  against the table for **every** declared field type, and refuses an unaccepted pair
  with `DATASET_INVALID` / **400** — naming the measure, the field, its declared type
  and the accepted set read off the table. Nothing reaches the driver.
- `sum` × `percent` is refused at last: the row `analytics-service.ts` has called
  "incoherent" in a comment since before the table existed. `avg` × `percent` is still
  ACCEPTED by the same table, which is what makes it a row and not a class.
- The refusal's closing prescription is now chosen by the source field's class: the
  temporal sentence #16778 measured is kept verbatim for temporal fields, and a
  non-numeric field is pointed at `count` / `count_distinct`, which accept every type
  because they read no arithmetic off a value.
- Unchanged: `derived` is covered by construction (a dataset carrying a refused base
  measure never finishes compiling), and the three "cannot answer, do not block" tiers —
  no `sourceFieldMeta`, an unresolvable field, a `relationship.field` path.

## ⚠️ Scope: the DERIVING aggregates. `min` / `max` are still not judged here

`min` / `max` SELECT one of the stored values; `sum` / `avg` DERIVE a number. This is the
line this package already draws — `measureResultType` branches on exactly that pair of
aggregates — and the defect is about a derived number, so the deriving aggregates are its
population.

The `min` / `max` rows stay with **#17513**, and that is measured rather than assumed.
Enforcing the residual whole was tried on this card: with `min` / `max` × the string
classes subtracted, **15** cases in `measure-result-type.test.ts` still went red, every
one of them on `min` × `json` — a pair the table refuses, in no ruling's scope, driven
end to end by the same shared fixture as the string rows. One dataset compiles every
measure in that fixture, so one refused pair reds the whole section. ⇒ `min` / `max` is
one question, and it is the table-amendment card's.

## Upgrading

No shipped dataset in this repository pairs `sum` or `avg` with a non-numeric field —
every one of the eleven shipped dataset measures resolves to `number`, `currency`,
`summary` or `progress`. If your own dataset declares such a pair, the refusal names the
accepted set; store the quantity as a numeric field and aggregate that, or count instead.
