---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): the data reads in `protocol.ts` hand the engine typed query options instead of `any`

Clause-②: no
Metadata-protocol: none

No behaviour change. `findData` (its `find`, `count` and `aggregate` calls), `getData`, `cloneData` and `probeRecord` now pass the engine an options bag typed as `IDataEngine` declares it (`EngineQueryOptions`, `EngineCountOptions`, `EngineAggregateOptions`), so `tsc` checks every key they send. `findData` builds its `find` bag key by key from the normalized request, copying only the keys that are present, so the engine receives the same keys as before. The one key that no longer rides along is a `groupBy` or `aggregations` set to null on a plain list query, which the engine already read as absent. `protocol.ts` leaves `scripts/query-options-erasure-baseline.json`, since its count of erased sites is now 0. Nothing to migrate.
