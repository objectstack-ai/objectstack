# @objectstack/knowledge-pgvector

## 19.0.0-next.3

### Patch Changes

- d753fd9: feat(service-knowledge): a caller who may read few of a source's records is answered from them, wherever they rank
  
  Clause-②: no
  Metadata-protocol: none
  
  A knowledge search re-checks every hit as the caller after ranking, and refills once at `topK × 20`. A caller who may read only a few of a source's rows (20 of 1,000, say) could find none of them within that cap and be answered nothing, though the store held their answer.
  
  - **`@objectstack/service-knowledge`.** Before the first round, for a caller who is not the system identity, the service reads the ids of each source's records that caller may read: as the caller, under the source's `where`, ids only, at most 501. When there are 500 or fewer, the source is handed them as a `record` scope term, so its adapter ranks only those rows. A caller's own `scope` is intersected with them, never widened: a one-record scope stays one record. A scope with a parent (metadata) term, more than 500 readable records, a read that fails (logged at `warn`), or no readable record in scope, and the source is searched as before. Every hit is still re-checked one by one, the organization filter is unchanged, and the system identity's search is unchanged. The conformance harness's engine double (`@objectstack/service-knowledge/testing`) answers that read as the caller too.
  - **`@objectstack/knowledge-turso`.** Each new generation's passage table carries an index on `source_record_id`, so a narrowed search reads only those records' passages. A generation made before gets it from its next build; nothing to run.
  - **`@objectstack/knowledge-pgvector`.** Each passage table carries an index on `(source_id, generation, source_record_id)`. A table made before gets it on the first write after the upgrade (`CREATE INDEX IF NOT EXISTS`, which holds writes to that table while it builds).
  
  Nothing to migrate.
- Updated dependencies [22e1089]
- Updated dependencies [e606bab]
- Updated dependencies [d578952]
- Updated dependencies [c06dac7]
- Updated dependencies [58b513a]
- Updated dependencies [1f1cd21]
- Updated dependencies [10321fa]
- Updated dependencies [fe0473d]
- Updated dependencies [3550665]
- Updated dependencies [33a0d4f]
- Updated dependencies [ee2ffca]
- Updated dependencies [3ffa92d]
- Updated dependencies [9609c13]
- Updated dependencies [da08375]
- Updated dependencies [86ce7a3]
- Updated dependencies [f9c6f92]
- Updated dependencies [d59478f]
- Updated dependencies [a7f7f3f]
- Updated dependencies [03f39cc]
- Updated dependencies [898b056]
- Updated dependencies [216524a]
- Updated dependencies [d994002]
- Updated dependencies [ba2d960]
- Updated dependencies [fd06b7a]
  - @objectstack/spec@19.0.0-next.3
  - @objectstack/core@19.0.0-next.3

## 19.0.0-next.2

### Patch Changes

- c151c49: feat(knowledge-turso, knowledge-pgvector): hybrid search — a keyword leg merged with the vector leg by reciprocal rank fusion
  
  Clause-②: no
  Metadata-protocol: none
  
  A vector alone often ranks a passage that names an exact token — an order number, a model code like `X-200`, a person's name, a short term like 「出差」 — below `topK`. Both open stores now search with two legs and merge them by reciprocal rank fusion (`k` = 60, each leg at most `topK`) before the knowledge service re-checks each hit as the caller. The organization filter, the record scope and the metadata `filter` are one `WHERE`, run in both legs before either ranks.
  
  - **Terms.** The query is split at white space and punctuation; a hyphen, dot, slash, underscore, `#`, `@` or `+` inside a term keeps it whole (at most 16 terms). A passage's keyword score sums the BM25 inverse document frequency, among the rows in scope, of the terms it holds.
  - **`@objectstack/knowledge-turso`.** A term of three characters or more is one quoted FTS5 phrase (so `X-200` is never FTS5 syntax) in a contentless trigram index beside each passage table (`<table>-kw`, `<table>-fts`), kept in step by triggers on every write and removal and dropped with the table. A shorter term is matched by `LIKE` over the rows in scope. A passage table made by an earlier release gets its keyword index at its first search, built from its rows in one transaction.
  - **`@objectstack/knowledge-pgvector`.** A word of three characters or more is a phrase on `to_tsvector('simple', content)`, served by a GIN expression index on each passage table (`knowledge_vec_d<width>_content_tsv`). A shorter term, or one holding a Han, kana or Hangul character (the parser keeps a run of them as one word), is matched by `ILIKE`. A passage table made by an earlier release gets the index from the first write or search of its width; `CREATE INDEX` blocks writes to that table while it builds.
  
  A hit's `score` is now the fused rank, normalized to `(0, 1]`: 1 for a passage first in both legs, 0.5 for one first in only one. It was the cosine similarity; anything that compared it with a fixed threshold reads it again. Nothing to migrate.
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

## 19.0.0-next.1

### Minor Changes

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
- 2314b0e: fix(knowledge-pgvector): `dropSource` removes a source that another process is building, and that build cannot bring it back
  
  Clause-②: no
  Metadata-protocol: none
  
  `IKnowledgeAdapter.dropSource` drops every generation of a source, "the one under construction included". On the pgvector store two cases did not hold while another process was building the same source and held its builder lock. Both were measured on a live PostgreSQL 16 with pgvector.
  
  - **A generation a concurrent `beginBuild` opened survived the drop.** When the drop waited on the row lock of a build that was opening its generation, the drop's locking read could not see the row that transaction inserted. The drop then retired only the active generation, and the new one stayed `building`, holding whatever the build wrote next. The drop now locks the source's rows and then retires every generation in one statement of its own, so the generation opened by the transaction it waited on is retired too.
  - **The other build's next write brought the dropped source back.** Its builder lock was still held, so its next page found no generation and opened a new active one. The store then served whatever that build wrote from that point on. A build's write, listing and completion now go only to the generation that build began. When that generation is gone, because the source was dropped in any process or another build replaced it, the call is refused `LOCK_CONFLICT` (409) and the build ends and lets go of its lock. A completion with no write since the drop is refused the same way. Before, it threw an error with no code.
  
  A drop of a source that holds nothing, racing a `beginBuild` that opens the source's first generation, is still settled as drop-then-build: the build's generation is kept. Event-sync writes are not fenced. Nothing to migrate.
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

## 19.0.0-next.0

### Patch Changes

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
- fc7bdeb: feat(knowledge-pgvector): a changed fingerprint builds a new generation beside the active one and switches to it
  
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
- Updated dependencies [8236d9b]
- Updated dependencies [1d28405]
- Updated dependencies [b02484e]
- Updated dependencies [7a3f86c]
- Updated dependencies [52a2398]
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
- Updated dependencies [06c1f54]
- Updated dependencies [489d9fe]
- Updated dependencies [c349576]
- Updated dependencies [c063734]
- Updated dependencies [0439a04]
- Updated dependencies [5bf7242]
- Updated dependencies [f92d271]
- Updated dependencies [3d4f423]
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
  - @objectstack/core@19.0.0-next.0
