---
'@objectstack/core': patch
'@objectstack/service-analytics': patch
---

A date-bucket key spells its year with four digits at every granularity, as the SQL drivers' bucket expressions do, so the in-memory and pushed-down paths key a day in 0001..0999 alike and a drill-down from such a key finds its range.

A `date` value names a year from 0001 to 9999, so these keys are reachable through a `date` field and through a stored `datetime` row. For 0050-06-15, `strftime('%Y-%m')` on SQLite and `to_char(…, 'YYYY-MM')` on PostgreSQL answer `0050-06`, while `bucketDateKey` answered `50-06`: the same `groupBy` keyed the same rows differently depending on which path ran it.

- **`@objectstack/core` `bucketDateKey`** pads the year to four digits: `0050`, `0050-Q2`, `0050-06`, `0050-06-15`, and the ISO week key `0050-W24` (early January 0050 is `0049-W52`, its ISO week-year). The engine's in-memory `groupBy` and the memory cube face delegate to it, so both now answer the drivers' key. A year from 1000 to 9999 is spelled as before.
- **`@objectstack/core` `bucketKeyToCalendarRange`** reads exactly what `bucketDateKey` writes. Its week arm checked a key against the unpadded label, so a padded key such as `0050-W01` answered `null`; it now answers `{ start: '0050-01-03', end: '0050-01-10' }`. An unpadded key (`50-06`, `49-W52`) is not a bucket key and still answers `null`.
- **`@objectstack/service-analytics`** mints the `compareTo` alignment key through `bucketDateKey` instead of spelling it locally, so a comparison row in 0001..0999 merges onto its bucket (`0050-06`) instead of being appended under `50-06`.
