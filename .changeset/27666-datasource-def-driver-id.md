---
'@objectstack/spec': patch
'@objectstack/service-datasource': patch
---

fix(service-datasource): a plugin-driver datasource connected or reconnected through the connection service keeps the engine's correctness floor (#27666)

Clause-②: yes
Metadata-protocol: none

The engine holds a plugin driver on a non-managed datasource behind a correctness floor (row cap, the query re-applied in memory, remote write refusals mapped) when the datasource definition it stores names a driver id that is not built in. Only the engine's own manifest install path carried that id. The datasource-connection service registered the definition without it, and `EngineDatasourceDef` had no such key, so a datasource created at runtime through datasource management was never floored, and one edited and reconnected lost the floor (the eviction drops the stored definition, and the connect that follows had no id to keep). Nothing said so: a driver that ignored `where` could answer rows outside the caller's sharing or row-level scope.

- `EngineDatasourceDef` (`@objectstack/spec/contracts`) gains an optional `driver`, the datasource's driver id. An engine never reads an absent key as "built in": a caller that registers only the write-gate facts keeps the id stored before it.
- `DatasourceConnectionService.connect` registers the definition with `record.driver`. `reconnect`'s keep-old-pool restore registers the OLD record's driver id (`previous.driver`; `previous` now carries it), not the new record's, because the kept pool was built from the old record.

A built-in driver (memory, sqlite, sqlite-wasm, postgres, mysql, mongodb, turso) and a managed datasource are unchanged: the floor engages only for a driver id a server plugin published on a datasource whose `schemaMode` is not `managed`. A host that registers no driver factory for plugin ids (the default) sees no change today.

What to do: nothing. A host whose factory builds plugin drivers gets the floor on those datasources from the connection service's next connect.
