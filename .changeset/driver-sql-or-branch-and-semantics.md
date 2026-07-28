---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `$or` branches AND their own contents again — every `$or` filter was widened

`applyFilterCondition` passed `logicalOp='or'` *into* each `$or` branch's
recursive call. That flag is meant to decide only how a branch attaches to its
parent builder, but inside the branch it also selected `orWhere` for the
branch's own contents. So a branch's field keys — and the operators of a single
field — OR-ed each other instead of AND-ing:

| Filter | Compiled to | Should be |
|---|---|---|
| `{$or:[{a:'x', b:'y'}]}` | `a = 'x' OR b = 'y'` | `a = 'x' AND b = 'y'` |
| `{$or:[{d:{$gte:X, $lt:Y}}]}` | `d >= X OR d < Y` | `d >= X AND d < Y` |
| `{$or:[{$and:[A,B]}, {c,d}]}` | `(A AND B) OR c OR d` | `(A AND B) OR (c AND d)` |

The Filter Protocol rule this breaks is Mongo's: **everything inside one filter
object is AND-ed, at every depth.** A `$or` array OR-s its *branches*; it does
not change how the contents *within* a branch combine.

Every miscompile widens the result set, never narrows it, so affected queries
returned **more** rows than the filter allowed. Two shapes to re-check in your
own metadata after upgrading:

- **Scoping filters** that pair a discriminator with an id list per branch —
  `{$or:[{parent_object, parent_id:{$in:[…]}}, …]}` and similar — were not
  holding the pairing. Where such a filter decides visibility, it was returning
  rows outside the intended scope.
- **Sharing-rule `criteria_json`** containing a `$or` whose branches carry more
  than one key (what a "match ANY of these groups" criteria builder emits). That
  path *writes* `sys_record_share` grants, so any over-match materialized
  durable grants that outlive this fix — **re-reconcile those rules after
  upgrading**; the driver fix alone does not retract grants already written.

Also affected: the abutting `$gte`/`$lt` window pattern the automation docs and
CLI flow linter recommend for scheduled flows. Each tier degenerated to
`d >= lo OR d < hi`, which matches every row, so multi-tier reminder flows fired
on the whole table instead of one window.

`driver-sql` was the sole divergent backend — `driver-memory`,
`driver-mongodb`, the analytics `read-scope-sql` compiler and the write-side
`matchesFilterCondition` evaluator all already AND-ed per node. Conformance
tests now pin the same shapes across the three in-repo evaluators so they cannot
drift apart again. `driver-sqlite-wasm` inherits the fix (it extends
`SqlDriver`); Postgres, MySQL, SQLite and sqlite-wasm were all affected.

The `$and` arm also now honors `logicalOp`, as `$or`/`$not` already did. Nothing
reaches it with `'or'` once the propagation above is fixed, but the two changes
are only correct together — leaving one combinator deaf to the flag is how the
rules drifted apart in the first place.
