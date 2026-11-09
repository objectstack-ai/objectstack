---
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest,runtime)!: the import doors and the catalog refresh read the walled-catalog verdict the metadata save door reads

Clause-②: no (narrowing) — under the `isolated` and `group` tenancy postures, importing a remote table as an object (`POST /api/v1/datasources/:name/external/tables/:remote/import`, and the MCP `import_object` tool) and refreshing a federated datasource's cached catalog (`POST /api/v1/datasources/:name/external/refresh-catalog`) are writes to the environment's metadata catalog, and they are the platform operator's, as every other write to that catalog is.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest changes: which caller an import door or the catalog refresh admits under a walled tenancy posture is all that moves, and every object already imported and every catalog snapshot already stored stays as it is. -->

**BREAKING** accept-set narrowing at both import doors and at the catalog refresh (`@objectstack/rest`, `@objectstack/runtime`) under a walled tenancy posture.

- **The rule.** Under `isolated` and `group` every organization shares the environment's metadata catalog, and a write to it is admitted only for the platform operator and for the engine's own writes (ADR-0131 D3, D12 items 7–8, D11). An import saves an object into that catalog, and a catalog refresh saves the datasource's `external_catalog` snapshot there, so each of those doors asks the walled-catalog verdict the metadata save door asks (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`) for the type it writes, after the federation capability rule and before the federation service is looked up.
- **The answer.** A refused call answers `403 PERMISSION_DENIED` with the verdict's sentence for the type written, the one the metadata save door answers, naming the posture. Nothing is introspected and nothing is saved. A `tenancy` service that is registered and cannot answer refuses the call `503 SERVICE_UNAVAILABLE`.
- **Unchanged.** The platform operator imports and refreshes under a wall as before. Under `single`, and on a deployment with no `tenancy` service, every caller holding both federation capabilities imports and refreshes as before. Listing remote tables, drafting an object and validating are unchanged, and the federation capability rule answers first, as before.
- **Who moves.** On a walled deployment, an import or a catalog refresh by a caller below the platform operator is refused; the platform operator performs it.
