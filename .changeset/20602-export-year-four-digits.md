---
'@objectstack/rest': patch
---

fix(rest): `GET /api/v1/data/:object/export` writes a `date` or `datetime` cell with a four-digit year, so an export of a year from 0001 to 0999 re-imports (#20602)

Clause-②: no

A `date` of `0500-01-01` exported as `500-01-01`, and a `datetime` on that day
as `500-01-01 10:00:00` (or that day's wall clock in the business timezone), in
CSV, xlsx and JSON alike. `POST /api/v1/data/:object/import` reads a four-digit
year only, so re-importing the platform's own file refused that row as
`invalid_date`. The export now spells every `date` and `datetime` cell's day
with the storage rule the write doors use (`temporalStorageForm` from
`@objectstack/core`): `0500-01-01` and `0500-01-01 10:00:00`, which the import
reads back as the same day and instant.

**What is not affected.** Every cell in the years 1000 to 9999 exports byte for
byte as before, in every business timezone and with none. The clock of a
`datetime` cell is unchanged. A year outside 0001 to 9999, which the write
doors refuse, stays unpadded, and a `datetime` whose business-timezone day
falls in such a year now spells that year as the storage rule does (`0-12-31`,
not the era year `1-12-31`); the import refuses both spellings, as before.
