---
"@objectstack/runtime": minor
---

feat(runtime): `POST /api/v1/security/permission-sets/:name/clone` — clone a permission set by name from the security catalog (ADR-0126 §7.1)

Clause-②: yes (widening)

- **What is new.** A route that copies a permission set's whole definition under a new machine name. The body is `{ name, label }`: both are required, no other key is accepted, and `name` must be snake_case. The answer is `{ permissionSet, notice }`: the copy that was saved, and a sentence naming what was not copied.
- **Where it reads and writes.** The source is read through the security catalog (the engine registry first, then the metadata service), the same read the authorization resolver uses. It never reads a `sys_permission_set` row, so it works on a database with none. The copy is saved through the metadata protocol's `saveMetaItem` as a `permission` item authored in this environment, with no organization and no package. The save is create-only, so a row written under the name meanwhile is refused, not overwritten.
- **What is copied, and what is not.** Every facet of the definition is copied. One server-declared list (`PERMISSION_SET_CLONE_DROPPED_KEYS`) is removed: the protection envelope and read decorations (derived from the spec), `packageId`, `managedBy`, `protection`, and the two privilege decisions `adminScope` and `isDefault`. The copy records nothing about its source.
- **Who may call it.** A holder of `manage_metadata`, through the same verdict the metadata save door asks (`metaWriteCapabilityVerdict`); `isSystem` bypasses. Anyone else gets `403 PERMISSION_DENIED`, and an anonymous caller `401`.
- **Refusals.** `400 VALIDATION_FAILED` for a malformed body or a name failing the name rule; `404` for an unknown source; `409 RESOURCE_CONFLICT` for a name the catalog already holds, including the source's own; `503 SERVICE_UNAVAILABLE` when no catalog is bound or it cannot be read; `501` when no metadata protocol is composed.
- **Nothing to migrate.** No existing route changes. The Setup action `clone_permission_set` keeps working as before.
