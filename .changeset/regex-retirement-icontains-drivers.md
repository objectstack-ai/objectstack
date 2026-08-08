---
"@objectstack/driver-sql": minor
"@objectstack/driver-sqlite-wasm": minor
"@objectstack/driver-turso": minor
"@objectstack/driver-memory": minor
"@objectstack/driver-mongodb": minor
"@objectstack/objectql": minor
---

feat(drivers,objectql): `$regex` / `$options` are refused everywhere, and `$icontains` is implemented on the SQL family (#5702)

The driver half of the #4706 ruling. #5701 landed the contract (the vocabulary,
the `RETIRED_FILTER_OPERATORS` prescriptions, the shared text case-set) and
#5710 flipped the last live producer — `plugin-auth`'s ObjectQL adapter, which
emitted `$regex` on the authentication path — so the refusal can now land
without breaking sign-in.

**BREAKING for anyone writing `$regex` or `$options` in a filter.** Both are
refused on every backend with `INVALID_FILTER` / 400 and a message that names
the replacement. `$regex` was never a declared operator: `driver-sql` compiled
it to a LIKE-escaped substring (so `a.b` matched only the literal `a.b`),
`driver-memory` ran it as a real `RegExp` (so the same filter also matched
`axb`, and an *invalid* pattern was caught and answered `false` — zero rows, in
silence), and `objectql`'s `having` did the same. Write `$icontains` for the
case-insensitive substring search this was almost always used for, `$contains`
for a case-sensitive one; a pattern that genuinely needs a regex has no
filter-level replacement.

**`$icontains` now runs on the SQL family** — `driver-sql`, `driver-sqlite-wasm`,
and both of `driver-turso`'s transports (the remote one does not go through
knex, so it needed its own). It compiles to `LOWER(col) LIKE LOWER(?) ESCAPE ?`
through the same `applyLike` / `pushLike` that carries the `%` / `_` / `\`
escaping, as a `fold` parameter rather than a second emitter — a copied emitter
is where the escape class would have been dropped, and an unescaped `%` matches
every row. An empty or non-string comparand is refused on the validating walk
(an empty one matches every row, which widens rather than narrows). On SQLite
`lower()` folds ASCII only, which IS the contract (#4706 Q1 = A): `$icontains:
'café'` does not match `CAFÉ`.

<!-- adr-0087: registered filter-regex-options-retired -->

`driver-mongodb`'s unknown-operator arm was throwing a bare `Error` with no
`code` and no `status`, three lines from the helper in its own file that sets
`INVALID_FILTER` / 400 — a 500-shaped body for a 400-class client mistake. It
now speaks the same envelope as its three siblings.

Two parts of the ruling are deliberately NOT in this change and stay tracked in
`scripts/check-driver-conformance.mjs`'s ledger: the `$contains` family's
case-sensitivity (#4706 Q2 = A) needs SQLite's `LIKE` replaced by a case-exact
construct in the driver, the RLS lowering and the analytics lowering together,
or one permission rule compiles to two row sets (#6518); and `$icontains` on the
JS evaluation faces needs the spec vocabulary to take the operator, which cannot
happen before `driver-memory` has an arm for it (#6520).
