---
'@objectstack/knowledge-pgvector': patch
---

feat(knowledge-pgvector): a changed fingerprint builds a new generation beside the active one and switches to it

Clause-②: yes (widening)
Metadata-protocol: none

ADR-0161 K7, rules 1 to 4, for the PostgreSQL store.

- **A new generation, built beside the old one.** Before, a complete reindex under a new index fingerprint (another embedding model, other dimensions, another split) was refused, and its result carried the statements that clear the source by hand. Now `beginBuild` opens a generation under construction beside the active one. The walk writes into it, and so do the event-sync writes that arrive during the build: they carry the new fingerprint. Nothing is written into the active generation under another fingerprint.
- **Search during the build** is refused `KNOWLEDGE_REBUILD_REQUIRED` (409) with the message that the source is being rebuilt. It is never answered from the old generation. `indexStatus` answers `building: true` while a generation is under construction.
- **The switch.** `completeBuild`, after the walk and its single purge, makes the new generation active and retires the old one in one transaction. The old one's passages are then deleted in batches of 1,000 rows (`deleteBatchSize` on the adapter), and its row last. A deletion that stops part-way is finished by the source's next build; a retired generation is never searched. A search that meets the switch reads the new generation.
- **One builder per source.** `beginBuild` takes a PostgreSQL session advisory lock on the source, on a connection of its own outside the pool (`PgPoolLike.connectSession`, which `poolFromPg` provides), and holds it until `completeBuild`. A second build from another process is refused `LOCK_CONFLICT` (409) before it reads or writes anything. The lock is freed when the build completes, when the process or its connection dies, or after 15 minutes without a call of the build itself (`buildLockIdleMs` on the adapter). Event-sync writes do not extend it. The plugin frees every lock it holds when it is destroyed. The lock is a session advisory lock: the store needs a direct or session-mode PostgreSQL connection, never a transaction-mode pooler. A release whose session no longer held the lock is logged at `warn`.
- **New exports, all optional (widening).** On the adapter's options: `buildLockIdleMs`, `deleteBatchSize` and `logger`. On `PgPoolLike`: `connectSession`. On the adapter: `close()`.
- **A build that stops is resumable.** The generation under construction is kept with what it holds. The next `beginBuild` under the same fingerprint takes it up, and the walk skips every document it already holds unchanged. A build under a third fingerprint abandons the unfinished generation and deletes it.
- The refusal's `remedy` no longer carries SQL: a complete reindex is the remedy. The generation table gains two unique partial indexes (one active and one building generation per source), created with `IF NOT EXISTS` on the next boot.
