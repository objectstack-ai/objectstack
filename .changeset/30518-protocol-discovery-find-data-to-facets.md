---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

refactor(metadata-protocol): `getDiscovery` and `findData` hand their bodies to their facets

Clause-②: no
Metadata-protocol: none

- The last two `ObjectStackProtocolImplementation` doors that #30054 typed keep their signature and docblock on the class and delegate in one line to `ProtocolDiscoveryAndBasesFacet` and `ProtocolDataCrudFacet`, which now hold the bodies, moved unchanged. The built `index.d.ts` and `index.d.cts` are byte-equal before and after, and no behaviour changes. Nothing to do on upgrade.
- `@objectstack/spec`'s published liveness ledgers (`liveness/qa.json`, `liveness/query.json`) cite the two bodies at their new files.
