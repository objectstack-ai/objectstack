---
'@objectstack/rest': patch
---

fix(rest): an import row for a NOT NULL refusal or a unique conflict answers what the create door answers (#20701)

**`POST /api/v1/data/:object/import` and the async import job — a NOT NULL
refusal.** When the database refuses a row because a NOT NULL column has no
value (for example a field declared `storage: { notNull: true }` and not
`required`, which the engine's own check lets through), the committed row
now fails with `code: 'required'`, `field` set to the field, and the sentence
`POST /api/v1/data/:object` gives for it ("f is required"). It used to fail with
the database's own code (`SQLITE_CONSTRAINT_NOTNULL` on SQLite) and no `field`.
The create door answers `400 VALIDATION_FAILED` with a `required` finding for
the field; the row reports that finding the way it reports a `required` field
the engine refuses itself, so no database dialect's code reaches the row.

**A unique conflict.** A committed row that repeats a unique value keeps
`code: 'UNIQUE_VIOLATION'` and its `field`, and now carries the create door's
sentence, "A record with this f already exists", in place of the engine's longer
sentence (which the create door returns as `developerMessage`).

The async job's rows, read from `GET /api/v1/data/import/jobs/:jobId/results`,
change the same way. The row takes these answers from the same mapper as the
create door, as it already does for a missing database column. No key is added
to the row. The dry run still previews such rows as `ok`, because it checks the
metadata and does not judge `storage.notNull` or uniqueness.
