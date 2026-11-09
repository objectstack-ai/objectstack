---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-hono-server': patch
---

fix(core,objectql): effective object permissions read the external write gate, so a read-only external object is no longer offered New, Import, Edit or Delete

Clause-②: yes (widening)
Metadata-protocol: none

- **Behaviour.** On an object whose external write gate is closed (ADR-0015 §5.3 Gate 3: a federated datasource, and not both `datasource.external.allowWrites` and `object.external.writable`), every insert, update and delete is refused `403 EXTERNAL_WRITE_FORBIDDEN` for every caller. The effective object-permission map now says so: the entry grants no `allowCreate`, `allowEdit`, `allowDelete` or `allowTransfer`, a `modifyAllRecords` on it is lowered to the `viewAllRecords` read it implies, and `apiOperations` carries no write operation (`create`, `update`, `delete`, `upsert`, `bulk`, `import`, `restore`, `purge`). Read and export are unchanged. Both consumers move together: `/auth/me/permissions` (the console hides those doors with no client change) and `ISecurityService.getEffectiveObjectPermissions`, so `current_user.can(object, 'create' | 'edit' | 'delete' | 'transfer')` now answers `false` on such an object, as the write itself always did.
- **`@objectstack/objectql`: `ObjectQL.isExternalWriteForbidden(objectName)`**, the gate's verdict as a read-only question. The write gate (`assertWriteAllowed`) reads the same verdict, so the two cannot disagree.
- **`@objectstack/core`: `engineExternalWriteForbidden(engine)`** (the accessor over an engine, asked when the member is present) and the optional `isExternalWriteForbidden` accessor on `EffectiveObjectPermissionsSchemaSource`; `annotateEffectiveApiOperations` takes the same predicate as an optional third argument. A caller that hands over neither gets the map it got before.
