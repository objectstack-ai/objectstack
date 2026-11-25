---
'@objectstack/spec': minor
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-memory': patch
---

feat(service-knowledge): adapters list their documents; a complete reindex skips unchanged documents and purges the ones its source no longer has; one adapter contract test suite

Clause-②: yes
Metadata-protocol: added
Skills-docs: none — no skill under `skills/**` teaches `KnowledgeDocument`, the adapter contract or reindex; `skills/objectstack-ai/SKILL.md` teaches `KnowledgeSource` authoring only, which this change does not touch. `content/docs/protocol/knowledge.mdx` gains the members, the skip and the purge in this change.

Knowledge adapters can now list the documents they hold, and a full reindex uses that list to skip unchanged documents and to remove documents whose record is gone.

New, all optional, in `@objectstack/spec`:

- `IKnowledgeAdapter.listDocuments?(ctx, { cursor?, limit })` returns `{ documents, nextCursor? }`, each entry `{ documentId, docHash? }`: the documents the adapter holds for a source, one page at a time. New exported types in `@objectstack/spec/contracts`: `AdapterListDocumentsOptions`, `AdapterListedDocument`, `AdapterListDocumentsPage`.
- `KnowledgeDocument.docHash?`: a hash of the document's content, title and metadata, prefixed `v1:`. The knowledge service sets it on every document it hands an adapter; the adapter stores it and returns it unchanged. `indexDocument` refuses a document that already carries a `docHash` (it throws, naming the field).
- `KnowledgeReindexResult.skipped?` and `purged?`.

`KnowledgeService.reindexSource` for an `object` source, when the source's adapter implements `listDocuments`:

- does not send a document to the adapter again when its hash is unchanged, and counts it in `skipped`;
- after a full run (no `limit`, no `dryRun`, every page read), deletes each listed document whose record no longer exists or no longer matches the source's `where`. Before each deletion it reads the record again; a record that exists at that moment keeps its document, a numeric record id included. A deletion never overlaps a sync of the same record. `purged` counts the deletions.

`purged` is `null` when nothing was deleted because no removal ran: the adapter has no `listDocuments`, the run had a `limit` or `dryRun`, a page failed or answered no list of rows, the source sets `refresh.onRecordChange: false`, or the adapter's listing failed (the `message` says why). If a re-read or a deletion fails, the result is `ok: false` and `purged` counts the deletions made before it.

`@objectstack/service-knowledge/testing` (new, test-only, ESM only; it imports `vitest`) exports `runKnowledgeAdapterContract({ name, makeAdapter, implements: { listDocuments } })`, a test suite any adapter package runs with its own factory: upsert, search and delete; `listDocuments` paging and `docHash` round-trips; and the skip and the removal through a real `KnowledgeService`. `@objectstack/knowledge-memory` implements `listDocuments` and runs the suite.

What to do: nothing. An adapter without `listDocuments` keeps working; its reindex sends every document, as before, and reports `purged: null`. An adapter package adds `listDocuments` (storing `docHash` as given) to get the skip and the removal, and runs the suite from `@objectstack/service-knowledge/testing` with its own factory. A caller of `indexDocument` stops setting `docHash`.
