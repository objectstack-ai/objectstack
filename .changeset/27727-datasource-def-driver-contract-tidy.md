---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/service-datasource': patch
---

fix(service-datasource): `DatasourceConnectionService.reconnect` requires `previous`, and the engine's datasource read-back answers the stored driver id (#27727)

Clause-②: yes (narrowing) — `DatasourceConnectionService.reconnect` now requires `opts.previous` with its `driver` id and refuses a call without it, and `ObjectQL.listDatasourceDefs` widens its answer by the stored `driver` key
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authored schema is added, removed, renamed or re-shaped: the narrowed parameter is on a host-facing service method, and the widened answer is an engine read-back. A datasource needs no metadata change, so there is nothing for a migration to rewrite. -->

**BREAKING** for a host that calls `DatasourceConnectionService.reconnect` itself without `previous`: the call is now a type error and, at runtime, rejects before anything is evicted. The in-repo caller (the datasource admin plugin's update path) already passes it.

The engine keeps a plugin driver on a non-managed datasource behind its correctness floor only while the stored datasource definition names the driver id. `reconnect` evicts the definition with the driver, and when a rebuild fails it restores the kept pool under a definition built from `previous`. Without `previous` that definition named no driver, so a kept plugin-driver pool was served without the floor, and nothing said so.

- `DatasourceConnectionService.reconnect`: `opts.previous` (the record the live pool was built from, including its `driver`) is required. A call without it, or with an empty `driver`, rejects with an error naming what to pass, and the live pool is left untouched.
- `ObjectQL.listDatasourceDefs` answers each definition's stored `driver` id when it has one, so a sweep can ask which datasources name a plugin driver. A definition that never named one is still listed without the key.
- `IDataEngine.registerDatasourceDef` (`@objectstack/spec/contracts`) now says what the engine already does: last write wins, except an absent `driver` keeps the id stored before it.

What to do: a host that calls `reconnect` directly passes the stored record as it was before the update as `previous`. Nothing else changes.
