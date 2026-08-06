---
"@objectstack/service-analytics": patch
---

fix(service-analytics): an ad-hoc cube's dimensions no longer depend on how the `where` was spelled (#5353)

`inferCubeFromQuery` mints a Cube for a free-form analytics query that names no
registered cube, seeding `dimensions` from the fields the query mentions — its
`measures`, `dimensions`, `timeDimensions`, and its `where`. The `where` arm was
guarded by `!Array.isArray(query.where)`, written when an array `where` was not a
filter. #5334 made it one, so from then on one filter minted two different cubes
depending on its spelling:

```
where: {stage: 'won'}          → dimensions: {stage}   ← seeded
where: [['stage','=','won']]   → dimensions: {}        ← skipped
```

The `where` is now LOWERED to its canonical `FilterCondition` before its keys are
read, so the spelling stops mattering. The lowering is the same one the
strategies already use (#5334's `parseFilterAST` call, extracted from
`normalizeAnalyticsFilterTree` as `lowerAnalyticsWhere` so there is still exactly
one of it), and the keys are read through `conjunctFieldKeys`, which descends
`$and` — necessarily, because the lowering itself introduces `$and` where the
object spelling has none: `[[a,…],[b,…]]` lowers to `{$and: [{a…},{b…}]}`. As a
result an explicit `{$and: […]}` object `where` now also seeds its conjuncts'
keys, which it never did.

`$or` / `$not` are not descended, and contribute no key on either spelling, as
before.

**No compiled statement, bound value or gate verdict changes.** Both spellings
already compiled a byte-identical predicate (which is why this shipped as an
observation rather than a defect): `resolveFieldSql` falls back to the bare
column name for an undeclared member, and `qualifyAndRegisterJoin` leaves bare
columns bare on a cube with no `joins` — which an inferred cube never has. So the
newly-declared dimensions move those members from the undeclared branch to the
declared one and both yield the same column. What does change is the suggestion
list in a rejection: `Valid filter members:` / `Valid dimensions:` now read the
same for both spellings of one filter, and `getMeta` reports the same dimension
vocabulary for both.

**Still spelling-dependent: a DOTTED `where` key.** `{'owner.region': 'NA'}`
seeds the stripped tail `region` as a base-table dimension; the array spelling
`[['owner.region','=','NA']]` seeds nothing and compiles the relation traversal.
Unifying them is #5739's call, not this change's — propagating the mint to the
array spelling turns a working traversal into a base-column filter over different
rows (and a `400 INVALID_FIELD` where the base table has no such column), while
withdrawing it from the object spelling would split a verdict #5740 deliberately
shares with the `dimensions` request key. Dotted keys therefore keep today's
per-spelling answer, pinned by tests, until #5739 rules.
