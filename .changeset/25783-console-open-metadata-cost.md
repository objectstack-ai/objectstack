---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

perf(metadata-protocol,rest,runtime): opening the console no longer schema-parses every object on each `/meta/app` read, and served metadata lists parse each unchanged document once

Clause-②: no
Metadata-protocol: none

- **`GET /meta/app` judges its navigation on the execution face.** The nav-servability gate reads each object's `enable` to prune the entries whose object refuses `list` (#24031). It read them through the served list, `getMetaItems`, which stamps `_diagnostics` on every object, so every `/meta/app` read ran a full schema parse of every object definition. The gate now reads `getMetaItemsForExecution` for `object` where the protocol has it, in `RestServer` and in the dispatcher's `/meta/app` alike, and the served list otherwise. The same list, without the served decorations. Nothing it serves changes.
- **Diagnostics verdicts are memoized.** `computeMetadataDiagnostics` remembers a verdict per schema object and per document content (a SHA-256 of an encoding that keeps apart everything the parse keeps apart), so a served list of unchanged documents parses each one once instead of on every read. A replaced type schema starts from nothing, each caller gets its own copy, and a document with no faithful key is parsed every time as before. The served bytes are unchanged.
- **Measured** on the showcase app (108 objects, local, main-thread CPU per request): `GET /meta/app` 73.25 ms → 16.75 ms, `GET /meta/object` 85.75 ms → 37 ms.
