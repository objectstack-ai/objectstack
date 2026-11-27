---
'@objectstack/service-knowledge': patch
---

feat(service-knowledge): record changes sync through the queue service — a save does not wait for the embedder, a failed sync is retried, a rolled-back write is never indexed

Clause-②: yes (widening) — `KnowledgeServicePluginOptions` gains the optional `recordSyncRetry`; `KnowledgeService` gains `routeRecordSyncs`, `recordSyncQueued`, `enqueueRecordSync` and `processRecordSync`; the package exports `KNOWLEDGE_RECORD_SYNC_QUEUE`, `RECORD_SYNC_RETRY_DEFAULTS` and the `KnowledgeRecordSync*` types
Metadata-protocol: none

A save of a record a knowledge source indexes used to sync its document inside the write: with a realtime service composed, the save waited for the re-read, the split, the embedding call and the store write, all before the write's unit of work committed. A failed sync was one `warn` line and was never retried, and a write that then rolled back could leave a document built from a row that never committed, or delete the document of a row that still matched.

Where the kernel composes a durable `queue` service (the platform's `QueueServicePlugin` over a data engine, which the standard runtime mounts on every preset but `minimal`) and a data engine is bound, the sync now runs through the `knowledge-record-sync` queue:

- **A save publishes and returns.** Either trigger — the realtime subscription, or the after-write hooks on a kernel without one — publishes one message per source that indexes the object on record change: the source's index key, the object, the record id and the reason (`event`, or `freshness` for the repair a search starts). Never a field value. The save does not wait for the embedder.
- **After the commit, and never for a rollback.** The message is published through the engine's `runAfterOpenUnitsCommit`, once the write's own unit or a caller's `engine.transaction()` commits, and not at all when it rolls back. So nothing is processed before the write commits, and after a rollback the index equals the committed database.
- **Retried, then a dead letter.** The worker re-reads the row and writes or removes its document; a failure is thrown to the queue, which runs it up to eight times, 5 s doubling to a 2 min cap between attempts (`recordSyncRetry` changes it). Then the message is a dead letter `listFailed` lists, naming the source and the record, logged once at `error`; the reconcile repairs it. A source no longer registered, or no longer indexing the object on record change, completes its message with no write and no retry; a source whose adapter is not mounted is retried like a failure.
- **One queue row per source per save**, no idempotency key: a keyed message would suppress a save made while the record's sync runs, and every later save for a day after one completed.
- **The freshness repair** a search starts is a `freshness` message too, so it survives a restart and is retried.

With only the kernel's in-memory fallback queue, a queue with no dead-letter surface (`listFailed`), or no data engine, the sync runs inline as before, and the boot says so once at `warn`. A host that mounts the service by hand adds `new QueueServicePlugin()` from `@objectstack/service-queue` to get the queued sync. `enableEventSync: false` and `refresh.onRecordChange: false` publish nothing. Nothing to migrate.
