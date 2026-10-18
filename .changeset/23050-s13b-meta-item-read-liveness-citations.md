---
'@objectstack/spec': patch
---

The liveness ledger's `/meta` cache-flag, per-item switch, doc and book rows cite the code that reads their keys where it now lives

Clause-②: no (only the rows' evidence paths and notes move and every status stays `live`: `MetadataEndpointsConfigSchema`, `DocSchema` and `BookSchema` accept exactly what they accepted before, and no state count moves)

- `liveness/metadata_endpoints.json`: the `enableCache` row and the `if (metadata.endpoints.item !== false)` half of the `endpoints.item` row cited `packages/rest/src/rest-server.ts#registerMetadataEndpointsInner`. `@objectstack/rest` moved the per-item reads to `packages/rest/src/meta-item-read-routes.ts#registerMetaItemReadRoutes` with no behaviour change, so those references follow them. The `registerPerItemRoute` half of the `endpoints.item` row keeps its citation: that call still lives in the inner method's head.
- `liveness/doc.json`: the `content` row's single-item branch, and the `_note`'s book-tree and single-item branches, cite the new module. The `doc` list branch keeps its citation.
- `liveness/book.json`: the `_note` names the new module for the `book/:name/tree` branch.
- The quoted code, the producers, the verdicts and the row notes are unchanged.
