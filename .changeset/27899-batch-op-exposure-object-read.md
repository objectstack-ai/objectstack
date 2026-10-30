---
'@objectstack/rest': patch
---

fix(rest)!: the cross-object batch door judges each op's API exposure on the object the data door serves for its name (#27899)

Clause-②: no (narrowing) — on `POST {basePath}/batch`, an op that names a legacy `ns__short` object by its short name is now held to that object's own `enable` settings and refused with the data door's 404 or 405, before the transaction opens. No value, key or shape is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the batch door's exposure gate now reads each op's object the way every /data/:object route's gate already reads it, and answers the two already-published refusals (404 OBJECT_API_DISABLED, 405 OBJECT_API_METHOD_NOT_ALLOWED) those routes answer. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** the cross-object batch door (`POST {basePath}/batch`) refuses an op it used to write (`@objectstack/rest`), per triage 6514615922.

- **Before.** The door's per-op exposure gate searched the object list for an item declared under the op's exact name. A legacy `ns__short` object named by its short name was not found there, so the op passed as an unknown object, and the engine, which resolves the short name, then wrote it. `enable.apiEnabled: false` and an `enable.apiMethods` list were not applied to it on this door, while every `/data/:object` route already applied them.
- **Now.** The gate reads each op's object through the same by-name read as the `/data/:object` routes' gate, so it judges the object the data door serves for that name. Such an op is refused with the answer those routes give, status and body: 404 `OBJECT_API_DISABLED`, or 405 `OBJECT_API_METHOD_NOT_ALLOWED` for a write the object does not expose in bulk. The whole batch is refused before the transaction opens, so no op in it is written. Each distinct object is read once per request. No shipped object carries a `__` name.
- **Who sees it.** A client that sends a batch op naming a legacy `ns__short` object by its short name, where that object sets `enable.apiEnabled: false` or an `enable.apiMethods` list that leaves the write or `bulk` out. The same op under the full name was already refused.

**The remedy.** Nothing changes for objects the API exposes. For a restricted `ns__short` object, the short name now answers on the batch door as it does on every `/data/:object` route: lift the object's `enable` restriction if the API should serve it.
