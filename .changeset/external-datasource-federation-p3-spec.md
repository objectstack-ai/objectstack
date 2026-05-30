---
"@objectstack/spec": minor
---

External Datasource Federation (ADR-0015) — Phase 3 spec: `external_catalog`
metadata type.

- Registers `external_catalog` in `MetadataTypeSchema` and
  `DEFAULT_METADATA_TYPE_REGISTRY` (system domain, `allowRuntimeCreate: true`,
  not org-overridable).
- Adds `data/external-catalog.zod.ts` — `ExternalCatalogSchema` /
  `ExternalTableSchema` / `ExternalColumnSchema` for persisting a cached
  remote-schema snapshot of a federated datasource (consumed by
  `refreshCatalog`, the boot-validation gate, and Studio's schema browser).
