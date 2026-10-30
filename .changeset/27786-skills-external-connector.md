---
'@objectstack/skills': patch
---

docs(skills): objectstack-data teaches `external.connector`, the datasource credential channel that borrows a declared connector instance's credential, beside `credentialsRef`

Clause-②: no
Metadata-protocol: none

- **Before.** A datasource can name a declared connector instance in `external.connector` and borrow that instance's credential (ADR-0015 amendment D7), so one credential serves the connector's flow actions and an API-backed datasource's records. `objectstack-data`'s `rules/datasources.md` taught only `credentialsRef`, so an agent following it bound a second copy of a vendor credential the stack already held, and had no way to know the key exists or where it is refused.
- **Now.** The rule's credentials section names the two channels and that exactly one is written: `credentialsRef`, a secret-store handle resolved at connect; or `connector`, for a datasource on a plugin driver such as `@objectstack/driver-odata`, naming a `connectors` instance with a `provider` and an `auth` other than `none`, shown as `schemaMode: 'external', external: { connector: 'erp_api' }`. It says where `connector` is refused (beside `credentialsRef`, on a built-in driver, on a `managed` datasource, and naming an undeclared instance, at `defineStack` or else at connect), that a disabled instance or a stack with no automation service leaves the datasource unconnected with the reason, and that a connector credential not set yet answers `503` per request instead of failing the connect.
- The new text is paid for inside the same file: the `field.columnName` history clause, the auto-connect lead-in and the escape-hatch note are shortened, and phrases that restated their neighbours (the `columnMap` direction the example already shows, the mapping-routing tail, the write-gate tail) are dropped. The file stays under its token ceiling, which does not move. No schema, key or runtime behaviour changes.
