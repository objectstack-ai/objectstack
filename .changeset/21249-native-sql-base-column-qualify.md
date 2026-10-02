---
"@objectstack/service-analytics": patch
---

fix(service-analytics): on the native-SQL strategy, a base-table column is qualified with its table whenever the statement joins a related object, not only when the cube declares a join

Clause-②: no

A cube that declares no join still joins a lookup's declared `reference` when a query names a relationship path through it (`owner.email`). The native-SQL strategy qualified base-table columns only for a cube that declares a join, so it wrote them bare beside the joined object. When that object declares a column of the same name, the database refused the statement as ambiguous, and `POST /api/v1/analytics/query` answered `500 DATABASE_ERROR` on SQLite and on PostgreSQL. The ObjectQL strategy answered `200` for the same query.

**Before and after**, measured on a configured cube over a `deal` object that declares no join, whose lookup `owner` points at a person object that also declares `note`, `amount`, `closed_on` and `id`:

- Dimensions `note` and `owner.email`, with or without a `where` on `note` and an `order` by it: `500` → `200`, one group per (deal note, owner email).
- A `sum` over `amount`, a `timeDimensions` window on `closed_on`, or a `where` on `id`, each grouped by `owner.email`: `500` → `200`.
- An ad-hoc query over the object, whose inferred cube never declares a join: the same.

The strategy now reads what the statement actually joins, from the one relationship-path resolver, and qualifies every base column in the select list, the grouping, the filters, the measures and the time windows. A statement that joins nothing keeps bare columns. That is now also true on a cube that declares a join when the query uses none of it: the statement it shows on `POST /api/v1/analytics/sql` reads `note` where it read `"deal"."note"`, and the answer is the same.

**Unchanged.** The ObjectQL strategy; every query on a cube that declares the join it uses; every statement that joins nothing on a cube that declares no join; the refusals.
