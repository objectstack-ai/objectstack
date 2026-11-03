---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): the metadata list reads, the audit read and the UI-view read move out of `protocol.ts` through the protocol host

Clause-②: no
Metadata-protocol: none

No behaviour change. The bodies of `getMetaItems`, `getMetaItemsForExecution`, `getMetaItemsPerPackage`, `readFlattenedMetaItems`, `auditMetaItem` and `getUiView` now live in `protocol-meta-list-reads.ts` and `protocol-meta-audit-ui-view.ts`, reached through the per-instance host (`protocol-host.ts`). Each method keeps its docblock and signature on `ObjectStackProtocolImplementation`, and each moved body differs from the method body only by `this.` reading `host.`. The published `index.d.ts` (ESM and CJS) is byte-identical to the one `main` builds before this change. Nothing to migrate.
