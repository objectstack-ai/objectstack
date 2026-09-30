---
'@objectstack/rest': patch
---

fix(rest): `GET /api/v1/data/:object/export` writes a `date` or `datetime` cell with a four-digit year, so an export of a year from 0001 to 0999 re-imports (#20602)

Clause-②: no

A `date` of `0500-01-01` exported as `500-01-01`, in CSV, xlsx and JSON alike,
and so did the day of a `datetime` cell whose business-timezone day fell before
year 1000: the instant `1000-01-01T02:00:00.000Z` exported in America/New_York
as `999-12-31 21:03:58`. `POST /api/v1/data/:object/import` reads a four-digit
year only, so re-importing the platform's own file refused that row as
`invalid_date`. The export now spells every `date` and `datetime` cell's day
with the storage rule the write doors use (`temporalStorageForm` from
`@objectstack/core`): `0500-01-01` and `0999-12-31 21:03:58`, which the import
reads back as the same day and the same instant.

**What is not affected.** Every cell whose day falls in the years 1000 to 9999
exports byte for byte as before, in every business timezone and with none. The
clock of a `datetime` cell is unchanged. A `datetime` stored before year 1000,
which the write doors now refuse, exports with a padded year as well, and the
import refuses it as `invalid_date`, as the write doors do. A year outside 0001
to 9999 stays unpadded, and a `datetime` whose business-timezone day falls in
such a year now spells that year as the storage rule does (`0-12-31`, not the
era year `1-12-31`); the import refuses both spellings, as before.
