---
'@objectstack/service-datasource': patch
---

`ExternalDatasourceServicePlugin` types the `'data'` service with the real engine contract (`IDataEngine`, `@objectstack/spec/contracts`) and deletes its private structural `DataEngineLike` re-declaration — the workaround the untyped `IDataEngine.introspectDatasource()` forced (#11493). The introspection fallback branch now probes `getDriverByName?` (the registry member the contract declares) instead of `getDatasourceDriver?`, a spelling no engine in either repository ever had, so the degradation path is reachable for the first time.
