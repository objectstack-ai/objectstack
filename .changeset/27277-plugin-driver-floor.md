---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

fix(objectql)!: a plugin driver on an external datasource answers every read correctly or refuses: the engine applies the whole query to the rows the driver returns, up to 1000 of them (#27277)

Clause-②: yes (two codes join ERROR_CODE_LEDGER under `@objectstack/objectql`: `EXTERNAL_WRITE_REFUSED` and `EXTERNAL_ROW_CAP_EXCEEDED`, both 422)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. A read on a plugin-driver datasource that matches more than 1000 rows is now refused with a 422 that names its own remedy (narrow the filter, or mirror the data with DataSync); there is no metadata for a migration to rewrite. -->

**BREAKING** accept-set narrowing for reads on a plugin-driver external datasource (`@objectstack/objectql`). Only a datasource with both of these is affected: `schemaMode` is not `managed`, and `driver` names a driver a server plugin published (not a built-in id: memory, sqlite, sqlite-wasm, postgres, mysql, mongodb, turso). A managed datasource and an ADR-0015 federated database on a built-in driver are unchanged.

- **Before.** The engine passed the whole query to the plugin driver and served whatever came back. A driver that ignored part of the filter, the sort or the paging answered the wrong rows, and nothing said so.
- **Now.** The engine holds such a driver behind a correctness floor. The driver is sent `where` and `orderBy`, which it may push down, and `limit: 1001`. It is never sent `offset` or `fields`. The engine then applies the whole query to the rows it gets back (`applyDriverQueryInMemory`): filter, sort (nulls last, and an `id` tie-break on a paged read), offset and limit, and projection. A driver that returned every row still answers the right subset.
  - `findOne` and `count` are answered from the same read.
  - `aggregate` is hidden, so the engine aggregates in memory over that read.
  - The filter is evaluated by the engine's own walker (the one `having` uses). `$like` and `$ilike` now work in its `where` position. It is held to the spec tables `FILTER_LOGIC_CASES`, `FILTER_TEXT_CASES`, `PAGINATION_*_CASES` and `TEMPORAL_CASES`.
- **Row cap.** A read that matches more than 1000 rows is refused with `EXTERNAL_ROW_CAP_EXCEEDED` (422), whose message says to narrow the filter or mirror the data into a real object with DataSync.
- **Writes pass through.** A remote refusal with a 4xx status is `EXTERNAL_WRITE_REFUSED` (422). Its message is the remote's own, and `details.remoteStatus` carries the status. A remote that fails, does not answer, or answers 5xx is `ERR_DATASOURCE_UNAVAILABLE` (503, `reason: 'remote'`); its cause goes to the server log at `warn` and is never sent to the caller.
- **One instance.** The engine stores the floored driver in place of the driver, so `getDriverByName`, `datasource()` and the routing for an object all return the same instance. `unwrapExternalDriverFloor` answers the driver behind it.
- **Not covered.** `updateMany` and `deleteMany` pass the predicate through to the driver unchanged. A `where` with a `ReadableIds` leaf is refused (ADR-0139 D3), because the engine has no semi-join over a plugin driver's rows.

**The remedy.** If a read now meets the cap, narrow its filter, or mirror the data with a `mapping` pulled by a `job` and read the real object.

New exports from `@objectstack/objectql`: `applyDriverQueryInMemory`, `ExternalWriteRefusedError`, `ExternalRowCapExceededError`, their `*_CODE` constants, `EXTERNAL_ROW_CAP`, `needsExternalDriverFloor`, `unwrapExternalDriverFloor`, and the types `DriverQueryInMemory`, `DriverQueryInMemoryOptions`, `ExternalWriteOperation` and `DatasourceUnavailableReason`. `DatasourceDef` gains an optional `driver`.
