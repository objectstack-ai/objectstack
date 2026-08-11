---
"@objectstack/objectql": patch
"@objectstack/service-datasource": patch
---

fix(objectql,service-datasource): bind federated objects to their remote tables whatever the boot order, and report the ones that could not be bound (#7737)

`driver.registerExternalObject(obj)` is the only thing that installs an
ADR-0015 federated object's read metadata — the object -> remote-table mapping
(`external.remoteName` / `remoteSchema`), the `external.columnMap` translation
and the coercion maps. An external object that never gets it resolves to a
table named after the OBJECT rather than the remote table it declares, so every
read against it fails with `no such table`, or answers from the wrong table.

`ObjectQLPlugin`'s boot schema-sync calls it, but that call runs inside the
engine plugin's `start()`, while the declared datasource that owns the remote
database is auto-connected in `AppPlugin.start()` — a later `start()`. So on a
perfectly healthy boot `getDriverForObject()` answers `undefined` for every
federated object at that moment and the call is skipped; whether the object ends
up bound depended on some other component re-driving it afterwards. Two cases
where nothing did:

- an object routed to the datasource by a **`datasourceMapping` rule** (#4462)
  rather than an explicit `object.datasource` — `DatasourceConnectionService`
  re-drove only the explicitly-bound list;
- any deployment running with **`OS_SKIP_SCHEMA_SYNC`** — that flag is about DDL
  managed out of band, and this binding is DDL-free, but it took both
  `syncRegisteredSchemas()` calls (and the only in-plugin binding site) with it.

**What changed**

- `ObjectQLPlugin` now runs a federated-binding reconciliation on
  `kernel:ready`, after every plugin's `start()` has completed: it re-drives the
  binding for every registered external object (idempotent) regardless of which
  plugin connected the datasource, in which slot, or whether DDL was skipped.
  Boot order no longer decides whether federation works.
- The same pass **reports** what it could not bind, at `error`, naming the
  objects, their datasources, the consequence and the fix. Previously the entire
  diagnosis of a broken federation was one `debug` line reading
  `No driver available for object, skipping schema sync` — invisible at any
  normal log level, and emitted on healthy boots too. A boot with nothing to
  report stays silent.
- `DatasourceConnectionService.connect()` now re-drives `mappedObjects`
  alongside `objects` when a datasource comes up, so a mapping-routed federated
  object is also bound by a **runtime** (UI-created) datasource connect, not
  only at boot.

No authoring surface changes; a deployment whose federated objects already
worked behaves identically.
