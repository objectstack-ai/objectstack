---
"@objectstack/spec": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-memory": patch
"@objectstack/lint": patch
---

refactor(spec,drivers,lint): one implementation of the filter identity reduction (#5659)

`{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
disjunct that absorbs its `$or`, `{ $not: {} }` is FALSE. That is a ruling
(#5322/#5134) pinned for every backend by the four identity cases in
`FILTER_LOGIC_CASES` — and it was implemented four times over: `reduceFilterNode`
in `driver-sql`, the same function again in `driver-mongodb`, the
`every`/`some`/truthiness algebra of `driver-memory`'s matcher, and nearly a
fifth hand-written copy inside `@objectstack/lint`, which declined to write one
and filed this issue instead.

**New in `@objectstack/spec` (`@objectstack/spec/data`): `reduceFilterVerdict`**,
beside the case table that proves it. It answers `'true' | 'false' | 'clause'`
for a filter node and never throws on its own; each backend's own refusals — the
undeclared `$`-combinator and the `undefined` comparand in `driver-sql`, the
query-level keys and the `$null` comparand in `driver-mongodb` — are passed in as
`FilterVerdictHooks` and are invoked from exactly the positions they were invoked
from before. `reduceFilterKeyVerdict` answers the same question for one key, which
is what both SQL and MongoDB emitters consult while walking a node.

**No behaviour changes in the three drivers.** The move is mechanical: the shared
algebra replaces each private copy, the refusals stay where they were, and the
`FILTER_LOGIC_CASES` conformance suites are green on both sides of the change —
including the SQL-inheriting `driver-sqlite-wasm` and `driver-turso`.

**`@objectstack/lint` gains two warnings it was structurally blind to.** The
`multi: true` unbounded-bulk-write rule (#5482) asked "does this filter have zero
keys", so a `delete_record` bounded by `filter: { $and: [] }` or
`filter: { $or: [{}] }` — a whole-object write by the ruling every driver executes
— passed silently. It now asks the reduction, and it warns about both while
staying quiet on `{ $or: [] }` and `{ $not: {} }`, which match nothing. The
message names the shape it saw (`a filter that REDUCES TO TRUE ({"$and":[]})`)
rather than calling a non-empty filter "empty".

If you have a flow declaring a bulk write bounded by one of those two shapes, the
lint will now tell you so — the write was already unbounded at run time; only the
feedback is new.
