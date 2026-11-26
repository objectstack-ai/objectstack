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

- **New capability token `knowledge`** (`PLATFORM_CAPABILITY_TOKENS`, provider `@objectstack/service-knowledge`, edition `open`). `os serve` and `@objectstack/verify` mount `KnowledgeServicePlugin` plus exactly one store, picked from the primary database: PostgreSQL gets `KnowledgePgvectorPlugin` (adapter `pgvector`, on the same database URL); any other database gets `KnowledgeTursoPlugin` (adapter `turso`) on a local libSQL file, `knowledge.db` in the directory of the default database: `.objectstack/data/`, or `<OS_HOME>/data/` when `OS_HOME` is set (`os start --home` sets it). An in-memory database gets an in-memory turso store. The in-memory adapter (`knowledge-memory`) is never mounted by the token.
- No token: no knowledge service and no knowledge settings page, as before. A host that mounts `KnowledgeServicePlugin` itself keeps its own and gets no store from the runtime; a host that mounts only the store the token would choose keeps that store and gets the service.
- New core exports: `resolveCapabilityExtras`, `resolveKnowledgeStore`, `KNOWLEDGE_STORE_PROVIDERS` and the `CapabilityDatabase` / `CapabilityExtra` / `KnowledgeStoreSpec` types. `constructServedProviders` (`@objectstack/verify`) takes an optional `database` (default: in-memory SQLite).
- `os serve` now warns when a capability's extra plugin cannot be imported or constructed, instead of skipping it silently.
- **A source whose adapter is not mounted** no longer fails silently. The service still mounts and boot does not fail; after boot the service logs one `error` per such source naming the mounted adapters, and indexing or searching that source answers `SERVICE_UNAVAILABLE` (503) with the same message. A search across several sources names the refused one beside the hits of the others. Before, indexing threw an uncoded error and search skipped the source with a warning.
- **The turso store reads its URL from settings under the token.** `KnowledgeTursoPlugin` gains `urlFromSettings`: with no `url` option it reads the saved `knowledge.turso_url` / `turso_auth_token`. It reads them when the boot completes (`kernel:bootstrapped`), the first moment the settings service answers a saved value; the adapter is mounted from `start()` and answers `SERVICE_UNAVAILABLE` until the store has opened. A saved `file:` URL must resolve, after symlinks, inside that data directory; a URL that leaves it, names the platform database, or carries a NUL byte or another control character, written out or percent-encoded (`%00`, `%0a`), is refused before the libSQL client sees it (the client decodes the path, and a NUL byte in it kills the process inside the native library). New option `stateDir` (the token passes `OS_HOME`); new exports: `resolveSettingsStoreUrl`, `dataDirectoryOf`. `resolveStoreUrl` refuses control characters too, in both spellings.
- **`@objectstack/knowledge-turso` is an optional dependency of `@objectstack/cli` and `@objectstack/verify`**, not a hard one: its libSQL client is a native module with an `os` / `cpu` list, and a hard dependency would refuse the whole install outside that list. Where it is absent `os serve` warns that the store was not mounted and boots on, `@objectstack/verify` does the same, and a source naming `turso` answers `SERVICE_UNAVAILABLE`. `KNOWLEDGE_STORE_PROVIDERS.turso` and the extra `resolveCapabilityExtras` answers for it carry `optional: true`.
- The `turso_url` setting's example path now reads `file:./.objectstack/data/knowledge.db` in every locale.
