---
'@objectstack/rest': patch
---

fix(rest): an import row for a missing database column answers what the create door answers (#20701)

**`POST /api/v1/data/:object/import` and the async import job.** When an object
declares a field whose database column is missing (the schema has drifted from
the metadata), a committed row that writes that field now fails with
`code: 'INVALID_FIELD'`, `field` set to the field, and the sentence
`POST /api/v1/data/:object` gives for the same key: "The database table of
object 'X' has no column for field 'f'. If the object declares 'f', its database
schema has drifted from the metadata: run 'os migrate' to reconcile." It used to
fail with the database's own code and text (for example `SQLITE_ERROR` and
`table X has no column named f`) and no `field`. The async job's rows, read from
`GET /api/v1/data/import/jobs/:jobId/results`, change the same way.

The row now classifies a write error through the same mapper as the create door,
and takes that answer when it is `INVALID_FIELD`. The dry run still cannot see a missing column,
because it checks the metadata and not the table, so it previews such a row as
`ok`.
