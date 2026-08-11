---
"@objectstack/driver-sql": minor
"@objectstack/driver-sqlite-wasm": minor
---

feat(driver-sql): compile `$field` to a column-to-column comparison on SQL push-down (#5222)

`FieldReferenceSchema` (`{ $field: 'other_column' }`) is declared in the spec and
genuinely PRODUCED — `compileCelToFilter` emits it whenever a CEL permission/RLS
rule compares one field to another — but its only implementation was the
in-memory evaluator. #5041 measured the consequence and installed a loud refusal
(`INVALID_FILTER` / 400, replacing a bare `TypeError` and, inside an `$in` list,
a silent zero-row answer), deliberately leaving the capability itself to this
change. Until now, therefore, one permission rule had two behaviours chosen by
whether the query reached a database.

The six scalar comparison operators — `$eq` / `$ne` / `$gt` / `$gte` / `$lt` /
`$lte`, including the array-triple authorings that lower to them — now compile
`{ $field: 'col' }` into a real column reference:

```js
{ amount: { $gt: { $field: 'budget' } } }   // → where "amount" > "budget"
```

**Nothing that worked before changes.** This is additive: every shape that
compiled still compiles identically, and the refusal gate was NARROWED, never
removed. A minor bump because a previously-400 filter now returns rows.

**The refused arm, and why each entry is there** (all keep `INVALID_FILTER` /
400):

- **Dotted paths** (`{ $field: 'account.owner_id' }`) — maintainer ruling: v1 is
  same-table columns only. No JOIN planning, no alias-qualified columns.
- **Undeclared columns**, on either side — the `$field` value lands in a SQL
  identifier position, so only fields the object declares are accepted, refused
  at COMPILE time rather than by the database. Federated/external tables
  (ADR-0015), whose column set this driver does not own, are refused wholesale.
- **The tenant-isolation column**, on either side — a privilege-escalation
  comparison surface. Closed on both sides because the operands of `=` commute.
- **Cross-class comparisons** (a number against text, a date against text) —
  SQLite orders by storage class first while the in-memory evaluator applies JS
  coercion, so the two paths genuinely disagree and neither answer can be made
  the other. Refused rather than shipped as a silent divergence.
- **`$in` / `$nin` / `$between` list members** — the in-memory evaluator does not
  resolve a reference inside a list either (`resolveValue` returns an array
  unchanged), so there is no correct semantics for SQL to be equivalent to.
- **The string operators** (`$contains`, `$startsWith`, …) — a column-side LIKE
  pattern cannot be metacharacter-escaped portably, and an unescaped one is the
  `%`-matches-every-row filter bypass.
- **The bare `{ field: { $field: 'other' } }` spelling** — what
  `parseFilterAST(['a', '=', { $field: 'b' }])` lowers to. Still refused, because
  the in-memory evaluator answers `false` for it rather than reading it as an
  equality; the refusal now names `$eq` as the spelling that compiles instead of
  falling through to a generic operator list.

**Equivalence is proven, not asserted.** A cross-path conformance suite runs each
supported shape through the in-memory evaluator AND through SQL push-down against
the same seeded rows, holding both to the same declared id list. Its fixture
carries every NULL arrangement two columns can be in — target NULL, referent
NULL, and BOTH NULL — because three-valued SQL against a two-valued JS matcher is
the one place these paths can genuinely diverge. Every emitted predicate is
therefore written TOTAL: `{ a: { $eq: { $field: 'b' } } }` matches a row where
both columns are NULL, which a plain `a = b` would drop, and `$not` over any
cross-field leaf is its exact complement.

The suite runs the full driver axis — SQLite always, live Postgres and MySQL
when the runner provisions them — and on both SQL drivers: `driver-sqlite-wasm`
inherits the compiler but executes through its own sql.js dialect, which binds
the identifier list itself. The dialect axis is not ceremony here: a cross-field
predicate is the one filter shape whose SQL carries two identifiers and no bound
value, and the class rule has a different failure per backend — comparing text to
a number is a silent wrong answer on SQLite (storage classes order before values)
but `operator does not exist: text > integer` on Postgres. The guard is what
keeps either from being reached.
