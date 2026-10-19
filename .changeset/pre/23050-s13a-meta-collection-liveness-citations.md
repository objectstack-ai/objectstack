---
'@objectstack/spec': patch
---

The liveness ledger's `/meta` type-list, per-type-list and maintenance switch rows cite the code that reads their keys where it now lives

Clause-②: no (only the rows' evidence paths move and every status stays `live`: `MetadataEndpointsConfigSchema` accepts `endpoints.types`, `endpoints.items` and `endpoints.maintenance` exactly as before, and no state count moves)

- `liveness/metadata_endpoints.json`: the `endpoints.types`, `endpoints.items` and `endpoints.maintenance` rows cited `packages/rest/src/rest-server.ts#registerMetadataEndpointsInner` for the gates on their mounts. `@objectstack/rest` moved those three route groups to `packages/rest/src/meta-collection-routes.ts#registerMetaCollectionRoutes` with no behaviour change, so those three path references follow them.
- The quoted code, the producers, the verdicts and the notes are unchanged. The `prefix` row keeps its citation: `metaPath` is still built in the inner method's head.
