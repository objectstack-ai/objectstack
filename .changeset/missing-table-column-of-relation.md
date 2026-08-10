---
"@objectstack/metadata": patch
---

fix(metadata): `isMissingTableError` no longer reads Postgres' write-path missing-COLUMN message as a missing TABLE (#6347)

`isMissingTableError` is the single predicate that licenses a caller to treat a
failed read as "the table is not provisioned yet, so there are genuinely no
rows". Its own docblock names `column "x" does not exist` (SQLSTATE 42703) as a
real failure that must stay loud — "a case where 'start numbering at 1' would be
the wrong answer against a table that may be full of rows" — and the code did
not honour that, in one direction only.

Postgres has **two** missing-column phrasings:

| path | message | judged |
|:---|:---|:---|
| read (`SELECT`) | `column "bogus" does not exist` | correctly NOT a missing table |
| write (`INSERT`/`UPDATE`/`ALTER`) | `column "label" of relation "sys_team" does not exist` | **wrongly** a missing table |

The write-path phrase contains a complete, legal missing-table phrase —
`relation "sys_team" does not exist` — as a substring, so the table-scoped
message test matched it. The code channel did not rescue it either: the matcher
is a sequential OR, so an error carrying `code: '42703'` falls past both code
lines and is decided by its message. The same superstring covers every other
sub-object of a relation Postgres phrases this way, e.g.
`constraint "uq_x" of relation "sys_team" does not exist` (42704).

A message regex can never exclude a superstring, so the repair is a
**front-exclusion** evaluated before any positive test: the column-level
SQLSTATEs the docblock already names (`42703`, `42704`, `3D000`) and the
`"x" of relation "y"` sub-object phrasing. Recognising one ends the question
with `false` — it does not descend into `cause`, because an error that
identifies as "a column of an existing relation" is that error whatever it
wraps.

What changes for you: a driver error of that shape now propagates instead of
being silenced. Every consumer of the predicate is affected the same way, and
all of them get louder rather than quieter — `DatabaseLoader.nextEventSeq` and
`SysMetadataRepository`'s history counters no longer restart `event_seq` at 1,
`ObjectQLEngine`'s autonumber seed no longer reseeds from 0, and the metadata
loaders no longer answer "nothing declared". The set of errors judged benign
shrinks; nothing that was loud becomes quiet. Genuine missing-table detection is
unchanged for PostgreSQL, MySQL/MariaDB and the SQLite family.
