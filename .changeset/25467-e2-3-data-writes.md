---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): the single-record data writes move out of `protocol.ts` through the protocol host

Clause-②: no
Metadata-protocol: none

No behaviour change. The bodies of `validateData`, `createData`, `updateData` and `deleteData` now live in `protocol-data-writes.ts`, reached through the per-instance host (`protocol-host.ts`). Each method keeps its docblock and signature on `ObjectStackProtocolImplementation`, and each moved body differs from the method body only by `this.` reading `host.`. The published `index.d.ts` (ESM and CJS) is byte-identical to the one `main` builds before this change. Nothing to migrate.
