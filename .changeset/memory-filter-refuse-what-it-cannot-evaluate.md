---
"@objectstack/driver-memory": patch
---

fix(driver-memory): the live query path refuses the filters it cannot evaluate, and compiles the one it must (#5324, #5328)

**This is an observable behaviour change.** Two filter shapes that used to be
answered *silently* now raise the catalogued `INVALID_FILTER` / 400 every other
filter refusal in this driver and in `driver-sql` already speaks (ADR-0112):

| filter | before | now |
|---|---|---|
| an operator outside the Filter Protocol — `{ name: { $sounds_like: 'x' } }`, `$elemMatch`, `$size`, `$where`, field-level `$not`, … | handed to mingo, which threw a `MingoError` carrying **no `code` and no `status`** — served as a 500-shaped `{ error }` body | `INVALID_FILTER` / 400, naming the operator, the field and its position |
| a `$between` whose comparand is not `[min, max]` — `{ score: { $between: 5 } }` | the arm was skipped, the constraint **vanished**, and `find` returned `[]` | `INVALID_FILTER` / 400, wording aligned with `driver-sql`'s |

Two more shapes join them, same cause: an undeclared `$`-combinator in a node
position (`{ $nor: … }`, `{ $where: … }` — `FilterConditionSchema` declares
`$and`/`$or`/`$not` and nothing else), and a combinator operand that is not a
filter condition (`{ $or: 'x' }`, `{ $or: [null] }`, `{ $not: 'x' }`).

If a query of yours starts returning a 400, it was already broken — it was
returning an empty result set or an uncoded 500 for the same input, and
`driver-sql` was rejecting it. The message names the operator and the path
(`filter.$or[1].$and[0].stage`).

**`$not` is the opposite change: it now works.** `$not` is a declared combinator
(`LOGICAL_OPERATORS`), `cel-to-filter` emits it for every CEL `!expr` in an RLS
read scope, and `driver-sql` / `driver-mongodb` / this package's own reference
matcher all implement it — but the live query path passed it to mingo, and
MongoDB has no document-level `$not`, so **every query carrying a negated scope
threw** `unknown top level operator: $not`. It is compiled to `$nor` with one
operand, the same rewrite `driver-mongodb` performs, which is NULL-safe by
construction and therefore lands on the answer #5146 ruled canonical.

Both of this package's filter faces — the live mingo path and the reference
matcher — now share ONE shape gate, so they cannot answer one filter
differently again. They did: given a malformed `$between` the live path returned
NO rows while the matcher returned EVERY row.

The conformance gap that hid all of this is closed too. `FILTER_LOGIC_CASES`
was run against this backend through the reference matcher only — the driver
does not call it — so the table's `$not` case had been green for as long as it
existed while the same filter through `InMemoryDriver.find` threw. The table now
runs through the real driver, as it does for the other three backends.

Accepted operators are the spec's `FILTER_OPERATORS`, plus `$regex` (produced by
plugin-auth's ObjectQL adapter, compiled by `driver-sql`) and its `$options`
companion. `$options` is a modifier, not a predicate: on its own, with no
`$regex` beside it, it is refused like any other filter this driver cannot
evaluate — it used to raise the same uncoded engine error on the live path and
match every row in the matcher.
