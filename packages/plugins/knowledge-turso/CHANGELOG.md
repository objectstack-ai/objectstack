# @objectstack/knowledge-turso

## 6.4.0

### Minor Changes

- 52d1244: Add `@objectstack/knowledge-turso` — production-grade knowledge adapter backed by [Turso](https://turso.tech) / libSQL native vector columns.

  **What's included:**

  - `TursoKnowledgeAdapter` — implements `IKnowledgeAdapter` against a libSQL database with native `F32_BLOB` vector columns and ANN search via `vector_distance_cos()`. Single-table schema (`knowledge_chunks_<sourceId>`), automatic schema bootstrap on first `upsert()`, deterministic chunking + pluggable embedder.
  - `KnowledgeTursoPlugin` — registers the adapter with `IKnowledgeService` on `start()`. Accepts an existing `@libsql/client` instance or `{ url, authToken }` config.
  - Default tiny built-in embedder (hash-token bag-of-words → fixed-dim float vector) for tests / offline dev. Production deployments inject an OpenAI / Voyage / Cohere embedder via the `embed` option.

  **Why:** memory adapter is for tests, RAGFlow adapter is for teams that already run RAGFlow. Turso is the sweet spot for ObjectStack apps that want a real vector store with **zero new infrastructure** — it's the same libSQL the platform already uses for data.

  See `packages/plugins/knowledge-turso/README.md` for the full reference.

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/service-knowledge@6.4.0
  - @objectstack/core@6.4.0
