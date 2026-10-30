---
'@objectstack/service-datasource': patch
---

fix(service-datasource): an edit that rebuilds a Setup-created managed datasource's pool gives the objects bound to it their tables on the new pool (#27750)

Clause-②: no
Metadata-protocol: none

#27701 made a runtime managed datasource's pool sync the objects bound to it when the pool opens. An edit that rebuilds the pool still synced nothing: an admin who moved `warehouse` to a new database (a changed `config`) left every code object bound to it without a table there, and every read of it failed until the tables were recreated by hand.

- **Now.** The rebuild (`PATCH /api/v1/datasources/:name` → `updateDatasource` → `reregisterPool` → `DatasourceConnectionService.reconnect`) carries the objects bound to the NEW record into the rebuild's connect, so its sync loop gives them their tables, as on create. The same holds when an edit re-activates an inactive datasource. `reconnect` takes them as a new optional `objects` option.
- **One gate.** The open (`registerPool`) and the rebuild (`reregisterPool`) read the bound objects through one helper.
- ⛔ **Only a managed datasource.** A datasource whose `schemaMode` is `external` or `validate-only` syncs nothing for its objects on the rebuild either, so it never gets DDL.
- **Not changed.** When the rebuild fails and the previous pool is kept, nothing is synced: that pool already served those objects.
