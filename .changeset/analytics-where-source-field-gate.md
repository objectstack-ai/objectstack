---
"@objectstack/service-analytics": patch
---

fix(service-analytics): an analytics `where` over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5669)

`ensureCube` carried two source-field gates — `assertMeasureFields` (#4437,
`param: 'measures'`) and `assertDimensionFields` (#5520,
`param: 'dimensions' | 'timeDimensions'`) — and none for the filter face, the
request key most likely to carry a hand-typed field name. A `where` naming a
field the object does not have compiled straight into the statement and came
back as a driver error with no envelope:

```
POST /analytics/query {"cube":"crm_account","measures":["count"],"where":{"bogus_col":"x"}}
→ SELECT COUNT(*) AS "count" FROM "crm_account" WHERE bogus_col = $1
→ 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

# the control group on the same route, already fixed by #4437 / #5520
POST /analytics/query {"cube":"crm_account","measures":["count"],"dimensions":["bogus_dim"]}
→ 400 {"code":"INVALID_FIELD","message":"Dimension 'bogus_dim' … "}
```

A driver error class as the caller's `error.code` for a caller-shaped mistake is
the ADR-0112 fault #4437 was filed about; the `/data` route has answered the same
typo with a field-naming 400 since #4315/#4254.

**The gate.** `ensureCube` now runs `assertWhereFields` after the other two on
every path, so a filter whose source column the backing object does not have is
refused **before** any SQL is built, with the same envelope its two siblings
use: `INVALID_FIELD` / 400 plus `field` / `object` / `param: 'where'`, and a
message naming the field, the valid filter members and the object's known field
list. `query`, `generateSql` and `queryDataset` (both `runtimeFilter` and a
dataset's own declared `filter`) are covered, and a rejected query leaves
nothing behind in the cube registry. `/analytics/dataset/query` needed no
change: #5352's envelope branch already carries a coded 4xx through, which the
new REST-face test pins end to end.

**Field names come from the SQL producer's own reader.** The members are
collected through `normalizeAnalyticsFilterTree` + `collectFilterLeaves` — the
same pair both strategies call to build the predicate — rather than by walking
the raw `where` object. So `$and`/`$or`/`$not` nesting, `$`-prefixed operator
keys, `$between` lowering, the `{owner: {region: 'NA'}}` → `owner.region`
flattening and the #5334 array spelling are all read exactly as they will be
compiled, in one place, instead of in a second walker that could drift from it.

**What deliberately did not change:**

- Filtering on a REAL field the cube never declared (`where: {phone: '555'}`)
  still works — the gate asks "does the *object* have this field", never "did the
  cube declare it".
- A filter member resolves through `cube.dimensions` **and** `cube.measures`,
  which is what the strategies do: a cube declaring
  `measures.revenue = {sql: 'annual_revenue'}` still answers
  `where: {revenue: {$gt: 100}}` as `annual_revenue > ?`.
- A declared member is followed to its real column, so a dimension `assessed`
  over column `assessed_at` is not judged by its own name.
- `id` / `created_at` / `updated_at` stay admitted unconditionally, matching the
  data path's `resolveQueryFields`.
- An expression `sql` (on the cube or on a member), a dotted relation traversal,
  and a host that wires no field-name probe are all stood down on, exactly as the
  measure and dimension gates stand down.
- The `INVALID_FILTER` family is untouched. A `where` the normalizer refuses
  outright — an unknown operator, a zero-operator field constraint, an
  unlowerable filter array — is *not* judged here: the gate stands down and the
  refusal stays where it already happens (#5352 / #5367's geography). A field
  gate that cannot read the tree has nothing to say about it, and pulling those
  refusals forward would also have newly refused them on the draft-preview path,
  whose matcher never consults the normalizer.
