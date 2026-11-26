---
'@objectstack/service-knowledge': patch
'@objectstack/cli': patch
---

feat(service-knowledge): a knowledge source that was never built is built after boot, and an administrator can rebuild one with `os knowledge rebuild`

Clause-②: yes
Metadata-protocol: none

- **The first build.** After every boot, `KnowledgeServicePlugin` reads what each `object` source's adapter holds (`indexStatus`, else one entry of `listDocuments`) against the index fingerprint and recipe hash the service computes now (ADR-0161 K7, "What starts a rebuild"), and builds — once, in the background, one source at a time — every source the adapter holds nothing for, holds under another fingerprint, or holds under another recipe hash. A source already built is left alone; a source with `refresh.onRecordChange: false` is left to its external indexer; an adapter with neither `indexStatus` nor `listDocuments` is never built automatically, and the boot log says so once. `KnowledgeServicePlugin({ buildAtBoot: false })` turns it off.
- **One node builds a source.** A build runs under the `cluster` service's lock, key `knowledge:build:SOURCE`, renewed while it runs; a node that gets the lock after another built the source re-reads it and builds nothing, and a lock that does not answer starts no build. With no cluster service the composition is one node. Only a shared cluster lock driver (`redis`) makes this hold across nodes: the default `memory` driver's lock is per process, so with it every node builds.
- **The administrator's rebuild.** The `knowledge` settings namespace gains two actions, gated like every settings write on `manage_platform_settings`: `rebuild` (`{ "source": "ID" }`) starts one complete build in the background, and `index_status` (`{}` or `{ "source": "ID" }`) answers each source's index state and the last build the answering node ran — its progress while it runs, its result (written, unchanged, purged, cannot be indexed) once it ended. `os knowledge rebuild SOURCE` starts a build and follows its progress to its end (`--no-wait` exits 0 once it has started and reports no outcome; otherwise exit 1 when it did not run or did not finish); `os knowledge status [SOURCE]` prints the state.
- **What it costs.** A build sends the content fields of every matching row the index does not already hold unchanged to the embedding provider, which bills for them. The line that starts a build says so, the server logs its progress every ten seconds and its result, and `content/docs/ai/knowledge-rag.mdx` states it. The default `memory` adapter holds nothing after a restart, so with it every boot builds the whole source again, on every node.
- `KnowledgeService` gains `readIndexState`, `rebuildSource`, `buildRecord`, `buildSourcesAtBoot` and `stopBuilds`, and the option `resolveBuildLock`; `IKnowledgeService` is unchanged.
