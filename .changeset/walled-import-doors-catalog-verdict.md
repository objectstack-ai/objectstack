---
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest,runtime)!: both import doors read the walled-catalog verdict the metadata save door reads

Clause-②: no (narrowing) — under the `isolated` and `group` tenancy postures, importing a remote table as an object (`POST /api/v1/datasources/:name/external/tables/:remote/import`, and the MCP `import_object` tool) is a write to the environment's metadata catalog, and it is the platform operator's, as every other write to that catalog is.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest changes: which caller an import door admits under a walled tenancy posture is all that moves, and every object already imported stays as it is. -->

**BREAKING** accept-set narrowing at both import doors (`@objectstack/rest`, `@objectstack/runtime`) under a walled tenancy posture.

- **The rule.** Under `isolated` and `group` every organization shares the environment's metadata catalog, and a write to it is admitted only for the platform operator and for the engine's own writes (ADR-0131 D3, D12 items 7–8, D11). An import saves an object into that catalog, so both import doors ask the walled-catalog verdict the metadata save door asks (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`), after the federation capability rule and before the federation service is looked up.
- **The answer.** A refused import answers `403 PERMISSION_DENIED` with the verdict's sentence for an object, the one the metadata save door answers, naming the posture. Nothing is introspected and nothing is saved. A `tenancy` service that is registered and cannot answer refuses the import `503 SERVICE_UNAVAILABLE`.
- **Unchanged.** The platform operator imports under a wall as before. Under `single`, and on a deployment with no `tenancy` service, every caller holding both federation capabilities imports as before. Listing remote tables, drafting an object and validating are unchanged, and the federation capability rule answers first, as before.
- **Who moves.** On a walled deployment, an import by a caller below the platform operator is refused; the platform operator performs it.
