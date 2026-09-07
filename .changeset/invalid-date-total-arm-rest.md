---
'@objectstack/rest': patch
---

Serve an Invalid `Date` from a driver as visible text instead of raising `RangeError` in the import-job DTO and the CSV export.

`canonicalIsoStamp` and `formatCsvCell` both reached `value.toISOString()` for any `Date`, and that call raises `RangeError: Invalid time value` for the one `Date` whose time value is `NaN` — so one bad timestamp column answered **500** on `GET /api/v1/data/import/jobs/:jobId` and aborted a CSV export mid-stream.

The shape is measured: mysql2 3.23.1 returns a module constant literally named `INVALID_DATE` for a zero `DATETIME`, and postgres-date 1.0.7 builds `new Date(NaN)` for every year in 275760..294276, a range Postgres itself stores.

Both arms now guard on `Number.isNaN(value.getTime())` and render the visible text `"Invalid Date"` — the rendering the spelling they replaced produced. Both are read by a human, and the declared contracts allow it: the four import-job stamps are plain `z.string()` (not `z.string().datetime()`), and a CSV cell has no schema at all. The operator sees a wrong-looking field they can report, rather than an error naming no row.

The CSV arm needs its own guard rather than a fall-through, because the branch below it is `JSON.stringify` and `Date.prototype.toJSON` answers `null` for an Invalid `Date` — the silent blank this change exists to avoid. Both CSV paths land on the guarded arm: with field metadata, `formatDate` rejects an Invalid `Date` and passes the value through unchanged.
