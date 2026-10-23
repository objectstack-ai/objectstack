---
'@objectstack/service-datasource': minor
---

fix(service-datasource)!: the datasource admin API refuses to make a datasource managed while objects bind it with `external`, as the metadata save door does

Clause-②: no (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: not-required (already-registered object-external-binding-managed-datasource-refused) no rule is added or changed: the admin door now asks the save door's existing ADR-0015 §4.2 predicate, and that ledger entry already describes the refused shape and its fix -->

**BREAKING** (what the datasource admin API stores narrows), shipped as `minor` under the 18.x convention for breaking changes.

`POST /api/v1/datasources` (`createDatasource`) and `PATCH /api/v1/datasources/:name` (`updateDatasource`) write the datasource without entering the metadata save door. So they stored a datasource that is managed (`schemaMode: 'managed'`, or no `schemaMode`, the spec default) while objects bind it with `external`: the pair `PUT /api/v1/meta/datasource/:name` refuses (ADR-0015 §4.2). The runtime then skips those objects' DDL as federated while the boot validation and the write gate judge them as managed.

- **FROM:** the admin API created a managed datasource under objects that already name it with `external`, and a `PATCH` that set `schemaMode: 'managed'` (or edited another bound field of a datasource that is already managed) was stored.
- **TO:** both refuse with `400 DATASOURCE_ADMIN_ERROR`, one line per bound object, each the spec predicate's own message (`externalBindingDatasourceRefusal`, `@objectstack/spec/data`). Nothing is stored or registered, no secret is minted and the live pool is untouched.
- **Unchanged:** a federated datasource (`schemaMode: 'external'` or `'validate-only'`) and a datasource no object binds with `external` keep their answers. A `PATCH` that changes only `label` or `active` is not judged, so a datasource can still be renamed or taken out of service.
- **For a host that builds `DatasourceAdminService` itself:** `DatasourceAdminServiceConfig` gains a required member, `listObjectsBoundTo(datasource)`, returning the objects that name the datasource with their `external` binding. `DatasourceAdminServicePlugin` answers it from the engine's object registry (the `objectql` service's `registry`, the one the save door writes through to), so an object saved or imported at runtime counts at once.
- **The fix for an author:** declare the datasource `schemaMode: 'external'` (or `'validate-only'`) with its `external` settings, or remove `external` from the bound objects first, then make it managed.
