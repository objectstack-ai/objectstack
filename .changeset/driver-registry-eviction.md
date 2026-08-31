---
"@objectstack/objectql": patch
"@objectstack/service-datasource": patch
"@objectstack/spec": minor
---

Deleting a datasource now evicts its driver from the data-engine registry, so `/api/v1/ready` recovers without a process restart

**BREAKING** `IObjectQLEngine` gains a REQUIRED member, shipped as `minor`
under the repo's launch-window convention for breaking changes.

`unregisterDriver(name: string): boolean` is additive for CONSUMERS — nothing
they already call changes — but it breaks any third-party *implementer* of
`IObjectQLEngine` at compile time, and the interface is on the published
surface (`packages/spec/src/contracts/index.ts` re-exports it and `./contracts`
is a published export path). Graded `minor` to match this contract's own
precedent: the three prior changes to it all took `minor`, including one that
added five members that were **all optional** and therefore broke nobody by
construction. A required member grading below that would be inconsistent.

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

<!-- adr-0087: not-required (no-migration-prescription) this change is purely ADDITIVE: `IObjectQLEngine` gains a member and nothing is renamed, retired or converted, so there is no authored metadata for `objectstack migrate meta` to rewrite and no migration to prescribe. The breaking half is compile-time only, against third-party IMPLEMENTERS of the interface; consumers are unaffected. Deliberately NOT claimed as runtime-interface-only: this gate classifies packages/spec/src/contracts/** as a metadata surface, so that category is false here even though the symbol is a TypeScript interface with no Zod schema behind it. -->
