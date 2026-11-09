---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection): install-local's reseed and sample-data count reach an unmanaged copy, and retry a failed first load (#31425)

Clause-②: yes (widening) — `POST /api/v1/marketplace/install-local/:id/reseed-sample-data` and `GET …/:id/sample-data` now serve the base of an unmanaged copy this door made with `seedSampleData: true`, which they answered `404` before. Nothing is narrowed.
Metadata-protocol: none

- **Reseed.** For a copy, the reseed loads the sample data again from the copy's seed receipt, through the same read of it the purge uses: the rows it creates are owned by the caller, it answers the same four counts, and a run over an intact baseline succeeds with `inserted: 0`. A copy made without the sample data answers `400 RESEED_SKIPPED`, and a receipt that could not be read answers `503 SERVICE_UNAVAILABLE`, never "no sample data".
- **Retry.** A copy whose first load failed at install (`seeded.mode: 'skipped'` with `seed-receipt-unread` or `seed-error`) is loaded by the reseed from the stored receipt, instead of a re-run of the install that the import refuses `409`.
- **Count.** For a copy, the count is the rows a purge of the copy would delete now; `count: 0` for a copy made without the sample data.
- **Unchanged.** Any other base, a Studio-authored one with published seed items included, still answers `404` on all three doors. Uninstalling a copy is `DELETE /api/v1/packages/:baseId`, which drops its tables with their rows unless `keepData: true` keeps them all; this door does not purge on uninstall.
