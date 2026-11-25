---
'@objectstack/spec': minor
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-memory': patch
---

feat(service-knowledge): a search can answer records, not passages — `granularity` and `groupBy`, with a freshness check

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — no page under `skills/**` teaches the knowledge search options or the hit's shape (the one knowledge eval asks about source authoring); `content/docs/ai/knowledge-rag.mdx` and `content/docs/protocol/knowledge.mdx` teach them, updated here.

ADR-0161 K1 (record-level return), K8 items 3 and 14.

- **`KnowledgeSearchOptions.granularity`** (`'chunk' | 'record'`, default `'chunk'`, which answers exactly as before). Under `'record'` a search answers one hit per record, the record's best-scoring passage, and `topK` counts records. Every source is then asked for `topK × 5` passages, for every caller, and refilled once at `topK × 20` when fewer than `topK` records survive the permission re-check — the cap; fewer records within it answer fewer hits, logged at `debug`. A `file` / `http` hit is grouped by its document. The return type is still `KnowledgeHit[]`.
- **`KnowledgeSearchOptions.groupBy`** names a metadata field and groups by its value — "which policies", not "which clauses" — keeping the best hit of each group, the value in the hit's `metadata`. It implies record granularity and is refused with `granularity: 'chunk'`. Hits with the same value form one group whichever source they come from. An `object` source that does not list the field in its `metadataFields` is not searched for that search, and a record with no value for it is not answered: a hit is never answered ungrouped.
- **The freshness check.** Each record-level hit about to be answered is checked against its record as it reads now: one system-context read per source, of only those records, `{ $and: [where, { id: { $in } }] }`, projected to the fields assembly reads. A record that was deleted or left `where` since it was indexed, or whose recomputed `docHash` differs from the hit's, is not answered, and the next record moves up (at most three rounds). Its document is repaired in the background through the event sync's path, single-flight, once per document until a later search finds its hash matching; the repair never throws into the search. A hit whose adapter stores no hash is checked for membership only; a freshness read that fails answers none of that source's checked hits, reported at `warn`.
- **The live title.** Under record granularity the permission re-check — still one query, as the caller — also reads the object's display field, and the hit's `title` is the record's title as it reads now.
- **`KnowledgeHit.docHash?` and `KnowledgeHit.headingPath?`** (`@objectstack/spec/ai`): the stored hash of the hit's document, returned as stored, and the heading path of the passage the hit came from. `knowledge-memory` returns both. The adapter contract suite (`@objectstack/service-knowledge/testing`) now asks an adapter that implements `listDocuments` to return each hit's stored `docHash` (and pins the record-level freshness check through a real service), and an adapter that takes chunks to return each passage's `headingPath`.
