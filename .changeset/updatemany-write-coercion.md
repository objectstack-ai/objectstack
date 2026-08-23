---
"@objectstack/driver-sql": patch
---

fix(driver-sql): route `updateMany()`'s payload through `formatInput` / `applyWriteColumnMap` (#11223)

`updateMany()` was the only write door in `sql-driver.ts` that passed the caller's `data`
straight to `builder.update(data)`. Every other one — `create`, `update`, `bulkCreate`,
`upsert`, `rotatedUpdateById` — applies `applyWriteColumnMap(object, formatInput(object, data))`
first, and the WHERE side of the very same bulk statement was already being translated by
`applyFilters`. Measured on SQLite, live PostgreSQL 16.13 and live MySQL 8.0.46:

- **`json` and `Field.multiple` values were refused.** Nothing stringified the structured
  value for the bind, so each dialect refused it in its own voice: `22P02 invalid input
  syntax for type json` on Postgres, `SQLite3 can only bind numbers, strings, bigints,
  buffers, and null` on SQLite, and on MySQL the array expanded into the SET list itself
  (``set `tags` = 'y', 'z'``) — a syntax error rather than a bind error. `update()` wrote
  the identical values correctly in the same run.
- **A federated `external.columnMap` object's bulk update named a column that does not
  exist.** The WHERE was mapped and the SET was not, in one statement:
  ``update `legacy_p` set `name` = 'Bulk' where `full_name` = 'Renamed'`` → `no such
  column: name`. The door was unusable on every remapped external object.
- **Temporal values were stored verbatim**, silently. On SQLite a zone-naive
  `'2026-05-06 07:08:09'` landed as-is — the pre-#3912 storage form
  `needsLegacyDatetimeRepair` exists to repair on read, written into a column
  `canonicalDatetimeFields` had already certified as canonical and therefore stopped
  repairing. Measured end to end: a range filter over that calendar day returned only the
  `update()`-written row, with the bulk-written row on disk carrying the right day and
  invisible to the query. On live Postgres the same literal was resolved in the **server's**
  timezone rather than UTC — `2026-05-06 07:08:09` stored as `2026-05-05T23:08:09.000Z`, a
  silent 8-hour instant shift on an `Asia/Shanghai` server. `Field.date` and `Field.time`
  were affected the same way: stored verbatim on SQLite, refused outright on the live
  dialects.

The literal `'NOW()'` token now resolves on this door as it does on every other one; it
previously stored the four-character string `"NOW()"` into a datetime column on SQLite and
was refused by MySQL.

#11176's `updated_at` stamping is unchanged in effect — the stamping decision now reads the
formatted payload, matching `update()` and `rotatedUpdateById`, and the stamp is still
applied afterwards as the literal post-map column name.
