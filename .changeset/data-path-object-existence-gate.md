---
"@objectstack/metadata-protocol": minor
"@objectstack/rest": minor
---

fix(metadata-protocol,rest): the data path really 404s unknown objects now (#3770)

The REST API-exposure gate (`enforceApiAccess`) passes through any object it
cannot find in metadata, and the comment there justified that with
`// unknown object → let the data path 404`. That fallback did not exist.

- `findData` — and every other data entry point except `cloneData` — had **no
  existence check**. The repo's only `OBJECT_NOT_FOUND` throw was in `cloneData`.
- The engine does not reject unregistered names either: `resolveObjectName`
  falls back to `StorageNameMapping.resolveTableName({ name })`, so the object
  name is used **as the table name**.
- The 404 was therefore only ever a side effect of the **driver** erroring on a
  missing table, which the REST layer recognised by matching the driver's error
  string.

So the 404 held only when the table happened not to exist. When a physical table
with that name **did** exist — out-of-band DDL, a registration that failed after
`syncObjectSchema` had already run, a registration race — the exposure gate was
silently skipped and the rows were served, with no layer turning it into a 404.
(Since #3545 an authenticated caller on a plugin-security deployment is refused
by the fail-closed posture check; anonymous callers and deployments without
plugin-security were not.)

**The gate.** `ObjectStackProtocolImplementation` now runs a shared
`assertObjectRegistered` before storage is touched, on `findData`, `getData`,
`createData`, `cloneData`, `updateData`, `deleteData`, `batchData`,
`createManyData`, `insertManyData`, `updateManyData`, `deleteManyData` and
`analyticsQuery`. An object absent from the schema registry is rejected with
`OBJECT_NOT_FOUND` / 404 — an authoritative answer from the registry, raised
*before* the name becomes a table name, instead of an inference from driver
prose. `cloneData`'s open-coded check is now that shared gate; its envelope is
unchanged.

It sits at the protocol ingress, the same boundary `apiEnabled` guards: internal
callers (hooks, flows, migrations, raw ObjectQL) go to the engine directly and
are unaffected. When the engine exposes no schema registry at all there is
nothing to consult, so the gate stands down and warns once per process —
matching the tiering #3545 recorded in `api-exposure.ts` for a whole-registry
outage.

**Behaviour change.** A REST data request for an object that is not in the
schema registry now returns `404 object_not_found` even when a table of that
name exists. Previously it returned that table's rows. If a deployment depended
on reading a table with no registered object, register the object (its schema is
what every other layer — exposure, RBAC/FLS/RLS, field projection — already
needs in order to enforce anything at all).

**One wire code.** `mapDataError` maps the protocol's `OBJECT_NOT_FOUND` to the
canonical `object_not_found` `ApiErrorCode` — byte-identical to the envelope the
driver-string branch already produced — so a client keying on `code` sees *what
happened*, not *which layer noticed*. The driver-string branch stays as the
safety net for the other failure it actually covers: an object that IS registered
but whose physical table is missing. Callers that were reading `cloneData`'s 404
as `code: 'OBJECT_NOT_FOUND'` on the wire now get `object_not_found`; the status
is 404 either way.

The misleading comment is replaced with what actually closes the hole — this
gate for existence, plugin-security's `unresolved` posture (#3545) for
authorization — and a note not to widen the exposure gate on the assumption that
some other layer 404s.
