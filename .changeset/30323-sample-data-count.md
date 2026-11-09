---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection): `GET /api/v1/marketplace/install-local/:manifestId/sample-data` answers how many of an installed app's sample records a purge would delete now

Clause-②: yes (widening)
Metadata-protocol: none

- **New read-only route.** `GET /api/v1/marketplace/install-local/:manifestId/sample-data` answers `{ success: true, data: { manifestId, count, unidentified } }`. `count` is the number of rows `POST …/purge-sample-data` would delete if it ran now, found by the purge's own matcher with nothing deleted. A record a user added is not counted, and neither is a sample record whose key field (its dataset's `externalId`) was edited, because the purge deletes neither. A sample record edited only in other fields is still a sample row: the purge deletes it and the count includes it. `unidentified` counts the sample records the purge would report in `errors` and leave in place (no usable key value, or a key two rows carry). Before this, the count was known only from the install answer's `data.seeded`, so after a reload no API could say how much sample data was left; the installed-apps listing's `withSampleData` says only whether any is left.
- **Same rules as the purge.** It requires `manage_metadata`, answers `404` for a package that is not installed and `422 OS_PROTOCOL_INCOMPATIBLE` for an entry this runtime refused to load, and counts in the purge's scope (the caller's active organization under an organization wall, every row without one). A walled session with no active organization gets `count: 0`, the same answer as the listing's `withSampleData: false` for that session. A package with no seed datasets gets `count: 0`. With no data engine or metadata service it answers `500 DRIVER_UNAVAILABLE`, never `0`.
- **It cannot delete.** It is a `GET` and accepts no query parameter: any parameter (`dryRun`, `confirm`, …) is refused with `400 VALIDATION_ERROR` before any row is read.
- **Unchanged.** What the purge deletes, its permission and its answer; the listing's `withSampleData`.
- `@objectstack/cloud-connection` now depends on `@objectstack/rest`, for the shared closed-query-set refusal message.
