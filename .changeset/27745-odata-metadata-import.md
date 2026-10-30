---
'@objectstack/spec': patch
'@objectstack/driver-odata': patch
'@objectstack/service-datasource': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(datasource): import objects from an OData datasource's `$metadata` — EDM types map to field types, the key to the id, and navigations to lookups; Studio's datasource page imports several entity sets at once, and MCP gains `list_remote_tables` / `import_object`

Clause-②: yes (widening)
Metadata-protocol: none

- **Type matrix (`@objectstack/spec/data`).** `SqlDialect` gains `'odata'`, whose aliases map the EDM primitives (`Edm.String`, `Edm.Int16/32/64`, `Edm.Decimal`, `Edm.Double`, `Edm.Boolean`, `Edm.Date`, `Edm.DateTimeOffset`, `Edm.TimeOfDay`, `Edm.Guid`, `Edm.Binary`, `Edm.Stream`, `Collection(…)`) onto the matrix's canonical types. `Edm.Duration`, the geography / geometry families and a service's own enum or complex types stay unknown, so a draft flags them for review. `Edm.Int64` and `Edm.Decimal` take the same verdict as SQL `bigint` / `numeric` (exact for `number`).
- **Gate 2 gets looser, for SQL federation too.** `lookup` and `master_detail` are now exact under the `text`, `integer` and `bigint` rows, as they already were under `uuid`: a reference stores the target's id, which on a federated object is the remote key a foreign-key column carries. Before, `isCompatible` refused a lookup over `CustomerID int` or `varchar` as a `type_mismatch` error, so the boot validation (`onMismatch: 'fail'`) refused any federated object that declared one. Nothing that passed before fails now.
- **Draft (`@objectstack/service-datasource`).** For an OData datasource (the driver reports dialect `odata-4.0`, read as the `odata` vocabulary) `generateObjectDraft` / `importObject` / `refreshCatalog` and the validation map EDM types through that arm. A column whose name is not a snake_case field name drafts as its snake_case spelling with `external.columnMap` carrying the remote name (`CategoryID` → `category_id`); `rename` overrides now land in `columnMap` too, so a renamed field stays bound to its column. A remote table name drafts the same way (`Products` → `products`; a leading capital used to give `_products`). A single-valued navigation becomes a `lookup` on the column its `ReferentialConstraint` names when the constraint references the target's single key and the target is imported on the same datasource (or is the object itself); every other navigation is left out of the draft and named in `review` with its reason — import the target first.
- **Driver (`@objectstack/driver-odata`).** `introspectSchema()` lists each navigation's `referentialConstraints`.
- **Studio.** The datasource page's tables tab selects several entity sets and imports them in one go, saving lookup targets before the tables that reference them; the write opt-in is offered only on a datasource that allows writes, and an imported object stays read-only otherwise (single-table dialog included).
- **MCP.** `list_remote_tables` and `import_object` reach the same `IExternalDatasourceService` calls, registered only for a token whose scopes name `metadata:write`, and refused by the runtime bridge without the capability the REST twins require (`FEDERATION_READ_CAPABILITY` / `FEDERATION_WRITE_CAPABILITY`, now exported from `@objectstack/rest`).
