---
'@objectstack/driver-sql': patch
---

A bare comparand nested under `$and` / `$or` / `$not` now gets the same compilation and the same refusal it gets at top level

A filter with no operator anywhere compiles through one loop; any other filter (a
combinator, or a single sibling key carrying an operator) compiles through
`applyFilterCondition`. That second path handled a bare `{ field: value }` leaf in
two ways the first one did not:

- **An array in the equality slot was not refused.** `{ tags: ['a'] }` at top level
  answers `INVALID_FILTER` / 400, but under `$and` / `$or` / `$not`, or beside an
  operator-carrying sibling (`{ tags: ['a'], name: { $ne: 'x' } }`), it was bound as
  it stood. SQLite refused the bind, so the caller got a 500 `DATABASE_ERROR` for a
  filter it can fix. Postgres bound the array as its array-literal text (`{"a"}`)
  and silently returned the wrong rows. Every such leaf now gets the top-level
  refusal: the same code, status, message and server-side diagnostic.
- **A `Date` comparand was dropped, and a binary one was refused or dropped.** That
  path treated any non-array object as an operator map. A `Date` has no entries, so
  `{ $and: [{ closed_at: someDate }] }` emitted no predicate for the leaf and
  answered every row on SQLite and Postgres, while `{ closed_at: someDate }`
  answered the matching rows. A non-empty binary comparand (`Buffer` / `Uint8Array`)
  had its byte indices read as operator names, so it was refused with
  `INVALID_FILTER` / 400 `Unsupported filter operator "0"`, although the same leaf
  at top level compiles. An empty one was dropped like the `Date`. Only a plain
  object is now read as an operator map (the same test the filter-validating walk
  already uses), so all of these compile as the equality they are at top level.
  The `$not` NULL guard now reads a comparand the same way, so a binary comparand
  under `$not` returns the rows whose column is NULL, as every other negated
  equality does; an empty one used to get no guard at all.

Valid filters are unchanged. A scalar leaf in any of these positions compiles to
byte-identical SQL, and the new suite pins that SQL against the output captured
before the fix. Neither shape is stopped before the driver today: `parseFilterAST`
and the engine's object-form comparand walk both pass the array leaf through, and
the engine's walk also keeps a `Date` leaf a `Date`. Both refuse a binary
comparand in every position, so the binary half reaches direct driver callers only.
