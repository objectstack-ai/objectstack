---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

perf(metadata-protocol,runtime): served metadata lists parse each unchanged document once, and the dispatcher's `/meta/app` reads objects on the execution face

Clause-②: no
Metadata-protocol: none

- **Diagnostics verdicts are memoized.** `computeMetadataDiagnostics` remembers a verdict per schema object and per document content (a SHA-256 of an encoding that keeps apart everything the parse keeps apart), so a served list of unchanged documents parses each one once instead of on every read. A replaced type schema starts from nothing, each caller gets its own copy, and a document with no faithful key is parsed every time as before. The served bytes are unchanged. Measured on the showcase app (108 objects, local, main-thread CPU per request): `GET /meta/object` 85.75 ms → 37 ms.
- **The dispatcher's `/meta/app`** (the `${prefix}/*` catch-all) reads each object's `enable` for its nav prune through `getMetaItemsForExecution` where the protocol has it, as `RestServer` does, and `getMetaItems` otherwise.
- **No public surface moves.** The built `dist/index.d.ts` of both packages is byte-identical at `cb0a2fcf` and at this head.
