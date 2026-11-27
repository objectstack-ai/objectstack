---
'@objectstack/knowledge-turso': patch
---

feat(knowledge-turso): an approximate vector index for a large source of one organization

Clause-②: yes (widening)
Metadata-protocol: none

Every search of a libSQL store read every vector in scope: at 1,536 dimensions about 1.2 GB at 200,000 passages. A complete build that completes on a generation of `vectorIndexThreshold` passages or more (default 20,000), all of one organization, now makes that generation's DiskANN index (`vector_top_k`, one-bit neighbours, at most 32 each). The vector leg then reads `topK × vectorIndexOverfetch` candidates (default 4, at most 200), runs the same organization, record-scope and metadata `WHERE` over them, and ranks those in scope by their stored vector; its ranks feed the reciprocal rank fusion with the keyword leg as the exact scan's did. A leg the filter leaves short of `topK` runs again as the exact scan, so a search never answers fewer hits than before.

- **Never over two organizations.** The index ranks before it filters, so a generation holding passages of more than one organization (passages of none count as one) gets no index, and each search reads the organization index and takes the exact scan once a second organization's passage is written.
- **Built at the end of a complete build, never on a search or a write.** `os knowledge rebuild`, a fingerprint change, the boot build and the daily reconcile all end in one. The index is made empty, then filled 128 passages to a transaction before the generation is switched to; a search waits at most one batch. A source that grows past the threshold between builds keeps the exact scan until its next complete build. After that, each write of a passage also writes the index.
- **Names.** `knowledge_<source>_g<n>-vec` (the side table of float8 vectors), `…$vec` (the DiskANN index, kept by libSQL in `…$vec_shadow`), `…-org` (the organization index) and three `…-vec-*` triggers, dropped with the generation by a switch and by `dropSource`. An object under one of those names that the store did not make is never dropped: the call is refused `SERVICE_UNAVAILABLE`, naming it.
- **Two new options**, on `KnowledgeTursoPlugin` and `TursoKnowledgeAdapter`: `vectorIndexThreshold` (`Infinity` never makes an index) and `vectorIndexOverfetch`. Nothing to migrate: a store keeps the exact scan until its next complete build.
