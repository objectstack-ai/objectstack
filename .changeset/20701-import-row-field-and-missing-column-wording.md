---
'@objectstack/rest': patch
---

fix(rest): an import row names the column the engine refused, and a missing database column is no longer called an unknown field (#20701)

**`POST /api/v1/data/:object/import` — a failed row names its column.** A row the
engine refuses with `INVALID_FIELD` (a column that names no field of the object)
now carries `field` with that column, on the dry run and on the commit alike. It
used to carry only `code: 'INVALID_FIELD'`, while `POST /api/v1/data/:object`
named the field for the same key. The row reads the error's own `field` when no
field-level finding names one; a field-level finding still wins. A unique
conflict row now names its column too, when the database said which column it
was, as the `409` does.

**A missing database column says what the database said.** When the database
reports that a table has no column for a field, the `400 INVALID_FIELD` answer
now reads "The database table of object 'X' has no column for field 'f'. If the
object declares 'f', its database schema has drifted from the metadata: run
'os migrate' to reconcile." It used to read "Unknown field 'f'", which was false
for a field the object declares: the engine refuses an undeclared key itself,
before the database is reached, and keeps its own "Unknown field" wording for
that case. `code`, `status`, `field` and `object` are unchanged.
