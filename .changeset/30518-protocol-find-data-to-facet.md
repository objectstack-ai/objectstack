---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

refactor(metadata-protocol): `findData` hands its body to its facet

Clause-②: no
Metadata-protocol: none

- `ObjectStackProtocolImplementation#findData` keeps its signature and docblock on the class and delegates in one line to `ProtocolDataCrudFacet`, which now holds the body, moved unchanged. The built `index.d.ts` and `index.d.cts` are byte-equal before and after, and no behaviour changes. Nothing to do on upgrade.
- `getDiscovery` stays on the class: its body reads `typeof this.searchAll === 'function'`, which a forwarded host method would always answer true. The move tool now refuses a method read as a value.
- `@objectstack/spec`'s published liveness ledger (`liveness/query.json`) cites `findData` at its new file.
