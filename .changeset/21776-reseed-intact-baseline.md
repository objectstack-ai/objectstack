---
"@objectstack/cloud-connection": minor
---

An install-local reseed over sample rows that are all still in place answers success, with the loader's `skipped` count, instead of a refusal naming a false cause (#21776).

Clause-②: yes (widening)

- **Intact baseline.** `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data`, run while every seed record the package declares is already present, answers `200 { success: true, data: { manifestId, inserted: 0, updated: 0, skipped: N, errors: 0, withSampleData: true } }`. Before, it answered `422 RESEED_NO_ROWS`, "Reseed wrote no rows. The package declares no seedable records for this runtime.", over a package that declares them. The reseed is idempotent, so a run that finds every row in place has reached its goal. The install's record of sample data is set the same way as when rows land.
- **`skipped` on every success.** A successful reseed now answers all four of the loader's counts: `inserted`, `updated`, `skipped` and `errors`. Before, `skipped` was not in the response.
- **Unchanged refusals.** `422 RESEED_NO_ROWS` still answers a run that wrote nothing because records failed, with the error count and the first error, and its `details` are still `{ inserted, updated, errors }`. It also still answers, with the same text, a run in which the loader had no record to process for this runtime: for example, every dataset is scoped to another environment (`Seed.env`). That text now states a true cause. A package with no seed dataset at all still answers `400 RESEED_SKIPPED` (`no-datasets`).
