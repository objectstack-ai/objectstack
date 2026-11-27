# @objectstack/knowledge-turso

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

- 9df53a1: Clause-②: no
  Metadata-protocol: none
  
  knowledge-turso: a search whose source's index is switched by a rebuild on each of its three attempts now answers `CONCURRENT_MODIFICATION` (409), the same coded answer the pgvector store gives, instead of `SERVICE_UNAVAILABLE` (503). The store was ready all along; running the same search again answers. The retry count and every other search answer are unchanged.
- ff63b02: fix(knowledge-turso)!: the Knowledge page's Turso fields are contributed by the store that reads them — a deployment whose store is pgvector shows none
  
  Clause-②: no (narrowing) — narrowed: where `@objectstack/knowledge-turso` is not mounted (the store is `@objectstack/knowledge-pgvector`, on PostgreSQL), or is mounted with a `url` or `client` of its own, `PUT /api/settings/knowledge` refuses a body naming `turso_url` or `turso_auth_token` (`400 UNKNOWN_KEY`, the whole body), where it stored them, and `GET /api/settings/knowledge` no longer serves them; where the store reads its URL from settings (the `requires: ['knowledge']` mount on any other database) both doors answer as before
  Metadata-protocol: none
  Skills-docs: none — no skill under `skills/**` teaches `turso_url` or `turso_auth_token`. `content/docs/ai/knowledge-rag.mdx` says where the page shows them.
  
  <!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: a settings manifest is a runtime registration, not authorable metadata. The narrowed answers are doors of one settings namespace on deployments that do not read the two keys, nothing that `objectstack migrate meta` reads names them, and stored rows are untouched. -->
  
  **BREAKING** for a script or client that writes `turso_url` or `turso_auth_token` to the `knowledge` settings namespace of a deployment that does not mount `@objectstack/knowledge-turso` reading its URL from settings: the write is now refused as an undeclared key, and refused whole — no other key in that body is saved. Nothing on such a deployment ever read either key, so no deployment behaves differently. Drop the two keys from the body.
  
  The Turso group (`turso_url`, `turso_auth_token`) left `@objectstack/service-settings`' `knowledge` manifest (now `version` 5), whose remaining keys all have a reader on every deployment that mounts the knowledge service. `KnowledgeTursoPlugin` adds the group to that page in `init()` when it reads the two keys (`urlFromSettings` with no `url` or `client`, as the runtime's `knowledge` capability mount sets it), in front of the page as before, so:
  
  - on PostgreSQL, where the store is pgvector in the platform database, the Knowledge page shows no Turso fields;
  - where the store is the libSQL file, the page shows them, and a saved value is read by the store at the end of the boot exactly as before.
  
  New exports of `@objectstack/knowledge-turso`: `knowledgeTursoSettingsSpecifiers`, `withKnowledgeTursoSection`, `contributeKnowledgeTursoSettings`, `knowledgeTursoSettingsTranslations` and `KNOWLEDGE_SETTINGS_NAMESPACE`. A host that declares the two keys in its own `knowledge` manifest keeps that manifest as written.
  
  Stored values: an environment that saved either key keeps its `sys_platform_setting` row (the auth token's `sys_secret` handle included); the settings service never deletes a stored row. Where the store is not mounted the value is not served and changes nothing, as it changed nothing before; mounted again, the store reads it. To tidy up a PostgreSQL deployment, delete the `knowledge` rows named `turso_url` and `turso_auth_token`; nothing requires it.
  
  The group's copy moved with it: `@objectstack/service-settings`' eleven locale bundles no longer carry the Turso group or its two fields, and `KnowledgeTursoPlugin` loads the same strings, in the same eleven locales, into the i18n service at `kernel:ready`.
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

- 40570d6: feat(knowledge): the libSQL vector store moves into the open framework, with generations, listing and the adapter contract suite
  
  Clause-②: yes
  Metadata-protocol: none
  
  ADR-0161 Execution row 7; cloud ADR-0119 D5 (#37107).
  
  - **`@objectstack/knowledge-turso` now ships from this repository**, Apache-2.0 (its `LICENSE` file is the Apache-2.0 text). `KnowledgeTursoPlugin` registers a `TursoKnowledgeAdapter` (adapter id `turso`) that keeps passages and vectors in a libSQL database of its own with libSQL's native vectors: the `url` option (`file:`, `:memory:`, `libsql://`), else `knowledge.db` under the project's `.objectstack/data/` (`defaultStoreUrl`). A URL naming the platform's own database file (`objectstack.db`, `dev.db`, `standalone.db`, or the file `OS_DATABASE_URL` names) is refused: two engines writing one SQLite file lose rows. On a file the store sets WAL and a busy timeout (`busyTimeoutMs`, default 5000), and in one process every call of the store runs its database work one at a time. On a remote database (`libsql://`) each request is bounded (`requestTimeoutMs`, default 10000; a write sends one request per document): past it the call answers `SERVICE_UNAVAILABLE`, a write stopped before its commit is rolled back, and the queue moves on.
  - **The platform embedder and splitter.** The package's own OpenAI embedding provider, hash embedder and chunker are gone: it embeds with the kernel's `embedder` service, read at each call (or the `embedder` option), reports `embedding` (model, dimensions, input limit), and declares `capabilities.chunks`, indexing the service's passages as given. Removed exports of the cloud-repo releases: `HashEmbedder`, `HashEmbeddingProvider`, `EmbeddingProvider`, `TursoAdapterOptions` and the default export; removed options: `embedding` (now `embedder`), `chunkTarget`, `overFetch`, and `adapterConfig.tableName` / `dimensions` on a source.
  - **Generations under the index fingerprint (ADR-0161 K7; K8, item 8).** A generation table `knowledge_generation` and one passage table per source and generation, `knowledge_<source>_g<n>`. A write or a search under another fingerprint is refused `409 KNOWLEDGE_REBUILD_REQUIRED` (registered in the error-code ledger for this package). `beginBuild` under a new fingerprint opens a generation beside the active one, which keeps answering its own fingerprint; `completeBuild` switches to it, records the recipe hash and drops the old table; `indexStatus` answers the fingerprint, the recipe hash and whether a build is under way. The unique index keeps one generation under construction per source; it does not refuse a second builder: a second `beginBuild` under the same fingerprint joins the build, and one under another fingerprint replaces it, after which the first builder's writes are refused `KNOWLEDGE_REBUILD_REQUIRED`. Either way no generation mixes two fingerprints. A table of the cloud-repo releases (`knowledge_<source>` with exactly their columns) is never served: a search answers `KNOWLEDGE_REBUILD_REQUIRED`, and the table is dropped when the first complete reindex finishes.
  - **Listing, hashes, organizations.** `listDocuments` pages the generation the writes go to, each document's `docHash` as stored; hits carry `docHash` and the passage's `headingPath`; the organization filter, the record scope (`scope`, ADR-0161 K8 item 17) and the metadata `filter` run in SQL before ranking, by an exact cosine scan (no DiskANN index, which ranks before it filters). A passage whose text is unchanged is not embedded again.
  - **When it cannot run**, because the database cannot be opened or `@libsql/client` has no native build for the platform (Windows on ARM), the plugin still registers and boot goes on; `healthCheck` answers `ok: false` and every call answers `503 SERVICE_UNAVAILABLE`, its reason in the error's `remedy`.
  - **Settings → Knowledge, "Test connection" on Turso** no longer says the package ships from another repository, or that a store with no URL reuses the platform's database: it names `@objectstack/knowledge-turso`, registered beside the knowledge service, and its default file.
  - The package runs `runKnowledgeAdapterContract` with every member declared (`scope` included), on `:memory:` and on a `file:` URL, in its own unit tests.
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
