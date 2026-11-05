---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): the eight `ObjectStackProtocolImplementation` doors that kept an inferred return type spell it on the signature

Clause-②: no
Metadata-protocol: none

- `getDiscovery`, `findData`, `getData`, `cloneData`, `saveMetaItem`, `publishMetaItem`, `rollbackMetaItem` and `deleteMetaItem` now declare their return type, copied from the published declaration file it was inferred into. The built `index.d.ts` and `index.d.cts` are byte-equal before and after, and no behaviour changes; only the source maps move with the new lines. Nothing to do on upgrade.
