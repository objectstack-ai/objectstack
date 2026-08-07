---
'@objectstack/driver-turso': patch
---

driver-turso: remote mode answers the NULL / no-value family the way local mode does

`TursoDriver` compiles filters two different ways: local (and replica) mode
inherits `SqlDriver.applyFilterCondition`, remote mode uses
`RemoteTransport.buildWhereSQL`, an independent emitter. The NULL rulings landed
only on the first, so ONE driver gave one filter two answers depending on the
`url` it was constructed with. Measured against a fixture with two valued rows
and two no-value rows:

| filter | local | remote (before) |
|---|---|---|
| `{ d: { $ne: 'v1' } }` | rows 2,3,4 | row 2 |
| `{ d: { $nin: ['v1'] } }` | rows 2,3,4 | row 2 |
| `{ d: { $notContains: 'v1' } }` | rows 2,3,4 | row 2 |
| `{ $not: { d: 'v1' } }` | rows 2,3,4 | row 2 |
| `{ d: { $exists: 'yes' } }` | `INVALID_FILTER` | rows 1,2 |

Remote mode now matches local on all five:

- **`$not` is NULL-safe** (#5146). Each leaf of the negated condition is made
  total before the negation, so `NOT (…)` is TRUE or FALSE for every row instead
  of vanishing into SQL's UNKNOWN. A row whose column has no value does not
  satisfy the negated condition, so it IS returned.
- **`$ne`, `$nin` and `$notContains` are NULL-safe** (#5298), emitted as
  `(col IS NULL OR <test>)`. `$ne: null` is unchanged and still compiles to
  `IS NOT NULL` — polarity follows the comparand, not the operator's name — and
  no positive comparison changes shape.
- **A non-boolean `$exists` comparand is refused** with `INVALID_FILTER` / 400
  (#5369), as `$null` already was. `@objectstack/spec`'s `FieldOperatorsSchema`
  declares `$exists` as a boolean, and the emitter's `=== false` test sent every
  other value — including the truthy string `"false"` — to the `IS NOT NULL`
  side. `$exists: true` / `$exists: false` are unchanged.

Why it matters beyond a row count: a CEL `!expr` in a permission rule lowers to
`{ $not: {…} }`, so this was one RLS read scope admitting different row sets per
connection mode. The `$ne` and `$not` cases are now enrolled in the shared
`FILTER_LOGIC_CASES` conformance table, which all eleven filter backends run.

**Upgrade note:** a query that relied on remote mode silently dropping no-value
rows from a negative filter will now see them. Spell that intent explicitly —
`{ $and: [{ d: { $ne: 'v1' } }, { d: { $null: false } }] }` — which is what it
already had to be on every other backend.
