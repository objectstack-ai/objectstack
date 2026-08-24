---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `introspectUniqueConstraints` reports single-column uniqueness on all three dialects (#11202)

`SqlDriver.introspectUniqueConstraints` returns a flat `string[]` that
`introspectSchema` folds into a per-column `isUnique` flag, and the three dialect arms
disagreed about what that list meant. SQLite pushed a column only when the unique index
had exactly one column; the Postgres and MySQL arms returned **every member of every
composite constraint**. So for `UNIQUE (a, b)` the same table read through Postgres
claimed `a` alone is unique *and* `b` alone is unique — a claim the constraint does not
make — while through SQLite it claimed neither.

The divergence was latent rather than active until recently: the Postgres arm's query
selected `c.column_name` with no alias `c` in scope, and the bare `catch {}` the method
carried until #11161 turned every execution into `[]`. Live Postgres had therefore never
once reported a unique constraint through this method. Repairing that query is what put
three dialects into conflict on live systems for the first time.

Per maintainer ruling 2026-08-23 (option A→B), the flag is now narrowed to
**single-column uniqueness only**: a column is reported iff some unique constraint covers
that column and nothing else. A composite constraint's members are deliberately absent —
a per-column boolean is structurally unable to say "a and b are unique *together*", so
setting it on both members asserts something different and false. Representing composite
constraints is option B and waits for real demand; until it exists, an absent flag on a
composite member means "not single-column unique", never "no constraint".

All three arms now normalise their rows to a `UniqueConstraintMember` and decide through
one predicate, so a fourth dialect cannot quietly acquire a fourth meaning. The Postgres
arm additionally selects `constraint_schema` and keys constraint identity on
`(schema, name)`: its answer spans `current_schemas(false)` and Postgres auto-names a
unique constraint after the table and column, so two same-named tables in two schemas
produce two different constraints under one name — keyed on the name alone they would
fuse into an apparent two-member constraint and drop a genuinely single-column unique
(the #11201 defect class, one method over).

Two smaller corrections ride the same rewrite, both in the SQLite arm's handling of
`PRAGMA index_info` rows: an expression-index term (`… ON t (lower(a))`) reports
`name: null`, which the arm used to push into a `string[]` as a literal `null` — it is
now discarded, while still counting toward the index's width so `(d, lower(e))` cannot
read as single-column; and the returned columns are de-duplicated, so a column carrying
both a `UNIQUE` clause and a hand-made unique index is named once.

No interface shape and no accepted input changes, and `isUnique` is only ever *set* to
`true`, so a column that stops being flagged carries `undefined` exactly as an
unconstrained column always has. The one in-tree consumer is
`introspectedSchemaToObjects` in `@objectstack/objectql`, which turns the flag into a
drafted field's `unique: true` — it is the direct beneficiary: composite members no
longer draft fields declaring a single-column uniqueness the database never enforced.

Verified on embedded SQLite, including the consumer-visible `introspectSchema` fold; the
live Postgres and MySQL cells are declared through the shared dialect matrix and run in
the `Temporal Conformance (live PG + MySQL)` job. The narrowing predicate is pinned
directly against each dialect's real row shape, so the Postgres and MySQL decision is
measurable without a provisioned server. Reverse-verified by ablation: with the width
filter removed, 9 of the new pins fail — the Postgres and MySQL row-shape cases, the
end-to-end SQLite cell, and the `isUnique` fold.
