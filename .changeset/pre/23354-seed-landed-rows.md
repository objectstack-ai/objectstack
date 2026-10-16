---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': minor
---

feat(spec): the seed loader reports the rows each dataset landed on, and the seed-settlement contract hands them to readers

- **`SeedLoadResult.landedIds`** (`@objectstack/spec/data`, default `[]`): the ids of the stored rows a dataset's records landed on — a row a record inserted, a row it updated, and a row its key matched on a replay and left as it was. Each id appears once, in record order. A dry run reports none. A replay therefore reports the rows an earlier load wrote, so the answer holds across boots. The loader's own key and reference resolution is behind it: a dataset keyed on a reference reports the matched row, whose stored key is the resolved id, never the dataset's value.
- **`ISeedSettlementService.seededRecordIds?(object, organizationId?)`** (`@objectstack/spec/contracts`, optional): "which rows of this object did this process's seed write?". Without `organizationId` it answers for the boot-time seed sources (the inline seed `app:seeded` announces); a source publishes its rows before it settles, so a reader inside `app:seeded` already sees them. With `organizationId` it answers for that organization's per-organization replay; the host keeps the most recent replay only, so a process that creates many organizations does not hold every replay's rows. A host that does not implement it publishes no reading, and a reader treats every unowned row as one it cannot place.
- **`@objectstack/metadata-protocol`**: `SeedLoaderService.load()` fills `landedIds` on every per-dataset result.
- **`@objectstack/runtime`**: the `seed-settlement` service implements `seededRecordIds`. `AppPlugin` publishes the inline seed's rows before the source settles (the loader path and the basic-insert fallback alike), and its per-organization `seed-replayer` records each replay's rows under that organization. `SeedSourceHandle` gains `publishLanded(report)`.

Nothing is removed or renamed. The reader this exists for is the seed-ownership claim, which now hands over only the seed's rows (see the `@objectstack/plugin-security` and `@objectstack/organizations` entries).
