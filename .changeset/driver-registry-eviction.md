---
"@objectstack/objectql": patch
"@objectstack/service-datasource": patch
"@objectstack/spec": patch
---

Deleting a datasource now evicts its driver from the data-engine registry, so `/api/v1/ready` recovers without a process restart

The ObjectQL driver registry had a `registerDriver` door and no counterpart, so
nothing could ever leave it. Deleting a datasource emptied the admin door while
`GET /api/v1/ready` kept naming the deleted datasource's driver — the readiness
probe reports whatever `checkDriversHealth()` finds in that registry — and on a
multi-replica deployment the only recovery was restarting every process.

`IObjectQLEngine` gains `unregisterDriver(name)`, the removal counterpart of
`registerDriver`. The registry owns the invariant rather than each caller: an
eviction has to drop the driver entry, clear the `defaultDriver` NAME when it
pointed at the evicted driver (otherwise `getDefaultDriverName()` answers with a
name nothing backs), and drop the datasource definition that has no removal door
of its own. Evicting does not disconnect the pool — teardown belongs to whoever
owns it.

Three lifecycle paths now use it:

- **Datasource delete / pool teardown** — `DatasourceConnectionService.disconnect()`
  evicts after closing the pool, which is the path `DELETE /api/v1/datasources/:name`
  reaches. The default driver is evicted under its natural registered name.
- **Failed-start rollback** — a connect that throws after registering now rolls
  that registration back, instead of leaving a driver the admin list reports as
  failed and the readiness probe still pings.
- **Engine teardown** — `destroy()` disconnects and then evicts, so a destroyed
  engine no longer reports drivers whose pools it has already closed.

Eviction is per-replica, matching how driver registration already works
(each replica registers pools from the shared datasource records at boot);
propagating it cluster-wide would need a broadcast channel the driver registry
does not have today.
