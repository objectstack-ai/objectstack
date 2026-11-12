---
'@objectstack/skills': patch
---

docs(skills): a total over a computed value is taught through a stored computed field, not a hook

Clause-②: no
Metadata-protocol: none

The skills now teach the way to a total the platform's own refusal names. A `sum`, `avg`, `min` or `max` over a `formula` field stays refused, and its fix line reads "make it a field of its return type with the same `expression` (computed and stored on write) and aggregate that". Three places said something else:

- **`objectstack-ui` → `rules/dashboards.md`, "Total over a computed value".** It told the author to store the number "user-entered, a `summary` rollup, or hook-kept", and its leave-days example kept a `number` in step with a `beforeInsert` / `beforeUpdate` hook. It now carries the refusal's sentence, and the example is a `readonly` `number` field with the formula's `expression`, summed by the same measure. A hook is code, which an author on a hosted tier may not be able to add; the field's declaration needs none.
- **`objectstack-data` → `rules/field-types.md`, the `formula` row.** "both need a stored field" now names which one: a stored field of the formula's return type with the same `expression`. That is the answer for a group key (a dataset or cube dimension) as well as for an aggregate.
- **`objectstack-ui` eval 6** (`evals/analytics-inline-vs-dataset.json`). The expected answer is the `readonly` `number` field carrying the same expression, and an answer that writes a `beforeUpdate` hook no longer passes.

**The known limit rides in the same `dashboards.md` sentence.** The engine computes such a field when a row is written, so rows that existed before the field was declared stay empty until each is written again, and a total over them reads low. `os migrate stored-expressions --apply` fills them where the operator has the database URL; a hosted tenant has no way to run a backfill yet. The skill says both halves in its own words: "existing rows stay empty until rewritten, no hosted backfill yet".

The "Computed column" bullet of `dashboards.md` also drops its aside "not a hook-kept number": the `duration` measure it prescribes is unchanged.

No skill grows: `dashboards.md` and `field-types.md` stay at their token ceilings and their line counts. Nothing an author writes is accepted or refused differently.
