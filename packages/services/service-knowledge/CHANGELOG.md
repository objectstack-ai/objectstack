# @objectstack/service-knowledge

## 19.0.0-next.2

### Minor Changes

- dbe0716: feat(knowledge): a knowledge source needs no `adapter` and no `requires: ['knowledge']` — it binds to the deployment's store, and shipping one mounts the service
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  Skills-docs: follow-up #37310 — `skills/**` teaches the optional `adapter` and the item mount after this lands
  
  A `knowledge_source` may leave out `adapter` (ADR-0161 K4), and a stack that ships one in `knowledgeSources` is served the knowledge service and one vector store without listing `knowledge` under `requires` (ADR-0161 K8, item 12). One source written as metadata now builds on SQLite under `os dev` (the `turso` store, a libSQL file), on PostgreSQL (`pgvector`) and on a host that mounts its own store, with no change to the source.
  
  - **`@objectstack/spec`.** `KnowledgeSourceSchema.adapter` is optional. Omitted, the source is held by the deployment's adapter: the store the runtime mounted beside the knowledge service, else the only adapter registered. A named adapter is kept as written. `PlatformCapabilityProvider` gains an optional `mountedBy: { collection }`, set on the `knowledge` row of `PLATFORM_CAPABILITY_PROVIDERS` (`knowledgeSources`): a stack holding an item of that collection is served the capability as its token serves it.
  - **`@objectstack/core`.** `stackItemCapabilities(stack)` answers the tokens a stack's items mount (top level, then each package body), and `resolveServedCapabilities` takes them as `itemTokens`: appended after the declared tokens, read as declared (a provider that cannot be built fails the boot as for `requires`), and reported in a new `byItems` set. `resolveCapabilityArgument('knowledge', …)` now answers `{ deploymentAdapter }`, the adapter id of the store `resolveCapabilityExtras` mounts for the same database.
  - **`@objectstack/cli` and `@objectstack/verify`.** `os serve` / `os dev` / `os start` and `bootStack` read the item tokens, and hand the knowledge service the deployment's store (`pgvector` on PostgreSQL, `turso` otherwise). `os migrate plan` / `apply` read them too, so an item-only stack's migrate run composes the knowledge service as `os serve` mounts it (init only: no store, build or embedder call).
  - **`@objectstack/service-knowledge`.** `KnowledgeServicePlugin` and `KnowledgeService` take a `deploymentAdapter` option: the runtime's mark of the store it mounted. It is a service option, not an adapter-contract member, and `registerAdapter` is unchanged: an adapter application code registers is never the deployment's by registering. A source that names no adapter is placed where it is used (`adapterIdFor`, `adapterFor`), so one registered in code before its store started finds it. With several adapters registered and none the deployment's, such a source is refused at registration (both doors) and at its save, `400 VALIDATION_ERROR`, naming the adapters; registered first and left unplaceable by adapters that came later, it answers the same refusal at index and search, and the boot names it once at `error`. With no adapter registered it answers `503 SERVICE_UNAVAILABLE`, naming the deployment's store when one was marked. The `index_status` action reports the adapter a source is placed on.
  - **`@objectstack/runtime`.** The MCP draft door (`save_metadata_draft`) carries the knowledge service's refusal code through: a source refused `400 VALIDATION_ERROR` arrived over MCP as `SERVICE_UNAVAILABLE` with status 400, and now arrives as `VALIDATION_ERROR`, as on the REST door. A `403` is still `PERMISSION_DENIED`.
  
  Unchanged: a source that names an adapter that is not mounted answers `SERVICE_UNAVAILABLE` as before; a host that mounts `KnowledgeServicePlugin` itself keeps its own, gets no store from the runtime and no deployment's mark; without a source or the token nothing is mounted; an item saved at run time on a deployment that mounted no knowledge service is reported at boot exactly as before.
  
  What to do: nothing to change, with one behaviour to know. A stack on 19.0.0-next.1 that ships a source without `requires: ['knowledge']` held it inert, with a boot warning; it is now indexed: the service mounts, the boot pass builds the source's index, and its content fields are sent to the configured embedder (ADR-0161 K5: embedding is egress). A source that names `adapter: 'turso'` or `adapter: 'pgvector'` keeps working; drop the key to let the deployment choose, and drop `knowledge` from `requires` in an app that ships its sources.

### Patch Changes

- 73d0240: fix(service-knowledge): a source naming an unmounted adapter is logged once at boot, not twice
  
  Clause-②: no
  Metadata-protocol: none
  
  At boot, a knowledge source whose `adapter` names a store nothing mounted was named twice: once at `error` by the boot's reading of unmounted adapters, and once more at `warn` by the first-build pass ("is not built at boot: what the adapter holds could not be read"). The first-build pass now skips such a source without a line, so the one boot line is the `error` that names the source, the adapter and the mounted choices. Nothing else changes: indexing and searching the source still answer `SERVICE_UNAVAILABLE`, and a source loaded while the process runs is still named at `warn` by its reload build, since no boot reading runs then.
- 724d6f3: feat(service-knowledge): a scheduled reconcile keeps every knowledge index equal to its source, daily and soon after a predicate write
  
  Clause-②: no
  Metadata-protocol: none
  
  Record events keep an index fresh; the reconcile now keeps it correct (ADR-0161 K1). `KnowledgeService.reconcileSources()` walks every source whose store lists its documents with the complete build the boot and `os knowledge rebuild` already run — same cluster lease and fence, same skip, same purge, same `completeBuild`, trigger `reconcile` — so the documents of rows inserted or changed without an event are written, those of rows deleted or moved out of `where` by a predicate write, or built from an insert that rolled back, are purged, and nothing is embedded again for a row that did not change.
  
  - `KnowledgeServicePlugin` schedules one job, `knowledge:reconcile`, on the platform's job service, daily at 03:00 UTC. The new plugin option `reconcile` moves it (`{ cron, timezone }`) or turns it off (`false`). A run that could not finish a source is `degraded` in the job's run history, naming the source. With no job service composed, the plugin says so once at boot.
  - A `data.records.updated` / `data.records.deleted` event (a `multi: true` write) now asks for a reconcile of every source over the object, started once the object has had no further predicate write for two minutes, at the latest ten minutes after the first; its warning says so. A source on an adapter without `listDocuments` is never reconciled: the reconcile says so once at `warn`, and the predicate-write warning keeps its old text for it.
  - A source whose index fingerprint or recipe moved while the server runs (a split or embedder setting saved) is built as a new generation by the next reconcile instead of at the next restart.
  - `KnowledgeBuildTrigger` gains `'reconcile'`; new exports `KnowledgeReconcileReport`, `KnowledgeReconcileEntry`, `KnowledgeReconcileRequest`, `RECONCILE_JOB`, `RECONCILE_DEFAULT_CRON`, `RECONCILE_QUIET_MS` and `RECONCILE_MAX_WAIT_MS`; `KnowledgeService.requestReconcile(object)`.
  
  No migration: nothing an author writes changes, and a deployment that wants no scheduled walk sets `reconcile: false`.
- 58be677: feat(service-knowledge): record changes sync through the queue service — a save does not wait for the embedder, a failed sync is retried, a rolled-back write is never indexed
  
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
- 8d598aa: fix(service-knowledge): record changes reach the knowledge index on a kernel with no realtime service
  
  Clause-②: no
  Metadata-protocol: none
  
  On a kernel that composes no `realtime` service (every hosted kernel), the knowledge index was built once at boot and then never saw a later create, update or user delete: the engine publishes no `data.record.*` event there, so `KnowledgeServicePlugin` only warned "event sync disabled". It now registers the data engine's `afterInsert` / `afterUpdate` / `afterDelete` hooks on every object a record-change source indexes, and each hook calls the same `handleRecordUpsert` / `handleRecordDelete` the realtime subscription calls. A new record is searchable without a rebuild, an updated one is found by its new text, and a deleted one is gone.
  
  - **One trigger per kernel.** With a `realtime` service the subscription stays the trigger and no hook is registered, so each write is synced once.
  - **Off the write's response.** The hook only hands the sync off: the re-read, the split and the embed run after the write has answered, so a slow embedding provider no longer slows the write.
  - **After the commit.** The sync starts through the engine's `runAfterOpenUnitsCommit`: once the unit of work open at the write commits, and never when it rolls back.
  - **Predicate writes** (`multi: true`) are synced row by row, since an object with an `afterUpdate` / `afterDelete` hook gets one dispatch per matched row. Such a write is then held to the engine's per-row hook ceiling (10,000 matched rows), as on every object that already carries a per-row hook such as the audit plugin's: on a kernel with neither a `realtime` service nor the audit plugin, a predicate write over more than 10,000 rows of an indexed object is now refused, with nothing written. Narrow the write's `where` to stay under it.
  - **A source added later** for a new object gets its hooks when it arrives; the plugin's teardown removes them.
  - A recycle-bin restore runs no hooks, so on such a kernel a restored row is not re-indexed by itself; `reindexSource` brings it back.
- 0ea3093: feat(service-knowledge): `embedderSettings: false` keeps the embedder section off the ai settings page
  
  Clause-②: yes
  Metadata-protocol: none
  
  `KnowledgeServicePluginOptions` gains `embedderSettings` (default `true`). A host that provides the embedder itself (it registers the `embedder` service, which the plugin keeps) sets it to `false`: the `ai` settings page then carries no `embedder_*` fields, `ai/test_embedder` has no handler and answers like any undeclared action, and the boot warning about the embedder settings not being offered is not logged. The knowledge settings page, its actions and its Setup entry are unchanged. `contributeKnowledgeSettings` takes the same switch as an optional fourth argument (`KnowledgeSettingsContributionOptions`). Omitted or `true`, nothing changes. Nothing to migrate.
- Updated dependencies [34f7078]
- Updated dependencies [0b539b6]
- Updated dependencies [ab04434]
- Updated dependencies [abf1eeb]
- Updated dependencies [c23e556]
- Updated dependencies [b4c99b8]
- Updated dependencies [27ee984]
- Updated dependencies [dbe0716]
- Updated dependencies [3c53b85]
- Updated dependencies [0b87f12]
- Updated dependencies [b316afa]
- Updated dependencies [8b47659]
- Updated dependencies [a145e24]
- Updated dependencies [6e2a8f2]
  - @objectstack/spec@19.0.0-next.2
  - @objectstack/core@19.0.0-next.2
  - @objectstack/embedder-openai@19.0.0-next.2
  - @objectstack/service-settings@19.0.0-next.2

## 19.0.0-next.1

### Minor Changes

- 87af66e: feat(core): `requires: ['knowledge']` mounts the knowledge service and one vector store
  
  Clause-②: yes
  Metadata-protocol: added
  Skills-docs: follow-up #37310
  
  ADR-0161, #37102.
  
  - **New capability token `knowledge`** (`PLATFORM_CAPABILITY_TOKENS`, provider `@objectstack/service-knowledge`, edition `open`). `os serve` and `@objectstack/verify` mount `KnowledgeServicePlugin` plus exactly one store, picked from the primary database: PostgreSQL gets `KnowledgePgvectorPlugin` (adapter `pgvector`, on the same database URL); any other database gets `KnowledgeTursoPlugin` (adapter `turso`) on a local libSQL file, `knowledge.db` in the directory of the default database: `.objectstack/data/`, or `<OS_HOME>/data/` when `OS_HOME` is set (`os start --home` sets it). An in-memory database gets an in-memory turso store. The in-memory adapter (`knowledge-memory`) is never mounted by the token.
  - No token: no knowledge service and no knowledge settings page, as before. A host that mounts `KnowledgeServicePlugin` itself keeps its own and gets no store from the runtime; a host that mounts only the store the token would choose keeps that store and gets the service.
  - New core exports: `resolveCapabilityExtras`, `resolveKnowledgeStore`, `KNOWLEDGE_STORE_PROVIDERS` and the `CapabilityDatabase` / `CapabilityExtra` / `KnowledgeStoreSpec` types. `constructServedProviders` (`@objectstack/verify`) takes an optional `database` (default: in-memory SQLite).
  - `os serve` now warns when a capability's extra plugin cannot be imported or constructed, instead of skipping it silently.
  - **A source whose adapter is not mounted** no longer fails silently. The service still mounts and boot does not fail; after boot the service logs one `error` per such source naming the mounted adapters, and indexing or searching that source answers `SERVICE_UNAVAILABLE` (503) with the same message. A search across several sources names the refused one beside the hits of the others. Before, indexing threw an uncoded error and search skipped the source with a warning.
  - **The turso store reads its URL from settings under the token.** `KnowledgeTursoPlugin` gains `urlFromSettings`: with no `url` option it reads the saved `knowledge.turso_url` / `turso_auth_token`. It reads them when the boot completes (`kernel:bootstrapped`), the first moment the settings service answers a saved value; the adapter is mounted from `start()` and answers `SERVICE_UNAVAILABLE` until the store has opened. A saved `file:` URL must resolve, after symlinks, inside that data directory; a URL that leaves it, names the platform database, or carries a NUL byte or another control character, written out or percent-encoded (`%00`, `%0a`), is refused before the libSQL client sees it (the client decodes the path, and a NUL byte in it kills the process inside the native library). New option `stateDir` (the token passes `OS_HOME`); new exports: `resolveSettingsStoreUrl`, `dataDirectoryOf`. `resolveStoreUrl` refuses control characters too, in both spellings. An auth token carrying a control character (a pasted line break, a NUL byte), saved or given as the `authToken` option, is refused the same way, read as written: the store answers `SERVICE_UNAVAILABLE` with a reason that never quotes the token.
  - **`@objectstack/knowledge-turso` is an optional dependency of `@objectstack/cli` and `@objectstack/verify`**, not a hard one: its libSQL client is a native module with an `os` / `cpu` list, and a hard dependency would refuse the whole install outside that list. Where it is absent `os serve` warns that the store was not mounted and boots on, `@objectstack/verify` does the same, and a source naming `turso` answers `SERVICE_UNAVAILABLE`. `KNOWLEDGE_STORE_PROVIDERS.turso` and the extra `resolveCapabilityExtras` answers for it carry `optional: true`.
  - The `turso_url` setting's example path now reads `file:./.objectstack/data/knowledge.db` in every locale.
- d58bf7a: feat(spec)!: a knowledge source is a governed metadata type, `knowledge_source`, loaded by the knowledge service
  
  Clause-②: yes (narrowing)
  Metadata-protocol: narrowed
  Skills-docs: follow-up #37310. Here only the enumeration row: `skills/objectstack-platform/SKILL.md` lists the new top-level key `knowledgeSources`, and `skills/objectstack-ai/SKILL.md`'s compiled `supportKb` example writes `name` and `content`, because the 18 spelling no longer parses.
  
  <!-- adr-0087: registered knowledge-source-id-to-name, knowledge-source-content-fields-to-content, knowledge-source-inert-keys-removed, knowledge-source-content-lists-fields, knowledge-source-file-http-kinds-retired, knowledge-source-inert-keys-retired, knowledge-source-registration-governed -->
  
  ADR-0161 K4, K5, K6 and K8 item 4 (#37304).
  
  **BREAKING.** A knowledge source written for 18 is refused at parse until it is moved. `os migrate meta --from 18` lists every edit and `--write` applies the ones it can prove.
  
  | Wrote (18) | Write instead (19) |
  |:--|:--|
  | `id: 'support_kb'` | `name: 'support_kb'` (the value is unchanged, so the index is found again and nothing is rebuilt) |
  | `source.contentFields: ['title', 'body']` | `source.content: ['title', 'body']` |
  | `contentFields: ['*']` | `content` with every field named (a hand edit: only the author knows which fields may leave the row store) |
  | `embedding`, `vectorStore`, `adapterConfig`, `refresh.cron` | delete the key: nothing read it |
  | `source.kind: 'file'` or `'http'`, with `prefix`, `mimeTypes`, `urls`, `userAgent` | a source indexes the records of one object (`kind: 'object'`); a file or URL source has no replacement |
  | `knowledge.indexDocument(…)`, `knowledge.deleteDocument(…)` | no call: the service builds every document from the records a source selects; `reindexSource` rebuilds a source |
  | `KnowledgeServicePlugin({ sources: [{ id, … }] })`, `registerSource({ id, … })` | the same call with the 19 shape, or the source shipped as metadata in the stack's `knowledgeSources` |
  
  What changes:
  
  - **The type.** `knowledge_source` is registered in the metadata type registry with the one schema `KnowledgeSourceSchema`; a stack carries its sources in the new top-level collection `knowledgeSources`, in `*.knowledge-source.ts` or `.yml` files. An item can be created and changed at run time (Studio, MCP); it takes no environment overlay. Studio's menu lists the type, and the metadata form bundles carry its label in every locale. Two packages may each ship a source of one name (ADR-0150, addendum of 2026-11-25): each has its own index, and `search_knowledge` lists a package's source as `NAMESPACE-NAME` and takes that spelling in `sourceIds`.
  - **The schema is strict.** An undeclared key is refused, never dropped. `content` is a non-empty list of field names; an empty-string member is refused, and `'*'` is refused with the instruction to list the fields: embedding is egress, and the wildcard sent every text field of a record to the embedder, including one added to the object later. Credential-class and `internal` fields stay unindexed even when named.
  - **The loader.** `KnowledgeServicePlugin` reads the published items when it starts and follows the type while it runs: an added source is registered and built when a build is due; a changed one is registered again, and a changed `where` or `metadataFields` rebuilds inside the generation while a changed `content` or `split` builds a new one; a removed one is unregistered and its index dropped. The reap guard now follows the sources, so a retention delete on an object first indexed by a source added after boot de-indexes the row. A deployment that holds an item and mounts no knowledge service says so once at boot, naming the items.
  - **`IKnowledgeAdapter.dropSource?(ctx)`** removes everything an adapter holds for a source: every generation, the one under construction included, and what it recorded about the index. `knowledge-memory`, `knowledge-pgvector` and `knowledge-turso` implement it, and the contract suite (`@objectstack/service-knowledge/testing`) takes a new `implements.dropSource` declaration. Over an adapter without it, a removed source's index is kept and the service says so once. An adapter is handed the source's index key as `ctx.source.name` (it was `ctx.source.id`): the bare name for a source no package holds, so an existing index is found under the same key.
  - **A capability of its own.** New platform capability `manage_knowledge_sources`: a write of a `knowledge_source` through `/meta` (REST and the dispatcher: save, publish, rollback, delete) and through the MCP draft door needs it beside `manage_metadata`. Platform administrators hold it by default; a grant on the indexed object's records does not imply it. A caller without it is refused `403 PERMISSION_DENIED`, naming the capability. The package doors ask it too: every write to an existing package that holds a knowledge source (an item, a pending draft, or for the commit revert and the rollback a commit that touched one) needs the capability: enable, disable, publish, publish-drafts, discard-drafts, the commit revert, rollback, revert, adopt-orphans, duplicate, the manifest update and delete. A package that holds none is written as before. The install door is not asked, and neither is ensure-customization, which writes nothing of the base and creates an empty pair. For a caller without the capability the doors read the package's holding before their own request checks, so such a caller hears this `403` ahead of a `400`, `404` or `422` the door would have answered for the same request; a holding that cannot be read refuses `503` and changes nothing (a host with no metadata store holds none). A duplicate also admits each knowledge source it copies for the caller (source admission, below), and refuses the whole copy when one is refused.
  - **Source admission at save.** Those same doors save a source only when its author may themselves search what it would index: an object of a disabled package, an object the API does not serve for `search`, a system object without `enable.aiReadable`, or a field the author may not query refuses the save `403`, naming the object or the field; a verdict that cannot be reached, or a knowledge service that is registered and cannot be resolved, refuses `503`. The fields judged are the ones the source serves and the ones its `where` reads, at save and at search: a source whose `where` reads a field a caller may not query is not searched for that caller. Over MCP it is the human who is judged. Where no knowledge service is mounted there is nothing to ask, and the save goes on.
  - **One name, one source.** `KnowledgeServicePlugin({ sources })` and `registerSource` stay a door for the same schema and parse with it: a retired key is refused with its prescription (`400 VALIDATION_ERROR`), not converted. A source registered in code belongs to no package. It shares one slot with an environment-authored item of the same name, and the second of the two to arrive is refused `409 RESOURCE_CONFLICT`, naming both doors; a metadata item reloading its own earlier version is not a second arrival.
  - **The push door leaves.** `IKnowledgeService.indexDocument` and `deleteDocument` are removed, with the `file` / `http` branches that served them. They are runtime-interface-only members with no metadata form, so the compiler reports each call (`TS2339`).
  - **Removed exports**, twelve, all from `@objectstack/spec/ai`. The whole `embedding` module leaves with `embedding` and `vectorStore`, because the knowledge source was its only composer: `EmbeddingModelSchema`, `VectorStoreSchema`, `VectorStoreProviderSchema` and the types `EmbeddingModel`, `VectorStore`, `VectorStoreProvider`. The source kinds leave with `file` and `http`: `FileKnowledgeSourceSchema`, `HttpKnowledgeSourceSchema`, `KnowledgeSourceKindSchema` and the types `FileKnowledgeSource`, `HttpKnowledgeSource`, `KnowledgeSourceKind`. None has a replacement; an import of one is a compile error.
  - **CLI.** `os knowledge status` prints the package that holds a source and no longer prints a source kind.

### Patch Changes

- 9ed54cb: fix(service-knowledge, knowledge-pgvector): a build that loses its lease stops at the next page, and a build that stalls is cancelled
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  - **A build that loses its cluster lease stops.** Before each page, a build checks that it still holds its cluster lease. The lease counts as lost when the lock says so, or when no renewal has succeeded within the 60-second lease (the lock store is unreachable, or a renewal hangs). The build then stops before reading or embedding another page. It neither purges nor completes, and its record (`buildRecord`, `os knowledge status`) reads the new status `lease-lost`. Before this change the build only logged a warning and went on, so a second node could build the same source and the embedding spend doubled.
  - **A build that stalls is cancelled.** A build that finishes no page for 15 minutes (a fixed ceiling, not a setting) is cancelled, for example when an embedding call never answers. The walk stops waiting on that call and the lease is released. The record reads the new status `timed-out`, and a new rebuild can usually start without a restart; a purge deletion that never answers is the exception, since the store still lists that document and every later build waits on it in its purge until the deletion answers or the process restarts. The limit applies to the time between two pages (or two purge deletions), not to the whole build, so a large source that keeps making progress is never cut short. The completion (on pgvector, the switch to the new index and the removal of the replaced one) is not bounded: once it has begun the build waits for it, so a switch that began before the limit passed still commits and the record reads `done` or `failed`, and no other build of the source starts on that node until it settles.
  - **pgvector: a build that lost its builder lock writes and completes nothing.** Each write and removal of a build checks, on the lock's own session, that the source's session advisory lock is still held. Once the lock is gone (freed after `buildLockIdleMs`, or its session ended), the write is refused `LOCK_CONFLICT` (409) before anything is embedded. `completeBuild` completes only the build this adapter began, and only the generation that build began. Otherwise it is refused `LOCK_CONFLICT` and switches, records and deletes nothing, so a build that lost its lock can no longer switch a generation another build has taken up since. A lock kept from an earlier build is re-checked at the next `beginBuild`, so a session that ended is never taken for a lock that is still held. **Behind a transaction-mode connection pooler** (PgBouncer transaction pooling, or a hosted provider's pooled URL), a deployment the store already did not support, the advisory lock does not stay with the session that took it. The check therefore reads a held lock as lost, and every complete build is now refused `LOCK_CONFLICT` at its first page, where before it ran with a release warning. Point the store's `url` at a direct or session-mode endpoint; the refusal's remedy says so.
  - **pgvector: a search whose source's index was switched under it three times** is now refused `CONCURRENT_MODIFICATION` (409) instead of throwing an error with no code.
  
  Widening: the exported `KnowledgeBuildRecord.status` type gains `lease-lost` and `timed-out`. A consumer that switches over it should handle both the way it handles `failed`. No other export changes: the fence and its 15-minute limit are internal to the service.
  
  `os knowledge rebuild` and `os knowledge status` know the two new statuses: a followed rebuild that ends `lease-lost` or `timed-out` exits 1 with the build's message, as a `failed` one does.
- 1490855: fix(service-knowledge): a build checks its lease before `beginBuild` and before each purge deletion
  
  Clause-②: no
  Metadata-protocol: none
  
  - **A build cancelled or lease-lost while it waits its turn no longer begins.** A build queued behind another walk of the same source used to call the adapter's `beginBuild` once that walk ended, even when the build had meanwhile been cancelled (`timed-out`) or had lost its cluster lease. On pgvector that call takes the store's builder lock, which then stayed held until it went idle. The build now checks its lease first: it calls neither `beginBuild` nor anything after it, writes nothing, and its record ends `timed-out` or `lease-lost` as before, with a message that says it stopped before its build began.
  - **A build that loses its lease during its purge stops at the next deletion.** Before, a lost lease was noticed only once the whole purge had run, just before the completion. Each purge deletion now checks the lease first, so the purge stops before the next one, nothing is completed, and the record reads `lease-lost` with the number of deletions made. A build cancelled during its purge likewise deletes nothing further once the deletion it stopped waiting on answers.
  
  No export or adapter contract changes.
- Updated dependencies [0296d97]
- Updated dependencies [bb76b8c]
- Updated dependencies [d9bc148]
- Updated dependencies [c42a045]
- Updated dependencies [58570d8]
- Updated dependencies [81c68b3]
- Updated dependencies [eb683b8]
- Updated dependencies [561fe12]
- Updated dependencies [f722411]
- Updated dependencies [c3a4a30]
- Updated dependencies [b1c41e5]
- Updated dependencies [ea1b70a]
- Updated dependencies [dedc16c]
- Updated dependencies [adb65d1]
- Updated dependencies [adb65d1]
- Updated dependencies [87af66e]
- Updated dependencies [9f9db81]
- Updated dependencies [ddd5941]
- Updated dependencies [d58bf7a]
- Updated dependencies [bebc2cf]
- Updated dependencies [c3da753]
- Updated dependencies [9a65a48]
- Updated dependencies [9b99640]
- Updated dependencies [712df42]
- Updated dependencies [579b857]
- Updated dependencies [50b4bf8]
- Updated dependencies [6b7b305]
- Updated dependencies [91875c7]
- Updated dependencies [520cf3f]
- Updated dependencies [1bc265f]
- Updated dependencies [39fafc0]
- Updated dependencies [b1490f2]
- Updated dependencies [44ccf94]
- Updated dependencies [1dbf19a]
- Updated dependencies [14badad]
- Updated dependencies [f4d6bc5]
- Updated dependencies [ff63b02]
- Updated dependencies [5d37374]
- Updated dependencies [3e87d7b]
- Updated dependencies [8071f35]
- Updated dependencies [f07d63a]
- Updated dependencies [709a087]
- Updated dependencies [54dc93a]
- Updated dependencies [56c9cae]
- Updated dependencies [c826e8a]
- Updated dependencies [8fbae19]
- Updated dependencies [b620c4b]
- Updated dependencies [babd660]
  - @objectstack/spec@19.0.0-next.1
  - @objectstack/core@19.0.0-next.1
  - @objectstack/service-settings@19.0.0-next.1
  - @objectstack/embedder-openai@19.0.0-next.1

## 19.0.0-next.0

### Patch Changes

- a73edb3: fix(settings)!: the knowledge settings page and the AI page's embedder section appear only where the knowledge service is mounted
  
  Clause-②: no (narrowing) — narrowed: on a deployment that does not mount `KnowledgeServicePlugin` (every stock boot), `GET` / `PUT /api/settings/knowledge` and `POST /api/settings/knowledge/test` now answer `404 UNKNOWN_NAMESPACE`, where they served the Knowledge page; a write of an `ai.embedder_*` key (`embedder_provider`, `embedder_api_key`, `embedder_model`, `embedder_base_url`, `embedder_dimensions`, `embedder_batch_size`) now answers `400 UNKNOWN_KEY`, and `POST /api/settings/ai/test_embedder` answers that no handler is registered; the hub list no longer carries `knowledge`, and the Setup sidebar no longer carries `nav_settings_knowledge`. `builtinSettingsManifests` drops `knowledgeSettingsManifest`, and `aiSettingsManifest` drops its embedder section.
  Metadata-protocol: none
  Skills-docs: none — no skill under `skills/**` teaches the knowledge settings page or the `ai.embedder_*` keys; `skills/objectstack-ai` teaches wiring `KnowledgeServicePlugin`, which is unchanged.
  
  <!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: settings manifests are runtime registrations, not authorable metadata. The moved answers are settings doors that a deployment without the knowledge service no longer serves; a deployment that mounts it serves them exactly as before, and stored rows are untouched, so there is nothing for a migration to rewrite. -->
  
  **BREAKING** for a deployment that does not mount the knowledge service: the knowledge base is not a default capability, so its settings are no longer offered by default. The Knowledge page, the AI page's Embedder section, their "Test connection" / "Test embedder" buttons and the Setup entry are now contributed by `@objectstack/service-knowledge` when `KnowledgeServicePlugin` is mounted beside `SettingsServicePlugin`, and only then. Values already stored under `knowledge.*` or `ai.embedder_*` stay in the database and are served again as soon as the service is mounted.
  
  The AI page's description no longer names the knowledge base, in every bundled locale.
  
  `@objectstack/service-settings` now exports `knowledgeSettingsManifest`, `knowledgeTestActionHandler`, `aiSettingsManifest`, `aiEmbedderSettingsSpecifiers`, `withAiEmbedderSection` and `aiTestEmbedderActionHandler` from its package entry, and its default `actionHandlers` map no longer registers `knowledge.test` or `ai.test_embedder`. `@objectstack/service-knowledge` depends on `@objectstack/service-settings` and declares the settings plugin in `optionalDependencies`, so the kernel inits it first.
  
  What to do: nothing, unless you configure an embedder or a knowledge backend from Setup. Then mount `KnowledgeServicePlugin` from `@objectstack/service-knowledge` (with a knowledge adapter plugin) beside `SettingsServicePlugin`; the page, the embedder section and the Setup entry come back with it. A host that passed its own `ai` manifest to `SettingsServicePlugin({ manifests })` adds `aiEmbedderSettingsSpecifiers` to it (or wraps it with `withAiEmbedderSection`) to keep the embedder keys. The embedder section joins only the bundled `ai` page, recognised as that very declaration; a host's own `ai` page (or one served through an option source) is left as it is, and the plugin logs a warning saying so. A host that passes its own `actionHandlers` to `SettingsServicePlugin` keeps a `knowledge` entry there only beside the knowledge manifest: without it the settings plugin refuses to register the handler for an unknown namespace at boot.
  
  Stored credentials: on a deployment that does not mount the knowledge service, `ai.embedder_api_key`, `knowledge.turso_auth_token` and `knowledge.ragflow_api_key` stay stored (as `sys_secret` handles) but no settings door serves, edits or clears them, and the AI page's reset clears declared keys only. To remove them, mount `KnowledgeServicePlugin` once and clear the keys from Setup, or delete their rows from `sys_platform_setting` (the `knowledge` namespace and the `ai.embedder_*` keys) and the `sys_secret` rows whose `id` those rows hold in `value_enc` (a `sec_` handle); until then the `sys_secret` orphan report may list them.
- 8aecf6d: feat(mcp,service-knowledge): the MCP door serves `search_knowledge`, and a skill MCP withholds is no longer withheld in silence
  
  Clause-②: yes
  Metadata-protocol: none
  
  **`search_knowledge` over MCP.** An app that mounts the knowledge service (`KnowledgeServicePlugin`) now has its knowledge sources searchable from any MCP client: `tools/list` lists `search_knowledge` wherever the kernel holds a `knowledge` service and the connection's grant reaches the read family (`data:read`, or an API key or session, which carry no OAuth grant). Before, no MCP connection served a knowledge tool, so a BYO-AI client could not reach an app's knowledge base at all, and every skill whose `tools` named `search_knowledge` was dropped from `prompts/list`.
  
  - **One definition, one executor (ADR-0149 D2).** `@objectstack/service-knowledge` exports the tool's `AIToolDefinition` (`getKnowledgeToolDefinitions`) and its executor (`createKnowledgeTools`, also `KnowledgeService.knowledgeTools()`). The MCP door registers the definition as the service hands it over, on HTTP and on stdio, and holds no copy of its description or argument schema. Arguments: `query` (required), `sourceIds` (at least one id; omit it to search every source, and an empty list is refused `VALIDATION_ERROR` rather than answered with no passage), `topK` (1 to 20, default 5); any other key is refused before the search runs.
  - **As the caller.** Each call runs with the caller's execution context, and the knowledge service re-checks every passage indexed from a record against the caller's row-level security; on an OAuth connection that is the delegating person's own reach.
  - **Only `aiExposed` sources.** The tool searches only the sources whose `aiExposed` is not `false`, and refuses a `sourceIds` entry naming any other source with `NOT_FOUND` and the sentence an unknown id gets, so an agent never learns a withheld source exists. `IKnowledgeService.search` itself is unchanged: it still searches a source its caller names explicitly, because it also serves platform callers that are not agents.
  - `MCP_DOOR_TOOL_NAMES` (`@objectstack/spec/system`) lists `search_knowledge`, so `os lint` resolves it for a skill offered over MCP, as it already did through the platform registry.
  
  **A withheld skill is said, twice.**
  
  - **Authoring time.** The `ai-skill-tool-unresolved` rule gains a verdict for a skill MCP would offer as a prompt (`instructions`, not `mcpPrompt: false`, not `active: false`) whose `tools` names one of the `ask` product's data tools no MCP connection serves (`aggregate_data`, `query_data`, `visualize_data`): the name resolves, but MCP withholds the skill from every `prompts/list`, and the warning names the tool. Fix: bind tools both doors serve, or set `mcpPrompt: false` on a skill written for the in-product agents.
  - **Runtime.** On the HTTP door, each `prompts/list` that withholds a skill logs one `debug` line naming the skill and each bound tool the connection does not serve.
- 7abf25f: fix(service-knowledge): knowledge search asks the object's API exposure and the caller's field-level read rules before it searches a source
  
  Clause-②: no
  Metadata-protocol: none
  
  A knowledge passage is built at index time, under a system context, from every `contentFields` member of its source, the record `title` and the source's `metadataFields`. Knowledge search re-checked only that the caller may read each hit's row, so a caller who could read a row but not one of those fields was served that field's text, and an object the API does not serve was served as passages. `KnowledgeService.search` now decides, for a non-system caller and once per object per search, whether each `object` source may be searched at all:
  
  - the object's owning package is not disabled;
  - the spec's exposure decision serves the object for the `search` operation (`enable.apiEnabled: false`, or an `enable.apiMethods` whitelist that does not grant `search`, refuses);
  - a `sys_*` object declares `enable.aiReadable: true`;
  - every field the source serves (each `contentFields` member, `'*'` meaning every declared field except `id`; each `metadataFields` member; `title`), less the credential-class and `internal` fields an index never carries, is one the caller may query, per the `security` service's `getQueryableFields` (absent it, `getReadableFields` less every field declaring a `maskingRule`; with no `security` service, every field except those declaring a `maskingRule`).
  
  A source that fails any gate is not searched for that caller. Every gate fails closed: a lookup that throws, or a `security` service that answers neither field question, keeps the source out. `KnowledgeServicePlugin` wires the `security` service, resolved per search: a missing answer or the kernel's not-registered refusal reads as "no security service"; any other throw from that lookup (a registration that cannot be used) refuses the sources, reported at `error` once per object per search. A host constructing `KnowledgeService` directly passes it as the new optional `resolveSecurity` option. The system context bypasses the gates, as it bypasses the row re-check.
  
  Three adjacent holes close with it. A caller with no execution context, or a service with no data engine bound, is now searched no `object` source at all, where before an object-source hit carrying no `sourceRecordId` was served to it. An admitted object source's hit with no `sourceRecordId` cannot be re-checked and is dropped. `KnowledgeService.search` drops a hit whose reported `sourceId` names another source than the one searched; it sees only what an adapter reports.
  
  **Narrowing for restricted callers.** A caller who may read a source's rows but not one of the fields the source serves now gets no hits from that source, where before it got passages carrying that field's text. A caller of an `apiEnabled: false` object, of an object whose `apiMethods` do not grant `search`, of a disabled package's object, or of a `sys_*` object without `enable.aiReadable: true` now gets no hits from its sources. No metadata key changes. To keep a source searchable for restricted callers, declare its `contentFields` / `metadataFields` from fields every intended reader may query and move sensitive fields into a separate source.
- eec6fb3: fix(service-knowledge): record-change sync honours the source `where`, and a restored record re-enters the index
  
  Clause-②: no
  Metadata-protocol: none
  
  An `object` knowledge source's `where` (for example `{ status: 'published' }`) was applied only by `reindexSource`. On a record change the sync built the document straight from the event payload, so a draft was indexed, a record that stopped matching stayed searchable with its old text, and a record restored from the recycle bin never came back into the index.
  
  - **The database decides membership on the event path too.** For a created, updated or restored record, with a data engine bound, each source now re-reads the row under the system context with `where AND id`, one row. A row comes back: the document is built from that row, through the same field rules as a reindex (the fields the source lists and the record `title`, never a credential-class or `internal` field). No row comes back: the record's document is deleted. A write result that omits a field no longer leaves the document short.
  - **`data.record.restored` is synced** through the same path, so a restored record is searchable again only if it matches the source.
  - **No data engine bound:** a source without `where` still builds from the event payload; a source with `where` is not synced, and the service says so once per source at `warn`.
  - **One document at a time.** Syncs of the same document run one after another in the process, so two opposite events for one record end with the index agreeing with the database. A write's sync can wait behind an earlier in-flight sync of the same document.
  - The sync runs before the write's unit of work commits (it re-reads inside the same transaction). A rolled-back write leaves the index wrong until the record's next event or a `reindexSource`, in one of two ways: if the uncommitted row matched, the document stays built from a row that never committed; if it did not match, the document was deleted, so the committed row, which may still match, is missing from the index. Bulk `data.records.*` events are still not synced. `content/docs/protocol/knowledge.mdx` states both.
  
  Nothing to change in an app: the same `where` now holds on both paths.
- bee9b68: fix(service-knowledge): `reindexSource` reads and indexes an object source one page at a time
  
  Clause-②: no
  Metadata-protocol: none
  
  `reindexSource` read the whole object in one `find` with no `limit` and pushed every document to the adapter in one `upsert`, so reindexing a large object could exhaust memory or exceed the adapter's request budget.
  
  - **Paged by id.** The walk reads at most 100 rows per `find`, ordered by `id`, each page continuing after the last id of the one before (`where AND id > cursor`), and upserts each page in its own adapter call before reading the next. Every `find` now carries a `limit`, and no `upsert` holds more than one page. Each row goes through the same field rules as the record-change sync. Only an empty page ends the walk: a page that comes back short (an `afterFind` hook may drop rows) is followed by the next one.
  - **`limit` still caps the total** number of rows a reindex takes; the last page is shortened to it. A fractional `limit` is rounded down; a negative or non-finite one is refused with `ok: false` and nothing is read.
  - **`dryRun` asks `count`** under the source's `where` instead of reading rows, and reports that count, capped by `limit`.
  - **A failed page ends the run with `ok: false`** instead of a thrown error. The `message` names the page and the id it continued after; `discovered` and `indexed` count the pages done before it, which stay in the index. A page whose last row has no id, or an engine that does not honour the id condition, also ends the run with `ok: false` instead of looping.
  - **Reindexes of one source wait for each other** in a process: a second `reindexSource` of the same source starts only after the first has finished, so the two never interleave. Different sources still reindex concurrently. Record-change syncs do not wait for a reindex: a record updated or deleted between a page's read and that page's upsert is written back from the older read, and a deleted record's document then stays until the index purge (#37096).
  - A reindex removes no documents: those of records that no longer exist or no longer match stay until the index purge (#37096). The bulk-write warning and `content/docs/protocol/knowledge.mdx` now say so instead of recommending a reindex to repair a predicate delete.
  
  Nothing to change in an app. A caller that caught a thrown error from `reindexSource` should read `ok` and `message` on the result instead.
- 039b288: fix(service-knowledge): search refills after the permission filter, and a hit's title is the object's display field
  
  Clause-②: no
  Metadata-protocol: none
  
  - **Search refills after the permission filter.** The permission re-check runs after ranking, so a caller who may read few of the matching rows used to get a short or empty answer. For a caller who is not the system identity, each `object` source is now asked for `topK × 5` hits; when the hits that survive the re-check name fewer than `topK` records (several passages of one record count once), each `object` source that answered as many as it was asked is asked once more, for `topK × 20` (the cap). At most two rounds; an adapter that answers fewer than it was asked is not asked again. A `file` / `http` source, and every source for the system identity, is asked for `topK` once. The answer is still at most `topK` hits; how many the re-check removed is logged at `debug`, never returned.
  - **A hit's title is the object's display field** (ADR-0161 K5; ADR-0079 `resolveDisplayField`: `nameField`, else the derived title field), not a field that happens to be named `title`. A credential-class or `internal` display field, an empty value, or an object with no display field gives no title; a source over an object with no registered definition still reads `title`. The source admission's field gate asks about the same field: a source whose object's display field the caller may not query is not searched for that caller at all. A declared field named `title` still gates the source too, because documents indexed before this change carry its value until a complete reindex writes them again.
  - The title enters `docHash`, so the next complete reindex rewrites the documents whose title changed.
- c349576: fix(settings)!: `@objectstack/knowledge-ragflow` is retired, and the Knowledge settings page no longer offers the RAGFlow adapter
  
  Clause-②: no (narrowing) — narrowed: `PUT /api/settings/knowledge` refuses `adapter: 'ragflow'` (`400 SETTINGS_VALIDATION`, field code `invalid_option`) and refuses `ragflow_base_url`, `ragflow_api_key` and `ragflow_default_dataset` (`400 UNKNOWN_KEY`), where it stored all four; `POST /api/settings/knowledge/test` answers `adapter = ragflow` as an unknown adapter (`400 SETTINGS_ACTION_FAILED`), where it answered a form check
  Metadata-protocol: none
  Skills-docs: updated here — `skills/objectstack-ai/SKILL.md` and its eval case 3 teach the `pgvector` adapter where they taught `ragflow`; `content/docs/protocol/knowledge.mdx`, `content/docs/ai/knowledge-rag.mdx` and `content/docs/ai/index.mdx` name the adapters this repository builds.
  
  <!-- adr-0087: not-required (runtime-export-retired @objectstack/knowledge-ragflow#*) the package is deleted whole: what it published (`KnowledgeRagflowPlugin`, `KnowledgeRagflowAdapter` and their option types) is runtime code a host registers; no `packages/spec` schema, metadata type or stored shape names it, and `KnowledgeSource.adapter` stays a free string, so there is nothing for `objectstack migrate meta` to rewrite. The settings half has the same answer: a settings manifest is a runtime registration, not authorable metadata; the narrowed answers are doors of one settings namespace, and stored rows are untouched. -->
  
  **BREAKING** for a deployment that saved the RAGFlow adapter on the Knowledge settings page, or that registers `KnowledgeRagflowPlugin`.
  
  The package `@objectstack/knowledge-ragflow` is removed from this repository and gets no further release. Its requests did not match the RAGFlow HTTP API (it wrote and filtered on chunk metadata the API neither stores nor returns), so a knowledge source bound to it never retrieved anything, and nothing reported that. It is retired rather than repaired; the last published version stays on npm and will be marked deprecated.
  
  On the Knowledge settings page (`knowledge` namespace, manifest `version` 3):
  
  - The **Adapter** select offers `memory` and `turso`. The `ragflow` option, the RAGFlow group and its three keys (`ragflow_base_url`, `ragflow_api_key`, `ragflow_default_dataset`) are gone, with their strings in all eleven bundled locales.
  - A stored `adapter = ragflow` is still served as stored, since the settings service never rewrites a stored value. The Console shows the Adapter select with nothing selected. Saving other keys works; saving `ragflow` again is refused; "Test connection" answers "Unknown adapter: ragflow". No code ever read this setting, so nothing else changes behaviour.
  - Stored rows for the three removed keys are kept, never deleted. The page no longer serves them, and no settings door clears them, the encrypted `ragflow_api_key` included.
  
  What leaves, and what to write instead:
  
  - FROM `@objectstack/knowledge-ragflow` TO an adapter package this repository builds: `@objectstack/knowledge-pgvector` (`adapter: 'pgvector'`, PostgreSQL with pgvector), `@objectstack/knowledge-turso` (`adapter: 'turso'`, a libSQL file) or `@objectstack/knowledge-memory` (`adapter: 'memory'`, development and tests). Fix: stop registering `KnowledgeRagflowPlugin`, remove the dependency, and bind your sources to one of those; to keep an external engine, register your own `IKnowledgeAdapter` under an id of your choice.
  
  On a deployment that used it, also:
  
  - A knowledge source that still names `adapter: 'ragflow'` with no such adapter registered boots without an error: searches over it answer no hits and log `references unknown adapter`, and indexing it throws `unknown adapter 'ragflow'`. Change the source's `adapter`.
  - Pick an adapter on the Knowledge settings page and save, which replaces the stored `ragflow` value.
  - To remove the stored API key, delete the `knowledge` rows named `ragflow_base_url`, `ragflow_api_key` and `ragflow_default_dataset` from `sys_platform_setting`, and the `sys_secret` row whose `id` the `ragflow_api_key` row holds in `value_enc` (a `sec_` handle). Until then the `sys_secret` orphan report may list it. An earlier note in this release says mounting the knowledge service and clearing the key from Setup removes it; for `ragflow_api_key` that no longer applies, because the page no longer declares the key.
  
  Also in this change, text only: `@objectstack/spec` comments on `KnowledgeSource.adapter`, `KnowledgeSource.embedding`, `IKnowledgeAdapter` and `IKnowledgeService` name adapters that exist; the `@objectstack/service-knowledge` README and package description, and the `@objectstack/embedder-openai` README, name the adapters this repository builds (the embedder README now says which of them take an `embedder`).
  
  In `@objectstack/skills`, `skills/objectstack-ai/SKILL.md` (*Knowledge Sources (RAG)*, rewritten in place, 487 lines and 6798 tokens before and after):
  
  - The wiring paragraph names `@objectstack/knowledge-memory` (`'memory'`, dev/test), `@objectstack/knowledge-pgvector` (`'pgvector'`) and `@objectstack/knowledge-turso` (`'turso'`), where it named the retired package and `'ragflow'`.
  - The example source uses `'pgvector'`. An agent following the old example wrote a source bound to an adapter that never retrieved anything. The `adapter` row no longer repeats example ids, and the `embedding` row no longer names engines no adapter here serves.
  - The splitting paragraph says which adapters take the service's passages (`memory`, `pgvector`, `turso`); any other adapter receives whole documents.
  - `evals/skills-tools-knowledge.json`, case 3: the prompt says the deployment runs PostgreSQL with pgvector, and the expected answer writes `adapter: 'pgvector'` and no `split` key, because the default `recursive` split fits article prose. The case keeps what it exercised (an object source with `where`, `metadataFields` and `refresh`, registered through `KnowledgeServicePlugin`); the in-memory adapter is already case 9.
- b8c8c88: feat(service-knowledge): the open edition registers `EMBEDDER_SERVICE` from the `ai.embedder_*` settings when the knowledge service is mounted
  
  Clause-②: yes (widening) — `@objectstack/embedder-openai` gains one export, `documentedMaxBatchSize(model): number | undefined`
  Metadata-protocol: none
  
  - **An embedder from the settings page.** `KnowledgeServicePlugin` reads the saved `ai.embedder_*` settings once, at `kernel:bootstrapped`, and registers an `@objectstack/embedder-openai` embedder as `EMBEDDER_SERVICE` (`'embedder'`) for the saved provider. The saved Base URL applies only to the custom and Azure providers; other providers use their preset endpoint. The boot line names the endpoint host. "Saved" means any layer but the manifest default, an `OS_*` override included; `ai.embedder_dimensions` and `ai.embedder_batch_size` are read as positive integers whether they arrive as numbers or as text (an `OS_AI_EMBEDDER_DIMENSIONS=256` override), and a value that is not one is refused with a `warn`, not dropped. Completeness is the Test embedder button's own check. `@objectstack/service-knowledge` now depends on `@objectstack/embedder-openai`.
  - **An embedder already registered is kept.** One registered by ObjectOS Cloud or by a host's own plugin in `init()`, `start()` or a `kernel:ready` handler is kept, with one `info` line, and the settings are not applied.
  - **The batch size is passed only when it was saved, and is held to the model's documented cap.** Unsaved (the form shows 64), the embedder batches at the model's documented cap. Saved, it is passed as `min(saved, documented cap)` when the saved model has a documented cap (DashScope `text-embedding-v3`: a saved 64 sends 10 per request), and as saved for a model with none.
  - **No embedder configured: the boot succeeds, and every use of the embedder answers an error naming the missing settings.** With no provider saved, `none` saved, or incomplete settings, `EMBEDDER_SERVICE` is an embedder whose `embed()` and `dimensions` refuse with that reason and the restart it needs, so an adapter that embeds refuses indexing and search with it. Nothing is sent to a provider until one is saved, and the API key is never logged or put in an error.
  - **A saved change waits for a restart, and the page says so** — help under the Embedder provider field (`@objectstack/service-settings`, all locales). There is no hot replacement.
  - **New export `documentedMaxBatchSize(model)` from `@objectstack/embedder-openai`**: the provider-documented per-request input cap for a model, read from the same known-model table `OpenAIEmbedder` batches by, or `undefined` for a model the table does not document. Read-only. `OpenAIEmbedder` is unchanged: an explicit `maxBatchSize` passed to it directly is still used as given, above the documented cap included.
  - If your own plugin registers `EMBEDDER_SERVICE` after `kernel:ready` (in `kernel:bootstrapped` or later, or after boot), move that registration into `init()`, `start()` or `kernel:ready`: the knowledge plugin has registered one by then, and a second registration of the name is refused.
- d7f299c: feat(service-knowledge): adapters list their documents; a complete reindex skips unchanged documents and purges the ones its source no longer has; one adapter contract test suite
  
  Clause-②: yes
  Metadata-protocol: added
  Skills-docs: none — no skill under `skills/**` teaches `KnowledgeDocument`, the adapter contract or reindex; `skills/objectstack-ai/SKILL.md` teaches `KnowledgeSource` authoring only, which this change does not touch. `content/docs/protocol/knowledge.mdx` gains the members, the skip and the purge in this change.
  
  Knowledge adapters can now list the documents they hold, and a full reindex uses that list to skip unchanged documents and to remove documents whose record is gone.
  
  New, all optional, in `@objectstack/spec`:
  
  - `IKnowledgeAdapter.listDocuments?(ctx, { cursor?, limit })` returns `{ documents, nextCursor? }`, each entry `{ documentId, docHash? }`: the documents the adapter holds for a source, one page at a time. New exported types in `@objectstack/spec/contracts`: `AdapterListDocumentsOptions`, `AdapterListedDocument`, `AdapterListDocumentsPage`.
  - `KnowledgeDocument.docHash?`: a hash of the document's content, title and metadata, prefixed `v1:`. The knowledge service sets it on every document it hands an adapter; the adapter stores it and returns it unchanged. `indexDocument` refuses a document that already carries a `docHash` (it throws, naming the field).
  - `KnowledgeReindexResult.skipped?` and `purged?`.
  
  `KnowledgeService.reindexSource` for an `object` source, when the source's adapter implements `listDocuments`:
  
  - does not send a document to the adapter again when its hash is unchanged, and counts it in `skipped`;
  - after a full run (no `limit`, no `dryRun`, every page read), deletes each listed document whose record no longer exists or no longer matches the source's `where`. Before each deletion it reads the record again; a record that exists at that moment keeps its document. A deletion never overlaps a sync of the same record. `purged` counts the deletions. Known limit: on driver-mongodb and driver-memory, a record stored under a caller-supplied numeric id is not found by that re-read, so if it was restored during the run its document is deleted until the record's next change or the next full reindex.
  
  `purged` is `null` when nothing was deleted because no removal ran: the adapter has no `listDocuments`, the run had a `limit` or `dryRun`, a page failed or answered no list of rows, the source sets `refresh.onRecordChange: false`, or the adapter's listing failed (the `message` says why). If a re-read or a deletion fails, the result is `ok: false` and `purged` counts the deletions made before it.
  
  The record sync (on record create, update and restore) now leaves a document in place and logs a warning when the data engine answers its re-read with something other than a list of rows; it used to delete the document.
  
  `@objectstack/service-knowledge/testing` (new, test-only, ESM only; it imports `vitest`) exports `runKnowledgeAdapterContract({ name, makeAdapter, implements: { listDocuments } })`, a test suite any adapter package runs with its own factory: upsert, search and delete; `listDocuments` paging and `docHash` round-trips; and the skip and the removal through a real `KnowledgeService`. `@objectstack/knowledge-memory` implements `listDocuments` and runs the suite.
  
  What to do: nothing. An adapter without `listDocuments` keeps working; its reindex sends every document, as before, and reports `purged: null`. An adapter package adds `listDocuments` (storing `docHash` as given) to get the skip and the removal, and runs the suite from `@objectstack/service-knowledge/testing` with its own factory. A caller of `indexDocument` stops setting `docHash`.
- f9fda2a: feat(service-knowledge): knowledge documents carry their organization, and a search hands the adapter the caller's organizations so it ranks only their documents
  
  Clause-②: yes
  Metadata-protocol: added
  Skills-docs: none — no skill under `skills/**` teaches `KnowledgeDocument`, `AdapterSearchOptions` or the adapter contract suite; `skills/objectstack-ai/SKILL.md` teaches `KnowledgeSource` authoring only, which this change does not touch. `content/docs/protocol/knowledge.mdx` gains the members and an "Organization scope" section in this change.
  
  In a deployment with more than one organization, a knowledge search now ranks only the documents of the caller's organizations, so another organization's documents no longer take the top places. Which hits the caller gets back is still decided by re-reading each record as the caller, as before.
  
  New, both optional, in `@objectstack/spec`:
  
  - `KnowledgeDocument.organizationId?`: the organization of the record a document was built from. The knowledge service sets it from the record's `organization_id` under the `group` and `isolated` tenancy postures. It is absent under `single`, for `file` and `http` sources, and for a record with no organization. `indexDocument` refuses a document that already carries one (it throws, naming the field).
  - `AdapterSearchOptions.organizationIds?`: the caller's organizations. The knowledge service computes it from the caller's execution context and the deployment's tenancy posture: under `isolated` the active organization, under `group` every organization the caller is a member of. It is absent (no filter) under `single`, for the system identity, for `file` and `http` sources, and for an object outside the tenancy wall. `[]` means the caller has no organization behind a wall and must match nothing; it never means "no filter". An adapter that reads it ranks only the documents whose `organizationId` is in the set and filters before it ranks; a document with no `organizationId` is not ranked.
  
  `docHash` now covers `organizationId` when a document has one. A document without one hashes exactly as before, so nothing changes under `single`.
  
  `KnowledgeService` reads the deployment's effective tenancy posture from the kernel's `tenancy` service (`KnowledgeServicePlugin` wires it; new option `resolveTenancyPosture`). If the posture cannot be read, a search does not search any `object` source for that call and logs an error, and a reindex stops before writing and returns `ok: false` with the reason. `recordToDocument` takes the posture as an optional fifth argument. The `search_knowledge` tool refuses an `organizationIds` argument: the organizations are never taken from the caller.
  
  `@objectstack/knowledge-memory` stores `organizationId` and filters by `organizationIds` before ranking. `runKnowledgeAdapterContract` (from `@objectstack/service-knowledge/testing`) now requires `implements.organizationIds`. It adds organization-filter cases for the adapter alone, and cases run through a real `KnowledgeService` under `isolated`, `group` and `single`.
  
  What to do: under a `group` or `isolated` posture, run a complete reindex of each `object` source (`reindexSource` with no `limit`). Documents indexed before this change carry no organization, and a filtered search does not rank them until that reindex writes them again; their hash changes, so the reindex does not skip them. An adapter package reads `organizationIds` in its search, stores `organizationId` as given, and passes `implements: { listDocuments, organizationIds }` to the contract suite.
- 91138ec: feat(service-knowledge)!: one splitter in the knowledge service (whole / recursive / markdown, aware of Chinese text), the chunk channel to adapters, and the `split` key on an object source; `KnowledgeChunk.metadata` and the Knowledge page's chunk overlap retired
  
  Clause-②: yes (narrowing) — widens the knowledge contract (the `split` key, `chunks`, `headingPath`, the adapter's `capabilities` and `embedding`, `IEmbedder.maxInputTokens`, the reindex `failed` / `failures`) and narrows two accept sets: `KnowledgeChunk.metadata` is refused, and `knowledge.chunk_overlap` is no longer a key of the `knowledge` settings namespace
  Metadata-protocol: narrowed
  Skills-docs: none in this change — `skills/objectstack-ai/SKILL.md` lists the object source's keys and does not yet name `split`, and names neither retired key; that file is a governed surface outside this change, so teaching the new key is left to its owner. `content/docs/protocol/knowledge.mdx` (new section 3.5) and `content/docs/ai/knowledge-rag.mdx` document the key, the strategies, the limits and the removals in this change.
  
  <!-- adr-0087: registered knowledge-chunk-metadata-retired -->
  
  **BREAKING** in two places, each with its fix:
  
  - `KnowledgeChunk.metadata` (`@objectstack/spec/ai`): FROM an optional `Record<string, unknown>` accepted and stripped TO a `retiredKey()` tombstone — `KnowledgeChunkSchema.parse()` (and a `KnowledgeDocument` whose `chunks` carry one) refuses it with the prescription, and `tsc` types the key `never`. Nothing ever wrote or read it: the knowledge service cuts the passages and sets no per-passage metadata, and no adapter consulted one. The fix: delete the key; a passage takes its document's `metadata` (`KnowledgeDocument.metadata`), which is what adapters filter on. D3 entry: `knowledge-chunk-metadata-retired`.
  - `knowledge.chunk_overlap` (the Knowledge settings page's **Chunk overlap**): FROM a `number` key of the `knowledge` settings namespace (default 80) TO no key — the page no longer shows it, the service no longer resolves it, and a write naming it is refused `400 UNKNOWN_KEY`. Nothing ever read it and the splitter cuts without overlap, so a value set there never had an effect. A stored value is kept, never deleted. The fix: stop writing the key (a script or seed that sets it); there is nothing to replace it with. **Target chunk size** (`knowledge.chunk_target`) is the setting that now shapes passages.
  
  The knowledge service now cuts documents into passages itself, once, and hands the same passages to every adapter that accepts them, so one source gives the same passages on each adapter.
  
  New in `@objectstack/spec`, all optional:
  
  - `ObjectKnowledgeSource.split?`: `{ strategy: 'whole' | 'recursive' | 'markdown', maxChars?, minChars? }`. Omitted, documents are cut `recursive`. New exports `KnowledgeSplitSchema`, `KnowledgeSplitStrategySchema` and the types `KnowledgeSplit`, `KnowledgeSplitStrategy` (`@objectstack/spec/ai`).
  - `KnowledgeDocument.chunks?`: the document's passages, set by the service. `KnowledgeChunk` gains `headingPath?` (the headings a passage sits under, outermost first); its `id` is set by the service to `documentId#index`.
  - `IKnowledgeAdapter.capabilities?: { chunks?: boolean }`: an adapter that sets `chunks: true` receives every document with `chunks` and indexes those passages as given. An adapter that does not set it receives whole documents, without `chunks`, as before.
  - `IKnowledgeAdapter.embedding?: { maxInputTokens? }` and `IEmbedder.maxInputTokens?`: the longest input the adapter's embedder accepts, in tokens. The service reads it each time it splits. New exported types `AdapterCapabilities`, `AdapterEmbeddingDescriptor` (`@objectstack/spec/contracts`).
  - `KnowledgeReindexResult.failed?` and `failures?` (`[{ documentId, reason }]`, at most 20 named; `failed` counts all).
  
  How the service cuts (`@objectstack/service-knowledge`):
  
  - `recursive` cuts at blank lines, then line breaks, then sentence ends, then semicolons, then characters. `。？！` end a sentence anywhere; `. ? !` only before whitespace or the end of the text, so 「3.2 条」 and 「400.50 元」 stay whole; an end mark followed by a closing quote or bracket ends nothing. A Markdown table or list item is never cut while it fits; a table that does not fit is cut between rows, each piece repeating the header row. Adjacent pieces shorter than `minChars` (default 200) are merged.
  - `markdown` cuts one section per heading; every passage begins with its heading path, which counts toward its length and is embedded, and carries it as `headingPath`.
  - `whole` keeps one passage per document.
  - A passage is at most `split.maxChars` characters, else the settings page's `knowledge.chunk_target`, else 800; and, when the adapter reports `embedding.maxInputTokens`, its `estimateTokens` is at most 80% of that limit.
  - A `whole` document over that budget is removed from the index and reported, never truncated: `reindexSource` counts it in `failed` and names it in `failures`, the record event sync logs it at `error` (source, record id, estimate, limit), and `indexDocument` throws. With no limit known nothing is checked.
  - `indexDocument` refuses a document that already carries `chunks` (it throws, naming the field), as it refuses `docHash`.
  - Known limit: `docHash` does not cover the passages, so a changed `split`, `chunk_target` or embedder limit re-splits a document only when the document itself next changes. The index fingerprint (ADR-0161 K7) will rebuild a source when its split changes.
  
  `@objectstack/knowledge-memory` no longer splits documents itself: it declares `capabilities.chunks` and indexes the service's passages as given (a document handed to it directly without `chunks` is one passage of its whole text). Its hits are now the service's passages, with the service's `chunkId`s.
  
  `@objectstack/embedder-openai`: `OpenAIEmbedder.maxInputTokens` is now public (`IEmbedder.maxInputTokens`): the `maxInputTokens` option, else the model's documented limit from the known-model table, else absent.
  
  `@objectstack/service-settings`: the Knowledge page's **Target chunk size** (`knowledge.chunk_target`) is now read: it is the splitter's `maxChars` beneath a source's own `split.maxChars`, and it is shown for the in-memory adapter too. **Chunk overlap** (`knowledge.chunk_overlap`) is retired: nothing ever read it and the splitter cuts without overlap. The `knowledge` manifest is now `version: 2`. A stored value for it is kept, never deleted; it is no longer shown or resolved, and a write naming it is refused `400 UNKNOWN_KEY`.
  
  `@objectstack/service-knowledge/testing`: `runKnowledgeAdapterContract`'s `implements` gains a required `chunks: boolean` (whether the adapter sets `capabilities.chunks`), and the suite runs the chunk-channel cases for it.
  
  What to do:
  
  - An adapter package that runs `runKnowledgeAdapterContract`: add `chunks: false` to `implements` (or `chunks: true` once the adapter takes the service's passages).
  - An adapter that wants the service's passages: set `capabilities: { chunks: true }`, index each `doc.chunks` entry as given, and report its embedder's limit as `embedding.maxInputTokens` (from `IEmbedder.maxInputTokens`), from a getter if the embedder resolves late.
  - A caller of `indexDocument` stops setting `chunks`.
  - A deployment that set **Chunk overlap**: nothing to do; the value had no effect and keeps having none. A script or seed that writes `knowledge.chunk_overlap` drops the key.
  - Code or a test that builds a `KnowledgeChunk` with `metadata`: delete the key; filter on the document's `metadata`.
  
  The retirement kit: the `retiredKey()` tombstone on `KnowledgeChunkSchema.metadata` in `ai/knowledge-document.zod.ts`, `RETIRED_KEYS_BY_MAJOR[18]` row `ai/KnowledgeChunk:metadata`, D3 `knowledge-chunk-metadata-retired` with its step-18 rationale fragment (no D2 conversion: a chunk is a runtime contract shape, never stored in stack metadata, so `os migrate meta` has no source to rewrite — the `ActionDescriptor.isAsync` disposition), the `[RETIRED]` line in `authorable-surface/ai.json`, the regenerated `knowledge-document.mdx` reference, and the pin `ai/knowledge-document.test.ts`. The settings key follows the Localization format keys' retirement: the specifier removed from `knowledge.manifest.ts` and from the 11 translation packs, the manifest at `version: 2`, stored rows kept, and the manifest pins updated.
- a7bf18f: feat(service-knowledge): a knowledge source that was never built is built after boot, and an administrator can rebuild one with `os knowledge rebuild`
  
  Clause-②: yes
  Metadata-protocol: none
  
  - **The first build.** After every boot, `KnowledgeServicePlugin` reads what each `object` source's adapter holds (`indexStatus`, else one entry of `listDocuments`) against the index fingerprint and recipe hash the service computes now (ADR-0161 K7, "What starts a rebuild"), and builds — once, in the background, one source at a time — every source the adapter holds nothing for, holds under another fingerprint, or holds under another recipe hash. A source already built is left alone; a source with `refresh.onRecordChange: false` is left to its external indexer; an adapter with neither `indexStatus` nor `listDocuments` is never built automatically, and the boot log says so once. `KnowledgeServicePlugin({ buildAtBoot: false })` turns it off.
  - **One node builds a source.** A build runs under the `cluster` service's lock, key `knowledge:build:SOURCE`, renewed while it runs; a node that gets the lock after another built the source re-reads it and builds nothing, and a lock that does not answer starts no build. With no cluster service the composition is one node. Only a shared cluster lock driver (`redis`) makes this hold across nodes: the default `memory` driver's lock is per process, so with it every node builds.
  - **The administrator's rebuild.** The `knowledge` settings namespace gains two actions, gated like every settings write on `manage_platform_settings`: `rebuild` (`{ "source": "ID" }`) starts one complete build in the background, and `index_status` (`{}` or `{ "source": "ID" }`) answers each source's index state and the last build the answering node ran — its progress while it runs, its result (written, unchanged, purged, cannot be indexed) once it ended. `os knowledge rebuild SOURCE` starts a build and follows its progress to its end (`--no-wait` exits 0 once it has started and reports no outcome; otherwise exit 1 when it did not run or did not finish); `os knowledge status [SOURCE]` prints the state.
  - **What it costs.** A build sends the content fields of every matching row the index does not already hold unchanged to the embedding provider, which bills for them. The line that starts a build says so, the server logs its progress every ten seconds and its result, and `content/docs/ai/knowledge-rag.mdx` states it. The default `memory` adapter holds nothing after a restart, so with it every boot builds the whole source again, on every node.
  - `KnowledgeService` gains `readIndexState`, `rebuildSource`, `buildRecord`, `buildSourcesAtBoot` and `stopBuilds`, and the option `resolveBuildLock`; `IKnowledgeService` is unchanged.
- 9981f27: feat(knowledge): an open vector store on PostgreSQL with pgvector, and the index fingerprint every knowledge index is built under
  
  Clause-②: yes
  Metadata-protocol: none
  
  ADR-0161 Execution row 8a and K8 item 8 (#37100).
  
  - **New package `@objectstack/knowledge-pgvector`.** `KnowledgePgvectorPlugin` registers a `PgvectorKnowledgeAdapter` (adapter id `pgvector`): passages and vectors in PostgreSQL with the pgvector extension, in a schema of its own (`os_knowledge`, option `schema`) — a generation table `knowledge_generation` and one passage table per vector width, `knowledge_vec_d<width>` — so no table collides with an object table or is read as schema drift. The database is the `url` option when given, else the platform's when `OS_DATABASE_URL` is PostgreSQL; the plugin keeps its own small pool (`poolMax`, default 4; `connectTimeoutMs`, default 5000, so an unreachable host does not hold boot), no pooled connection waits on the embedder, and the kernel's embedder is read at each call. Two deployments sharing one database set their own `schema`. Search is an exact cosine scan (a 3072-wide model works); the organization filter and the metadata `filter` run in the same `WHERE`, before ranking. A passage whose text is unchanged is not embedded again; one whose row a concurrent write removed is embedded and written, not lost. `queryPrefix` is put before every query before it is embedded. Without the `vector` extension, or the right to create it or the schema, the plugin still registers and boot goes on: it creates nothing, warns with the SQL to run, `healthCheck` answers `ok: false` with that SQL, and every call answers `503 SERVICE_UNAVAILABLE` until it has run; a database it cannot reach is reported as unreachable, with no SQL. A caller reads one sentence; the driver's text and the SQL travel in the error's `remedy`, for the operator. The store does not yet build a second generation beside the first: `beginBuild` under a new fingerprint is refused, and the reindex result carries the exact statements that clear the source (passages, then the generation row); a first generation never takes over passage rows left behind. An approximate (HNSW) index is an operator's step, documented with the package.
  - **The index fingerprint (ADR-0161 K7).** The knowledge service computes, per source and adapter, a fingerprint over the embedding model and dimensions the adapter reports, the resolved split and the splitter's version, and the content recipe; and a recipe hash over `where`, `metadataFields`, the title rule and the withheld fields. New exports from `@objectstack/service-knowledge`: `computeIndexFingerprint`, `computeRecipeHash`, `indexExpectation`, `INDEX_FINGERPRINT_VERSION`, `RECIPE_HASH_VERSION`, `ASSEMBLY_RULE_VERSION`, `TITLE_RULE_VERSION`, `SPLIT_ALGORITHM_VERSION`. Every adapter call carries them: `AdapterContext.index` and `AdapterSearchOptions.index` (`@objectstack/spec/contracts`).
  - **Adapter contract members (all optional).** `AdapterEmbeddingDescriptor` gains `model`, `dimensions` and `variant`; `IKnowledgeAdapter` gains `indexStatus`, and `beginBuild` / `completeBuild` as a pair: a complete reindex calls `beginBuild` before it lists or writes, and `completeBuild` once every row is written and the purge is done. `IEmbedder` gains `model`; `OpenAIEmbedder` reports the model it sends.
  - **A refused source is named, never read as empty.** A write or a search under another fingerprint is refused `409 KNOWLEDGE_REBUILD_REQUIRED` (registered in the error-code ledger). `KnowledgeService.search` over several sources answers from the searchable ones and logs each refused one with the adapter's `remedy`; a source that refuses the refill round is refused for the whole search, its first-round hits dropped; it throws the refusal (code, status, and `refused` naming every source) only when none could be searched. A caller is given the code and the adapter's one-sentence message, never its `remedy`; a reindex result carries the `remedy`. `KnowledgeService.searchWithRefusals` returns both, and the `search_knowledge` tool adds `refused` to its output when a source is refused.
  - **`knowledge-memory` is the reference.** It keeps an active generation and, while a build of another fingerprint runs, one under construction, switching at `completeBuild`.
  - **Contract suite.** `runKnowledgeAdapterContract`'s `implements` gains `indexStatus`, `builds`, `refusesOtherFingerprint` and `generations`, with cases for each. `knowledge-pgvector` runs the suite, the card's acceptance cases and a complete reindex over a real ObjectQL + SqlDriver against a live PostgreSQL in the `Temporal Conformance` job.
- 3801775: feat(service-knowledge): a search can answer records, not passages — `granularity` and `groupBy`, with a freshness check
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  Skills-docs: none — no page under `skills/**` teaches the knowledge search options or the hit's shape (the one knowledge eval asks about source authoring); `content/docs/ai/knowledge-rag.mdx` and `content/docs/protocol/knowledge.mdx` teach them, updated here.
  
  ADR-0161 K1 (record-level return), K8 items 3 and 14.
  
  - **`KnowledgeSearchOptions.granularity`** (`'chunk' | 'record'`, default `'chunk'`, which answers the same hits as before; on `knowledge-memory` each hit now also carries `docHash` and, when its passage has one, `headingPath`). Under `'record'` a search answers one hit per record, the record's best-scoring passage, and `topK` counts records. Every source is then asked for `topK × 5` passages, for every caller, and refilled once at `topK × 20` when fewer than `topK` records survive the permission re-check — the cap; fewer records within it answer fewer hits, logged at `debug`. A `file` / `http` hit is grouped by its document. The return type is still `KnowledgeHit[]`.
  - **`KnowledgeSearchOptions.groupBy`** names a metadata field and groups by its value — "which policies", not "which clauses" — keeping the best hit of each group, the value in the hit's `metadata`. It implies record granularity and is refused with `granularity: 'chunk'`; that refusal, an empty `groupBy` and an unknown `granularity` carry `code: 'VALIDATION_ERROR'`, `status: 400`. Hits with the same value form one group whichever source they come from. An `object` source that does not list the field in its `metadataFields` is not searched for that search, and a record with no value for it is not answered: a hit is never answered ungrouped.
  - **The freshness check.** Each record-level hit about to be answered is checked against its record as it reads now: one system-context read per source, of only those records, `{ $and: [where, { id: { $in } }] }`, projected to the fields assembly reads. A record that was deleted or left `where` since it was indexed, or whose recomputed `docHash` differs from the hit's, is not answered, and the next record moves up (at most three rounds; a hit still unchecked after them is not answered). Its document is repaired in the background through the event sync's path, single-flight, once per document until a later search finds its hash matching; the repair never throws into the search. A source with `refresh.onRecordChange: false` (an external indexer owns its index) is never repaired: its stale hit is only not answered. When the source names a field the object does not declare, that read takes the whole row instead, as assembly did. A hit whose adapter stores no hash is checked for membership only; a freshness read that fails answers none of that source's checked hits, reported at `warn`.
  - **The live title.** Under record granularity the permission re-check — still one query, as the caller — also reads the object's display field, and a caller's hit carries the record's `title` as it reads now. The system identity is not re-checked, so its hits carry the indexed title (the same whenever the hash matched).
  - **`KnowledgeHit.docHash?` and `KnowledgeHit.headingPath?`** (`@objectstack/spec/ai`): the stored hash of the hit's document, returned as stored, and the heading path of the passage the hit came from. `knowledge-memory` returns both. The adapter contract suite (`@objectstack/service-knowledge/testing`) now asks an adapter that implements `listDocuments` to return each hit's stored `docHash` (and pins the record-level freshness check through a real service), and an adapter that takes chunks to return each passage's `headingPath`.
- 98b17fe: feat(service-knowledge): a knowledge search can be held to chosen records, or to the records under one parent, and the adapter filters before it ranks
  
  Clause-②: yes
  Metadata-protocol: none
  
  A knowledge search can now look only inside chosen records, for example only inside one policy, and every one of the `topK` hits comes from inside that scope. A scope only narrows what is searched; each hit is still re-read as the caller, as before.
  
  New, both optional, in `@objectstack/spec` (types only, no metadata key):
  
  - `KnowledgeSearchOptions.scope?: Array<{ object: string; ids: string[] }>`. An entry naming the object a source indexes holds that source to those records. An entry naming another object reaches a source that lists, in its `metadataFields`, a `lookup` or `master_detail` field pointing at that object, and holds it to the documents whose stored value of that field is one of the ids. Entries are a union. A source no entry reaches is not searched, and a `file` / `http` source answers nothing under a scope. `scope: []`, or an entry with no ids, answers no hits; it never means "no scope". At most 10 entries, each with at most 500 ids, every `object` and id a non-empty string, no other key on an entry; past those bounds `search` refuses before any adapter is called, with an error carrying `code: 'VALIDATION_ERROR'` and `status: 400` and naming the bound.
  - `AdapterSearchOptions.scope?: AdapterScopeTerm[]`, and the exported type `AdapterScopeTerm` (`{ kind: 'record', ids }` or `{ kind: 'metadata', field, ids }`). The knowledge service builds it per source from `KnowledgeSearchOptions.scope`; an adapter that reads it ranks only the documents some term holds for, filtering before it ranks, comparing values as strings (a list value matches when any element does).
  
  `KnowledgeService` checks every hit after the adapter answers and drops a hit no term holds for, including a hit that does not carry the value, so an adapter returns the document's `metadata` on its hits. An adapter that ignores the member keeps working: its scoped searches may answer fewer than `topK`, and the service logs that once per adapter at `warn`. A source that lists two or more lookups to the scoped object is not reached by that entry, logged once at `warn` naming the fields. A `user` field is not a parent link, and a parent two hops away is not reached. How many hits the scope removed is logged, never returned.
  
  `@objectstack/knowledge-memory` applies `scope` before ranking, and `@objectstack/knowledge-pgvector` applies it in the same SQL `WHERE` as the organization filter, ids and field names as bound parameters. `runKnowledgeAdapterContract` (from `@objectstack/service-knowledge/testing`) now requires `implements.scope`. It adds scope cases for the adapter alone, for each term kind, and cases through a real `KnowledgeService`, including one over the adapter with the member stripped.
  
  What to do: an adapter package reads `scope` in its search, returns each document's `metadata` on its hits, and passes `implements.scope` to the contract suite. A source that should be searchable inside one parent record lists the lookup to that parent in `metadataFields`; documents indexed before the lookup was listed are in no parent scope until a complete reindex writes them again.
- 8a3315a: feat(service-knowledge): `search_knowledge` takes `scope`, `granularity` and `groupBy`
  
  Clause-②: yes
  Metadata-protocol: none
  
  ADR-0161 K9, rule 2 (#37311): the one `search_knowledge` definition gains the three arguments its knowledge service already reads, so an MCP client (HTTP and stdio) and the in-product agent are offered them alike. No transport adds or edits an argument.
  
  - `granularity: "record"` answers one hit per record, its best passage; `groupBy` answers one hit per value of a field the source lists in `metadataFields`, the value carried as the hit's `groupValue` (as the index stores it); an object source that does not list the field answers nothing for that search, and a `file` / `http` source answers one hit per document with no `groupValue`; `scope` searches only inside the named records, or the records linking to the named parents. Each is handed to `IKnowledgeService.search` as its option of the same name.
  - A hit also carries `headingPath` where its passage has headings. The hit stays a whitelist: no `chunkId`, `docHash` or `metadata`.
  - The executor refuses each malformed argument `VALIDATION_ERROR` (400) naming it; over MCP, a shape the definition's schema states is refused first by the SDK's input validation (`-32602`). The tool is stricter than the service: an empty `scope` or an entry with no ids is refused (as an empty `sourceIds` is), and an object name, record id or field name over 255 characters or holding a NUL character is refused. A refusal quotes a caller's string and cuts it to 64 characters, and lists at most five.
  - The executor searches only `aiExposed` sources, so a `scope` entry or `groupBy` field only a withheld source would answer gets the same empty answer as one no source answers. The answer carries no count of hits the permission re-check or the scope removed.
- Updated dependencies [8236d9b]
- Updated dependencies [1d28405]
- Updated dependencies [b02484e]
- Updated dependencies [7a3f86c]
- Updated dependencies [52a2398]
- Updated dependencies [a73edb3]
- Updated dependencies [37e7fdf]
- Updated dependencies [1c05546]
- Updated dependencies [42b4d09]
- Updated dependencies [4ffe9d3]
- Updated dependencies [b38e133]
- Updated dependencies [f796089]
- Updated dependencies [8f49499]
- Updated dependencies [b68f9ae]
- Updated dependencies [2e9e1ac]
- Updated dependencies [8e46424]
- Updated dependencies [f4dbcc2]
- Updated dependencies [9c29d73]
- Updated dependencies [0739dee]
- Updated dependencies [89364b4]
- Updated dependencies [dfc6bbf]
- Updated dependencies [97b9d1e]
- Updated dependencies [0f29688]
- Updated dependencies [5ecf937]
- Updated dependencies [2df9691]
- Updated dependencies [f19e6c6]
- Updated dependencies [feb9b79]
- Updated dependencies [b7d2474]
- Updated dependencies [50f85e9]
- Updated dependencies [4b1eb0e]
- Updated dependencies [c0716ed]
- Updated dependencies [7bd5d28]
- Updated dependencies [8856afc]
- Updated dependencies [9062756]
- Updated dependencies [cdb327f]
- Updated dependencies [6ffa816]
- Updated dependencies [09ba0c7]
- Updated dependencies [b863d2b]
- Updated dependencies [e75a528]
- Updated dependencies [5dd856f]
- Updated dependencies [5dd856f]
- Updated dependencies [61722e9]
- Updated dependencies [8384d18]
- Updated dependencies [f6902e9]
- Updated dependencies [df81f4c]
- Updated dependencies [ed906d5]
- Updated dependencies [e6fa510]
- Updated dependencies [99ece3c]
- Updated dependencies [3cfa5bc]
- Updated dependencies [bfd1049]
- Updated dependencies [2495486]
- Updated dependencies [16a96ac]
- Updated dependencies [f4de1de]
- Updated dependencies [53c9575]
- Updated dependencies [7411f9b]
- Updated dependencies [e114324]
- Updated dependencies [f71d488]
- Updated dependencies [f44758b]
- Updated dependencies [f7b172f]
- Updated dependencies [a0b01fa]
- Updated dependencies [5d2ce34]
- Updated dependencies [59392ed]
- Updated dependencies [c99156e]
- Updated dependencies [c8e9bec]
- Updated dependencies [7ee7a61]
- Updated dependencies [9b6db73]
- Updated dependencies [7c122ff]
- Updated dependencies [f98f18c]
- Updated dependencies [401eb44]
- Updated dependencies [29f1280]
- Updated dependencies [eb7ad70]
- Updated dependencies [de25d58]
- Updated dependencies [fe19096]
- Updated dependencies [4fb7169]
- Updated dependencies [d953558]
- Updated dependencies [af566c2]
- Updated dependencies [cedc094]
- Updated dependencies [bb1c55d]
- Updated dependencies [d7c257e]
- Updated dependencies [40e22f1]
- Updated dependencies [5dbcc02]
- Updated dependencies [bc9ace2]
- Updated dependencies [d6be99d]
- Updated dependencies [0a1b69c]
- Updated dependencies [2e07e61]
- Updated dependencies [643fe3b]
- Updated dependencies [0a3dd40]
- Updated dependencies [6b51822]
- Updated dependencies [f3c9d42]
- Updated dependencies [8df7bf2]
- Updated dependencies [170ca48]
- Updated dependencies [d33bf5a]
- Updated dependencies [236c804]
- Updated dependencies [c261a7c]
- Updated dependencies [f548bdc]
- Updated dependencies [e72f2aa]
- Updated dependencies [f2a990b]
- Updated dependencies [a23164e]
- Updated dependencies [8c5a81e]
- Updated dependencies [6db1dc2]
- Updated dependencies [78437e2]
- Updated dependencies [ed4d322]
- Updated dependencies [0628e08]
- Updated dependencies [b7fe94a]
- Updated dependencies [0b2118f]
- Updated dependencies [81eae2b]
- Updated dependencies [ad65d82]
- Updated dependencies [cb5a975]
- Updated dependencies [92e0475]
- Updated dependencies [d12ac84]
- Updated dependencies [ad92dfd]
- Updated dependencies [bb89b2d]
- Updated dependencies [8da2b7e]
- Updated dependencies [ec545de]
- Updated dependencies [7c9b22b]
- Updated dependencies [9742142]
- Updated dependencies [f3a8a13]
- Updated dependencies [543585d]
- Updated dependencies [70194ff]
- Updated dependencies [0002eaf]
- Updated dependencies [7a5ae65]
- Updated dependencies [70d07fd]
- Updated dependencies [73f2cf4]
- Updated dependencies [60e79ed]
- Updated dependencies [595844b]
- Updated dependencies [28588d0]
- Updated dependencies [3b58921]
- Updated dependencies [c45dd80]
- Updated dependencies [48c5484]
- Updated dependencies [cb2d6aa]
- Updated dependencies [d463c46]
- Updated dependencies [7501d0c]
- Updated dependencies [45ef94e]
- Updated dependencies [573a376]
- Updated dependencies [cbc06ff]
- Updated dependencies [8f141a2]
- Updated dependencies [d24e4ab]
- Updated dependencies [f66340a]
- Updated dependencies [fed637c]
- Updated dependencies [7a7ab47]
- Updated dependencies [08f4bad]
- Updated dependencies [70f454a]
- Updated dependencies [8644ce7]
- Updated dependencies [8aecf6d]
- Updated dependencies [8ddadc1]
- Updated dependencies [a03bc4e]
- Updated dependencies [021524c]
- Updated dependencies [129e637]
- Updated dependencies [13f5466]
- Updated dependencies [ff6f976]
- Updated dependencies [00aa574]
- Updated dependencies [d95d34f]
- Updated dependencies [76eea0f]
- Updated dependencies [84b1e0c]
- Updated dependencies [151e812]
- Updated dependencies [6210a08]
- Updated dependencies [81c1ae9]
- Updated dependencies [51b67f1]
- Updated dependencies [66452df]
- Updated dependencies [4f9a3f8]
- Updated dependencies [1cda7ea]
- Updated dependencies [5078f2f]
- Updated dependencies [01967c3]
- Updated dependencies [5078f2f]
- Updated dependencies [8b1841f]
- Updated dependencies [012f0a1]
- Updated dependencies [227e952]
- Updated dependencies [422df61]
- Updated dependencies [5ff858b]
- Updated dependencies [06c1f54]
- Updated dependencies [489d9fe]
- Updated dependencies [c349576]
- Updated dependencies [c063734]
- Updated dependencies [0439a04]
- Updated dependencies [5bf7242]
- Updated dependencies [f92d271]
- Updated dependencies [3d4f423]
- Updated dependencies [b8c8c88]
- Updated dependencies [d7f299c]
- Updated dependencies [f9fda2a]
- Updated dependencies [91138ec]
- Updated dependencies [9981f27]
- Updated dependencies [3801775]
- Updated dependencies [40570d6]
- Updated dependencies [2a6f26a]
- Updated dependencies [b7dee0e]
- Updated dependencies [68250f6]
- Updated dependencies [fd462c5]
- Updated dependencies [d15e439]
- Updated dependencies [6831e04]
- Updated dependencies [efaafe3]
- Updated dependencies [875ae40]
- Updated dependencies [da50177]
- Updated dependencies [7e9c50c]
- Updated dependencies [5cf9941]
- Updated dependencies [204356a]
- Updated dependencies [59571b2]
- Updated dependencies [c94191d]
- Updated dependencies [ebac615]
- Updated dependencies [98b17fe]
- Updated dependencies [8d60333]
- Updated dependencies [db46566]
- Updated dependencies [2776e88]
- Updated dependencies [083e040]
- Updated dependencies [66c854d]
- Updated dependencies [372ce7c]
- Updated dependencies [df8a1b8]
- Updated dependencies [75925e1]
- Updated dependencies [7d50dc8]
- Updated dependencies [595e9cb]
- Updated dependencies [20d025f]
- Updated dependencies [64b278e]
- Updated dependencies [695b9db]
- Updated dependencies [ecd4b2b]
- Updated dependencies [d280de9]
- Updated dependencies [f9dd033]
- Updated dependencies [6296909]
- Updated dependencies [660e7cd]
  - @objectstack/spec@19.0.0-next.0
  - @objectstack/service-settings@19.0.0-next.0
  - @objectstack/core@19.0.0-next.0
  - @objectstack/embedder-openai@19.0.0-next.0

## 18.6.0

### Patch Changes

- Updated dependencies [e53e02e]
- Updated dependencies [1f923d7]
- Updated dependencies [64c4285]
- Updated dependencies [b1efa37]
- Updated dependencies [84e6bbb]
- Updated dependencies [69783b7]
- Updated dependencies [bb17350]
- Updated dependencies [a061708]
- Updated dependencies [c59198f]
- Updated dependencies [fb3d1ff]
- Updated dependencies [2068e03]
- Updated dependencies [5c7e448]
- Updated dependencies [de3538c]
- Updated dependencies [5326028]
- Updated dependencies [f7b2d02]
- Updated dependencies [bb3c163]
- Updated dependencies [d635555]
- Updated dependencies [0ac112f]
- Updated dependencies [c934631]
- Updated dependencies [63e47fe]
- Updated dependencies [b005638]
- Updated dependencies [e5c2d76]
- Updated dependencies [db3bbd3]
- Updated dependencies [9f32c0f]
- Updated dependencies [109a903]
- Updated dependencies [2539ad9]
- Updated dependencies [98a4449]
- Updated dependencies [fdfccbf]
- Updated dependencies [fa1fb6f]
- Updated dependencies [d10f652]
- Updated dependencies [ba03d5e]
- Updated dependencies [3e49033]
- Updated dependencies [6091b64]
- Updated dependencies [61ded62]
- Updated dependencies [75ab117]
- Updated dependencies [071323e]
- Updated dependencies [41ff7c3]
- Updated dependencies [aab8b31]
- Updated dependencies [e0670b9]
- Updated dependencies [50d655f]
- Updated dependencies [3a08833]
- Updated dependencies [0e2e4f5]
- Updated dependencies [bef80d3]
- Updated dependencies [e0670b9]
- Updated dependencies [9e6fee1]
- Updated dependencies [52ec26f]
- Updated dependencies [c2cabce]
- Updated dependencies [6fb3d0c]
- Updated dependencies [2c296cf]
- Updated dependencies [fa9d695]
- Updated dependencies [d9c4b62]
- Updated dependencies [8c6ddc5]
- Updated dependencies [1bf90a0]
- Updated dependencies [27c0b20]
- Updated dependencies [842637a]
- Updated dependencies [227ae36]
- Updated dependencies [1177058]
- Updated dependencies [22bf910]
- Updated dependencies [371e5f1]
- Updated dependencies [11e0441]
- Updated dependencies [f23c71e]
- Updated dependencies [4240719]
- Updated dependencies [6302c2c]
- Updated dependencies [7b3e955]
- Updated dependencies [066177b]
- Updated dependencies [ddab49d]
- Updated dependencies [1538596]
- Updated dependencies [21d84a8]
- Updated dependencies [4fb8790]
- Updated dependencies [a1082f3]
- Updated dependencies [f02f4f6]
- Updated dependencies [e61af97]
- Updated dependencies [758bbe7]
- Updated dependencies [99bd220]
- Updated dependencies [13057ce]
- Updated dependencies [a8aa6ab]
- Updated dependencies [9cf74ae]
- Updated dependencies [6c1f9b3]
- Updated dependencies [b633afe]
- Updated dependencies [aa0fde3]
- Updated dependencies [743308b]
- Updated dependencies [bb169c3]
- Updated dependencies [2487242]
- Updated dependencies [92a5cac]
- Updated dependencies [d4b2a75]
- Updated dependencies [ad9b74b]
- Updated dependencies [e2a4c66]
- Updated dependencies [c37e47a]
- Updated dependencies [a6c2b83]
- Updated dependencies [1354d2a]
- Updated dependencies [a2bb7d5]
  - @objectstack/spec@18.6.0
  - @objectstack/core@18.6.0

## 18.5.0

### Patch Changes

- Updated dependencies [f229dfd]
- Updated dependencies [322ded7]
- Updated dependencies [f4cafd5]
- Updated dependencies [c747cf0]
- Updated dependencies [c747cf0]
- Updated dependencies [30e364e]
- Updated dependencies [605d712]
- Updated dependencies [05b56ef]
- Updated dependencies [f31f784]
- Updated dependencies [7ffbb1a]
- Updated dependencies [89d7bef]
- Updated dependencies [51ceb43]
- Updated dependencies [d635599]
- Updated dependencies [548f8ff]
- Updated dependencies [16e3486]
- Updated dependencies [d38ceba]
- Updated dependencies [6538ba4]
- Updated dependencies [9673030]
- Updated dependencies [84c66d3]
- Updated dependencies [a1604ce]
- Updated dependencies [6c5d31f]
- Updated dependencies [b462444]
- Updated dependencies [61ed314]
- Updated dependencies [40c73a8]
- Updated dependencies [2c98485]
- Updated dependencies [9317833]
- Updated dependencies [1f8ce6e]
- Updated dependencies [c312b26]
- Updated dependencies [5b2ec82]
- Updated dependencies [3e19223]
- Updated dependencies [1b878e7]
- Updated dependencies [6482c08]
- Updated dependencies [6222ecb]
- Updated dependencies [728be58]
- Updated dependencies [1fd5d8a]
- Updated dependencies [26b5994]
- Updated dependencies [0ba30eb]
- Updated dependencies [27d042f]
- Updated dependencies [4dbcbdd]
- Updated dependencies [09da8c7]
- Updated dependencies [53f5a4c]
- Updated dependencies [bc50d11]
- Updated dependencies [0be91f0]
- Updated dependencies [df9fe94]
- Updated dependencies [8f9eb3d]
- Updated dependencies [1da43fe]
- Updated dependencies [6ff3eee]
- Updated dependencies [8b53cc8]
- Updated dependencies [b392ff7]
- Updated dependencies [489ef5f]
- Updated dependencies [ee627c6]
- Updated dependencies [53b3544]
- Updated dependencies [b070e1c]
- Updated dependencies [3cbf1f2]
- Updated dependencies [89defde]
- Updated dependencies [06e53a7]
- Updated dependencies [f64c0f9]
- Updated dependencies [dd291b8]
- Updated dependencies [e997113]
- Updated dependencies [615c67f]
- Updated dependencies [67274ac]
  - @objectstack/spec@18.5.0
  - @objectstack/core@18.5.0

## 18.4.0

### Patch Changes

- Updated dependencies [7d0b47c]
- Updated dependencies [f6a429b]
- Updated dependencies [8aa2e91]
- Updated dependencies [c17719d]
- Updated dependencies [b90a6f7]
- Updated dependencies [e8dc483]
- Updated dependencies [bcdb1db]
- Updated dependencies [9ebca94]
- Updated dependencies [140d8ce]
- Updated dependencies [699ebd8]
- Updated dependencies [4c2cd29]
- Updated dependencies [4be8a2e]
- Updated dependencies [471add3]
- Updated dependencies [b5eb61d]
- Updated dependencies [771b2db]
- Updated dependencies [97e4249]
- Updated dependencies [9037b13]
- Updated dependencies [e3b56b2]
- Updated dependencies [a52761f]
- Updated dependencies [e8afd1e]
- Updated dependencies [bd65cb6]
- Updated dependencies [f19fbb8]
- Updated dependencies [217ba78]
- Updated dependencies [cde492d]
- Updated dependencies [eee4149]
- Updated dependencies [f3a52d3]
- Updated dependencies [d59a1eb]
- Updated dependencies [af3451b]
- Updated dependencies [3a27208]
- Updated dependencies [0c666c3]
- Updated dependencies [38717d3]
- Updated dependencies [ac890f5]
- Updated dependencies [aa57c76]
- Updated dependencies [fc869c2]
- Updated dependencies [fef212b]
- Updated dependencies [dc51811]
- Updated dependencies [b77c160]
- Updated dependencies [09720e2]
- Updated dependencies [25fea77]
- Updated dependencies [3da9a4c]
- Updated dependencies [4be9734]
- Updated dependencies [bb86ff9]
- Updated dependencies [2046d21]
- Updated dependencies [243eba1]
- Updated dependencies [fd749a4]
- Updated dependencies [d9d42d4]
- Updated dependencies [6a70821]
- Updated dependencies [9d939c5]
- Updated dependencies [d4a8439]
- Updated dependencies [69c7cd6]
- Updated dependencies [25e1c1a]
- Updated dependencies [47226e6]
- Updated dependencies [c7d1367]
- Updated dependencies [f5aaa0b]
- Updated dependencies [0005fec]
- Updated dependencies [2d6402c]
- Updated dependencies [77c203a]
- Updated dependencies [8293c74]
- Updated dependencies [29702d5]
- Updated dependencies [a839020]
- Updated dependencies [a7b8876]
- Updated dependencies [f7afab8]
- Updated dependencies [4dde0ae]
- Updated dependencies [590724f]
- Updated dependencies [38d416f]
- Updated dependencies [d2e2f6f]
- Updated dependencies [d5f3bc5]
- Updated dependencies [e3948ae]
- Updated dependencies [b55d6ab]
- Updated dependencies [1c5cee6]
- Updated dependencies [aad1603]
- Updated dependencies [7145bf3]
- Updated dependencies [55d9dd4]
- Updated dependencies [af8aab1]
- Updated dependencies [a59d00a]
- Updated dependencies [4bf9a2d]
- Updated dependencies [0c9aa82]
- Updated dependencies [49c8568]
- Updated dependencies [4564d6f]
- Updated dependencies [f2ea193]
- Updated dependencies [badf24d]
- Updated dependencies [5268f50]
- Updated dependencies [a30c4f4]
- Updated dependencies [0cba0ce]
- Updated dependencies [c893b3d]
- Updated dependencies [677d542]
- Updated dependencies [9bdeed2]
- Updated dependencies [3479c33]
- Updated dependencies [000a4c0]
- Updated dependencies [f4d9c09]
- Updated dependencies [c77dd17]
- Updated dependencies [ebe0a98]
- Updated dependencies [9038187]
- Updated dependencies [f108e6d]
- Updated dependencies [40eaae7]
- Updated dependencies [45916c9]
- Updated dependencies [b2ce250]
- Updated dependencies [5cb7d7e]
- Updated dependencies [468e0c1]
- Updated dependencies [6106b73]
- Updated dependencies [0f920b9]
- Updated dependencies [33bc8ae]
- Updated dependencies [ed4b832]
- Updated dependencies [b70d9aa]
- Updated dependencies [a1afbb9]
- Updated dependencies [150f740]
- Updated dependencies [42eb126]
- Updated dependencies [8cf1fd0]
- Updated dependencies [a5cb4f1]
- Updated dependencies [3c1eb63]
- Updated dependencies [d57be87]
- Updated dependencies [2b752f1]
- Updated dependencies [c0068ed]
- Updated dependencies [7fe019f]
- Updated dependencies [e735425]
- Updated dependencies [71d094c]
- Updated dependencies [8b16445]
- Updated dependencies [8c75f83]
- Updated dependencies [3aa0b42]
- Updated dependencies [82e6da1]
- Updated dependencies [acfc86c]
- Updated dependencies [18ed2db]
- Updated dependencies [39aa3f6]
- Updated dependencies [90457e7]
- Updated dependencies [76e4c2c]
- Updated dependencies [47bc621]
- Updated dependencies [efbe1a0]
- Updated dependencies [2d1a76b]
- Updated dependencies [3b7219e]
- Updated dependencies [3fed8ce]
- Updated dependencies [907fdca]
- Updated dependencies [f25414e]
- Updated dependencies [75d7fb1]
- Updated dependencies [41106b5]
- Updated dependencies [8aaa69f]
- Updated dependencies [59630d9]
- Updated dependencies [5e85952]
- Updated dependencies [ef4af73]
- Updated dependencies [7e697ff]
- Updated dependencies [d9a232f]
- Updated dependencies [3487ccc]
- Updated dependencies [2b3e3eb]
- Updated dependencies [5b7269f]
- Updated dependencies [6dd196d]
- Updated dependencies [d834a36]
- Updated dependencies [0cd594b]
- Updated dependencies [8beac67]
- Updated dependencies [b96b875]
- Updated dependencies [c62e72a]
- Updated dependencies [450bfb6]
- Updated dependencies [5defbfe]
- Updated dependencies [f56354c]
- Updated dependencies [e55347d]
- Updated dependencies [5f84ef0]
- Updated dependencies [5f84ef0]
- Updated dependencies [36a8700]
- Updated dependencies [fdfcc7a]
- Updated dependencies [5a8dbc7]
- Updated dependencies [fb94249]
- Updated dependencies [e627eaa]
- Updated dependencies [c8223fb]
- Updated dependencies [3224545]
- Updated dependencies [8fca8f7]
- Updated dependencies [26d30d7]
- Updated dependencies [3684d18]
- Updated dependencies [d9f626b]
- Updated dependencies [1a66fcf]
- Updated dependencies [6180c87]
- Updated dependencies [bc41e01]
- Updated dependencies [f00fb1b]
- Updated dependencies [c655af8]
- Updated dependencies [93ff5dd]
- Updated dependencies [c7dd505]
- Updated dependencies [016ec88]
- Updated dependencies [01559b8]
- Updated dependencies [8075338]
- Updated dependencies [93f0d43]
- Updated dependencies [c7dc143]
- Updated dependencies [aad7d2f]
- Updated dependencies [4f6fb53]
- Updated dependencies [7d4fcb6]
- Updated dependencies [4c928f5]
- Updated dependencies [171cf6d]
- Updated dependencies [ff04ad8]
- Updated dependencies [36b216b]
- Updated dependencies [84aabea]
- Updated dependencies [b96d492]
- Updated dependencies [ed95466]
- Updated dependencies [91d88ec]
- Updated dependencies [f714b0a]
- Updated dependencies [ba8e993]
- Updated dependencies [9bff554]
- Updated dependencies [1368536]
- Updated dependencies [7aab601]
- Updated dependencies [c419609]
- Updated dependencies [88282a7]
- Updated dependencies [d074c28]
- Updated dependencies [1e474e3]
- Updated dependencies [7575116]
- Updated dependencies [0763bf6]
- Updated dependencies [de6d893]
- Updated dependencies [5192297]
- Updated dependencies [326453e]
- Updated dependencies [f1d1f6c]
- Updated dependencies [a03cf66]
- Updated dependencies [90106d6]
- Updated dependencies [26f4e6d]
- Updated dependencies [6ff08b0]
- Updated dependencies [f09517e]
- Updated dependencies [2ae811e]
- Updated dependencies [1216abf]
- Updated dependencies [3c18783]
- Updated dependencies [e336a33]
- Updated dependencies [3452dec]
- Updated dependencies [e47da23]
- Updated dependencies [f0f729e]
- Updated dependencies [1af8253]
- Updated dependencies [be0c0a2]
- Updated dependencies [c54d60c]
- Updated dependencies [101adaf]
- Updated dependencies [6219588]
- Updated dependencies [6cec006]
- Updated dependencies [245afc1]
- Updated dependencies [070e879]
- Updated dependencies [a888c5c]
- Updated dependencies [9ae8291]
- Updated dependencies [4f1de9f]
- Updated dependencies [8c77203]
- Updated dependencies [386891e]
- Updated dependencies [9891065]
- Updated dependencies [870ce55]
- Updated dependencies [c54a23d]
- Updated dependencies [9af0766]
- Updated dependencies [fd63747]
- Updated dependencies [1ff2c7f]
- Updated dependencies [0b23b2a]
- Updated dependencies [fc45328]
- Updated dependencies [04c35f0]
- Updated dependencies [a596c03]
- Updated dependencies [ccaee99]
- Updated dependencies [d4b14a8]
- Updated dependencies [8004529]
- Updated dependencies [152b53c]
- Updated dependencies [3a83b53]
- Updated dependencies [e003ebb]
- Updated dependencies [6739719]
- Updated dependencies [5d4f2aa]
- Updated dependencies [9dbcc1f]
- Updated dependencies [19f9053]
- Updated dependencies [133f75a]
- Updated dependencies [f4cd4ec]
- Updated dependencies [d0fbe11]
- Updated dependencies [eca7cd2]
- Updated dependencies [cf4b9bf]
- Updated dependencies [767f110]
- Updated dependencies [14754c7]
- Updated dependencies [766a5df]
- Updated dependencies [e1dac19]
- Updated dependencies [e542831]
- Updated dependencies [44a030b]
- Updated dependencies [21510bb]
- Updated dependencies [0fd363d]
- Updated dependencies [f127b04]
- Updated dependencies [5210acf]
- Updated dependencies [d6b88f1]
- Updated dependencies [4123865]
- Updated dependencies [6ffe37e]
- Updated dependencies [63a470a]
  - @objectstack/spec@18.4.0
  - @objectstack/core@18.4.0

## 18.3.0

### Patch Changes

- Updated dependencies [ea025d3]
- Updated dependencies [2f21b48]
- Updated dependencies [0ea90c7]
- Updated dependencies [dbf7e04]
- Updated dependencies [a9f654e]
- Updated dependencies [b49b752]
- Updated dependencies [d8a9cc5]
- Updated dependencies [b53d9f3]
- Updated dependencies [8eeb3b3]
- Updated dependencies [4f05de4]
- Updated dependencies [95f818d]
- Updated dependencies [b3f7344]
- Updated dependencies [d90657b]
- Updated dependencies [ff26bc4]
- Updated dependencies [21a13f1]
- Updated dependencies [c68869c]
- Updated dependencies [162f668]
- Updated dependencies [43714ca]
- Updated dependencies [63e3873]
- Updated dependencies [9bf6598]
- Updated dependencies [a98693d]
- Updated dependencies [d9bf777]
- Updated dependencies [bb91ae8]
- Updated dependencies [d434481]
- Updated dependencies [f9f27a0]
- Updated dependencies [02b1392]
- Updated dependencies [c26d643]
- Updated dependencies [13e85be]
- Updated dependencies [13dc413]
- Updated dependencies [eab4bba]
- Updated dependencies [e438a55]
- Updated dependencies [2205863]
- Updated dependencies [9fab076]
- Updated dependencies [74801d1]
- Updated dependencies [17b5152]
- Updated dependencies [ef7067f]
- Updated dependencies [031d97a]
- Updated dependencies [0c47e87]
- Updated dependencies [e01edb2]
- Updated dependencies [f79fa74]
- Updated dependencies [b358e79]
- Updated dependencies [5374967]
- Updated dependencies [8a218fc]
- Updated dependencies [1539aad]
- Updated dependencies [cdd9f0a]
- Updated dependencies [3fe9d25]
- Updated dependencies [2ecf6a7]
- Updated dependencies [fbe344b]
- Updated dependencies [354dfcd]
- Updated dependencies [d887aa9]
- Updated dependencies [39fd5fb]
- Updated dependencies [5aad4e0]
- Updated dependencies [81b4599]
- Updated dependencies [c13ef04]
- Updated dependencies [6eaf404]
- Updated dependencies [79ed6f7]
- Updated dependencies [40320f1]
- Updated dependencies [49d652e]
- Updated dependencies [0fb0dda]
- Updated dependencies [e3470ed]
- Updated dependencies [9ac5ae5]
- Updated dependencies [c082af6]
- Updated dependencies [6dbff8e]
- Updated dependencies [c63ce2a]
- Updated dependencies [12b5aec]
- Updated dependencies [8b1740a]
- Updated dependencies [b88519e]
- Updated dependencies [e5b5c5b]
- Updated dependencies [d4ff1a0]
- Updated dependencies [10f27b6]
- Updated dependencies [fe9e856]
- Updated dependencies [d4ff1a0]
- Updated dependencies [ae16687]
- Updated dependencies [efdf11a]
- Updated dependencies [2655ebd]
- Updated dependencies [14e9685]
- Updated dependencies [0cd578f]
- Updated dependencies [a33fce2]
- Updated dependencies [385aa12]
- Updated dependencies [8bb2c31]
- Updated dependencies [8d79bbd]
- Updated dependencies [b8f4acc]
- Updated dependencies [4145210]
- Updated dependencies [194e66c]
- Updated dependencies [57c51aa]
- Updated dependencies [3604371]
- Updated dependencies [73b7270]
- Updated dependencies [6762dd9]
- Updated dependencies [556f323]
- Updated dependencies [b445807]
- Updated dependencies [6abcb72]
- Updated dependencies [7735d1d]
- Updated dependencies [7739573]
- Updated dependencies [bc4c963]
- Updated dependencies [86edcaf]
- Updated dependencies [ad3a640]
- Updated dependencies [fbaacfe]
- Updated dependencies [dbf576b]
- Updated dependencies [4fa4f2c]
- Updated dependencies [76b4ae4]
- Updated dependencies [0368504]
- Updated dependencies [6663a66]
- Updated dependencies [fbb8bec]
- Updated dependencies [f557d90]
- Updated dependencies [aad9ad5]
- Updated dependencies [e0aed00]
- Updated dependencies [72b08ee]
- Updated dependencies [bf658d1]
- Updated dependencies [3702be4]
- Updated dependencies [4a5396b]
- Updated dependencies [9d29223]
- Updated dependencies [7538f27]
- Updated dependencies [21c4bdd]
- Updated dependencies [2c683cf]
- Updated dependencies [86c9d53]
- Updated dependencies [bfdaba4]
- Updated dependencies [8441a01]
- Updated dependencies [0027c4a]
- Updated dependencies [684f2f6]
- Updated dependencies [869fa76]
- Updated dependencies [74aae1e]
- Updated dependencies [2b4b970]
- Updated dependencies [e063a87]
- Updated dependencies [7811c3f]
- Updated dependencies [755e285]
- Updated dependencies [07585bf]
- Updated dependencies [9cbe507]
- Updated dependencies [2695de7]
- Updated dependencies [0a4b0fb]
- Updated dependencies [b373263]
- Updated dependencies [d3b0a40]
- Updated dependencies [a68430a]
- Updated dependencies [6da8c3c]
- Updated dependencies [1ea3fe9]
- Updated dependencies [3e0fd7a]
- Updated dependencies [f552fa8]
- Updated dependencies [dc4755c]
- Updated dependencies [4793aa4]
- Updated dependencies [3a054cb]
- Updated dependencies [f934a41]
- Updated dependencies [0c64014]
- Updated dependencies [a7bdac4]
- Updated dependencies [c3842ac]
- Updated dependencies [916531a]
- Updated dependencies [d85ff19]
- Updated dependencies [7e3822c]
- Updated dependencies [3cc45cc]
- Updated dependencies [3a2f4c0]
- Updated dependencies [5b7dbb8]
- Updated dependencies [8d36669]
- Updated dependencies [e26cf9a]
- Updated dependencies [6e0b16a]
- Updated dependencies [7c3cc88]
- Updated dependencies [9b1dc99]
- Updated dependencies [f3fe660]
- Updated dependencies [3739d8d]
- Updated dependencies [f4a8eed]
- Updated dependencies [8f36f6b]
- Updated dependencies [80a9f99]
- Updated dependencies [11a7f96]
- Updated dependencies [b357250]
- Updated dependencies [75c2658]
- Updated dependencies [35f2055]
- Updated dependencies [fb4e0bb]
- Updated dependencies [7d846b5]
- Updated dependencies [fc5d509]
- Updated dependencies [71de060]
- Updated dependencies [6fd87b7]
- Updated dependencies [d359857]
- Updated dependencies [3238750]
- Updated dependencies [f23e051]
- Updated dependencies [bed8306]
- Updated dependencies [04c8930]
- Updated dependencies [001c04b]
- Updated dependencies [8ce974c]
- Updated dependencies [2d3aa8c]
- Updated dependencies [85a1b9d]
- Updated dependencies [361ea24]
- Updated dependencies [ea1751b]
- Updated dependencies [3fd4d6b]
- Updated dependencies [a00f335]
- Updated dependencies [700ec85]
- Updated dependencies [8bceb6a]
- Updated dependencies [8771726]
- Updated dependencies [ef0f6a1]
- Updated dependencies [9eaa209]
- Updated dependencies [ba0084e]
- Updated dependencies [462935d]
- Updated dependencies [0ecc2c4]
- Updated dependencies [d6e0967]
- Updated dependencies [519089e]
- Updated dependencies [16e7a80]
- Updated dependencies [044d201]
- Updated dependencies [12333ba]
- Updated dependencies [e7a6cc7]
- Updated dependencies [4d278c9]
- Updated dependencies [76bf6c5]
- Updated dependencies [1a95c74]
- Updated dependencies [5114b0e]
- Updated dependencies [e62dcc5]
- Updated dependencies [0c1829a]
- Updated dependencies [bc02a77]
- Updated dependencies [36fa4ff]
- Updated dependencies [c594e1c]
- Updated dependencies [e170d42]
- Updated dependencies [f5a400a]
- Updated dependencies [7b293c4]
- Updated dependencies [3fb74b6]
- Updated dependencies [b399cb8]
- Updated dependencies [a9782b3]
- Updated dependencies [60d8522]
- Updated dependencies [8196881]
- Updated dependencies [8d208a4]
- Updated dependencies [5493b88]
- Updated dependencies [663b7c0]
- Updated dependencies [c708de6]
- Updated dependencies [50df124]
- Updated dependencies [3cb8553]
- Updated dependencies [70943dd]
- Updated dependencies [92b7bbd]
- Updated dependencies [2081a5e]
- Updated dependencies [892eb66]
- Updated dependencies [2cba2eb]
- Updated dependencies [bf03ebb]
- Updated dependencies [2c3574c]
- Updated dependencies [1335c6b]
- Updated dependencies [bdb19ca]
- Updated dependencies [d8c611d]
- Updated dependencies [ec0316e]
- Updated dependencies [8bb2417]
- Updated dependencies [2ac698b]
- Updated dependencies [d0df873]
- Updated dependencies [462b4f9]
- Updated dependencies [9a0c622]
- Updated dependencies [138dacf]
- Updated dependencies [7f4258f]
- Updated dependencies [1ac1c24]
- Updated dependencies [97ca257]
- Updated dependencies [104cd1a]
- Updated dependencies [f1d795b]
- Updated dependencies [b3d1415]
- Updated dependencies [078e581]
- Updated dependencies [18e4ac1]
- Updated dependencies [51058ef]
- Updated dependencies [4df6292]
- Updated dependencies [f125ce4]
- Updated dependencies [b16ee8b]
- Updated dependencies [86d0a8c]
- Updated dependencies [d089dac]
- Updated dependencies [3557366]
- Updated dependencies [29c70ca]
- Updated dependencies [b5e7ba5]
- Updated dependencies [38a278b]
- Updated dependencies [bb82da1]
- Updated dependencies [85ea12f]
- Updated dependencies [85f7a0d]
- Updated dependencies [e9fb529]
- Updated dependencies [7b55ea9]
- Updated dependencies [4138ce8]
- Updated dependencies [53dda03]
- Updated dependencies [ba1f164]
- Updated dependencies [20f052d]
- Updated dependencies [9467a1b]
- Updated dependencies [8b65633]
- Updated dependencies [c268b72]
- Updated dependencies [d68d129]
- Updated dependencies [bd68248]
- Updated dependencies [f72bc9e]
- Updated dependencies [a20dcae]
- Updated dependencies [5d46f43]
- Updated dependencies [c9aaee9]
- Updated dependencies [3d6f230]
- Updated dependencies [7eb0b19]
- Updated dependencies [8e6ab05]
- Updated dependencies [e756782]
- Updated dependencies [8209a2f]
- Updated dependencies [aee9c47]
- Updated dependencies [0e75081]
- Updated dependencies [45b4922]
- Updated dependencies [31204d1]
- Updated dependencies [2c881fb]
- Updated dependencies [1bdf674]
- Updated dependencies [4b8cbe2]
- Updated dependencies [5f99582]
- Updated dependencies [63f962f]
- Updated dependencies [df8d020]
- Updated dependencies [6f09464]
- Updated dependencies [772b356]
- Updated dependencies [4008e62]
- Updated dependencies [b64bb72]
- Updated dependencies [b861525]
- Updated dependencies [6903c93]
- Updated dependencies [4b06a54]
- Updated dependencies [ebbb5b8]
- Updated dependencies [a81b7cb]
- Updated dependencies [eeb3117]
- Updated dependencies [a5fcd06]
- Updated dependencies [56076fd]
- Updated dependencies [fdb9a07]
- Updated dependencies [57958aa]
- Updated dependencies [59775a0]
- Updated dependencies [744211f]
- Updated dependencies [87956dc]
- Updated dependencies [3482f3d]
- Updated dependencies [a6a369e]
- Updated dependencies [601832b]
- Updated dependencies [5c4e752]
- Updated dependencies [4ab2e7e]
- Updated dependencies [589049b]
- Updated dependencies [d0f308c]
- Updated dependencies [4dc41e6]
- Updated dependencies [eb05ea2]
- Updated dependencies [55a4898]
- Updated dependencies [f87239a]
- Updated dependencies [2ae8c89]
- Updated dependencies [a4daa85]
- Updated dependencies [b64980a]
- Updated dependencies [bbb98c4]
- Updated dependencies [1bb9536]
- Updated dependencies [2bf71ce]
- Updated dependencies [c1af99c]
- Updated dependencies [99a6a78]
- Updated dependencies [1a8ba3f]
- Updated dependencies [1a8ba3f]
- Updated dependencies [3ac22c9]
- Updated dependencies [ceef714]
- Updated dependencies [b388cfe]
- Updated dependencies [04b1402]
- Updated dependencies [672bda0]
- Updated dependencies [3e54f99]
- Updated dependencies [710c2da]
- Updated dependencies [5d759b1]
- Updated dependencies [cfd237f]
  - @objectstack/spec@18.3.0
  - @objectstack/core@18.3.0

## 18.2.0

### Patch Changes

- 8061f33: chore(packages): publishing metadata — per-format types in `exports`, declared `sideEffects`, and a README for the 18 published packages without one
  
  Clause-②: no
  Metadata-protocol: none
  
  Measured on a fresh `origin/main` build of all 73 published packages outside `ui/`, each staged as `npm pack` would ship it, with publint 0.3.25 and @arethetypeswrong/cli 0.18.5. Before: 73 of 73 packages carried at least one publint message and 48 carried an attw problem. After: 3 packages carry a publint message and 16 carry an attw problem, each remaining class needing a change this one deliberately does not make — an export-map shape change, or a dual-build fix in `@objectstack/core`.
  
  - **Types per module format.** On 38 manifests one `types` entry served both formats, so a TypeScript consumer importing the ESM build was handed the CJS declarations — every one of attw's 38 `FalseCJS`. Each `{types, import, require}` entry becomes `{import: {types, default}, require: {types, default}}` pointing at the declaration file the same tsup run already emits for that format. No subpath is added or removed, and no JavaScript target moves. `@objectstack/core` keeps its single `types` entry: its `.d.ts` and `.d.cts` declare the same classes with private members, so serving them per format gives a consumer that reaches `core` through both resolution modes two incompatible `ObjectKernel` types, which is `@objectstack/plugin-dev`'s declaration build (it awaits `import('@objectstack/objectql')` inside a CommonJS build). Its `FalseESM` therefore stays, measured and unfixed here.
  - **`sideEffects` on the 72 manifests that declared none**, read per package rather than set in bulk: `@objectstack/service-cluster-redis` registers its `redis` cluster driver at module load and `create-objectstack`'s bin reaches its program through a bare import, so both declare their entry files side-effectful; everything else is `false`.
  - **`publishConfig: { access: 'public' }`** on the 17 that had none, the value the other 56 already declare.
  - **`type`** on the 39 that shipped `.js` without declaring a format — every `.js` under their `dist/` was read first and is CommonJS, which is what the absent field already meant — **`engines.node >= 22.0.0`** on the 22 that had no `engines`, and **`repository.url`** as the full `git+https://` git URL on 71.
  - **A README for 18 published packages that had none**: one paragraph, the first import a reader writes, and a link to the package's docs page. They are the pages npm renders, and for these 18 npm rendered nothing.
- Updated dependencies [733b3c8]
- Updated dependencies [384bb7b]
- Updated dependencies [fc4ac58]
- Updated dependencies [a0fac02]
- Updated dependencies [ab0bc89]
- Updated dependencies [42d9fe8]
- Updated dependencies [2af790f]
- Updated dependencies [cc10e74]
- Updated dependencies [8654435]
- Updated dependencies [65145d3]
- Updated dependencies [888d686]
- Updated dependencies [f6ba134]
- Updated dependencies [b77bb37]
- Updated dependencies [f1ddace]
- Updated dependencies [9993165]
- Updated dependencies [557973d]
- Updated dependencies [49653f9]
- Updated dependencies [6021b5e]
- Updated dependencies [7cd2ebf]
- Updated dependencies [4bcc4df]
- Updated dependencies [47af3dd]
- Updated dependencies [073f08b]
- Updated dependencies [07586f5]
- Updated dependencies [fa44dd2]
- Updated dependencies [0c81694]
- Updated dependencies [4034f47]
- Updated dependencies [52f3f51]
- Updated dependencies [d727348]
- Updated dependencies [5e113b3]
- Updated dependencies [493a6c4]
- Updated dependencies [d65cbb6]
- Updated dependencies [f00e8d5]
- Updated dependencies [d1663ba]
- Updated dependencies [2163e80]
- Updated dependencies [b00fc55]
- Updated dependencies [dd5e355]
- Updated dependencies [e2a4b6a]
- Updated dependencies [be78977]
- Updated dependencies [3446d43]
- Updated dependencies [436d284]
- Updated dependencies [dc71845]
- Updated dependencies [6d9d3ef]
- Updated dependencies [be531f6]
- Updated dependencies [f0b33ee]
- Updated dependencies [9ca36b1]
- Updated dependencies [39a78b1]
- Updated dependencies [c8cb510]
- Updated dependencies [9494dd8]
- Updated dependencies [8061f33]
- Updated dependencies [617f27e]
- Updated dependencies [b029c90]
- Updated dependencies [495fa07]
- Updated dependencies [876aa27]
- Updated dependencies [3b480e0]
- Updated dependencies [af13616]
- Updated dependencies [4548ba3]
- Updated dependencies [6a2866a]
- Updated dependencies [3a2d38c]
- Updated dependencies [17f8217]
- Updated dependencies [5e7cf63]
- Updated dependencies [6e47e16]
  - @objectstack/core@18.2.0
  - @objectstack/spec@18.2.0

## 18.1.0

### Patch Changes

- Updated dependencies [448374d]
- Updated dependencies [94842ba]
- Updated dependencies [7cacad5]
- Updated dependencies [df8bb40]
- Updated dependencies [0091d84]
- Updated dependencies [5e9b100]
- Updated dependencies [7532ea3]
- Updated dependencies [fde7456]
- Updated dependencies [de9cd1f]
- Updated dependencies [925fd07]
- Updated dependencies [e7befa7]
- Updated dependencies [55d7aab]
- Updated dependencies [644e4b2]
- Updated dependencies [0715fac]
- Updated dependencies [60b42cd]
- Updated dependencies [b9a79ef]
- Updated dependencies [63085c3]
- Updated dependencies [0b8bce4]
- Updated dependencies [2069b81]
- Updated dependencies [1862d8d]
- Updated dependencies [30d21f6]
- Updated dependencies [eddffc3]
- Updated dependencies [69712d5]
- Updated dependencies [dfe60e3]
- Updated dependencies [e939357]
- Updated dependencies [045858f]
- Updated dependencies [baedcec]
- Updated dependencies [03c12a5]
- Updated dependencies [386f60f]
- Updated dependencies [28c9a2c]
- Updated dependencies [2354058]
- Updated dependencies [edcc8ce]
- Updated dependencies [fccbd9d]
- Updated dependencies [c8f4c43]
- Updated dependencies [02ad31a]
- Updated dependencies [03966ce]
- Updated dependencies [e3aa111]
- Updated dependencies [863c580]
- Updated dependencies [7f5b19d]
- Updated dependencies [14e7239]
- Updated dependencies [fe0ec2b]
- Updated dependencies [dfab597]
- Updated dependencies [9127f23]
- Updated dependencies [24360dc]
- Updated dependencies [ecb4e69]
- Updated dependencies [8dfd126]
- Updated dependencies [bda53bb]
- Updated dependencies [b964ea1]
- Updated dependencies [4395cbc]
- Updated dependencies [9019af9]
- Updated dependencies [45f9962]
- Updated dependencies [e5eab06]
- Updated dependencies [dc532e8]
- Updated dependencies [d196748]
- Updated dependencies [5f30f00]
- Updated dependencies [7db1697]
- Updated dependencies [f5b6b3f]
- Updated dependencies [f4112a7]
- Updated dependencies [db1c7cc]
- Updated dependencies [303aef0]
- Updated dependencies [b3034ee]
- Updated dependencies [d12e650]
- Updated dependencies [830a63a]
- Updated dependencies [1000cc7]
- Updated dependencies [bdf762c]
- Updated dependencies [27b3f1f]
- Updated dependencies [7c68b10]
- Updated dependencies [025f6de]
- Updated dependencies [9f39094]
  - @objectstack/spec@18.1.0
  - @objectstack/core@18.1.0

## 18.0.0

### Patch Changes

- Updated dependencies [5a871e4]
- Updated dependencies [ffba02e]
- Updated dependencies [29d0ed3]
- Updated dependencies [1b40780]
- Updated dependencies [ca426cb]
- Updated dependencies [4ad3ce5]
- Updated dependencies [8016a9d]
- Updated dependencies [df9d07e]
- Updated dependencies [8eac321]
- Updated dependencies [a5a781b]
- Updated dependencies [9a7838e]
- Updated dependencies [191e043]
- Updated dependencies [b12e16a]
- Updated dependencies [fbafb85]
- Updated dependencies [35450f0]
- Updated dependencies [1e8b628]
- Updated dependencies [12d1476]
- Updated dependencies [14ccb1d]
- Updated dependencies [c0803b0]
- Updated dependencies [4bc3bec]
- Updated dependencies [1f949da]
- Updated dependencies [ecb7b44]
- Updated dependencies [41edf73]
- Updated dependencies [1c1144f]
- Updated dependencies [3983965]
- Updated dependencies [0c910d5]
- Updated dependencies [317cddd]
- Updated dependencies [b2e7870]
- Updated dependencies [fec87e7]
- Updated dependencies [c28f317]
- Updated dependencies [2e10c9a]
- Updated dependencies [dac99c2]
- Updated dependencies [0d3ea29]
- Updated dependencies [67b669e]
- Updated dependencies [0253192]
- Updated dependencies [bfc15d2]
- Updated dependencies [2ff0825]
- Updated dependencies [7aa8d51]
- Updated dependencies [95a8435]
- Updated dependencies [60bcfe7]
- Updated dependencies [66949b7]
- Updated dependencies [d112087]
- Updated dependencies [4806b18]
- Updated dependencies [1802315]
- Updated dependencies [06cc45d]
- Updated dependencies [7de0265]
- Updated dependencies [7895671]
- Updated dependencies [b389e43]
- Updated dependencies [c8b062f]
- Updated dependencies [117d34d]
- Updated dependencies [6729e10]
- Updated dependencies [1920cf3]
- Updated dependencies [41d0d40]
- Updated dependencies [c52bfb4]
- Updated dependencies [f9b4217]
- Updated dependencies [eebaf3b]
- Updated dependencies [c7d6037]
- Updated dependencies [72b26ed]
- Updated dependencies [2d21b9c]
- Updated dependencies [f66fdc7]
- Updated dependencies [9fdb127]
- Updated dependencies [615c696]
- Updated dependencies [968acc8]
- Updated dependencies [111ffff]
- Updated dependencies [12b9daf]
- Updated dependencies [7958bdf]
- Updated dependencies [d85615d]
- Updated dependencies [6a06e3b]
- Updated dependencies [0e9e7b7]
- Updated dependencies [0af4f66]
- Updated dependencies [9a0401f]
- Updated dependencies [9c93ce6]
- Updated dependencies [ac9f8bd]
- Updated dependencies [04e776b]
- Updated dependencies [a7df552]
- Updated dependencies [2f70c22]
- Updated dependencies [78f841b]
- Updated dependencies [c565813]
- Updated dependencies [d5a14dd]
- Updated dependencies [93125ae]
- Updated dependencies [56c8844]
- Updated dependencies [d4680d2]
- Updated dependencies [cdeabec]
- Updated dependencies [d7c5c33]
- Updated dependencies [a87d8be]
- Updated dependencies [15ec50e]
- Updated dependencies [db4c45b]
- Updated dependencies [51290bc]
- Updated dependencies [ad381fd]
- Updated dependencies [2b61f2d]
- Updated dependencies [8f2e808]
- Updated dependencies [3b49318]
- Updated dependencies [4e9fe9f]
- Updated dependencies [9ad3d24]
- Updated dependencies [326a90a]
- Updated dependencies [9fe7448]
- Updated dependencies [2e11d90]
- Updated dependencies [4578c56]
- Updated dependencies [c512c25]
- Updated dependencies [215e662]
- Updated dependencies [3d886ee]
- Updated dependencies [d8d0711]
- Updated dependencies [b15f8a1]
- Updated dependencies [f6e1d49]
- Updated dependencies [e9a1f5c]
- Updated dependencies [40a6ee5]
- Updated dependencies [5910b5e]
- Updated dependencies [7098aca]
- Updated dependencies [97610a5]
- Updated dependencies [081e6a0]
- Updated dependencies [1884948]
- Updated dependencies [3089848]
- Updated dependencies [e23eccb]
- Updated dependencies [ac8f2c5]
- Updated dependencies [db9cf80]
- Updated dependencies [e75dced]
- Updated dependencies [9af0005]
- Updated dependencies [440bed6]
- Updated dependencies [b2549a8]
- Updated dependencies [ee8751d]
- Updated dependencies [96e4be4]
- Updated dependencies [194a42d]
- Updated dependencies [35ef501]
- Updated dependencies [faf6348]
- Updated dependencies [557ae7c]
- Updated dependencies [6a3fe25]
- Updated dependencies [7731d70]
- Updated dependencies [3073b72]
- Updated dependencies [c76edeb]
- Updated dependencies [5b12503]
- Updated dependencies [514bf3c]
- Updated dependencies [20e7d52]
- Updated dependencies [b3a3634]
- Updated dependencies [3e72f93]
- Updated dependencies [f89b5f5]
- Updated dependencies [d25b187]
- Updated dependencies [0e00d36]
- Updated dependencies [d748ae8]
- Updated dependencies [dab6bf4]
- Updated dependencies [ed1de8c]
- Updated dependencies [a00cf99]
- Updated dependencies [5fb1746]
- Updated dependencies [29a163f]
- Updated dependencies [e223152]
- Updated dependencies [9f5eca5]
- Updated dependencies [9963322]
- Updated dependencies [b27b894]
- Updated dependencies [874a38d]
- Updated dependencies [02d9f69]
- Updated dependencies [f53f14b]
- Updated dependencies [a800912]
- Updated dependencies [d973c34]
- Updated dependencies [156ddfa]
- Updated dependencies [5081090]
- Updated dependencies [b6eb25f]
- Updated dependencies [165587e]
- Updated dependencies [e04759d]
- Updated dependencies [ea9fd99]
- Updated dependencies [b32ee3e]
- Updated dependencies [91f46d0]
- Updated dependencies [e5899a6]
- Updated dependencies [d7b26df]
- Updated dependencies [490cb6d]
- Updated dependencies [e865300]
- Updated dependencies [ec7c7e0]
- Updated dependencies [c74d843]
- Updated dependencies [6d5191e]
- Updated dependencies [85edd61]
- Updated dependencies [e84aeb3]
- Updated dependencies [322ff1e]
- Updated dependencies [7b0a9c9]
- Updated dependencies [5fc57b3]
- Updated dependencies [fe58bbc]
- Updated dependencies [c4e7fa5]
- Updated dependencies [581ca7d]
- Updated dependencies [3f0b6f2]
- Updated dependencies [b7cd1af]
- Updated dependencies [9814035]
- Updated dependencies [55382dc]
- Updated dependencies [b1d701b]
- Updated dependencies [efcbac7]
- Updated dependencies [51f36e7]
- Updated dependencies [20028df]
- Updated dependencies [69d4218]
- Updated dependencies [5ce6773]
- Updated dependencies [9432bac]
- Updated dependencies [3f69471]
- Updated dependencies [87e902d]
- Updated dependencies [e5687cb]
- Updated dependencies [1e62f71]
- Updated dependencies [777eed2]
- Updated dependencies [ec7f7f8]
- Updated dependencies [038d4c9]
- Updated dependencies [147a0d1]
- Updated dependencies [1959aac]
- Updated dependencies [ed03834]
- Updated dependencies [e1deaef]
- Updated dependencies [1badd31]
- Updated dependencies [55828c5]
- Updated dependencies [7856110]
- Updated dependencies [9b37edb]
- Updated dependencies [4216796]
- Updated dependencies [a22e67b]
- Updated dependencies [5f37d36]
- Updated dependencies [62ce45d]
- Updated dependencies [39e93ef]
- Updated dependencies [02bec6c]
- Updated dependencies [719183f]
- Updated dependencies [c40a0dd]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [8464380]
- Updated dependencies [252a582]
- Updated dependencies [f931e76]
- Updated dependencies [1912af4]
- Updated dependencies [e5f9f01]
- Updated dependencies [76815b9]
- Updated dependencies [4d1e4a8]
- Updated dependencies [4cc3ff9]
- Updated dependencies [c056979]
- Updated dependencies [4f68ba1]
- Updated dependencies [107853c]
- Updated dependencies [543b33d]
- Updated dependencies [b529a5c]
- Updated dependencies [1623faf]
- Updated dependencies [b4d573a]
- Updated dependencies [87d0619]
- Updated dependencies [4e0838d]
- Updated dependencies [60f9baf]
- Updated dependencies [f5ef054]
- Updated dependencies [584e737]
- Updated dependencies [37510aa]
- Updated dependencies [c857a93]
- Updated dependencies [345d1be]
- Updated dependencies [430e5f5]
- Updated dependencies [14a13bc]
- Updated dependencies [ca0bdbc]
- Updated dependencies [301eec6]
- Updated dependencies [572ecfb]
- Updated dependencies [5547ad4]
- Updated dependencies [707b3cd]
- Updated dependencies [6673c80]
- Updated dependencies [0f05907]
- Updated dependencies [5e725b8]
- Updated dependencies [086fa46]
- Updated dependencies [eeb95f7]
- Updated dependencies [d89f491]
- Updated dependencies [dc39326]
- Updated dependencies [775ed65]
- Updated dependencies [e4ec6ec]
- Updated dependencies [b1e9280]
- Updated dependencies [05ab9ef]
- Updated dependencies [1d79556]
- Updated dependencies [07b27b3]
- Updated dependencies [d0c09e4]
- Updated dependencies [3fed1eb]
- Updated dependencies [1692cd1]
- Updated dependencies [73c7dc4]
- Updated dependencies [8693110]
- Updated dependencies [ad5a7d7]
- Updated dependencies [dd29bbe]
- Updated dependencies [dd29bbe]
- Updated dependencies [6f21216]
- Updated dependencies [2372e0a]
- Updated dependencies [5afa1e0]
- Updated dependencies [56b2612]
- Updated dependencies [1418de4]
- Updated dependencies [7a96bf8]
- Updated dependencies [a35f7a6]
- Updated dependencies [daafae6]
- Updated dependencies [5fd2c76]
- Updated dependencies [be48c5e]
- Updated dependencies [57994c3]
- Updated dependencies [23e689d]
- Updated dependencies [bc0538a]
- Updated dependencies [f606ba2]
- Updated dependencies [d176b0a]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [c5dd7fc]
- Updated dependencies [ee0e115]
- Updated dependencies [4feb2d0]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [1ac24f2]
- Updated dependencies [0a052e6]
- Updated dependencies [462dff3]
- Updated dependencies [8044f4d]
- Updated dependencies [ae0ca66]
- Updated dependencies [c03077e]
- Updated dependencies [23d0bc7]
- Updated dependencies [069fd40]
- Updated dependencies [941c78a]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [6422da5]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [4ffdebe]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [e246f06]
- Updated dependencies [a65a59b]
- Updated dependencies [b0a1df0]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [45e6001]
- Updated dependencies [e46ce7b]
- Updated dependencies [9f024d8]
- Updated dependencies [2ac0616]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [fa26308]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [62e2b6d]
- Updated dependencies [01fafde]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [26501ae]
- Updated dependencies [31e7d0b]
- Updated dependencies [94e60c0]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [adb7910]
- Updated dependencies [f573976]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [ff48407]
- Updated dependencies [ef1fcb2]
- Updated dependencies [ace0a53]
- Updated dependencies [de70e97]
- Updated dependencies [74c4b34]
- Updated dependencies [e040b8c]
- Updated dependencies [f451a59]
- Updated dependencies [ba95607]
- Updated dependencies [b53b949]
- Updated dependencies [ea9fd99]
- Updated dependencies [1e44436]
- Updated dependencies [2acff87]
- Updated dependencies [299a2c6]
- Updated dependencies [325a92e]
- Updated dependencies [e23eccb]
- Updated dependencies [bf492c8]
- Updated dependencies [c7a3234]
  - @objectstack/core@18.0.0
  - @objectstack/spec@18.0.0

## 18.0.0-next.5

### Patch Changes

- Updated dependencies [fa26308]
- Updated dependencies [01fafde]
- Updated dependencies [26501ae]
- Updated dependencies [94e60c0]
- Updated dependencies [adb7910]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [ff48407]
  - @objectstack/spec@18.0.0-next.5
  - @objectstack/core@18.0.0-next.5

## 18.0.0-next.4

### Patch Changes

- Updated dependencies [b2e7870]
- Updated dependencies [eebaf3b]
- Updated dependencies [194a42d]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [f5ef054]
- Updated dependencies [b0a1df0]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [e46ce7b]
- Updated dependencies [2ac0616]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [62e2b6d]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [31e7d0b]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [f573976]
  - @objectstack/core@18.0.0-next.4
  - @objectstack/spec@18.0.0-next.4

## 18.0.0-next.3

### Patch Changes

- Updated dependencies [b15f8a1]
- Updated dependencies [4216796]
- Updated dependencies [c40a0dd]
- Updated dependencies [60f9baf]
- Updated dependencies [3fed1eb]
- Updated dependencies [a35f7a6]
- Updated dependencies [f606ba2]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [ee0e115]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [0a052e6]
- Updated dependencies [ae0ca66]
- Updated dependencies [23d0bc7]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [6422da5]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [4ffdebe]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [e246f06]
- Updated dependencies [a65a59b]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [45e6001]
- Updated dependencies [9f024d8]
  - @objectstack/spec@18.0.0-next.3
  - @objectstack/core@18.0.0-next.3

## 18.0.0-next.2

### Patch Changes

- Updated dependencies [0d3ea29]
- Updated dependencies [f9b4217]
- Updated dependencies [87d0619]
- Updated dependencies [4e0838d]
- Updated dependencies [584e737]
- Updated dependencies [301eec6]
- Updated dependencies [5547ad4]
- Updated dependencies [0f05907]
- Updated dependencies [086fa46]
- Updated dependencies [b1e9280]
- Updated dependencies [05ab9ef]
- Updated dependencies [1d79556]
- Updated dependencies [07b27b3]
- Updated dependencies [d0c09e4]
- Updated dependencies [1692cd1]
- Updated dependencies [73c7dc4]
- Updated dependencies [8693110]
- Updated dependencies [ad5a7d7]
- Updated dependencies [dd29bbe]
- Updated dependencies [dd29bbe]
- Updated dependencies [6f21216]
- Updated dependencies [2372e0a]
- Updated dependencies [5afa1e0]
- Updated dependencies [56b2612]
- Updated dependencies [1418de4]
- Updated dependencies [7a96bf8]
- Updated dependencies [daafae6]
- Updated dependencies [5fd2c76]
- Updated dependencies [be48c5e]
- Updated dependencies [57994c3]
- Updated dependencies [23e689d]
- Updated dependencies [bc0538a]
- Updated dependencies [d176b0a]
- Updated dependencies [c5dd7fc]
- Updated dependencies [4feb2d0]
- Updated dependencies [1ac24f2]
- Updated dependencies [462dff3]
- Updated dependencies [8044f4d]
- Updated dependencies [c03077e]
- Updated dependencies [069fd40]
- Updated dependencies [941c78a]
  - @objectstack/spec@18.0.0-next.2
  - @objectstack/core@18.0.0-next.2

## 18.0.0-next.1

### Patch Changes

- Updated dependencies [dac99c2]
- Updated dependencies [66949b7]
- Updated dependencies [7958bdf]
- Updated dependencies [87e902d]
- Updated dependencies [777eed2]
- Updated dependencies [ed03834]
- Updated dependencies [5f37d36]
- Updated dependencies [1912af4]
- Updated dependencies [76815b9]
- Updated dependencies [4d1e4a8]
- Updated dependencies [4cc3ff9]
- Updated dependencies [c056979]
- Updated dependencies [4f68ba1]
- Updated dependencies [107853c]
- Updated dependencies [543b33d]
- Updated dependencies [b529a5c]
- Updated dependencies [1623faf]
- Updated dependencies [b4d573a]
- Updated dependencies [37510aa]
- Updated dependencies [c857a93]
- Updated dependencies [345d1be]
- Updated dependencies [430e5f5]
- Updated dependencies [14a13bc]
- Updated dependencies [ca0bdbc]
- Updated dependencies [572ecfb]
- Updated dependencies [707b3cd]
- Updated dependencies [6673c80]
- Updated dependencies [5e725b8]
- Updated dependencies [eeb95f7]
- Updated dependencies [d89f491]
- Updated dependencies [dc39326]
- Updated dependencies [775ed65]
- Updated dependencies [e4ec6ec]
- Updated dependencies [325a92e]
  - @objectstack/spec@18.0.0-next.1
  - @objectstack/core@18.0.0-next.1

## 18.0.0-next.0

### Patch Changes

- Updated dependencies [317cddd]
- Updated dependencies [fec87e7]
- Updated dependencies [c28f317]
- Updated dependencies [2e10c9a]
- Updated dependencies [67b669e]
- Updated dependencies [0253192]
- Updated dependencies [bfc15d2]
- Updated dependencies [2ff0825]
- Updated dependencies [7aa8d51]
- Updated dependencies [95a8435]
- Updated dependencies [60bcfe7]
- Updated dependencies [d112087]
- Updated dependencies [4806b18]
- Updated dependencies [1802315]
- Updated dependencies [06cc45d]
- Updated dependencies [7de0265]
- Updated dependencies [7895671]
- Updated dependencies [b389e43]
- Updated dependencies [c8b062f]
- Updated dependencies [117d34d]
- Updated dependencies [6729e10]
- Updated dependencies [1920cf3]
- Updated dependencies [41d0d40]
- Updated dependencies [c52bfb4]
- Updated dependencies [c7d6037]
- Updated dependencies [72b26ed]
- Updated dependencies [2d21b9c]
- Updated dependencies [f66fdc7]
- Updated dependencies [9fdb127]
- Updated dependencies [615c696]
- Updated dependencies [968acc8]
- Updated dependencies [111ffff]
- Updated dependencies [12b9daf]
- Updated dependencies [d85615d]
- Updated dependencies [6a06e3b]
- Updated dependencies [0e9e7b7]
- Updated dependencies [0af4f66]
- Updated dependencies [9a0401f]
- Updated dependencies [9c93ce6]
- Updated dependencies [ac9f8bd]
- Updated dependencies [04e776b]
- Updated dependencies [a7df552]
- Updated dependencies [2f70c22]
- Updated dependencies [78f841b]
- Updated dependencies [c565813]
- Updated dependencies [d5a14dd]
- Updated dependencies [93125ae]
- Updated dependencies [56c8844]
- Updated dependencies [d4680d2]
- Updated dependencies [cdeabec]
- Updated dependencies [d7c5c33]
- Updated dependencies [a87d8be]
- Updated dependencies [15ec50e]
- Updated dependencies [db4c45b]
- Updated dependencies [51290bc]
- Updated dependencies [ad381fd]
- Updated dependencies [2b61f2d]
- Updated dependencies [8f2e808]
- Updated dependencies [3b49318]
- Updated dependencies [4e9fe9f]
- Updated dependencies [9ad3d24]
- Updated dependencies [326a90a]
- Updated dependencies [9fe7448]
- Updated dependencies [2e11d90]
- Updated dependencies [4578c56]
- Updated dependencies [c512c25]
- Updated dependencies [215e662]
- Updated dependencies [3d886ee]
- Updated dependencies [d8d0711]
- Updated dependencies [f6e1d49]
- Updated dependencies [e9a1f5c]
- Updated dependencies [40a6ee5]
- Updated dependencies [5910b5e]
- Updated dependencies [7098aca]
- Updated dependencies [97610a5]
- Updated dependencies [081e6a0]
- Updated dependencies [1884948]
- Updated dependencies [3089848]
- Updated dependencies [e23eccb]
- Updated dependencies [ac8f2c5]
- Updated dependencies [db9cf80]
- Updated dependencies [e75dced]
- Updated dependencies [9af0005]
- Updated dependencies [440bed6]
- Updated dependencies [b2549a8]
- Updated dependencies [ee8751d]
- Updated dependencies [96e4be4]
- Updated dependencies [35ef501]
- Updated dependencies [faf6348]
- Updated dependencies [557ae7c]
- Updated dependencies [6a3fe25]
- Updated dependencies [7731d70]
- Updated dependencies [3073b72]
- Updated dependencies [c76edeb]
- Updated dependencies [5b12503]
- Updated dependencies [514bf3c]
- Updated dependencies [20e7d52]
- Updated dependencies [b3a3634]
- Updated dependencies [3e72f93]
- Updated dependencies [f89b5f5]
- Updated dependencies [d25b187]
- Updated dependencies [0e00d36]
- Updated dependencies [d748ae8]
- Updated dependencies [dab6bf4]
- Updated dependencies [ed1de8c]
- Updated dependencies [a00cf99]
- Updated dependencies [5fb1746]
- Updated dependencies [29a163f]
- Updated dependencies [e223152]
- Updated dependencies [9f5eca5]
- Updated dependencies [9963322]
- Updated dependencies [b27b894]
- Updated dependencies [874a38d]
- Updated dependencies [02d9f69]
- Updated dependencies [f53f14b]
- Updated dependencies [a800912]
- Updated dependencies [d973c34]
- Updated dependencies [156ddfa]
- Updated dependencies [5081090]
- Updated dependencies [b6eb25f]
- Updated dependencies [165587e]
- Updated dependencies [e04759d]
- Updated dependencies [ea9fd99]
- Updated dependencies [b32ee3e]
- Updated dependencies [91f46d0]
- Updated dependencies [e5899a6]
- Updated dependencies [d7b26df]
- Updated dependencies [490cb6d]
- Updated dependencies [e865300]
- Updated dependencies [ec7c7e0]
- Updated dependencies [c74d843]
- Updated dependencies [6d5191e]
- Updated dependencies [85edd61]
- Updated dependencies [e84aeb3]
- Updated dependencies [322ff1e]
- Updated dependencies [7b0a9c9]
- Updated dependencies [5fc57b3]
- Updated dependencies [fe58bbc]
- Updated dependencies [c4e7fa5]
- Updated dependencies [581ca7d]
- Updated dependencies [3f0b6f2]
- Updated dependencies [b7cd1af]
- Updated dependencies [9814035]
- Updated dependencies [55382dc]
- Updated dependencies [b1d701b]
- Updated dependencies [efcbac7]
- Updated dependencies [51f36e7]
- Updated dependencies [20028df]
- Updated dependencies [69d4218]
- Updated dependencies [5ce6773]
- Updated dependencies [9432bac]
- Updated dependencies [3f69471]
- Updated dependencies [e5687cb]
- Updated dependencies [1e62f71]
- Updated dependencies [ec7f7f8]
- Updated dependencies [038d4c9]
- Updated dependencies [147a0d1]
- Updated dependencies [1959aac]
- Updated dependencies [e1deaef]
- Updated dependencies [1badd31]
- Updated dependencies [55828c5]
- Updated dependencies [7856110]
- Updated dependencies [9b37edb]
- Updated dependencies [a22e67b]
- Updated dependencies [62ce45d]
- Updated dependencies [39e93ef]
- Updated dependencies [02bec6c]
- Updated dependencies [719183f]
- Updated dependencies [8464380]
- Updated dependencies [252a582]
- Updated dependencies [f931e76]
- Updated dependencies [e5f9f01]
- Updated dependencies [ef1fcb2]
- Updated dependencies [ace0a53]
- Updated dependencies [de70e97]
- Updated dependencies [74c4b34]
- Updated dependencies [e040b8c]
- Updated dependencies [f451a59]
- Updated dependencies [ba95607]
- Updated dependencies [b53b949]
- Updated dependencies [ea9fd99]
- Updated dependencies [1e44436]
- Updated dependencies [2acff87]
- Updated dependencies [299a2c6]
- Updated dependencies [e23eccb]
- Updated dependencies [bf492c8]
- Updated dependencies [c7a3234]
  - @objectstack/spec@18.0.0-next.0
  - @objectstack/core@18.0.0-next.0

## 17.7.0

### Minor Changes

- 568dc0b: Record-change payloads apply the same credential mask and internal-field omission as write responses.
  
  Clause-②: yes (widening)
  
  - **`data.record.created` / `data.record.updated` events.** The engine projects the event's `after` and `changes` bodies through `omitInternalFieldsFromWriteResponse` (`@objectstack/core`), the helper every external write response already uses: credential-class fields (`secret`, and `password` outside the exempt `managedBy` buckets) carry `SECRET_MASK` (or `null` when unset), and `internal: true` fields are omitted. The engine's own write result is unchanged, so a privileged in-process caller that reads the stored value back off `insert` / `update` still sees it.
  - **Approval request snapshot.** The record snapshot an approval request stores (`payload_json`) applies the same rule when the request is opened.
  - **Outbound webhook body.** The delivered body, and the delivery row that stores it, apply the same rule to `before`, `after` and `changes`.
  - **Knowledge index documents.** `recordToDocument` takes the object definition as an optional fourth argument and skips credential-class and `internal` fields, under `'*'` and when a source names one explicitly. `KnowledgeService` passes the definition from the bound engine.
  - **New public surface of `@objectstack/service-knowledge` (additive):** `recordToDocument` accepts the object definition as an optional fourth argument; existing three-argument calls behave as before.
  - **Receivers see masked values.** Webhook receivers and realtime clients now get `SECRET_MASK` (or `null` when unset) for credential-class fields and no key for `internal` fields.
  - **Existing rows are not rewritten.** Approval snapshots, webhook delivery rows and knowledge documents written before this change keep their stored bodies; reindexing a knowledge source refreshes its documents.
  - The audit trail already masked these fields and is unchanged. No other accept set or public schema changes.

### Patch Changes

- 6091136: MCP stdio, email, knowledge, queue, SMS, storage and record-trigger refusals, warnings and template descriptions no longer cite tracker numbers; each one states the decision behind it in words
  
  Clause-②: no
  
  Some strings these seven packages show to operators, administrators and flow authors pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.
  
  - `@objectstack/connector-mcp`: the declarative stdio refusals say a stdio transport launches a local process, so stack metadata may only name a command the host's own code allows, and that an http transport is not gated by this policy.
  - `@objectstack/plugin-email`: the built-in change-email notice template's description, in all four locales, says the notice goes to the previous address so a hijacked session cannot move the account identity unannounced; the internal-headers refusal says a missing header does not announce itself, so the send would succeed while silently deviating from what was authored; the over-limit attachments line says the storage capability holds large content outside the row while the row keeps a reference and the attachment's audit metadata.
  - `@objectstack/service-knowledge`: the no-identity retrieval warning says a missing identity is not a grant of authority, so retrieval fails closed rather than searching the whole corpus unscoped; the predicate-write warning says the lifecycle reap guard de-indexes retention-swept rows before they are deleted.
  - `@objectstack/service-queue`: the missing-retention refusal says the one platform reaper sweeps completed rows by that declaration, so the adapter does not sweep the table itself; the rejected-floor error says the floor is what makes the lifecycle service refuse an override below the idempotency window.
  - `@objectstack/service-sms`: the unreadable-counter warning says a quota the platform cannot count must not refuse the one-time codes users sign in with; the counter store's lines name the daily SMS send quota without a number.
  - `@objectstack/service-storage`: the reclamation-gate line says deleting bytes cannot be undone, so it waits for a verified migration with no deviation on record, while reversible work carries on.
  - `@objectstack/trigger-record-change`: the array-trigger warning says multi-event arrays are deferred until two independent projects need a combination other than created-or-updated.
  
  Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
- Updated dependencies [ecb6ca0]
- Updated dependencies [135daaa]
- Updated dependencies [22c2d6f]
- Updated dependencies [909229e]
- Updated dependencies [0721848]
- Updated dependencies [bdd3654]
- Updated dependencies [aead296]
- Updated dependencies [c205b6c]
- Updated dependencies [ad7c351]
- Updated dependencies [e901c27]
- Updated dependencies [a387354]
- Updated dependencies [f6b7520]
- Updated dependencies [36e4647]
- Updated dependencies [93a54b8]
- Updated dependencies [f623e2f]
- Updated dependencies [96a9719]
- Updated dependencies [41a3c8d]
- Updated dependencies [c52c49d]
- Updated dependencies [cfa4d74]
- Updated dependencies [99589f9]
- Updated dependencies [36ad321]
- Updated dependencies [dcc5ef4]
- Updated dependencies [9b7a0ef]
- Updated dependencies [5a9292e]
- Updated dependencies [30af17e]
- Updated dependencies [1c52a5e]
- Updated dependencies [99e1912]
- Updated dependencies [7ebb543]
- Updated dependencies [3911901]
- Updated dependencies [222ecc2]
- Updated dependencies [3937ad2]
- Updated dependencies [3a6d92f]
- Updated dependencies [7526058]
- Updated dependencies [53fd35e]
- Updated dependencies [23365ea]
- Updated dependencies [32d5769]
- Updated dependencies [16eefc6]
- Updated dependencies [6e33b67]
- Updated dependencies [57cc695]
- Updated dependencies [db3fee3]
- Updated dependencies [4c8363f]
- Updated dependencies [9f13c94]
- Updated dependencies [6d67ad5]
- Updated dependencies [ca0dfb6]
- Updated dependencies [45efcfa]
- Updated dependencies [c9c555a]
- Updated dependencies [68c5ab7]
- Updated dependencies [b793010]
- Updated dependencies [5555047]
- Updated dependencies [aa46322]
- Updated dependencies [100c394]
- Updated dependencies [72217cd]
- Updated dependencies [72af58c]
- Updated dependencies [1289925]
- Updated dependencies [958cfe2]
- Updated dependencies [ced3e1a]
- Updated dependencies [7d674df]
- Updated dependencies [3f1bc81]
- Updated dependencies [72f3c74]
- Updated dependencies [529d971]
- Updated dependencies [16d241a]
- Updated dependencies [4331a6b]
- Updated dependencies [6c5697d]
- Updated dependencies [9a4182a]
- Updated dependencies [41b1333]
- Updated dependencies [f1e4ae5]
- Updated dependencies [eb9ef79]
- Updated dependencies [eb9ef79]
- Updated dependencies [f83d066]
- Updated dependencies [1ac7308]
- Updated dependencies [10454b3]
- Updated dependencies [9e9d693]
- Updated dependencies [6ec54f0]
- Updated dependencies [98eb3b9]
- Updated dependencies [a2aadab]
- Updated dependencies [fe10172]
- Updated dependencies [ed15448]
- Updated dependencies [9d91f58]
- Updated dependencies [9059082]
- Updated dependencies [309224d]
- Updated dependencies [e83c9f6]
- Updated dependencies [045f764]
- Updated dependencies [2df3d13]
- Updated dependencies [07bf21f]
- Updated dependencies [6fb7115]
- Updated dependencies [53021e3]
- Updated dependencies [a0176ef]
- Updated dependencies [ba57588]
- Updated dependencies [a43d90a]
- Updated dependencies [607463d]
- Updated dependencies [cab6396]
- Updated dependencies [e864db5]
- Updated dependencies [866683f]
- Updated dependencies [88a39c0]
- Updated dependencies [8e35895]
- Updated dependencies [1f04696]
- Updated dependencies [d16b9fb]
- Updated dependencies [bab7685]
- Updated dependencies [fb69825]
- Updated dependencies [48eb9c1]
- Updated dependencies [8832655]
- Updated dependencies [100f68b]
- Updated dependencies [8963dbf]
- Updated dependencies [1354e7b]
- Updated dependencies [1cbe165]
- Updated dependencies [15fe567]
- Updated dependencies [0bddffd]
- Updated dependencies [7e0066a]
  - @objectstack/spec@17.7.0
  - @objectstack/core@17.7.0

## 17.6.0

### Patch Changes

- e952cff: fix(service-knowledge): the realtime event bridge no longer keeps a `record.created` / `record.updated` / `record.deleted` branch, and its docs name the events ObjectQL really publishes (#20573)
  
  No producer emits a bare `record.*` event: the ObjectQL engine publishes `data.record.created` / `data.record.updated` / `data.record.deleted` for a single-record write and `data.records.updated` / `data.records.deleted` for a predicate write (`multi: true`), and `@objectstack/spec` already dropped the bare names from `RealtimeEventType`. The `KnowledgeServicePlugin` subscription handler still carried a branch for them, with a `payload.record ?? payload` fallback for a shape nothing sends. That branch is removed. The `data.record.*` sync (record body from `after`, id from `recordId`) and the `data.records.*` stale-index warning are unchanged.
  
  The `enableEventSync` option's TSDoc and the `handleRecordUpsert` / `handleRecordDelete` docs now name `data.record.created|updated|deleted` instead of `record.*`.
  
  If a plugin of yours publishes a bare `record.created`, `record.updated` or `record.deleted` event through `IRealtimeService` and relied on the knowledge index following it, publish `data.record.created|updated|deleted` with the `DataEvent` payload instead (the record in `after`, its id in `recordId`).
- Updated dependencies [e5c7d07]
- Updated dependencies [addbbf0]
- Updated dependencies [93d4e0e]
- Updated dependencies [88b484e]
- Updated dependencies [9905e61]
- Updated dependencies [f11b5f2]
- Updated dependencies [0cb72cf]
- Updated dependencies [c1d8051]
- Updated dependencies [a918fe7]
- Updated dependencies [41dcf11]
- Updated dependencies [c46279f]
- Updated dependencies [688ddef]
- Updated dependencies [b1aab1e]
- Updated dependencies [274e162]
- Updated dependencies [05a7547]
- Updated dependencies [0efbdc3]
- Updated dependencies [c8dd8dd]
- Updated dependencies [03cdb9a]
- Updated dependencies [15b586d]
- Updated dependencies [542670d]
- Updated dependencies [e73ee2d]
- Updated dependencies [92fe081]
- Updated dependencies [c4c68ca]
- Updated dependencies [d78a0bd]
- Updated dependencies [5363e2d]
- Updated dependencies [c876a74]
- Updated dependencies [f1e921a]
- Updated dependencies [7a1faf1]
- Updated dependencies [c9d234c]
- Updated dependencies [3fbf3ca]
- Updated dependencies [24d521e]
- Updated dependencies [b785c3b]
- Updated dependencies [2473e26]
- Updated dependencies [3a89d45]
- Updated dependencies [f379f57]
- Updated dependencies [889139c]
- Updated dependencies [05cb2bc]
- Updated dependencies [7510663]
- Updated dependencies [a6866da]
- Updated dependencies [1a75e39]
- Updated dependencies [cd901d7]
- Updated dependencies [d7631d5]
- Updated dependencies [d830d71]
- Updated dependencies [89801cd]
- Updated dependencies [1ab9892]
- Updated dependencies [fbec216]
- Updated dependencies [35587f7]
- Updated dependencies [ace770d]
- Updated dependencies [ed54768]
- Updated dependencies [99786f9]
- Updated dependencies [63bfe69]
- Updated dependencies [1940afd]
- Updated dependencies [4f83db5]
- Updated dependencies [f5c7b2c]
- Updated dependencies [6afccda]
- Updated dependencies [671d4c1]
- Updated dependencies [bbcd20c]
- Updated dependencies [c8111a5]
- Updated dependencies [9ad6544]
- Updated dependencies [c9c182e]
- Updated dependencies [4b4ee88]
- Updated dependencies [f10d802]
- Updated dependencies [856321f]
- Updated dependencies [6b004c0]
- Updated dependencies [93e9e42]
- Updated dependencies [ca5408c]
- Updated dependencies [b280546]
- Updated dependencies [975b248]
- Updated dependencies [ebb66aa]
- Updated dependencies [ceee88f]
- Updated dependencies [e18fea6]
- Updated dependencies [f750119]
- Updated dependencies [660a9b2]
- Updated dependencies [dcd3309]
- Updated dependencies [f6ccca4]
- Updated dependencies [26437ae]
- Updated dependencies [d1633f3]
- Updated dependencies [32d3b3c]
- Updated dependencies [c6b3a01]
- Updated dependencies [bee75ce]
- Updated dependencies [2742e53]
- Updated dependencies [a75311d]
- Updated dependencies [d98bf24]
- Updated dependencies [8368f1c]
- Updated dependencies [8368f1c]
- Updated dependencies [31c3996]
- Updated dependencies [95555e7]
- Updated dependencies [a29a0ea]
- Updated dependencies [83480c6]
- Updated dependencies [013f97d]
- Updated dependencies [5d5e679]
- Updated dependencies [e07566b]
- Updated dependencies [11d28c1]
- Updated dependencies [399e3aa]
- Updated dependencies [ba03198]
- Updated dependencies [94608a7]
- Updated dependencies [58a77db]
- Updated dependencies [b3d7a70]
- Updated dependencies [b3917d9]
- Updated dependencies [c27404f]
- Updated dependencies [a11faee]
- Updated dependencies [2c1cef3]
- Updated dependencies [27c0cf3]
- Updated dependencies [097ef80]
- Updated dependencies [70dae53]
- Updated dependencies [665cab3]
- Updated dependencies [682873d]
- Updated dependencies [1bd14c9]
- Updated dependencies [62b90d7]
- Updated dependencies [cb45469]
- Updated dependencies [f3b16fc]
- Updated dependencies [d6d6e87]
- Updated dependencies [df1feae]
- Updated dependencies [336e191]
- Updated dependencies [9bdc6d3]
- Updated dependencies [24c554d]
- Updated dependencies [3dc33b2]
- Updated dependencies [9969228]
- Updated dependencies [95e24b0]
- Updated dependencies [1a4c7f8]
- Updated dependencies [c7396f1]
- Updated dependencies [434c6c7]
- Updated dependencies [4b59a38]
- Updated dependencies [d2bc644]
- Updated dependencies [cfa9315]
- Updated dependencies [0803a8b]
- Updated dependencies [0d42104]
- Updated dependencies [a3d7588]
- Updated dependencies [b8191f7]
- Updated dependencies [315888d]
- Updated dependencies [1741c5d]
- Updated dependencies [3711e0b]
- Updated dependencies [a8acee2]
- Updated dependencies [a51920f]
- Updated dependencies [0f6dcac]
- Updated dependencies [682873f]
- Updated dependencies [2123fcc]
  - @objectstack/spec@17.6.0
  - @objectstack/core@17.6.0

## 17.5.0

### Patch Changes

- Updated dependencies [863c7c4]
- Updated dependencies [0f95f43]
- Updated dependencies [825d70f]
- Updated dependencies [6057357]
- Updated dependencies [a60e04d]
- Updated dependencies [abc4b83]
- Updated dependencies [7382c5d]
- Updated dependencies [ea2940d]
- Updated dependencies [7d0f911]
- Updated dependencies [48f5200]
- Updated dependencies [245f360]
- Updated dependencies [d0f1845]
- Updated dependencies [9dcdb77]
- Updated dependencies [6175da8]
- Updated dependencies [0283cb9]
- Updated dependencies [324968e]
- Updated dependencies [7843663]
- Updated dependencies [ce57857]
- Updated dependencies [744a0a3]
- Updated dependencies [c7d4825]
- Updated dependencies [4844840]
- Updated dependencies [fe71032]
- Updated dependencies [74eaab8]
- Updated dependencies [0b788da]
- Updated dependencies [f7a3495]
- Updated dependencies [97f4f8c]
- Updated dependencies [482d34d]
- Updated dependencies [7a25a3e]
- Updated dependencies [839d1b0]
- Updated dependencies [2fc092b]
- Updated dependencies [2dfe070]
- Updated dependencies [6059b29]
- Updated dependencies [88a072e]
- Updated dependencies [d4a1a28]
- Updated dependencies [baf9745]
- Updated dependencies [3d8779d]
- Updated dependencies [0bd7dae]
- Updated dependencies [d34f9b6]
- Updated dependencies [57343f7]
- Updated dependencies [271d6bb]
- Updated dependencies [1e20f81]
- Updated dependencies [38472ce]
- Updated dependencies [8b48903]
- Updated dependencies [2d235bc]
- Updated dependencies [aaacf1d]
- Updated dependencies [6548118]
- Updated dependencies [9dacf61]
- Updated dependencies [146c291]
- Updated dependencies [4db1bf1]
- Updated dependencies [e0e4a56]
- Updated dependencies [7aae005]
- Updated dependencies [bdb247d]
- Updated dependencies [d5c91dd]
- Updated dependencies [0e51278]
- Updated dependencies [48203ff]
- Updated dependencies [ada2869]
- Updated dependencies [d88a47d]
- Updated dependencies [2f1a6f6]
- Updated dependencies [23fc5d6]
- Updated dependencies [2d34f32]
- Updated dependencies [7b1e4a4]
- Updated dependencies [d7c0241]
- Updated dependencies [9e3c485]
- Updated dependencies [e1796ad]
- Updated dependencies [8271c81]
- Updated dependencies [c9eb773]
- Updated dependencies [fbc12be]
- Updated dependencies [ec2ede0]
- Updated dependencies [4342c99]
- Updated dependencies [132dd13]
- Updated dependencies [d285bf0]
- Updated dependencies [dfeba25]
- Updated dependencies [9059a94]
- Updated dependencies [0a88a80]
- Updated dependencies [2c1011b]
- Updated dependencies [12bb672]
- Updated dependencies [97233b9]
- Updated dependencies [c199772]
- Updated dependencies [f5a7250]
- Updated dependencies [1a2bb9e]
- Updated dependencies [eea7ccc]
- Updated dependencies [097d268]
- Updated dependencies [182bbde]
- Updated dependencies [5ce3705]
- Updated dependencies [24d622b]
- Updated dependencies [0252320]
- Updated dependencies [2eb4724]
- Updated dependencies [e04a0af]
- Updated dependencies [6b97a20]
- Updated dependencies [e7ff9c2]
- Updated dependencies [75237a9]
- Updated dependencies [920f887]
- Updated dependencies [497655f]
- Updated dependencies [ada7012]
- Updated dependencies [3a9ad22]
- Updated dependencies [6d2571f]
- Updated dependencies [2bf6ef1]
- Updated dependencies [092d460]
- Updated dependencies [09e16a5]
- Updated dependencies [98bd798]
- Updated dependencies [cbcae14]
- Updated dependencies [8261ff7]
- Updated dependencies [24489f1]
- Updated dependencies [fc28c1d]
- Updated dependencies [6d64785]
- Updated dependencies [00c332b]
- Updated dependencies [b3b43b6]
- Updated dependencies [d93400f]
- Updated dependencies [b1d3945]
- Updated dependencies [134b410]
- Updated dependencies [84e6b05]
- Updated dependencies [cb1f274]
- Updated dependencies [5c28cc7]
- Updated dependencies [b0eb9a5]
- Updated dependencies [e233db9]
- Updated dependencies [176b035]
- Updated dependencies [a83dbb6]
- Updated dependencies [d3a2331]
- Updated dependencies [51297e9]
- Updated dependencies [2d892dd]
- Updated dependencies [156792e]
- Updated dependencies [5ba2ec3]
- Updated dependencies [abb01f1]
- Updated dependencies [e64ae15]
- Updated dependencies [02bdeaa]
- Updated dependencies [66abef3]
- Updated dependencies [25c9a83]
- Updated dependencies [ee5812a]
- Updated dependencies [68fea8b]
- Updated dependencies [c049e74]
- Updated dependencies [bb9794a]
- Updated dependencies [d402e32]
- Updated dependencies [63a8eb4]
- Updated dependencies [9a910c4]
- Updated dependencies [adabccf]
- Updated dependencies [340b6dc]
- Updated dependencies [fe0ae5c]
- Updated dependencies [99fcb4a]
- Updated dependencies [55095cc]
- Updated dependencies [0f1cd83]
- Updated dependencies [a3d4c59]
- Updated dependencies [74832b6]
- Updated dependencies [1aa5026]
- Updated dependencies [2b80461]
- Updated dependencies [2bdb81f]
- Updated dependencies [b9d5422]
- Updated dependencies [c7448dc]
- Updated dependencies [627382b]
- Updated dependencies [0b31d90]
- Updated dependencies [4b58dcf]
- Updated dependencies [c23cfb3]
- Updated dependencies [559041d]
- Updated dependencies [e0d0553]
- Updated dependencies [5100c42]
- Updated dependencies [596090e]
- Updated dependencies [5380daa]
- Updated dependencies [00b38d7]
- Updated dependencies [47a9002]
- Updated dependencies [7056ca5]
- Updated dependencies [731f020]
- Updated dependencies [5eebc9e]
- Updated dependencies [72c1640]
- Updated dependencies [5e5ec9f]
- Updated dependencies [170fd83]
- Updated dependencies [922923b]
- Updated dependencies [2cac363]
- Updated dependencies [fc91239]
- Updated dependencies [e6c34f6]
- Updated dependencies [062f5cd]
- Updated dependencies [0318faf]
- Updated dependencies [5d8319f]
- Updated dependencies [43f4766]
- Updated dependencies [8e8ea99]
- Updated dependencies [a484966]
- Updated dependencies [021755a]
- Updated dependencies [b929e0a]
- Updated dependencies [dbd4744]
- Updated dependencies [14a762f]
- Updated dependencies [b146102]
- Updated dependencies [75c0dac]
- Updated dependencies [9bb059d]
- Updated dependencies [07c6f82]
- Updated dependencies [502f179]
- Updated dependencies [f20fe29]
- Updated dependencies [362035c]
- Updated dependencies [7e0bfce]
- Updated dependencies [c120dbd]
- Updated dependencies [32b5831]
- Updated dependencies [74554a3]
- Updated dependencies [e56112c]
- Updated dependencies [aeaaa44]
- Updated dependencies [43460b9]
- Updated dependencies [44a2332]
- Updated dependencies [f34dda6]
- Updated dependencies [488f4f5]
- Updated dependencies [15f9284]
- Updated dependencies [a4ca69a]
- Updated dependencies [1ff3a8f]
- Updated dependencies [61dd96f]
- Updated dependencies [b971924]
- Updated dependencies [6afa59d]
- Updated dependencies [e37ea4d]
- Updated dependencies [8f6d831]
- Updated dependencies [fa29803]
- Updated dependencies [b01bdbc]
- Updated dependencies [adbdbc5]
- Updated dependencies [6cc8dcd]
- Updated dependencies [ba77509]
- Updated dependencies [408ca2e]
- Updated dependencies [ec292cf]
- Updated dependencies [dc0ab6a]
- Updated dependencies [19e58e2]
- Updated dependencies [7e1b048]
- Updated dependencies [342808c]
- Updated dependencies [b3615f1]
- Updated dependencies [0b4022b]
- Updated dependencies [a60c913]
- Updated dependencies [5c5b67f]
- Updated dependencies [3f9e2ea]
- Updated dependencies [77f54bf]
- Updated dependencies [ccccdcc]
- Updated dependencies [48c91e9]
- Updated dependencies [2b52a5b]
- Updated dependencies [0f057b6]
- Updated dependencies [3875ae6]
- Updated dependencies [1c16889]
- Updated dependencies [1912237]
- Updated dependencies [fc29c74]
- Updated dependencies [95fb417]
- Updated dependencies [4ec3987]
- Updated dependencies [5b9402d]
- Updated dependencies [2cf9db7]
- Updated dependencies [dc1b986]
- Updated dependencies [655e8c0]
- Updated dependencies [041c8cf]
- Updated dependencies [e3277c3]
- Updated dependencies [cc6dfd9]
- Updated dependencies [7536721]
- Updated dependencies [9df3934]
- Updated dependencies [0b83e01]
- Updated dependencies [ebc6afe]
- Updated dependencies [6696056]
- Updated dependencies [0e06f3b]
- Updated dependencies [c1dfa52]
- Updated dependencies [2548ba5]
- Updated dependencies [9282578]
- Updated dependencies [ecf90b2]
- Updated dependencies [90ff10a]
- Updated dependencies [2bbebf5]
- Updated dependencies [369bcbe]
- Updated dependencies [3bd28e2]
- Updated dependencies [9347c1f]
- Updated dependencies [c164186]
- Updated dependencies [e7344f0]
- Updated dependencies [4d7e740]
- Updated dependencies [de091b5]
- Updated dependencies [6aa3188]
- Updated dependencies [ae7a35a]
- Updated dependencies [cf55914]
- Updated dependencies [17bd318]
- Updated dependencies [681868c]
- Updated dependencies [a9fb83e]
- Updated dependencies [2274894]
- Updated dependencies [e462186]
- Updated dependencies [b5853da]
- Updated dependencies [4ac9319]
- Updated dependencies [560b724]
- Updated dependencies [16c5473]
- Updated dependencies [b276d44]
- Updated dependencies [3f86dc5]
- Updated dependencies [172b4cf]
- Updated dependencies [67c98f6]
- Updated dependencies [b98fbc2]
- Updated dependencies [e7f69db]
- Updated dependencies [84156c7]
- Updated dependencies [e0f17a3]
- Updated dependencies [0bf85ea]
- Updated dependencies [1df29df]
- Updated dependencies [8a44ce7]
- Updated dependencies [ca753c0]
- Updated dependencies [8ecbe0f]
- Updated dependencies [6a4aec7]
- Updated dependencies [e4471e6]
- Updated dependencies [e8fcf55]
- Updated dependencies [fe677ae]
- Updated dependencies [8d1f7ab]
- Updated dependencies [cfc3bcf]
- Updated dependencies [dd1b803]
- Updated dependencies [03d6cb0]
- Updated dependencies [9e7824a]
- Updated dependencies [437bb0d]
- Updated dependencies [49144fc]
- Updated dependencies [e2c4e12]
- Updated dependencies [08c8484]
- Updated dependencies [93cfc3f]
- Updated dependencies [6ac33a5]
- Updated dependencies [443b2f4]
- Updated dependencies [7e7fab7]
- Updated dependencies [b09ce67]
- Updated dependencies [4df101c]
- Updated dependencies [6a6a17b]
- Updated dependencies [733822c]
- Updated dependencies [e5cf27d]
- Updated dependencies [a91d12a]
- Updated dependencies [bea6d2e]
- Updated dependencies [f415bcf]
- Updated dependencies [615c468]
- Updated dependencies [5f9d7d7]
- Updated dependencies [31d281d]
- Updated dependencies [569d4d2]
- Updated dependencies [9e9bb46]
- Updated dependencies [0d7ed5a]
- Updated dependencies [2aa25ef]
- Updated dependencies [0e1afe8]
- Updated dependencies [288611e]
- Updated dependencies [dfd8e39]
- Updated dependencies [89f87f2]
- Updated dependencies [28ad7e4]
- Updated dependencies [e6b7d8c]
- Updated dependencies [3062e50]
- Updated dependencies [40b315b]
- Updated dependencies [f2c7eef]
- Updated dependencies [7e36a3c]
- Updated dependencies [5a6267f]
- Updated dependencies [0bbe400]
- Updated dependencies [862b6ce]
- Updated dependencies [80153f5]
- Updated dependencies [26daf0b]
- Updated dependencies [826f327]
- Updated dependencies [7e5246d]
- Updated dependencies [b810ddb]
- Updated dependencies [7dc45eb]
- Updated dependencies [17e4f52]
- Updated dependencies [dcd3bce]
- Updated dependencies [2d91c9a]
- Updated dependencies [b285508]
- Updated dependencies [2c31070]
- Updated dependencies [7db1332]
- Updated dependencies [aeb0557]
- Updated dependencies [1c1b8c8]
- Updated dependencies [05077d4]
- Updated dependencies [ba5927f]
- Updated dependencies [75b2169]
- Updated dependencies [de8c973]
- Updated dependencies [65352b7]
- Updated dependencies [e956924]
- Updated dependencies [2304b16]
- Updated dependencies [c7ad16f]
- Updated dependencies [48efe91]
- Updated dependencies [fb38607]
- Updated dependencies [dc07593]
- Updated dependencies [e967cbd]
- Updated dependencies [8255a51]
- Updated dependencies [d1c01ff]
- Updated dependencies [9e1689f]
- Updated dependencies [b057434]
- Updated dependencies [f6ceddc]
- Updated dependencies [4c42fd1]
- Updated dependencies [5f392f0]
- Updated dependencies [a362e0e]
- Updated dependencies [f26fb8e]
- Updated dependencies [bc2ec80]
- Updated dependencies [0da638c]
- Updated dependencies [041d9fd]
- Updated dependencies [f03f6c7]
- Updated dependencies [b8ec127]
- Updated dependencies [cf79182]
- Updated dependencies [e81c4e5]
- Updated dependencies [28f9277]
- Updated dependencies [929d9e3]
- Updated dependencies [8a5240a]
- Updated dependencies [c1d54db]
- Updated dependencies [c7af6bd]
- Updated dependencies [1f0b565]
- Updated dependencies [23aa83c]
- Updated dependencies [357f499]
- Updated dependencies [80aef80]
- Updated dependencies [65ad77d]
- Updated dependencies [a61ae59]
- Updated dependencies [fb59fb5]
- Updated dependencies [a54ecaa]
- Updated dependencies [854639b]
- Updated dependencies [44c917a]
- Updated dependencies [613d35a]
- Updated dependencies [e08c8b0]
- Updated dependencies [0ee32ed]
- Updated dependencies [58b36fa]
- Updated dependencies [4792049]
- Updated dependencies [53ec0b1]
- Updated dependencies [71629a1]
- Updated dependencies [0a56d3b]
- Updated dependencies [f8e5790]
- Updated dependencies [d2c1d19]
- Updated dependencies [681871e]
- Updated dependencies [54e8234]
- Updated dependencies [d127f9b]
- Updated dependencies [4bbf766]
- Updated dependencies [c17b494]
- Updated dependencies [d414e2b]
- Updated dependencies [af98a04]
- Updated dependencies [43cbe14]
- Updated dependencies [c86d351]
- Updated dependencies [6e3e546]
- Updated dependencies [c4d1759]
- Updated dependencies [f7a9740]
- Updated dependencies [96451ec]
- Updated dependencies [9cdffbe]
- Updated dependencies [331a1a2]
- Updated dependencies [9788f1e]
- Updated dependencies [3cf6449]
- Updated dependencies [3cf6449]
- Updated dependencies [2bd53f1]
- Updated dependencies [5f9f846]
- Updated dependencies [5d527f7]
- Updated dependencies [5bf2330]
- Updated dependencies [9165d5c]
- Updated dependencies [d9e1587]
- Updated dependencies [07150b3]
- Updated dependencies [143c715]
- Updated dependencies [fb2bccf]
- Updated dependencies [d2badf7]
- Updated dependencies [d64bcb6]
- Updated dependencies [d4f5232]
- Updated dependencies [396eae3]
- Updated dependencies [ecdfc94]
- Updated dependencies [f04be62]
- Updated dependencies [de1a611]
- Updated dependencies [4fba503]
- Updated dependencies [db76982]
- Updated dependencies [5cf58eb]
- Updated dependencies [66e266c]
- Updated dependencies [3b1dab9]
- Updated dependencies [7607076]
- Updated dependencies [1555ed4]
- Updated dependencies [776d64c]
- Updated dependencies [03b19d9]
- Updated dependencies [6154165]
- Updated dependencies [199002b]
- Updated dependencies [ab450f4]
- Updated dependencies [21ab410]
- Updated dependencies [025588a]
- Updated dependencies [a49e8ae]
- Updated dependencies [f3e3d59]
- Updated dependencies [9bd4344]
- Updated dependencies [51efbf1]
- Updated dependencies [9c44eed]
- Updated dependencies [bbca441]
- Updated dependencies [7cd5874]
- Updated dependencies [3cb84d0]
- Updated dependencies [119a02b]
- Updated dependencies [eea8787]
- Updated dependencies [7887077]
- Updated dependencies [29dd1a6]
  - @objectstack/spec@17.5.0
  - @objectstack/core@17.5.0

## 17.4.0

### Patch Changes

- Updated dependencies [fe0d9a4]
- Updated dependencies [ecd2158]
- Updated dependencies [f2b5e46]
- Updated dependencies [2ed6be6]
- Updated dependencies [ed7243d]
- Updated dependencies [6ba0db4]
- Updated dependencies [625b0c3]
- Updated dependencies [233222e]
- Updated dependencies [07f40e5]
- Updated dependencies [ceb4877]
- Updated dependencies [e9fcd6b]
- Updated dependencies [90e7e6d]
- Updated dependencies [2bdabe6]
- Updated dependencies [ca326b5]
- Updated dependencies [8f404a5]
- Updated dependencies [68437d4]
- Updated dependencies [abb140c]
- Updated dependencies [8333a6c]
- Updated dependencies [3e3ecb0]
- Updated dependencies [3030369]
- Updated dependencies [d5d8d50]
- Updated dependencies [e08892d]
- Updated dependencies [ae05f2e]
- Updated dependencies [b548e43]
- Updated dependencies [c463d03]
- Updated dependencies [64bd6a3]
- Updated dependencies [13c48c2]
- Updated dependencies [b0529e1]
- Updated dependencies [66dc6ab]
- Updated dependencies [6f94458]
- Updated dependencies [6e67b86]
- Updated dependencies [132742f]
- Updated dependencies [85a2459]
- Updated dependencies [50dc214]
- Updated dependencies [e89fa92]
- Updated dependencies [e9fcd6b]
- Updated dependencies [8976ea1]
- Updated dependencies [56fe8c2]
- Updated dependencies [acabd24]
- Updated dependencies [ab50c8f]
- Updated dependencies [6491463]
- Updated dependencies [89cf4d6]
- Updated dependencies [21c5dcb]
- Updated dependencies [6d4d5d3]
- Updated dependencies [ed5d557]
- Updated dependencies [bca21f7]
- Updated dependencies [e9fcd6b]
- Updated dependencies [2025b1f]
- Updated dependencies [1a7a7c9]
- Updated dependencies [e9fcd6b]
- Updated dependencies [ef3a138]
- Updated dependencies [68d5dfd]
- Updated dependencies [3e21cf0]
- Updated dependencies [4cfc93b]
- Updated dependencies [efd6b43]
- Updated dependencies [859ded3]
- Updated dependencies [fa125f3]
- Updated dependencies [74628d9]
- Updated dependencies [a646120]
- Updated dependencies [6f1ce7d]
- Updated dependencies [7778115]
- Updated dependencies [2c753fe]
- Updated dependencies [52804cd]
- Updated dependencies [3f89967]
- Updated dependencies [53cf263]
- Updated dependencies [21aabbc]
- Updated dependencies [9c270bb]
- Updated dependencies [76c8c5a]
- Updated dependencies [a84e1ce]
- Updated dependencies [bf1054a]
- Updated dependencies [d8d2776]
- Updated dependencies [222dc0f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [32c917d]
- Updated dependencies [f9a3c32]
- Updated dependencies [f502898]
- Updated dependencies [51ae731]
- Updated dependencies [af7edfe]
- Updated dependencies [b60f48b]
- Updated dependencies [c78c918]
- Updated dependencies [cf9bda4]
- Updated dependencies [784cb92]
- Updated dependencies [7629f4d]
- Updated dependencies [51df9fd]
- Updated dependencies [a7da4de]
- Updated dependencies [de0bcdd]
- Updated dependencies [70f7d6d]
- Updated dependencies [c677cda]
- Updated dependencies [554a160]
- Updated dependencies [f7da71e]
- Updated dependencies [7f745c3]
- Updated dependencies [5eb24f8]
- Updated dependencies [2a3decc]
- Updated dependencies [cc00df2]
- Updated dependencies [cc00df2]
- Updated dependencies [f4e6adf]
- Updated dependencies [ee4a59b]
- Updated dependencies [4db3c61]
- Updated dependencies [5ca314a]
- Updated dependencies [e0af1a8]
- Updated dependencies [4771bd9]
- Updated dependencies [414c1fc]
- Updated dependencies [22c0279]
- Updated dependencies [0db2947]
- Updated dependencies [92b5d7f]
- Updated dependencies [613bfbd]
- Updated dependencies [abae16a]
- Updated dependencies [094b8fd]
- Updated dependencies [c7aca0d]
- Updated dependencies [c1d8f98]
- Updated dependencies [8e0b297]
- Updated dependencies [d4f9b2a]
- Updated dependencies [5f7fa1d]
- Updated dependencies [87f0ccc]
- Updated dependencies [aedbaef]
- Updated dependencies [a727043]
- Updated dependencies [c5d6803]
- Updated dependencies [10d05bb]
- Updated dependencies [69602e5]
- Updated dependencies [c3ce76c]
- Updated dependencies [7936b29]
- Updated dependencies [46803fa]
- Updated dependencies [c2a336c]
- Updated dependencies [9f890d3]
- Updated dependencies [0bb2318]
- Updated dependencies [f7db8f4]
- Updated dependencies [1ecee3e]
- Updated dependencies [9408b7f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [9bcd9be]
- Updated dependencies [b398ad2]
- Updated dependencies [99261a7]
- Updated dependencies [81b426f]
- Updated dependencies [001af1c]
- Updated dependencies [fb77aa5]
- Updated dependencies [581d8f8]
- Updated dependencies [f81afe3]
- Updated dependencies [40a44b9]
- Updated dependencies [f89812e]
- Updated dependencies [7a7fb03]
- Updated dependencies [8fd246d]
  - @objectstack/spec@17.4.0
  - @objectstack/core@17.4.0

## 17.3.0

### Patch Changes

- e7191ce: fix(build): give each `exports` condition its own `types` target in the 28 dual-build packages (#13112)
  
  **Published-surface change, zero runtime change.** No emitted byte moves; what
  moves is which declaration file a resolver READS. Maintainer ruling 2026-08-29
  (decision batch #3, verbatim 「同意」) chose declaring the files over deleting
  them.
  
  ## What was wrong
  
  These 28 packages are `"type": "module"` and dual-built, and each spelled one
  `types` condition as a **sibling** of `import`/`require`:
  
  ```json
  "exports": { ".": {
    "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs"
  } }
  ```
  
  A sibling `types` answers for **both** conditions, so a CommonJS consumer was
  handed `dist/index.d.ts` — an ES-module declaration, because the package is
  `"type": "module"` — for an entry point it reaches with `require`. Measured with
  `tsc --traceResolution` on a `"type": "commonjs"` fixture at `moduleResolution:
  node16`:
  
  ```
  error TS1479: The current file is a CommonJS module whose imports will produce
  'require' calls; however, the referenced file is an ECMAScript module and cannot
  be imported with 'require'.
  ```
  
  The JavaScript at `dist/index.cjs` loads perfectly (`check:dual-build-cjs-loads`
  has asserted that for months). It is the **types** that told the consumer the
  supported `require` entry point could not be required. The `dist/index.d.cts`
  twin tsup emits beside it — 36 files, 5,517,701 B on this build — was named by
  no condition at all and shipped in every tarball unreachable.
  
  ## What changed
  
  Each condition now names its own declaration, the shape TypeScript documents:
  
  ```json
  "exports": { ".": {
    "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  } }
  ```
  
  33 entry points across 27 packages, subpaths included. The root `types` field is
  untouched, so `node10` resolvers are unaffected; the `import` condition resolves
  exactly what it resolved before, measured as an unchanged control in the same
  run.
  
  ## `@objectstack/core` is deliberately NOT changed
  
  Splitting a declaration in two makes TypeScript compare it nominally, and
  `ObjectKernel` carries a `private plugins` member that reaches every plugin
  through `PluginContext.getKernel()`. With core split, whole-repo `pnpm build`
  fails in `@objectstack/verify` with 5 × TS2345 ("Types have separate
  declarations of a private property 'plugins'"); with core held back and the
  other 27 split, 71/71 tasks pass. So core keeps the sibling-`types` shape and
  its two `.d.cts` files (220,854 B) stay unreachable, declared as such in
  `check:dual-build-cjs-loads`. Splitting it needs a decision about core's public
  types, not about an exports map.
  
  ## For consumers
  
  - **ESM consumers: nothing changes.** Same declaration file, byte for byte.
  - **CJS consumers under `node16`/`nodenext`: TS1479 goes away** and the
    declarations they get are the ones built for CommonJS.
  - **`node10` / `moduleResolution: node` consumers: nothing changes** — they never
    read `exports`.
  - Nothing is removed: every path that resolved before still resolves.
  
  Packages that are CJS-first (`require` → `./dist/index.js`, no `"type": "module"`)
  were already correct and are untouched — their `dist/index.d.ts` really is the
  CommonJS declaration. Their ESM mirror (an unreachable `.d.mts` under the
  `import` condition) is a separate, larger population and is filed separately per
  the ruling, not fixed here.
  
  `check:dual-build-cjs-loads` grew a fourth invariant (TYPED) that reds on the old
  shape, so the drift cannot return silently.
- 8422acd: fix(service-knowledge): put the test layer in front of tsc, and repair the four defects it was hiding (#15049)
  
  `packages/services/service-knowledge` had **no `typecheck` script at all** —
  its scripts were `build` and `test` — so no tsc program anywhere read this
  package. Turbo/CI typecheck lanes skipped it silently, because a zero-matching
  filter run exits 0. `tsup` transpiles with esbuild and `vitest` runs through
  esbuild type-**stripping**; neither type-checks. The package's own
  `tsconfig.json` does include the tests and always did, so the program that
  would have read them already existed and was simply never invoked — the same
  shape `@objectstack/service-cluster` (#14181) reached the ledger by.
  
  **Measured before any repair**, dependency closure built first: `tsc --noEmit`
  against the existing `tsconfig.json` (undivided, BUILD/NodeNext semantics)
  read **10** raw errors, matching the `DEBT` entry this PR deletes exactly. The
  new sibling `tsconfig.test.json` (module semantics only — `esnext` / `bundler`
  / `lib: ES2022`, matching how vitest actually executes these files; strictness
  untouched) read **4** under the correct split — not the ledger's own 3-code-tier
  guess. Fixing the 3 TS2835 (three relative test imports missing `.js`, required
  by `moduleResolution: NodeNext`) removed the noise cascade (4 TS7006, every
  `(h) => h.documentId)` callback over a `KnowledgeService` search result that
  had degraded to `any`) and, in doing so, re-enabled a TypeScript excess-property
  check the cascade had been suppressing — uncovering a 4th real error the
  undivided reading had masked entirely.
  
  **The four code-tier defects, all in the test file, all in the test file's own
  typing — never in `src/`:**
  
  1. `roles: ['member']` in one `ExecutionContext` object literal (TS2353 once
     the excess-property check could see it) — a field the spec renamed to
     `positions` (`execution-context.zod.ts`: *"Position names held by the
     user … Formerly `roles`"*), that no check had ever read against the
     renamed type. Every other `executionContext` literal in this file already
     used `positions`; this one was simply never checked before. Fixed by
     renaming it — `ExecutionContext` itself is untouched and correct.
  2. `buildSetup`'s `vi.fn()` stub for `IDataEngine.find` typed its second
     parameter as `{ context: { isSystem?: boolean } }`, omitting the `where`
     field the real call site (`knowledge-service.ts`'s RLS re-check) actually
     passes. `expect(opts.where).toEqual(...)` then read a property TypeScript
     correctly said did not exist (TS2339). Fixed by widening the mock's
     parameter type to match the call it stubs (`where` and `fields` added),
     not by loosening the assertion.
  3 & 4. Two more `vi.fn()` mocks (`upsertSpy`/`deleteSpy`/`searchSpy` in
     `makeAdapter`, and a `find` mock in the reindex test) had **no** parameter
     type at all, so TypeScript inferred a zero-argument implementation and
     `.mock.calls[N]` was typed as an array of **empty tuples**. Indexing past
     that boundary (`.mock.calls[0][1]`) is a genuine tuple-length error
     (TS2493), and casting the resulting `undefined` onward compounded into
     TS2352. Fixed the reindex-test `find` mock by typing its parameters to
     match the real `reindexSource` call site (`where`, `limit`, `context`);
     the `makeAdapter` stubs were reached only through the 3 TS2835 (below) and
     needed no change of their own once those were fixed.
  
  **The three TS2835 are repaired directly** (`.js` added to three relative
  specifiers in the test files), not routed around by excluding tests from
  `tsconfig.json` — which stays exactly as it is, per the family's own rule
  (AGENTS.md: never add such an exclusion). Because this package's build config
  already includes the tests, its `typecheck` script's own `tsc --noEmit tsconfig.json`
  step reads these same files under NodeNext regardless of the new sibling
  config, so they needed fixing either way — unlike `service-cluster`, whose test
  files already carried the extension and needed no import repair.
  
  Wired by the #14062 / #5286 route: `tsconfig.test.json` named by a new
  `typecheck` script through the shared `check:test-typecheck` gate. No
  `test-typecheck-debt.json` is added — its **absence is the zero**: the gate
  reads a missing ledger as no entries, under which any error in any file here
  is immediately red. After the repair, **both** readings (`tsconfig.json` and
  `tsconfig.test.json`) are 0.
  
  The package's `DEBT` entry in `scripts/check-type-check-coverage.mjs`
  (`errors: 10`) is **deleted**, not lowered — the graduation the ratchet's own
  invariant requires. `scripts/check-type-source-resolution.mjs` gains a
  registry entry for the three workspace deps (`core`, `objectql`, `spec`) now
  reached only through the new `tsconfig.test.json` program (the #11490
  onboarding-limb re-baseline, same route `service-cluster` took): `paths` was
  measured and rejected — redirecting those three deps to source takes this
  package's test layer from 0 errors to 487, all TS6059, all in another
  package's source.
  
  No runtime code changes: `src/**` (excluding tests) is byte-identical, so no
  shipped behaviour moves. The `patch` level reflects the published
  `package.json` gaining `typecheck` / `check:test-typecheck` scripts and a
  `tsx` devDependency.
- Updated dependencies [809d417]
- Updated dependencies [387e231]
- Updated dependencies [f794e4e]
- Updated dependencies [cae2169]
- Updated dependencies [b812a54]
- Updated dependencies [2d4fa75]
- Updated dependencies [0e4e51b]
- Updated dependencies [e84bbf6]
- Updated dependencies [effae80]
- Updated dependencies [efb3513]
- Updated dependencies [d62f990]
- Updated dependencies [c45d8e6]
- Updated dependencies [2e3e8c7]
- Updated dependencies [e621291]
- Updated dependencies [655b106]
- Updated dependencies [40a93b5]
- Updated dependencies [d5b330d]
- Updated dependencies [dda969c]
- Updated dependencies [1f45690]
- Updated dependencies [277948f]
- Updated dependencies [8bdd955]
- Updated dependencies [f3bbbef]
- Updated dependencies [4f24e9d]
- Updated dependencies [e27583e]
- Updated dependencies [4bd6faa]
- Updated dependencies [86cbe37]
- Updated dependencies [6a180e4]
- Updated dependencies [474242f]
- Updated dependencies [63cd487]
- Updated dependencies [bd4aa4e]
- Updated dependencies [803eaab]
- Updated dependencies [f8e8f03]
- Updated dependencies [983edf1]
- Updated dependencies [eae824e]
- Updated dependencies [f6fa22c]
- Updated dependencies [8a483b3]
- Updated dependencies [97bcd99]
- Updated dependencies [df59de0]
- Updated dependencies [96e25a8]
- Updated dependencies [f75a38a]
- Updated dependencies [7a25e7d]
- Updated dependencies [1fa05a6]
- Updated dependencies [c85a265]
- Updated dependencies [dcb10a5]
- Updated dependencies [773a999]
- Updated dependencies [35dffea]
- Updated dependencies [d8024f0]
- Updated dependencies [8120808]
- Updated dependencies [776a098]
- Updated dependencies [5060877]
- Updated dependencies [4f6325d]
- Updated dependencies [52954c0]
- Updated dependencies [2aa8456]
- Updated dependencies [93809a3]
- Updated dependencies [7c0d0c3]
- Updated dependencies [daae7aa]
- Updated dependencies [8dc22d6]
- Updated dependencies [279431e]
- Updated dependencies [948dd6b]
- Updated dependencies [3b4c56c]
- Updated dependencies [ae8edd2]
- Updated dependencies [e25403c]
- Updated dependencies [64baa68]
- Updated dependencies [9fa70d7]
- Updated dependencies [09db64a]
- Updated dependencies [92916e7]
- Updated dependencies [a84f3ea]
- Updated dependencies [f2eaae8]
- Updated dependencies [c09451b]
- Updated dependencies [ba64877]
- Updated dependencies [7345308]
- Updated dependencies [79b6a22]
- Updated dependencies [30d96ab]
- Updated dependencies [f658793]
- Updated dependencies [c95ad19]
- Updated dependencies [e58ea8b]
- Updated dependencies [4a17645]
- Updated dependencies [3795c5f]
- Updated dependencies [8ab926b]
- Updated dependencies [7317cf2]
- Updated dependencies [e25e839]
- Updated dependencies [5997207]
- Updated dependencies [8b13cc8]
- Updated dependencies [4a4a35d]
- Updated dependencies [86e765a]
- Updated dependencies [1d7e76a]
- Updated dependencies [53dc739]
- Updated dependencies [fd289be]
- Updated dependencies [03bf7b1]
- Updated dependencies [f90e820]
- Updated dependencies [18d816a]
- Updated dependencies [e8bd715]
- Updated dependencies [b91c351]
- Updated dependencies [a28a3c0]
- Updated dependencies [daeaaf9]
- Updated dependencies [c459da6]
- Updated dependencies [e914733]
- Updated dependencies [f887e52]
- Updated dependencies [881f8d8]
- Updated dependencies [3bfa1e6]
- Updated dependencies [0a8ebf3]
- Updated dependencies [901355c]
- Updated dependencies [34ce8e7]
- Updated dependencies [33681ea]
- Updated dependencies [4635f3e]
- Updated dependencies [fd289be]
- Updated dependencies [ee3595c]
- Updated dependencies [b2eab95]
- Updated dependencies [93940d4]
- Updated dependencies [3a04b01]
- Updated dependencies [45b9051]
- Updated dependencies [b9e9227]
- Updated dependencies [d395692]
- Updated dependencies [5894d30]
- Updated dependencies [a3765f6]
- Updated dependencies [2d5cee3]
- Updated dependencies [e22158f]
- Updated dependencies [7404925]
- Updated dependencies [0c2334f]
- Updated dependencies [778c59f]
- Updated dependencies [d2619fd]
- Updated dependencies [af56546]
- Updated dependencies [6acb11a]
- Updated dependencies [33c5fd3]
- Updated dependencies [20b0fdb]
- Updated dependencies [905019b]
- Updated dependencies [a286411]
- Updated dependencies [98c0d33]
- Updated dependencies [368a82e]
- Updated dependencies [a3d5724]
- Updated dependencies [93ea19b]
- Updated dependencies [9ee2dcf]
- Updated dependencies [8cb96ec]
- Updated dependencies [8f10a79]
- Updated dependencies [6269a55]
- Updated dependencies [a17da05]
- Updated dependencies [a8c00e2]
- Updated dependencies [0fb8760]
- Updated dependencies [e5ce2ed]
- Updated dependencies [be21955]
- Updated dependencies [bc56e18]
- Updated dependencies [be21955]
- Updated dependencies [a9ee989]
- Updated dependencies [4d0d944]
- Updated dependencies [15d58db]
- Updated dependencies [d63b014]
- Updated dependencies [9abe4e4]
- Updated dependencies [2cc7122]
- Updated dependencies [50d6c92]
- Updated dependencies [9e0ba21]
- Updated dependencies [311433f]
- Updated dependencies [3e5ad08]
- Updated dependencies [9abe4e4]
- Updated dependencies [b7131f3]
- Updated dependencies [e5812fa]
- Updated dependencies [7085f90]
- Updated dependencies [dee4dd4]
- Updated dependencies [ce7e497]
- Updated dependencies [51ecb2f]
- Updated dependencies [9086761]
- Updated dependencies [42a117b]
- Updated dependencies [1401ae7]
- Updated dependencies [4297fe7]
- Updated dependencies [e398863]
- Updated dependencies [d16df74]
- Updated dependencies [f11fc61]
- Updated dependencies [e808890]
- Updated dependencies [8f79379]
- Updated dependencies [e6ca40e]
- Updated dependencies [0c77ea4]
- Updated dependencies [52954c0]
- Updated dependencies [89eb997]
- Updated dependencies [7131f12]
- Updated dependencies [aa5994e]
- Updated dependencies [be93457]
- Updated dependencies [a65db76]
- Updated dependencies [15eb2c9]
- Updated dependencies [5691b07]
- Updated dependencies [2a6122b]
- Updated dependencies [225e769]
- Updated dependencies [8af88dd]
- Updated dependencies [fb5fbb8]
- Updated dependencies [d7b3963]
- Updated dependencies [33184fd]
- Updated dependencies [7c41693]
- Updated dependencies [b72db01]
- Updated dependencies [dce5cd4]
- Updated dependencies [9688f58]
- Updated dependencies [556ebc1]
- Updated dependencies [177ebdc]
- Updated dependencies [8d237b4]
- Updated dependencies [2d2e6f0]
- Updated dependencies [2d8dd8d]
- Updated dependencies [22d573e]
- Updated dependencies [b5a2398]
- Updated dependencies [348860c]
- Updated dependencies [5383fa6]
- Updated dependencies [5b3ff63]
- Updated dependencies [1a6a19c]
- Updated dependencies [527e050]
- Updated dependencies [dd33bf9]
- Updated dependencies [4cb2a90]
- Updated dependencies [74a7804]
- Updated dependencies [53d3689]
- Updated dependencies [b3a63d3]
- Updated dependencies [49f0dcf]
- Updated dependencies [033a34c]
- Updated dependencies [4d25d22]
- Updated dependencies [1ffee51]
- Updated dependencies [5ae4303]
- Updated dependencies [ece4dad]
- Updated dependencies [e9b377e]
- Updated dependencies [146f448]
- Updated dependencies [735f5c7]
- Updated dependencies [a7e18de]
- Updated dependencies [366f895]
- Updated dependencies [dc75ba8]
- Updated dependencies [cce0aa9]
- Updated dependencies [e764507]
- Updated dependencies [cff17af]
- Updated dependencies [39404f3]
- Updated dependencies [ca1965f]
- Updated dependencies [8619f95]
- Updated dependencies [b706af9]
- Updated dependencies [add4360]
- Updated dependencies [fc9ba76]
- Updated dependencies [0f94cc7]
- Updated dependencies [a11c1a5]
- Updated dependencies [71f9cd1]
- Updated dependencies [ee17d86]
- Updated dependencies [cdbd920]
- Updated dependencies [18c432e]
- Updated dependencies [3c418c4]
- Updated dependencies [fa8715a]
- Updated dependencies [a933ed7]
- Updated dependencies [b3ca463]
- Updated dependencies [a933ed7]
- Updated dependencies [0d4a6a8]
- Updated dependencies [518d5e5]
- Updated dependencies [6643ba1]
- Updated dependencies [eeba2ef]
- Updated dependencies [ec4c4d2]
- Updated dependencies [424f73c]
- Updated dependencies [cccbe51]
- Updated dependencies [a8d6b1d]
- Updated dependencies [e4a7695]
- Updated dependencies [87075b1]
- Updated dependencies [fc58a99]
- Updated dependencies [14cfc00]
- Updated dependencies [1c6f7b4]
- Updated dependencies [e854a53]
- Updated dependencies [dfebfc8]
- Updated dependencies [d028b37]
- Updated dependencies [f7b25c5]
- Updated dependencies [122ef38]
- Updated dependencies [4a37870]
- Updated dependencies [428f9b2]
- Updated dependencies [aa7ff56]
- Updated dependencies [c41b42e]
- Updated dependencies [c4db311]
- Updated dependencies [750fff5]
- Updated dependencies [c19035e]
- Updated dependencies [ececf7a]
- Updated dependencies [d173125]
- Updated dependencies [8eeca27]
- Updated dependencies [8425c17]
- Updated dependencies [a5ef1d8]
- Updated dependencies [772d5de]
- Updated dependencies [ce80ec2]
- Updated dependencies [b372318]
- Updated dependencies [97a2263]
- Updated dependencies [29d0676]
- Updated dependencies [0169d49]
- Updated dependencies [6bd3231]
- Updated dependencies [d2b5ba8]
- Updated dependencies [b799ac5]
- Updated dependencies [8f74307]
- Updated dependencies [d23dc08]
- Updated dependencies [644ad50]
- Updated dependencies [0da7cd2]
- Updated dependencies [28a5c3e]
- Updated dependencies [4bc18e5]
  - @objectstack/spec@17.3.0
  - @objectstack/core@17.3.0

## 17.2.0

### Minor Changes

- e222a53: **BREAKING** (compile-time only): twelve logger sink types that declared an
  optional `error` now declare a **non-optional** `warn`, so a durability report
  always has somewhere to land (#9754, #10556).
  
  `minor`, not `major`: during the launch window this stack ships breaking changes
  as `minor` — every publishable package versions in lockstep, so a `major` would
  promote the whole release. `patch` would be wrong in the other direction, because
  this *can* break a consumer's build.
  
  `error` stays optional on every one of these types — hosts legitimately inject
  reduced sinks, and requiring `error` was measured and rejected as #9754 option C.
  What changes is that its *absence* now has a declared, guaranteed destination.
  Call sites keep the `logger?.warn?.(…)` spelling as the backstop for hosts the
  type cannot reach, so **no runtime behaviour changes**: nothing that printed
  before stops printing, and nothing silent starts printing.
  
  ### Who has to change, and what to do
  
  Only a caller that hands one of these sinks an object with **no `warn` method** —
  for example `{ info }` or `{ error }` alone. Add a `warn` member; there is no
  rename, no removal, and no stored value or metadata key to rewrite. Every
  construction site inside this repo already supplied one, so the in-repo cost was
  zero; the compile error is reserved for the callers that were silently discarding
  these reports.
  
  The affected types, by package:
  
  - `@objectstack/cloud-connection` — the internal `PluginContext['logger']`
  - `@objectstack/metadata-protocol` — `IndexMigrationLogger`
  - `@objectstack/plugin-approvals` — the internal `MinimalLogger` of `lifecycle-hooks`
  - `@objectstack/plugin-audit` — `AuthEventAuditLogger`, `ReadAuditLogger`
  - `@objectstack/plugin-auth` — `ReconcileMembershipDeps['logger']`, the internal
    `LoggerLike` of `member-role-canonical`, and `AuthManagerOptions['logger']`
  - `@objectstack/plugin-email` — `ReclaimLogger`, via `ReclaimAttachmentContentOptions`
  - `@objectstack/plugin-reports` — `ReportServiceOptions['logger']`
  - `@objectstack/plugin-sharing` — the internal `MinimalLogger` of `bulk-recompute`,
    `rule-hooks` and `record-share-cascade`
  - `@objectstack/plugin-webhooks` — `OptionalLogger`, via `AutoEnqueuerOptions`
  - `@objectstack/service-knowledge` — `KnowledgeLogger`
  
  `AuthManagerOptions['logger']` is the one most likely to be reached from outside:
  `AuthManager` is public surface, its `logger` option stays optional, and a logger
  that *is* supplied must now carry `warn`. The only non-test construction site in
  this repo passes the kernel `Logger`, whose `warn` is already required.
  
  `ReportService` and `AutoEnqueuer` additionally stopped defaulting their logger
  field to `{}`. The field is now honestly optional rather than holding an empty
  object that declared it could report and discarded everything. Behaviour is
  unchanged in both directions.
  
  <!-- adr-0087: not-required (runtime-interface-only packages/plugins/plugin-auth/src/auth-manager.ts#AuthManagerOptions, packages/plugins/plugin-auth/src/reconcile-membership.ts#ReconcileMembershipDeps, packages/metadata-protocol/src/migrations/partial-index-probe.ts#IndexMigrationLogger, packages/plugins/plugin-audit/src/auth-event-audit.ts#AuthEventAuditLogger, packages/plugins/plugin-audit/src/read-audit.ts#ReadAuditLogger, packages/plugins/plugin-reports/src/report-service.ts#ReportServiceOptions, packages/services/service-knowledge/src/knowledge-service.ts#KnowledgeLogger) every tightened type is a plain TypeScript logger interface -- no Zod projection, no metadata surface, and none is referenced by one -- so `objectstack migrate meta` has nothing to rewrite. Nothing is removed or renamed and no stored value moves; the only consumer action is adding a `warn` member at a construction site the compiler names. -->

### Patch Changes

- 7bf3fb7: Point every documentation link in these packages' published READMEs — and in
  the project `create-objectstack` scaffolds — at the canonical docs origin
  `https://objectstack.ai`, replacing the `docs.objectstack.ai` spelling.
  
  Both spellings reach the same pages (the alias redirects to the apex,
  path-preserving), so no link was broken. The reason it needs a release rather
  than an in-repo fix alone: a README ships inside the npm tarball, so the
  version already on npm keeps showing the old host to every reader of the
  package page until a new one is published.
- 6d5c4fa: Release these plugins' resources from `destroy()`, the teardown hook the kernel
  actually calls (#10371). `Plugin` declares `init()`, `start?(ctx)` and
  `destroy?()` — and no `stop()` — so `ObjectKernel.performShutdown()` and
  `LiteKernel.destroy()`, which walk the plugins in reverse calling
  `plugin.destroy()`, walked straight past every plugin whose teardown was spelled
  `stop()`. `await kernel.shutdown()` resolved with the reports dispatcher still
  armed, the REST/OpenAPI/Slack connectors still registered on the automation
  engine, the approvals SLA escalation job still scheduled, and the knowledge
  event-sync subscription still open.
  
  Each teardown body now lives in `destroy()`. `stop()` is retained as a
  delegating alias with its parameter made optional, so an embedder that learned
  to call it directly — precisely because the kernel never did — keeps working
  unchanged. No export is removed and the `Plugin` interface is untouched.
  
  Same defect as #9371 in `@objectstack/service-messaging`, which surfaced as
  fully green test runs exiting 1 on `EnvironmentTeardownError` and being evicted
  from the merge queue.
- Updated dependencies [6936d07]
- Updated dependencies [59eb04d]
- Updated dependencies [9f05b7d]
- Updated dependencies [3b2af5e]
- Updated dependencies [7d2d112]
- Updated dependencies [5fa0d72]
- Updated dependencies [02b3b07]
- Updated dependencies [914c413]
- Updated dependencies [55809a0]
- Updated dependencies [ee2ff45]
- Updated dependencies [47cd3ec]
- Updated dependencies [52db1d1]
- Updated dependencies [5649efb]
- Updated dependencies [9d7d2de]
- Updated dependencies [c815c50]
- Updated dependencies [795ea05]
- Updated dependencies [2306a76]
- Updated dependencies [e5ea701]
- Updated dependencies [a40dcc1]
- Updated dependencies [def0d3e]
- Updated dependencies [8d0bb79]
- Updated dependencies [5acb58d]
- Updated dependencies [2e3cf95]
- Updated dependencies [4c93387]
- Updated dependencies [504c8d5]
- Updated dependencies [a037f7c]
- Updated dependencies [3ee8ddf]
- Updated dependencies [16cef97]
- Updated dependencies [a79bd35]
- Updated dependencies [6ceaa4b]
- Updated dependencies [15ea214]
- Updated dependencies [de19489]
- Updated dependencies [c684d00]
- Updated dependencies [923c424]
- Updated dependencies [1ec36b7]
- Updated dependencies [5f2e54c]
- Updated dependencies [189373b]
- Updated dependencies [35ad101]
- Updated dependencies [ceb33a9]
- Updated dependencies [73d9795]
- Updated dependencies [8012960]
- Updated dependencies [f34f56b]
- Updated dependencies [f399618]
- Updated dependencies [75e9301]
- Updated dependencies [2810695]
  - @objectstack/spec@17.2.0
  - @objectstack/core@17.2.0

## 17.1.0

### Patch Changes

- 0425db9: Published READMEs link to the docs site in the one form that works on npm, on GitHub and on the docs site (#9632)
  
  **Seven docs links in these READMEs pointed nowhere.** They were spelled as a repo
  path rooted at `/` — `[Flows](/content/docs/automation/flows.mdx)` — and a README in a
  package's `files` array with `private` unset is rendered on the **npm package page** and
  on **GitHub**, not only in this repository. There a root-relative href resolves against
  `npmjs.com` and `github.com` respectively. It was not a docs-site route either:
  `apps/docs/lib/source.ts` mounts `loader({ baseUrl: '/docs' })` over `content/docs`, so
  the route for that first link is `/docs/automation/flows`, and `apps/docs/redirects.mjs`
  carries no `/content` source that would rescue the written form. Every target page
  existed and every one of them was reachable — only the links were not.
  
  All seven now use the absolute form the repo had already established in
  `create-objectstack`'s published READMEs: `https://docs.objectstack.ai/docs/...`, with
  the path taken under `content/docs` and the page extension dropped, because the route
  carries none. Each target was re-verified at the route level rather than as a file — the
  two that named a **directory** (`/content/docs/automation/`,
  `/content/docs/references/automation/`) resolve only because those directories carry an
  `index.mdx`; a directory without one is a 404, not a section.
  
  **Two more links in the same class were converted in the same pass.**
  `service-knowledge` and `knowledge-ragflow` pointed at
  `../../../content/docs/protocol/knowledge.mdx`. Those relative paths do resolve on both
  GitHub and npm, so they are a milder defect than the seven — but they land the reader on
  **raw MDX source** instead of the rendered page. They now point at the rendered page as
  well. `service-knowledge`'s link text changed with it: it was the source filename in a
  code span, which stops being an honest label once the destination is the page.
  
  No API, behaviour or type surface changes — this is the published documentation these
  packages ship.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/core@17.1.0

## 17.0.0

### Patch Changes

- f2445c9: feat(spec,objectql,client,plugin-webhooks): predicate writes get an honest bulk event contract (#4639)

  A `multi: true` update/delete reaches `IDataDriver.updateMany` / `deleteMany`,
  which are contracted to resolve an affected row COUNT and nothing else. That
  satisfies neither `DataEvent.recordId` (required) nor `before` / `after` /
  `changes`, so before #4626 the engine fabricated a per-record event with
  `recordId: ''` and `after: <count>` — an event every schema-compliant consumer
  must reject, and one the webhook enqueuer's `?? 'unknown'` fallback turned into
  a real delivery naming an unidentifiable record. #4626 removed the fabrication
  and published nothing instead: honest, but it left webhooks, knowledge sync and
  `subscribeData` silent for every predicate write.

  Bulk writes now get their **own** contract rather than impersonating a
  per-record one or going dark:

  - **New `BulkDataEvent`** (`@objectstack/spec/api`): `data.records.updated` /
    `data.records.deleted` — note the plural — carrying `id`, `type`, `object`,
    `matched`, `userId?`, `timestamp`. Deliberately a separate schema from
    `DataEvent`, not a widened one: a consumer that receives
    `data.records.updated` knows from the type alone that no `recordId` is
    coming, instead of discovering an empty string at runtime.
  - **Engine** publishes it from the `multi: true` branches of `update()` /
    `delete()`, validated with `BulkDataEventSchema.parse` before publish. A
    predicate that matched **zero** rows publishes nothing (no data changed — this
    is what keeps an idle background sweep from becoming an hourly "0 records"
    delivery), and a driver that resolves a non-count publishes nothing and warns
    rather than asserting a number it cannot verify. Per-record writes are
    untouched, including a scalar `where.id` with `multi: true`, which is still a
    single-record target and still emits `data.record.deleted`.
  - **Webhooks**: two new opt-in triggers, `bulk_update` and `bulk_delete`
    (`WebhookTriggerType`, and the `sys_webhook.triggers` multi-select). They are
    **not** extra sources for `create` / `update` / `delete`: the delivered body
    has no `recordId` and no record, so routing it to existing per-record
    subscribers would hand them a payload missing every field they read — the
    same class of breakage as the old `recordId: ''`, from the other direction. A
    webhook that wants both subscribes to both. Bulk deliveries dedup on the
    producer's event uuid, since two sweeps in the same millisecond are genuinely
    different events that a timestamp-based key would collapse.
  - **Client SDK**: new `client.events.subscribeBulkData(object, cb)`, with the
    same loud boundary validation as `subscribeData`. Kept a separate method for
    the same reason — delivering a `BulkDataEvent` to a `(event: DataEvent) =>
void` callback would recreate exactly the "typed field, `undefined` at
    runtime" defect #4626 removed. `subscribeData`'s own guard was also tightened
    from `data.` to `data.record.`, so an aggregate event is ignored rather than
    rejected as off-contract.
  - **Knowledge sync** now says out loud that a predicate write leaves its index
    stale. A knowledge index is a per-record projection and `matched: 40` names no
    record, so no event shape could drive it — the durable fix is reconciliation,
    tracked in #4672.

  The event carries no `where` predicate. The only one available at publish time
  is the middleware-composed AST, whose filter embeds the security layer's
  injected row scoping (RLS, sharing) — publishing it would ship tenant scoping
  internals to whatever external URL a webhook points at.

  Also pays off a measurement debt from #4655, which claimed the write-path cost
  of event publishing had been measured but never published the numbers:
  `packages/objectql/src/engine-data-events.bench.ts` measures it. Against an
  in-memory driver, publishing costs ~7–9µs per event (insert 0.021ms vs 0.012ms,
  single-id update 0.013ms vs 0.007ms). A bulk write pays that **once** regardless
  of how many rows matched (0.040ms vs 0.034ms over a 100-row match set), so its
  relative cost shrinks as the match set grows.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 462b713: fix(objectql,client): `subscribeData` callbacks receive real `DataEvent`s — the producer now fulfils the declared contract (#4626)

  `@objectstack/spec/api`'s `DataEvent` declares top-level `id` (uuid,
  required), `type`, `object`, `recordId` (required), `changes?`, `before?`,
  `after?`, `userId?`, `timestamp`. But the producer (the ObjectQL engine)
  published a raw `RealtimeEventPayload` envelope with `{ recordId, after,
changes }` nested under `payload` and never generated `id`/`userId`, while the
  client SDK force-cast that envelope into the callback (`callback(event as any
as DataEvent)`). Subscribers who wrote `event.recordId` / `event.changes` —
  exactly what the types promised — compiled green and read `undefined` at
  runtime. The data-side twin of #4602.

  Producer now fulfils the contract:

  - `ObjectQL.insert()` / `update()` / `delete()` build a true `DataEvent`
    (generated uuid `id`, flattened top-level fields, `userId` from the
    execution context when the write names an actor) and validate it with
    `DataEventSchema.parse` before publishing. The transport envelope is
    unchanged (`RealtimeEventPayload`, with `payload` carrying the complete
    `DataEvent`), so subscribers keep receiving `{ type, object, payload,
timestamp }` on the wire.
  - A batch insert publishes one event **per record** (as before), each with its
    own event id.
  - **A multi-row write (`multi: true` → `updateMany` / `deleteMany`) now
    publishes nothing.** Those driver methods return only an affected count, so
    there is no record for a required `recordId` to name; the engine logs a
    warning naming the gap instead of publishing the previous fabrication
    (`recordId: ''`, `after: <affected count>`), which every schema-compliant
    consumer had to reject. **Consequence: webhooks and knowledge sync no longer
    fire for bulk writes** — they previously fired once with an unusable body. A
    real bulk event contract is tracked in #4639.

  Consumers validate or read the fulfilled shape instead of guessing:

  - `@objectstack/client`'s `subscribeData` (and therefore
    `@objectstack/client-react`'s `useDataSubscription` /
    `useDataSubscriptionCallback` / `useAutoRefresh`, which delegate to it)
    unwraps the envelope and runs `DataEventSchema.safeParse` at the boundary.
    An off-contract payload is rejected loudly (handler error, callback never
    invoked) — never coerced or passed through. The `as any as DataEvent`
    double-cast is gone, and the `recordId` option now filters on the fulfilled
    event.
  - `@objectstack/plugin-webhooks`' auto-enqueuer reads the required
    `recordId` directly; its `recordId ?? id ?? after?.id ?? before?.id ??
'unknown'` fallback chain is gone, and an off-contract event is dropped with
    a warning rather than delivered under the literal id `'unknown'`. Delivered
    webhook bodies now also carry the event's `id`/`type`/`userId`; the record
    itself stays nested under `after` and the envelope keys (`object`,
    `recordId`, `action`, `timestamp`) still win.
  - `@objectstack/service-knowledge`'s event sync reads the record from `after`
    (create/update) and the id from `recordId` (delete) for `data.record.*`.
    It previously indexed the envelope itself as if it were the row, and never
    resolved an id for deletes.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- 44106d9: 知识索引在保留期回收(reap)删除行之前先去索引,不再留下孤儿条目(#4672)。

  `object` 知识源是**逐记录投影**,而 `LifecycleService` 的保留期回收按谓词删行 ——
  ADR-0057 §3.3 又禁止把它扇出成 N 条逐记录事件(清理会回灌正在清空的表)。结果是行没了、
  文档还在:孤儿条目仍会占掉 `topK` 名额(权限过滤发生在适配器返回之后),`isSystem`
  调用方还会直接读到它们。

  现在 `KnowledgeServicePlugin` 会为每个被 `object` 源投影的对象注册一个 ADR-0057
  **reap guard**:sweep 在删除前把候选行交给 guard,guard 按 id 删除对应文档,只确认删除
  成功的行。

  - **失败方向**:`adapter.delete` 失败 ⇒ 该行本轮**保留**,下次 sweep 重试。允许「行比索引
    条目活得久」,绝不允许反过来。
  - **组合语义**:多个 guard 按交集组合(#5535),因此它既不会顶掉 `service-storage` 的字节
    回收 guard,也不会被其顶掉。
  - **分批**沿用 sweep 自身的约束(每批 500 行、每轮 20 批)。
  - **退出开关**:源上的 `refresh.onRecordChange: false` 或插件的 `enableEventSync: false`
    会同时关掉两个方向的内联同步(事件订阅与 reap 去索引)。

  零新增契约面:未新增任何 spec 键、`IKnowledgeAdapter` 成员或 `packages/objectql` 改动 ——
  经由既有的 `ctx.getService('lifecycle')` duck-type + `registerReapGuard` seam 接入,与
  `service-storage` 回收 `sys_file` 字节的方式一致。

  应用层谓词写(调用方自己的 `multi: true` 写)**仍不覆盖**,#4639 的 warn 保留并已改写为
  准确描述这条分界。

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0

## 17.0.0-rc.6

### Patch Changes

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- 44106d9: 知识索引在保留期回收(reap)删除行之前先去索引,不再留下孤儿条目(#4672)。

  `object` 知识源是**逐记录投影**,而 `LifecycleService` 的保留期回收按谓词删行 ——
  ADR-0057 §3.3 又禁止把它扇出成 N 条逐记录事件(清理会回灌正在清空的表)。结果是行没了、
  文档还在:孤儿条目仍会占掉 `topK` 名额(权限过滤发生在适配器返回之后),`isSystem`
  调用方还会直接读到它们。

  现在 `KnowledgeServicePlugin` 会为每个被 `object` 源投影的对象注册一个 ADR-0057
  **reap guard**:sweep 在删除前把候选行交给 guard,guard 按 id 删除对应文档,只确认删除
  成功的行。

  - **失败方向**:`adapter.delete` 失败 ⇒ 该行本轮**保留**,下次 sweep 重试。允许「行比索引
    条目活得久」,绝不允许反过来。
  - **组合语义**:多个 guard 按交集组合(#5535),因此它既不会顶掉 `service-storage` 的字节
    回收 guard,也不会被其顶掉。
  - **分批**沿用 sweep 自身的约束(每批 500 行、每轮 20 批)。
  - **退出开关**:源上的 `refresh.onRecordChange: false` 或插件的 `enableEventSync: false`
    会同时关掉两个方向的内联同步(事件订阅与 reap 去索引)。

  零新增契约面:未新增任何 spec 键、`IKnowledgeAdapter` 成员或 `packages/objectql` 改动 ——
  经由既有的 `ctx.getService('lifecycle')` duck-type + `registerReapGuard` seam 接入,与
  `service-storage` 回收 `sys_file` 字节的方式一致。

  应用层谓词写(调用方自己的 `multi: true` 写)**仍不覆盖**,#4639 的 warn 保留并已改写为
  准确描述这条分界。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- f2445c9: feat(spec,objectql,client,plugin-webhooks): predicate writes get an honest bulk event contract (#4639)

  A `multi: true` update/delete reaches `IDataDriver.updateMany` / `deleteMany`,
  which are contracted to resolve an affected row COUNT and nothing else. That
  satisfies neither `DataEvent.recordId` (required) nor `before` / `after` /
  `changes`, so before #4626 the engine fabricated a per-record event with
  `recordId: ''` and `after: <count>` — an event every schema-compliant consumer
  must reject, and one the webhook enqueuer's `?? 'unknown'` fallback turned into
  a real delivery naming an unidentifiable record. #4626 removed the fabrication
  and published nothing instead: honest, but it left webhooks, knowledge sync and
  `subscribeData` silent for every predicate write.

  Bulk writes now get their **own** contract rather than impersonating a
  per-record one or going dark:

  - **New `BulkDataEvent`** (`@objectstack/spec/api`): `data.records.updated` /
    `data.records.deleted` — note the plural — carrying `id`, `type`, `object`,
    `matched`, `userId?`, `timestamp`. Deliberately a separate schema from
    `DataEvent`, not a widened one: a consumer that receives
    `data.records.updated` knows from the type alone that no `recordId` is
    coming, instead of discovering an empty string at runtime.
  - **Engine** publishes it from the `multi: true` branches of `update()` /
    `delete()`, validated with `BulkDataEventSchema.parse` before publish. A
    predicate that matched **zero** rows publishes nothing (no data changed — this
    is what keeps an idle background sweep from becoming an hourly "0 records"
    delivery), and a driver that resolves a non-count publishes nothing and warns
    rather than asserting a number it cannot verify. Per-record writes are
    untouched, including a scalar `where.id` with `multi: true`, which is still a
    single-record target and still emits `data.record.deleted`.
  - **Webhooks**: two new opt-in triggers, `bulk_update` and `bulk_delete`
    (`WebhookTriggerType`, and the `sys_webhook.triggers` multi-select). They are
    **not** extra sources for `create` / `update` / `delete`: the delivered body
    has no `recordId` and no record, so routing it to existing per-record
    subscribers would hand them a payload missing every field they read — the
    same class of breakage as the old `recordId: ''`, from the other direction. A
    webhook that wants both subscribes to both. Bulk deliveries dedup on the
    producer's event uuid, since two sweeps in the same millisecond are genuinely
    different events that a timestamp-based key would collapse.
  - **Client SDK**: new `client.events.subscribeBulkData(object, cb)`, with the
    same loud boundary validation as `subscribeData`. Kept a separate method for
    the same reason — delivering a `BulkDataEvent` to a `(event: DataEvent) =>
void` callback would recreate exactly the "typed field, `undefined` at
    runtime" defect #4626 removed. `subscribeData`'s own guard was also tightened
    from `data.` to `data.record.`, so an aggregate event is ignored rather than
    rejected as off-contract.
  - **Knowledge sync** now says out loud that a predicate write leaves its index
    stale. A knowledge index is a per-record projection and `matched: 40` names no
    record, so no event shape could drive it — the durable fix is reconciliation,
    tracked in #4672.

  The event carries no `where` predicate. The only one available at publish time
  is the middleware-composed AST, whose filter embeds the security layer's
  injected row scoping (RLS, sharing) — publishing it would ship tenant scoping
  internals to whatever external URL a webhook points at.

  Also pays off a measurement debt from #4655, which claimed the write-path cost
  of event publishing had been measured but never published the numbers:
  `packages/objectql/src/engine-data-events.bench.ts` measures it. Against an
  in-memory driver, publishing costs ~7–9µs per event (insert 0.021ms vs 0.012ms,
  single-id update 0.013ms vs 0.007ms). A bulk write pays that **once** regardless
  of how many rows matched (0.040ms vs 0.034ms over a 100-row match set), so its
  relative cost shrinks as the match set grows.

- 462b713: fix(objectql,client): `subscribeData` callbacks receive real `DataEvent`s — the producer now fulfils the declared contract (#4626)

  `@objectstack/spec/api`'s `DataEvent` declares top-level `id` (uuid,
  required), `type`, `object`, `recordId` (required), `changes?`, `before?`,
  `after?`, `userId?`, `timestamp`. But the producer (the ObjectQL engine)
  published a raw `RealtimeEventPayload` envelope with `{ recordId, after,
changes }` nested under `payload` and never generated `id`/`userId`, while the
  client SDK force-cast that envelope into the callback (`callback(event as any
as DataEvent)`). Subscribers who wrote `event.recordId` / `event.changes` —
  exactly what the types promised — compiled green and read `undefined` at
  runtime. The data-side twin of #4602.

  Producer now fulfils the contract:

  - `ObjectQL.insert()` / `update()` / `delete()` build a true `DataEvent`
    (generated uuid `id`, flattened top-level fields, `userId` from the
    execution context when the write names an actor) and validate it with
    `DataEventSchema.parse` before publishing. The transport envelope is
    unchanged (`RealtimeEventPayload`, with `payload` carrying the complete
    `DataEvent`), so subscribers keep receiving `{ type, object, payload,
timestamp }` on the wire.
  - A batch insert publishes one event **per record** (as before), each with its
    own event id.
  - **A multi-row write (`multi: true` → `updateMany` / `deleteMany`) now
    publishes nothing.** Those driver methods return only an affected count, so
    there is no record for a required `recordId` to name; the engine logs a
    warning naming the gap instead of publishing the previous fabrication
    (`recordId: ''`, `after: <affected count>`), which every schema-compliant
    consumer had to reject. **Consequence: webhooks and knowledge sync no longer
    fire for bulk writes** — they previously fired once with an unusable body. A
    real bulk event contract is tracked in #4639.

  Consumers validate or read the fulfilled shape instead of guessing:

  - `@objectstack/client`'s `subscribeData` (and therefore
    `@objectstack/client-react`'s `useDataSubscription` /
    `useDataSubscriptionCallback` / `useAutoRefresh`, which delegate to it)
    unwraps the envelope and runs `DataEventSchema.safeParse` at the boundary.
    An off-contract payload is rejected loudly (handler error, callback never
    invoked) — never coerced or passed through. The `as any as DataEvent`
    double-cast is gone, and the `recordId` option now filters on the fulfilled
    event.
  - `@objectstack/plugin-webhooks`' auto-enqueuer reads the required
    `recordId` directly; its `recordId ?? id ?? after?.id ?? before?.id ??
'unknown'` fallback chain is gone, and an off-contract event is dropped with
    a warning rather than delivered under the literal id `'unknown'`. Delivered
    webhook bodies now also carry the event's `id`/`type`/`userId`; the record
    itself stays nested under `after` and the envelope keys (`object`,
    `recordId`, `action`, `timestamp`) still win.
  - `@objectstack/service-knowledge`'s event sync reads the record from `after`
    (create/update) and the id from `recordId` (delete) for `data.record.*`.
    It previously indexed the envelope itself as if it were the row, and never
    resolved an id for deletes.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1

## 15.1.0

### Patch Changes

- f531a26: fix(security): close three execution-surface authz holes surfaced by the #2849 class sweep (#2980, #2981, #2982)

  Three independent, confirmed-exploitable defects where an execution surface
  ignored the caller's identity or fell open on a missing one. Each is fixed at
  its own enforcement point; none change behaviour for correctly-scoped callers.

  - **#2980 — reports IDOR + scheduled-report RLS bypass.** `ReportService`
    discarded the caller's context and read/wrote `sys_saved_report` with a system
    context, so any authenticated user could read, delete, or overwrite any saved
    report by id (cross-owner / cross-tenant), and `listReports` enumerated all
    owners. `getReport`/`deleteReport`/`saveReport`/`listReports` are now
    owner-scoped (system read of the protection-locked metadata object, but
    authorization enforced by owner match); create/overwrite can no longer spoof
    ownership. Scheduled dispatch no longer runs `isSystem` (which emailed the
    target object's entire table past the owner's RLS): it resolves the owner to a
    real RLS-bearing context via a new `resolveOwnerContext` seam and **fails
    closed** (skips + marks the schedule failed) when the owner can't be resolved,
    rather than running elevated. Wiring that resolver is the reports-surface
    consumer of ADR-0073's user-less identity resolution.

  - **#2981 — knowledge/RAG retrieval fall-open.** `applyPermissionFilter` returned
    every hit when the context was missing _or_ system. A missing identity is no
    longer treated as a grant: object-backed hits fail closed (dropped, keeping
    ACL-less file/http hits), and only an **explicit** system context passes
    through. Closes the agent path where an omitted `ToolExecutionContext.actor`
    yielded unfiltered semantic search over the whole corpus.

  - **#2982 — bulk-write OWD gap.** `update({multi:true})` / `deleteMany` had no
    single id to `canEdit`-gate, so owner scoping was skipped on private (and
    public_read) objects. A new `SharingService.buildWriteFilter` (the edit-set
    analogue of `buildReadFilter`) is AND-ed into the write AST for multi writes,
    constraining them to rows the caller may edit — including the on-behalf-of
    delegator intersection.

  Tracked as the motivating evidence of ADR-0096 (execution-surface identity
  admission); the mechanism that would prevent the class structurally is separate.

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

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
  - @objectstack/core@6.4.0
