---
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(objectql,spec): `filter` folds to `where` on EVERY engine method, and `top`/`limit` joins the #3795 slot table (#4346)

The `filter` → `where` fold that #3795 settled at the protocol layer existed
at the **engine** layer in exactly one of six methods. `ObjectQL.find()`
folded it; `findOne`/`count`/`update`/`delete`/`aggregate` passed the option
bag through with `ast.where === undefined`, which every driver reads as "no
predicate" — so a caller filtering with `{ filter }` silently matched EVERY
row:

| call | before | after |
|---|---|---|
| `findOne({filter: {status:'done'}})` | first row of the table | a matching row |
| `count({filter})` | whole-table count | matching count |
| `update(data, {filter, multi:true})` | **every row rewritten** | matching rows |
| `delete({filter, multi:true})` | **table emptied** | matching rows |
| `aggregate({filter, …})` | aggregated all rows | matching rows |

This was reachable, not theoretical: the deprecated
`DataEngine{Query,Update,Delete,Count,Aggregate}OptionsSchema` contracts all
declare `filter`, `ScopedContext`/`ObjectRepository` (the cross-object API
handed to L2 hook bodies) forwards its argument verbatim, and the spec's own
hook documentation taught the broken call
(`users.findOne({ filter: { role: 'admin' } })` — now corrected to `where`).

Every engine entry point now folds through the spec's own #3795 machinery
(`RPC_QUERY_ALIAS_SLOTS` + `foldQueryAliasSlots`) instead of `find`'s
hand-rolled copy, under the #4181 rule: an alias alone folds, redundant
identical spellings collapse, DIFFERENT values for one slot throw
("Send exactly one") instead of silently picking a winner, and an explicit
`null` alias is a withdrawal.

**The sixth pair.** `top` → `limit` — the pair the #3795 scope note excluded
as "the OData layer" — joins `RPC_QUERY_ALIAS_SLOTS`. The protocol normalizer
folded it BACKWARDS (`options.limit = Number(options.top)` — the alias
overwrote the canonical key) while `engine.find` folded it canonical-wins, so
`{top: 1, limit: 3}` answered 1 over HTTP and 3 through a direct engine call.
All three readers (wire normalizer, RPC schema parse, engine) now resolve the
pair identically: `top` alone still limits, a conflicting `{top, limit}` is
refused.

Behavior change to note: option bags that previously smuggled conflicting
spellings (`{where: X, filter: Y}`, `{top: 1, limit: 3}`) are now refused
loudly on every path instead of silently resolving differently per layer.
Pinned per method, write paths included — a regression here is silent and
destructive, and the class went unnoticed precisely because `find` was the
only method anyone thought to check.
