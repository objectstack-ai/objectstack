---
"@objectstack/cloud-connection": patch
---

`GET /api/v1/marketplace/install-local` now answers each entry's `withSampleData` for the caller's own organization. Before, after a purge in organization A, the listing read as organization B answered `withSampleData: false` while B still held every one of its seed rows.

Clause-②: no

- **What was wrong.** The listing served the install ledger's `withSampleData`, one value per install. Under an organization wall, sample data is per organization: the install, the reseed and the purge each act in the caller's active organization. A purge in A flipped the one value for every organization, and a restart kept it.
- **What it does now.** The listing reads the rows. An entry answers `true` when at least one of the package's seed rows is in the caller's scope. Rows are matched the way the purge matches them, by each dataset's `externalId`. "At least one" is exactly when the purge has something to delete, and it decides whether the console labels its reseed action "Add sample data" or "Reseed again". The purge's matching is now a separate read-only step, and the purge deletes what it returns, with the same counts and log lines as before.
- **Scope.** Under a wall, the scope is the caller's active organization. A session with no active organization reads nothing, so every entry answers `false` with `200`, and no row is read. Without a wall, the match covers the whole table, and the answer is the one the ledger records after an install, a purge and a reseed.
- **When the rows cannot be read** (for example, a package the runtime did not load), the entry answers `false`, and the server log says why at `warn`, once per entry per request.
- **The response keeps its shape.** The ledger keeps its shape too. Its `withSampleData` and `sampleDataPurged` stay as install-time records, and their docs now say they are not per organization.
