---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): six `ObjectStackProtocolImplementation` doors hand their bodies to their facets

Clause-②: no
Metadata-protocol: none

- `getData`, `cloneData`, `saveMetaItem`, `publishMetaItem`, `rollbackMetaItem` and `deleteMetaItem` keep their signature and docblock on the class and delegate in one line to `ProtocolDataCrudFacet`, `ProtocolSaveFacet`, `ProtocolHistoryAndPublishFacet`, `ProtocolPackageCommitsFacet` and `ProtocolDiffDeleteLoadFacet`, which now hold the bodies, moved unchanged. The built `index.d.ts` and `index.d.cts` are byte-equal before and after, and no behaviour changes. Nothing to do on upgrade.
