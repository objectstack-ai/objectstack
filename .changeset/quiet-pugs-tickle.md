---
'@objectstack/cli': patch
---

`os explain query` now teaches the two keys `QuerySchema` actually declares.

The entry's example and its two optional-table rows named `filters` and `sort`.
Neither is a key of `BaseQuerySchema`, which is a plain `z.object` — so both
were dropped silently: an author who copied the example got a query that parsed
clean and ran with no filter and no ordering, with nothing in the output saying
so.

Both faces now read the schema's own spellings:

- `where` — one condition **tree**, not a `Filter[]`. A field-keyed entry is a
  condition on that field (a bare value is implicit equality, an object is a map
  of `$` operators), and `$and` / `$or` / `$not` combine conditions.
- `orderBy` — sort nodes, each `{ field, order }`. The direction key is spelled
  `order`; `direction` is rejected by name.

No schema changed, and no accept set moved: the correction is to the catalog
entry only. The `os explain` catalog sweep also gains a key-retention assertion
— an example must parse **and** come back with every key it declares — so the
next entry whose schema strips a key is named instead of passing.
