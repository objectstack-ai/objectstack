---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/cli': minor
'@objectstack/verify': minor
'@objectstack/service-knowledge': minor
'@objectstack/knowledge-turso': minor
'@objectstack/service-settings': patch
---

feat(core): `requires: ['knowledge']` mounts the knowledge service and one vector store

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up #37310

ADR-0161, #37102.

- **New capability token `knowledge`** (`PLATFORM_CAPABILITY_TOKENS`, provider `@objectstack/service-knowledge`, edition `open`). `os serve` and `@objectstack/verify` mount `KnowledgeServicePlugin` plus exactly one store, picked from the primary database: PostgreSQL gets `KnowledgePgvectorPlugin` (adapter `pgvector`, on the same database URL); any other database gets `KnowledgeTursoPlugin` (adapter `turso`) on a local libSQL file, `.objectstack/data/knowledge.db` by default. An in-memory database gets an in-memory turso store. The in-memory adapter (`knowledge-memory`) is never mounted by the token.
- No token: no knowledge service and no knowledge settings page, as before. A host that mounts `KnowledgeServicePlugin` (or a store) itself keeps its own: the token adds only what is not already mounted.
- New core exports: `resolveCapabilityExtras`, `resolveKnowledgeStore`, `KNOWLEDGE_STORE_PROVIDERS` and the `CapabilityDatabase` / `CapabilityExtra` / `KnowledgeStoreSpec` types. `constructServedProviders` (`@objectstack/verify`) takes an optional `database` (default: in-memory SQLite).
- `os serve` now warns when a capability's extra plugin cannot be imported or constructed, instead of skipping it silently.
- **A source whose adapter is not mounted** no longer fails silently. The service still mounts and boot does not fail; after boot the service logs one `error` per such source naming the mounted adapters, and indexing or searching that source answers `SERVICE_UNAVAILABLE` (503) with the same message. A search across several sources names the refused one beside the hits of the others. Before, indexing threw an uncoded error and search skipped the source with a warning.
- **The turso store reads its URL from settings under the token.** `KnowledgeTursoPlugin` gains `urlFromSettings`: with no `url` option it reads the saved `knowledge.turso_url` / `turso_auth_token`. A saved `file:` URL must resolve, after symlinks, inside the project's `.objectstack/data/` directory; a URL that leaves it, names the platform database, or carries a NUL byte or another control character is refused before the libSQL client sees it (a NUL byte in a file URL kills the process inside the native client). New exports: `resolveSettingsStoreUrl`, `dataDirectoryOf`. `resolveStoreUrl` refuses control characters too.
- The `turso_url` setting's example path now reads `file:./.objectstack/data/knowledge.db` in every locale.
