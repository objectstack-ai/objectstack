---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): the metadata item reads and the layered read move out of `protocol.ts` through the protocol host

Clause-②: no
Metadata-protocol: none

No behaviour change. The bodies of `getMetaItem`, `getMetaItemForExecution`, `readMetaItem`, `packagelessLayeredReadRefusal` and `getMetaItemLayered` now live in `protocol-meta-item-reads.ts` and `protocol-meta-layered-reads.ts`, reached through the per-instance host (`protocol-host.ts`). Each method keeps its docblock and signature on `ObjectStackProtocolImplementation`, and each moved body differs from the method body only by `this.` reading `host.`. The published `index.d.ts` (ESM and CJS) is byte-identical to the one `main` builds before this change. Nothing to migrate.
