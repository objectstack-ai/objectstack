---
'@objectstack/knowledge-pgvector': patch
'@objectstack/spec': patch
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-memory': patch
'@objectstack/embedder-openai': patch
---

feat(knowledge): an open vector store on PostgreSQL with pgvector, and the index fingerprint every knowledge index is built under

Clause-②: yes
Metadata-protocol: none

ADR-0161 Execution row 8a and K8 item 8 (#37100).

- **New package `@objectstack/knowledge-pgvector`.** `KnowledgePgvectorPlugin` registers a `PgvectorKnowledgeAdapter` (adapter id `pgvector`): passages and vectors in PostgreSQL with the pgvector extension, in a schema of its own (`os_knowledge`, option `schema`) — a generation table `knowledge_generation` and one passage table per vector width, `knowledge_vec_d<width>` — so no table collides with an object table or is read as schema drift. The database is the platform's when `OS_DATABASE_URL` is PostgreSQL, else the `url` option; the plugin keeps its own small pool (`poolMax`, default 4) and no pooled connection waits on the embedder. Search is an exact cosine scan (a 3072-wide model works); the organization filter and the metadata `filter` run in the same `WHERE`, before ranking. A passage whose text is unchanged is not embedded again. `queryPrefix` is put before every query before it is embedded. Without the `vector` extension, or the right to create it or the schema, the plugin still registers and boot goes on: it creates nothing, warns with the SQL to run, `healthCheck` answers `ok: false`, and every call answers `503 SERVICE_UNAVAILABLE` naming that SQL until it has run. The store does not yet build a second generation beside the first: `beginBuild` under a new fingerprint is refused with the SQL that clears the source. An approximate (HNSW) index is an operator's step, documented with the package.
- **The index fingerprint (ADR-0161 K7).** The knowledge service computes, per source and adapter, a fingerprint over the embedding model and dimensions the adapter reports, the resolved split and the splitter's version, and the content recipe; and a recipe hash over `where`, `metadataFields`, the title rule and the withheld fields. New exports from `@objectstack/service-knowledge`: `computeIndexFingerprint`, `computeRecipeHash`, `indexExpectation`, `INDEX_FINGERPRINT_VERSION`, `RECIPE_HASH_VERSION`, `ASSEMBLY_RULE_VERSION`, `TITLE_RULE_VERSION`, `SPLIT_ALGORITHM_VERSION`. Every adapter call carries them: `AdapterContext.index` and `AdapterSearchOptions.index` (`@objectstack/spec/contracts`).
- **Adapter contract members (all optional).** `AdapterEmbeddingDescriptor` gains `model`, `dimensions` and `variant`; `IKnowledgeAdapter` gains `indexStatus`, and `beginBuild` / `completeBuild` as a pair: a complete reindex calls `beginBuild` before it lists or writes, and `completeBuild` once every row is written and the purge is done. `IEmbedder` gains `model`; `OpenAIEmbedder` reports the model it sends.
- **A refused source is named, never read as empty.** A write or a search under another fingerprint is refused `409 KNOWLEDGE_REBUILD_REQUIRED` (registered in the error-code ledger). `KnowledgeService.search` over several sources answers from the searchable ones and logs each refused one; it throws the refusal (code, status, and `refused` naming every source) only when none could be searched. `KnowledgeService.searchWithRefusals` returns both, and the `search_knowledge` tool adds `refused` to its output when a source is refused.
- **`knowledge-memory` is the reference.** It keeps an active generation and, while a build of another fingerprint runs, one under construction, switching at `completeBuild`.
- **Contract suite.** `runKnowledgeAdapterContract`'s `implements` gains `indexStatus`, `builds`, `refusesOtherFingerprint` and `generations`, with cases for each. `knowledge-pgvector` runs the suite, the card's acceptance cases and a complete reindex over a real ObjectQL + SqlDriver against a live PostgreSQL in the `Temporal Conformance` job.
