---
'@objectstack/core': patch
'@objectstack/objectql': patch
---

fix(core): an update or upsert import finds its match through the organization's unique index instead of scanning the table once per row

Clause-②: yes (widening) — @objectstack/core gains resolveTenantFieldName, DEFAULT_TENANT_FIELD and isFederatedObject (moved from @objectstack/objectql, which re-exports the same bindings)
Metadata-protocol: none

The match lookup of `runImport` (the `POST /data/:object/import` door, import jobs and a `job.pull` connector sync) queried the key fields alone. Under the `single` tenancy posture the engine adds no organization to a read, so the database could not use the `(organization_id, <key>)` unique index and read the whole table for every row: an upsert of 1,000 rows into a 50,000-row SQLite table ran at 128 rows/s and kept slowing as the table grew. The lookup now carries the caller's organization (the context's `tenantId`, the organization a created row is stamped with) on the target's tenant column, so each row is one index probe (857 rows/s on the same run, flat as the table grows).

The scope only narrows the lookup. It is the key alone, as before, when the context carries no organization, when the target has no tenant column (`tenancy.enabled: false`, `systemFields.tenant: false`, or none declared), for a federated (`external`) object, and when the target's declaration cannot be read. A `job` that declares no `organization` runs with none in its context, so its pull keeps the key-only lookup for now. A key set that names the tenant column keeps the row's own value. Under the `group` posture the match is now the record in the active organization, the one a create from that context writes; it no longer reaches a row of another member organization.

`resolveTenantFieldName`, `DEFAULT_TENANT_FIELD` and `isFederatedObject` move down to `@objectstack/core` so the import runner asks the engine's own tenancy rule. `@objectstack/objectql` re-exports the same bindings, so every existing import keeps working unchanged.
