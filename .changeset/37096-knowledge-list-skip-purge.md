---
'@objectstack/spec': minor
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-memory': patch
---

feat(service-knowledge): adapters list their documents; a complete reindex skips unchanged documents and purges the ones its source no longer has; one adapter contract test suite

Clause-②: yes
Metadata-protocol: added

Two optional knowledge-adapter contract members land with their reader (ADR-0161 K8, items 1 and 2):

- `IKnowledgeAdapter.listDocuments?(ctx, { cursor?, limit })` answers `{ documents, nextCursor? }`, each entry `{ documentId, docHash? }` — the documents the adapter holds for the source, a page at a time. New exported types in `@objectstack/spec/contracts`: `AdapterListDocumentsOptions`, `AdapterListedDocument`, `AdapterListDocumentsPage`.
- `KnowledgeDocument.docHash?` — a hash of the assembled document (content, title and metadata, in a stable key order, behind the `v1:` prefix). The knowledge service computes it on every document it hands an adapter, `indexDocument` included (a caller's own value is replaced); the adapter stores it and returns it as stored.

`KnowledgeService.reindexSource` of an `object` source, over an adapter that implements `listDocuments`, lists the adapter's documents first and does not write a document again when its computed `docHash` equals the listed one. After a complete walk — no `limit`, no `dryRun`, no failed page — it purges each listed document the walk did not see, once the event sync's own re-read (the source's `where` AND the record id) confirms no row backs it; a row created or restored during the walk keeps its document. `KnowledgeReindexResult` gains `skipped` and `purged`; `purged` is `null` when no purge ran (a `limit` or `dryRun` walk, a failed walk, a source with `refresh.onRecordChange: false`, or an adapter without `listDocuments`, which also skips nothing). A failed listing skips and purges nothing and the result's `message` says why; a failed purge step answers `ok: false`. The purge is the exported `purgeDocuments` function of the service module.

`@objectstack/service-knowledge/testing` (new, test-only, ESM only — it imports `vitest`) exports `runKnowledgeAdapterContract({ name, makeAdapter, implements: { listDocuments } })`: upsert / search / delete, `listDocuments` page boundaries and `docHash` round-trips, and the skip and purge through a real `KnowledgeService`. `@objectstack/knowledge-memory` implements `listDocuments` and runs the suite.

What to do: nothing. An adapter without `listDocuments` keeps working; its reindex writes every document, as before, and reports `purged: null`. An adapter package adds `listDocuments` (storing `docHash` as given) to get the skip and the purge, and runs the suite from `@objectstack/service-knowledge/testing` with its own factory.
