---
"@objectstack/service-analytics": patch
---

The draft-data preview **refuses** a field constraint with zero operators (`{ name: {} }`) instead of answering it with every row, so a drafted chart no longer shows rows for a filter publish refuses outright (#19835).

`preview-evaluator.ts`'s `matchesWhere` iterated a field constraint's entries; an empty object has none, so the loop never ran and the row fell through to a MATCH. `matchesWhere({ name: 'Globex' }, { name: {} })` answered `true`. Every data driver refuses this shape (`driver-memory`, `driver-mongodb`, and `driver-sql` at the top level and inside `$and`/`$or`/`$not`), and so does this package's own `where` door, so the preview and publish gave opposite answers to the same filter.

- **Refused in the ADR-0112 `INVALID_FILTER` / 400 envelope**, through the same `invalidFilterError` the preview already uses for an operator it cannot evaluate. No new error code and no new exported symbol. The message follows the drivers' wording: it names the constraint and its position (`where.$or[1].amount`), and gives the two legal repairs (name an operator, or write a direct comparand).
- **Not answered as "matches zero rows" either.** `{ status: {} }` does not mean "no rows". Read literally it means "rows whose status is anything", and the shape is almost always an authoring accident: a filter builder that recorded a field but never its operator. Only a refusal names the constraint to repair.
- **Nesting cannot route around it.** The check walks the whole `where` before any row is read, `$and` / `$or` / `$not` arms included. So a constraint in an `$or` arm that a matching row would short-circuit past still refuses, and so does a seed draft holding zero rows.
- ⚠️ **What it costs**: a drafted chart whose filter carries `{ field: {} }` now returns `400 INVALID_FILTER` in preview, where before it rendered a number computed over every row. Fix: name the operator the constraint was meant to carry, e.g. `{ status: { $eq: 'open' } }` or `{ status: 'open' }`.
- **Unchanged**: constraints that name an operator, implicit-equality comparands, and an empty *node* (`where: {}` or `$and: [{}]`, which is the identity and not a field constraint).
