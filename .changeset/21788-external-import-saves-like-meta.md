---
'@objectstack/service-datasource': patch
---

"Import as Object" saves the imported federated object through the metadata door's own save, so it is durable and reads from its remote table (#21788).

Clause-②: no

- `POST /api/v1/datasources/:name/external/tables/:remote/import` used to hold the generated object in the metadata service's memory only. No `sys_metadata` row was written, the object's storage was not synced, and the driver was never told the object's remote table. An object imported under a name that differs from its remote table answered `201` and then `500 DATABASE_ERROR` (`no such table: <name>`) on its first read. Every import was gone after a restart (`404 OBJECT_NOT_FOUND`).
- The import now calls `saveMetaItem` on the `protocol` service, the same save `PUT /api/v1/meta/object/:name` makes, with the request that door sends for an `object`. The object is a `sys_metadata` row the next boot binds, it is written through to the engine registry, and it is mapped onto its `external.remoteName` table. Both an import under a different name and one under the remote table's own name serve the remote rows, before and after a restart.
- The save door is looked up when an import runs, not when the plugin starts. A deployment with no metadata save door still refuses the import with "requires a writable metadata store", before any remote introspection.
- A save the metadata door refuses now refuses the import. The route answers it as `400 EXTERNAL_IMPORT_ERROR` with the door's message, as it answers every refused import.
- The route's request and response shapes are unchanged.
