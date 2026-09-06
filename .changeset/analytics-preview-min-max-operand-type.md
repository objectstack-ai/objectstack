---
"@objectstack/service-analytics": minor
---

A draft-preview `min`/`max` answers the operand's own type instead of `0`, and a preview dimension column is described by its own type

`POST /api/v1/analytics/dataset/query` has two producers of one response: the engine, and — when the request renders the as-if-published world over a pending seed draft (ADR-0037 P3) — `evaluateAnalyticsQueryOverRows`. The second one coerced every aggregate operand with `Number()` and dropped the non-finite ones, so a `min` / `max` over a non-numeric field answered `0`. Measured on one dataset and one row set, with two services differing only in whether a pending seed draft exists:

```
live     {"category":"travel","latest_spend":"2026-05-12"}
preview  {"category":"travel","latest_spend":0}
```

That is not a mislabelled column: it is a different, wrong answer to the same query, with no refusal and no warning, on the path an author is looking at *while* authoring the dataset.

What changed, per member of the closed `AggregationFunction` vocabulary:

- **`min` / `max` return the winning operand in its own type.** Ordering goes through this file's shared `compare` — so an ISO date orders as a date, a BSON `Date` orders as its instant against wire text, and text orders the way `MIN(text_col)` does on a SQL face — with a numeric arm so a numeric column written as text (`'800'`) still orders numerically. `cross-object-rebucket.ts` settled the identical question for the recombination path: the value these two pick is a value OF the column, so it must come back in the shape the row carried.
- **A group whose operand is null throughout answers `null`, not `0`** — `emptyGroupValueFor` (`@objectstack/spec/data`) rules `min` / `max` over nothing unanswerable, and `0` reads as a measurement nobody made.
- **`count_distinct` answers a cardinality again.** Its arm was spelled `countDistinct`, a word no producer mints (`dataset-compiler` copies the spec's `count_distinct` through), so it was unreachable and the measure fell to the numeric default — answering a row count under the author's `count_distinct` name (measured: `3` where the live path says `2`).
- **`count` stays a row count and `sum` / `avg` stay arithmetic.** Counting dates is still counting.
- **`sum` / `avg` over a TEMPORAL operand is deliberately unchanged.** There is no defined answer — the SQL faces do not agree on one either — and refusing an incoherent aggregate/field-type pair is an open decision, not this fix's to invent.
- **A dimension column is typed from the cube dimension**, the same expression both live producers use (`d?.type || 'string'`), so a `date` dataset dimension is `time` on the preview path as it already was on the live one. A MEASURE column keeps the `number` every producer mints; correcting that is the ADR-0021 descriptor pass's one rule, not a second copy here.

Derived measures are untouched: `computeDerived` still coerces with `Number()` and answers `null` for a non-finite operand — but a derived ratio over a temporal `min` / `max` now sees a date instead of the spurious `0`, so it answers `null` on the preview path exactly as it already did on the live one.
