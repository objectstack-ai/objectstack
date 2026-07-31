---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
---

fix(data): `sort` / `select` / `expand` naming a field that does not exist are rejected, not silently dropped (#4226)

The list path has four axes on which a caller names a field. `filter` was
closed over #4134 / #4164 / #4181 / #4121 — a filter the server cannot apply is
now a 400, never a 200 over the wrong rows. The other three still leaked, all
answering `200`:

```
sort=no_such_field   -> 200  CAEBD          byte-identical to "no sort at all"
select=no_such_field -> 200  <every field>   asked for one column, got all of them
expand=no_such_rel   -> 200  <no such key>   no relation, no complaint
```

Each is now refused at the shared normalizer, so `GET /data/:object`,
`GET /data/:object/:id`, `POST /data/:object/query`, the export route and the
runtime dispatcher give one answer instead of five.

- **`sort` → `400 INVALID_SORT`.** The row set is unchanged, so this is not
  #4181's "returned everything" — it is worse in one specific way: `sort` +
  `top` is how a caller asks for "the latest N", and a dropped sort makes that
  an arbitrary N that nothing in the response reveals. This is the list half of
  the bug #4181 fixed on the export route's `orderby`. `INVALID_SORT` had sat
  in the standard catalog since it was written with no emitter.
- **`select` → `400 INVALID_FIELD`.** `engine.find()` drops unknown columns
  (deliberate `SELECT *` tolerance) and then falls back to `*` when that empties
  the projection, and the two compose into `?select=<typo>` asking for ONE
  column and receiving EVERY column — a parameter whose purpose is to return
  less, failing by returning more, against both FLS and data minimisation. The
  partially-unknown case (`?select=title,no_such`) is refused on the same terms:
  half a projection is not the one that was asked for, and the tolerant reading
  would have to explain why `?status=<typo>` is a 400 and `?select=<typo>` is
  not, on one endpoint, about one field map.
- **`expand` → `400 INVALID_FIELD`.** The lightest of the three — same rows,
  same columns, the relation simply is not there — but the response cannot be
  told apart from "every foreign key is null", and the client renders raw ids
  where names belong. A name that is no field at all and a name that is a field
  holding no reference (`?expand=title`) get different messages, since the fixes
  differ.

**Sorts that were silently never applied now are.** Two wire spellings reached
the normalizer and fell through it untouched, and every driver then declined
them (`SqlDriver` guards its ORDER BY with `Array.isArray(orderBy)`): the
client SDK's own declared `orderBy: string[]`, and the `{field: direction}` map
that `GET /data/:object/export`, `GET /data/import/jobs` and objectui's calendar
all emit. Both are now folded to `SortNode[]` — so the import-job history, which
has asked for `created_at desc` since it was written and served insertion order,
sorts. A sort shape that still cannot be read (a number, an entry naming no
field, a direction that is neither `asc` nor `desc`) is `400 INVALID_SORT`
rather than a silent no-op.

**`$expand` of a `tree` field works.** `REFERENCE_VALUE_TYPES` lists `tree`
among the types whose value "points at another record … the related record
object in expanded form", and objectui requests it, but
`engine.expandRelatedRecords` tested membership with a hand-copied `!==` chain
that omitted it — so a hierarchy field came back as a raw parent id. The loop
now reads the shared spec set, which is also what the new expand gate validates
against, so the gate cannot admit a field the engine then skips.

**What changes for callers:** requests naming a non-existent field in `sort`,
`select` or `expand` now fail loudly instead of receiving an unsorted, widened
or unexpanded response. Every axis naming real fields is unaffected. The
engine's own tolerance is untouched — it guards internal callers (hooks, flows,
expand sub-reads, registry-less hosts) that never pass through this ingress,
the same tiering the object-existence and unknown-field gates already use.
