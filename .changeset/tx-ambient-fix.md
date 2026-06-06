---
"@objectstack/objectql": minor
"@objectstack/rest": minor
---

Robust multi-write transactions (ADR-0034). `engine.transaction()` now establishes an ambient transaction (AsyncLocalStorage) so every data operation during the callback — including internal reads performed while a write runs — binds to the active transaction's connection instead of asking the pool for another one and deadlocking on SQLite's single-connection pool. Adds a cross-object transactional batch endpoint (`POST /api/v1/data/batch`) with intra-batch `{ $ref: <opIndex> }` parent references, so a parent and its children can be created atomically in one transaction.
