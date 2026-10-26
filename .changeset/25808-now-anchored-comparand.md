---
'@objectstack/spec': minor
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-mongodb': patch
'@objectstack/formula': patch
'@objectstack/service-analytics': patch
---

feat(spec,core,objectql,driver-sql,formula,driver-mongodb,service-analytics): a filter compares a datetime column against now shifted by whole days held on the record (`{ $now: true, addDays }`)

Clause-②: yes (widening)
Metadata-protocol: added
Ruling-ref: 6415710193

An analytics dataset could not say "opened longer ago than this ticket's own SLA": the comparand grammar had a `{ $field, addDays }` pair for two columns of the record and `{N_days_ago}` placeholders for a fixed number of days, but nothing that anchored at the current instant and read the number of days off the row. Authors fell back to a literal day count, which drifts from every record whose SLA differs.

`FilterCondition` gains a now-anchored comparand, legal exactly where a `{ $field }` reference is — as the whole comparand of `$eq` / `$ne` / `$gt` / `$gte` / `$lt` / `$lte`, on a `date` or `datetime` column:

```ts
// opened more than review_sla_days_offset days ago — the column holds NEGATIVE days
{ opened_at: { $lt: { $now: true, addDays: { $field: 'review_sla_days_offset' } } } }
// on or after thirty days ago
{ closed_on: { $gte: { $now: true, addDays: -30 } } }
```

- **`@objectstack/spec`.** `NowAnchorSchema` (`data/filter.zod.ts`): `$now` is the literal `true`, `addDays` is REQUIRED — an integer of any sign or a `{ $field }` reference to a numeric column of the same record, the `addDays` grammar `FieldReferenceSchema` already carries; there is no `subDays`, and the unshifted instant stays the `{now}` placeholder. The `FilterCondition` door refuses a malformed anchor in the anchor's own words, and an anchor as an `$in` / `$nin` member or a `$between` endpoint by name, as it refuses a reference there. `filter.mdx` and the authorable surface document the shape.
- **`@objectstack/core`.** `resolveFilterTokens` pins `$now` to the tree's one instant (the `now` every `{N_days_ago}` in the tree resolves from), as an ISO string, so every executor sees `{ $now: '<ISO>', addDays }`; an anchor without `addDays` is `INVALID_FILTER` / 400 there.
- **`@objectstack/driver-sql`.** SQL push-down compiles the anchor on SQLite, PostgreSQL and MySQL through the `addDays` arithmetic (`crossFieldOffsetExpr`), with the instant bound in the target column's storage form: a `datetime` column keeps the time of day, a `date` column meets the instant's UTC calendar day. A NULL offset column is zero days (`coalesce`). The predicate is total: an ordering and `$eq` need the target to have a value, `$ne` holds when it has none or differs, so `$not` takes exactly the complement. The offset column is held to the same-table rules the `addDays` pair's is (declared, numeric, same table, never the tenant-isolation column); a non-temporal target, a malformed anchor and every other position are refused with the operands withheld from the message and the diagnostic in the server log.
- **`@objectstack/formula`.** `matchesFilterCondition` resolves the anchor in the form of the stored value it meets (a calendar day stays a calendar day), so the memory path answers the SQL path's rows; `$now: true` reads the evaluator's clock for a caller with no resolver seam.
- **`@objectstack/objectql`.** `aggregations[i].filter` and `having` judge the anchor by `where`'s rules (temporal target, declared numeric offset) before any row is read, and evaluate it per row through the formula evaluator.
- **`@objectstack/service-analytics`.** `NativeSQLStrategy` declines a query carrying an anchor, as it declines a `{ $field }` comparand, so a dataset filter or measure filter routes to the engine path where the driver compiles it; a dataset's authored `$now: true` is pinned by the service's own token seam.
- **`@objectstack/driver-mongodb`.** Refuses the anchor in every position (`INVALID_FILTER` / 400) rather than translating it as a literal sub-document.

Pinned on the drivers' cross-field conformance corpus (`CROSS_FIELD_NOW_CASES` / `CROSS_FIELD_NOW_REFUSALS`, exported from `@objectstack/driver-sql`) on both execution paths, and on the analytics dataset shape the ruling was made for.
