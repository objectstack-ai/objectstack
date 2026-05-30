# @objectstack/knowledge-memory

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/service-knowledge@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/service-knowledge@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/service-knowledge@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/service-knowledge@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/service-knowledge@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/service-knowledge@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/service-knowledge@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/service-knowledge@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/service-knowledge@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/service-knowledge@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/service-knowledge@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/service-knowledge@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/service-knowledge@6.5.0

## 6.4.0

### Minor Changes

- f8651cc: Knowledge Protocol MVP — protocol-first RAG via adapter plugins.

  **What's new:**

  - `@objectstack/spec` — new `KnowledgeSource` / `KnowledgeDocument` / `KnowledgeChunk` / `KnowledgeHit` schemas (under `@objectstack/spec/ai`) and `IKnowledgeService` / `IKnowledgeAdapter` contracts (under `@objectstack/spec/contracts`).
  - `@objectstack/service-knowledge` — `KnowledgeService` orchestrator + `KnowledgeServicePlugin`. Routes search/index calls to the appropriate adapter, runs **permission-aware retrieval** by re-checking every hit's `sourceRecordId` against the caller's `ExecutionContext` via `IDataEngine` (same RLS that gates plain ObjectQL), and subscribes to `IRealtimeService` for inline record→adapter sync.
  - `@objectstack/knowledge-memory` — deterministic, dependency-free in-memory adapter for dev/tests/reference. Hash-token embedder + brute-force cosine + paragraph chunking.
  - `@objectstack/knowledge-ragflow` — production-grade adapter against the Apache-2.0 [RAGFlow](https://github.com/infiniflow/ragflow) REST API. Plug in your dataset id; ObjectStack handles permission filtering after retrieval.
  - `@objectstack/service-ai` — new `search_knowledge` tool wired through the registry. Threads the LLM caller's actor into `KnowledgeService.search` so retrieval honours RLS automatically.

  **Why this design:** ObjectStack does NOT own chunking / embedding / vector storage / rerank — those are commodity capabilities best handled by mature OSS (RAGFlow, LlamaIndex, Dify, …). What ObjectStack uniquely owns is the protocol + permission-aware orchestration on top.

  See `content/docs/protocol/knowledge.mdx` for the full design.

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/service-knowledge@6.4.0
  - @objectstack/core@6.4.0
