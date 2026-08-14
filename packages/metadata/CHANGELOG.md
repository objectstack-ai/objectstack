# @objectstack/metadata

## 17.0.0

### Major Changes

- ac6c0be: refactor(metadata)!: remove the `artifact-api` artifact source (#4246)

  `MetadataPluginOptions.artifactSource` loses its `artifact-api` union member;
  `{ mode: 'local-file', path }` is now the single artifact source. The
  `_loadFromArtifactApi` loader, its `environmentId` pre-flight guard, and the
  Bearer-token support in `_fetchJson` go with it.

  **Why removal, not the doc fix this branch first carried.** #4246 found the
  declaration and the implementation contradicting each other — the option's
  comment called `artifact-api` "reserved for M3/M4" while the loader shipped and
  all three bootstrap modes dispatched to it — and asked the owner to pick a
  direction. Auditing both repos to answer that settled it:

  - **Zero consumers anywhere.** No `mode: 'artifact-api'` call site exists in
    this repo or in cloud. The two real "pull an artifact from the cloud" paths
    both bypass it: the cloud runtime uses its own `ArtifactApiClient` (TTL
    cache, singleflight, hostname resolution, runtime config injection — a
    superset this option was never going to grow into), and package distribution
    into a running OSS instance goes through `@objectstack/cloud-connection`
    (`os package install`, ADR-0008).
  - **Half its input contract had been dead since v5.0 with no one noticing.**
    The URL builder decided "append the canonical path vs use as-is" by testing
    for an `/api/v{n}/cloud/projects/` segment that the v5.0
    `project → environment` rename deleted, so every already-resolved URL got
    the path appended a second time and 404'd. A year of silence on a bug like
    that is consumer-count evidence of its own.
  - **Its one non-replaceable capability was declined.** A Bearer-authenticated
    pull of a _private_ environment artifact is the single thing `local-file`
    cannot do (`local-file` URLs fetch verbatim, unauthenticated). The owner
    confirmed that sealed-private-artifact deployments are not a supported need
    right now, which removed the last reason to keep the mode.

  **Migration.** Public or commit-pinned artifacts load through the existing
  `local-file` URL form, which every bootstrap mode already honors:

  ```ts
  artifactSource: {
    mode: 'local-file',
    path: 'https://cloud.example.com/pub/v1/environments/env_42/artifact?commit=cmt_1a2b',
  }
  ```

  (`private` environments still serve exact-commit deep links through the same
  `/pub` route; fully private pulls have no replacement — by decision, not
  oversight.) For installing packages into a running runtime, use
  `os package install` / `@objectstack/cloud-connection`.

  **The removal is loud, not silent.** A still-configured `artifact-api` source
  (reachable from JS or `any`-typed config now that the TS union is
  single-member) throws at `start()` with the migration pointer above. This
  guard exists because the dispatch's old fall-through would have treated
  "unsupported source" as "no source" — under `eager` that silently scans the
  filesystem instead of loading the artifact the caller named. Tests pin the
  rejection in `artifact-only` and `eager`, and pin the migration target
  (`local-file` fetching an http(s) URL and registering the envelope) so the
  path the error message points at stays real.

  Also replaces a test that passed for the wrong reason: "artifact-only
  bootstrap rejects the not-yet-implemented artifact-api source" matched
  `/artifact-api/` against the missing-`environmentId` guard's message — which
  merely contained the string — proving nothing about implementation status.
  The doc comment, `implementation-status.mdx`, `metadata-service.mdx`, and the
  package ROADMAP now all describe the single `local-file` source, ending the
  docs-audit loop #4246 was filed to stop.

- 9960cd2: fix(metadata): remove the second, stale-keyed producer of `idx_sys_metadata_overlay_active` (#6771)

  **Breaking:** `addSysMetadataOverlayIndex` and its `AddSysMetadataOverlayIndexResult`
  type are removed from `@objectstack/metadata/migrations`. Nothing needs to replace
  them — see below.

  One index name, `idx_sys_metadata_overlay_active`, had **two** producers with
  **different** keys:

  | producer                                                                 | key                                                                                |
  | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
  | `metadata-protocol`'s `ensureMetadataOverlayIndexes` (runtime, ADR-0048) | `(type, name, organization_id, COALESCE(package_id, ''))` `WHERE state = 'active'` |
  | this package's `addSysMetadataOverlayIndex`                              | `(type, name, organization_id, environment_id, scope)`                             |

  The second key is the pre-ADR-0048 one. `environment_id` has been retired since
  ADR-0005 (2026-05 revision) — `saveMetaItem` no longer writes it and overlay reads
  never consult it, so it is NULL on every new row, and SQL UNIQUE treats NULLs as
  DISTINCT. `scope` is not part of the current discriminator at all. Both producers
  used `IF NOT EXISTS`, so whichever ran first claimed the name and the other
  silently became a no-op — decided by boot order, not by any declaration.

  Measured against real SQLite before removal:

  - On a normal `DatabaseLoader` boot the stored DDL is
    `` CREATE UNIQUE INDEX `idx_sys_metadata_overlay_active` on `sys_metadata` (`type`, `name`, `organization_id`, `package_id`) `` —
    the **declared** index from `metadata-core`'s `sys-metadata.object.ts`, materialized
    by `SqlDriver.syncDeclaredIndexes`, already holds the name with the current key.
    `addSysMetadataOverlayIndex` therefore changed nothing, while still returning
    `status: 'created'`.
  - In the one window where it was _not_ a no-op — the table present but its declared
    indexes not yet materialized, which the engine path hits by construction because
    ObjectQL's startup owns the sync — it installed the **retired** key. Since
    `syncDeclaredIndexes` skips by name, nothing ever repaired it afterwards, and
    overlay uniqueness was left unenforced on every new row.

  So the function could only ever do nothing or do harm. Overlay uniqueness keeps the
  two producers that are correctly keyed and deliberate: the runtime partial,
  NULL-safe index from `metadata-protocol`, and — for stacks assembled without it —
  the coarser unrestricted UNIQUE that the declaration in `metadata-core` materializes,
  exactly as that file documents.

  Both call sites in `DatabaseLoader.ensureSchema()` are gone with it, and the empty
  `catch` that surrounded the engine-path one now reports per the ADR-0120 D4 shape
  (name what did not happen, point at the fix, never block the boot) instead of
  swallowing driver-resolution failures.

  **Migration:** if you called `addSysMetadataOverlayIndex(driver)` directly, delete
  the call. Assemble `metadata-protocol` for the partial, active-scoped index, or rely
  on the declared index that `syncSchema` already builds.

  <!-- adr-0087: not-required (no-migration-prescription) what is removed is a TypeScript function export, not an authored metadata surface: no metadata key, no key spelling and no stored value moves, so `objectstack migrate meta` has nothing to rewrite and the ledger has no upgrader to reach. The index itself is unchanged in the only spelling that ever reached a database from a correct producer. Measured: the export had zero call sites outside its own package across objectstack, cloud and objectui. -->

### Minor Changes

- ffb003c: **ADR-0110 — an action's identity is its `name`, and anything executable over a
  governed surface must have a declaration.**

  `POST /api/v1/actions/:object/:action` resolved the DECLARATION from the URL
  segment as a `name` but dispatched the HANDLER using that same segment as a
  registry key. For a target-bound action (`{ name: 'complete_task', target:
'completeTask' }`) those are different strings, so the two documented callers
  each worked on exactly the half the other broke: the documented curl resolved
  the declaration then 404ed, while the Console's `target`-addressed call
  dispatched fine and resolved no declaration — silently skipping the ADR-0066 D4
  capability gate and the ADR-0104 param contract (#3935).

  - **D1/D2** — identity is always the declarative `name`; the handler key is
    derived from the resolved declaration through a rotation now shared with the
    MCP `run_action` bridge (`resolveActionHandlerKeys`, `executeRegisteredAction`).
    The REST route previously rotated only the object key, never the handler key.
  - **D3 (breaking)** — declaration resolution is a trichotomy. A genuinely
    undeclared handler is **refused (404)** with the `defineAction` to add, rather
    than executed ungated with system privileges; an unreachable metadata plane is
    a **503** rather than a silent ungating (`MetadataManager.loadDiagnosed` tells
    a clean miss from an outage). `OS_ALLOW_UNDECLARED_ACTIONS=1` is the migration
    valve — it warns on every invocation and is removed in 18.
  - **D5** — `reconcileActionRegistrations` plus `ObjectQLEngine.listRegisteredActions`
    power a `kernel:ready` inventory logging every registered-but-undeclared
    handler (refused at dispatch) and every declared script action bound to no
    handler — the ADR-0078 converse, mechanised.
  - **D6** — security-gate strictness is opt-**out** (`OS_ALLOW_*`), never opt-in.

  Apps whose actions are all declared need no changes beyond gaining enforcement
  of the `requiredPermissions` they already declared.

- ecc61ab: feat(metadata): 端点匹配器 —— `MetadataManager.matchEndpoint` 惰性索引实现 (#5089)

  `IMetadataService.matchEndpoint?` 的契约在 #5080/#5097 落地(声明先行),本变更补上
  `metadata` 槽位占位者 `MetadataManager` 的实现:把已声明的 `api` 元数据条目编成
  **METHOD → 精确路径 → 端点** 的惰性索引,供 HTTP 分发器在「没有内建域认领这条路径」
  与「回答语义 404」之间做一次查表。这是 #5040 端点执行器程序的 E2 单。

  **结构性不可达,零行为变更。** 17.x 里没有任何东西会调用 `matchEndpoint`:挂载 seam
  是 #5090 的面,而 publish/validate 对非空 `apis:` 仍然硬拒(#4936)。新代码在真实组合
  里不暴露任何 HTTP 行为;测试直接驱动服务,这正是 #5040 设计选定的验收姿态。

  实现要点(逐字实现契约文本,`packages/spec/src/contracts/metadata-service.ts`):

  - **匹配维度**:`method` 大写规整后比较(请求动词大小写不敏感);`path` 去掉**一个**
    尾斜杠后**整串精确**比较,两侧同规则。17.x 不做百分号解码、不做 Unicode 规整、
    不做大小写折叠 —— 原串即键。词表(ADR-0121)未定义任何路径模板语法,因此
    `params` **恒为 `{}`**;此处不发明只存在于实现里的方言。
  - **答案是 parse 后的形状**:每条经 `ApiEndpointSchema.safeParse`,默认值已物化 ——
    作者省略 `authRequired` 时消费方拿到的是 `true`,不可能把「缺省」误读为放行。
  - **坏条目响亮缺席**:解析失败的存量条目被跳过并以 `error` 级点名(说明该路由将回 404
    及如何修),绝不返回半合法形状,也绝不牵连同批的好条目。
  - **重复声明确定性收敛**:两条条目声明同一 METHOD+path 时,`name` 字典序在前者保留
    路由,被弃者连同规则一并 `error` 级点名 —— 不是静默 last-write-wins,每个节点、每次
    启动的解析结果一致。
  - **断存储抛错,不伪装 404**:`undefined` 只表示「无声明拥有这条路由」;读不到存储时
    抛出(与 `loadDiagnosed` 的 miss/outage 之分同源,ADR-0110 D3),因为 miss 会变成
    404,而故障不得伪装成 404。构建失败不缓存,下次调用重试。
  - **失效**:挂在仓内既有机制上,不新造事件系统 —— `invalidateListCache('api')` 覆盖
    全部本地写入(含 artifact 装载 / HMR 的 `{ notify: false }` 写入,这些按构造不经过
    watcher),`subscribe('api', …)` 覆盖集群对端回放(它只经 `notifyWatchersLocal`)。
    失效后下次调用整体重建。

  `ApiEndpointSchema` 与 `packages/spec` 未做任何改动(词表冻结)。

- c52e608: fix(metadata,spec): the endpoint publish gates now guard the metadata write path too (#5189, #5040 E7b)

  #5111 (E7) hung the five per-endpoint `apis:` gates on
  `ObjectStackDefinitionSchema`, which every path that parses a **stack** runs
  through — `defineStack`, `os validate`, the lint scorer, artifact ingest,
  `EnvironmentArtifactSchema.metadata`. #5189 proved a stored `api` item need
  never have been part of a stack: `MetadataManager.publishPackage`, a direct
  `metadata.register()` and a Studio metadata write each mint one item at a time
  and saw no gate at all.

  Three of the five gates degrade safely when bypassed — the executor answers a
  structured 501 naming the item, and a path outside the `apps/<namespace>/`
  carve-out simply matches nothing. **ADR-0121 D6 has no runtime counterpart**:
  the runtime honours `authRequired: false` faithfully and `deriveBucketConfig`
  returns `null` for a budget whose `enabled` is not `true`, so the bypass minted
  an anonymous, zero-quota execution entry point — the exact shape D6 exists to
  forbid.

  Two doors now, both running the SAME gate function rather than a second copy of
  the criteria:

  - **Publish** — `MetadataManager.publishPackage` runs
    `validateApiEndpointDeclarations` over the package's `api` items and fails
    the publish, naming each endpoint and the key to fix, on the same
    `validationErrors` surface it already uses. This pass is **not** governed by
    `options.validate`: an opt-out on a security gate is the bypass this fixed.
  - **Load** — the endpoint matcher's index build re-applies the _identity-free_
    subset (supported subset, mapping, policy/D6) to every stored item. A
    declaration that never passed publish is EXCLUDED from the index and named at
    `error` level, so a bypassed endpoint answers 404 with a loud log instead of
    answering anonymously and unmetered. The namespace and uniqueness gates are
    deliberately not applied there — both need a stack identity a stored row does
    not carry.

  **New in `@objectstack/spec/api`** (the module was package-internal in #5111,
  whose only consumer was one file away):
  `validateApiEndpointDeclarations`, `identityFreeEndpointGateFailure`,
  `EndpointGateIssue`, `EndpointGateIdentity`.

  **New option — `publishPackage(id, { namespace })`.** `MetadataManager` indexes
  items by `packageId` and carries no manifest, so it cannot prove a namespace on
  its own and will **not** infer one from the items it is judging (an
  author-supplied value would make the ADR-0121 D1/D2 carve-out gate vacuous).
  Callers that hold the package manifest pass its explicit `manifest.namespace`;
  without it the namespace gate fails and the package's `api` items do not
  publish — which is the rule, not a limitation: a publish that cannot prove a
  namespace must not mint a URL under one. Packages that declare no `api` items
  are untouched.

- 2f8328c: feat(spec,metadata,mcp): let a plural metadata read say it is known-partial (#6504)

  `IMetadataService.list(type)` returns an array whether every loader answered or
  one of them was down. A consumer receiving a short list therefore had no way to
  ask whether it was short because that is all anyone declared, or because a
  loader was unreachable — the #5840 / PR #6051 defect on the plural read.

  The verdict already existed and was already being thrown away.
  `MetadataManager.readListUncached()` has computed a `degraded` flag since #5184,
  and `list()` spent it entirely on picking a cache TTL. This is sharper than the
  singular case rather than merely analogous: `list` is the read whose answer
  carries a **count**, and a consumer restating `items.length` as "this
  environment contains N items" makes a positive, numeric claim out of a read that
  partly did not happen.

  **New optional contract member — `listDiagnosed?(type)`.** Returns
  `{ items, degraded, errors }`, the plural counterpart of `getDiagnosed`.
  Optional for the same reason its singular twin is: an implementation that
  predates it cannot report the distinction, so a consumer probes for it and falls
  back to `list()`, which reports nothing degraded. `list()` itself is unchanged
  in every direction — same items, same array instance, same best-effort posture —
  so no existing caller has to do anything.

  `MetadataManager` implements it through the same cache entry and the same
  single-flight slot `list()` uses, so asking for the verdict costs no extra
  loader walk and the two members cannot drift.

  **MCP consumers, classified individually** (PR #6051's discipline, not a blanket
  switch):

  - `objectstack://objects` **mis-described**, and its degraded body changes. It
    rendered `{ objects, totalCount }`, and during an outage `totalCount` was
    simply false. A healthy read is byte-identical to before. A degraded read now
    serves the same `objects` — the reachable set is still the most useful true
    thing here — with `totalCount` **absent** and `partial: true`,
    `returnedCount`, `warning`, plus the `code: 'SERVICE_UNAVAILABLE'` / `status:
503` envelope the sibling `objectstack://objects/{objectName}` resource
    already carries. Dropping the key rather than reporting a smaller number is
    the point: a client reading `body.totalCount` now gets `undefined`, where a
    plausible-looking integer would have been believed.
  - the `agent_prompt` sibling **skill bridge** is a snapshot and its output is
    unchanged. It publishes no count to any client, so a degraded read costs it
    silently-unregistered prompts instead of a false statement; the verdict goes
    to the operator as a `warn` naming the loader, the fact that the skills are
    missing rather than undeclared, and that the stdio transport's snapshot stays
    short until restart while the HTTP transport self-heals.

  If you consume `objectstack://objects` and read `totalCount` unconditionally,
  branch on `partial` (or on the key's absence) before treating any count from
  this resource as a total.

- 9319586: feat(core,metadata,objectql): `IMetadataService.register` refuses ambiguous writes, and type stores key on the canonical type (#7378)

  The maintainer's three-cell ruling of 2026-08-12 on #7378, implemented in every
  shipped `IMetadataService` implementation — `createMemoryMetadata`
  (`@objectstack/core`), `MetadataManager` (`@objectstack/metadata`) and
  `MetadataFacade` (`@objectstack/objectql`) — through one shared guard,
  `assertMetadataRegisterContract` / `canonicalMetadataServiceType`, newly
  exported from `@objectstack/core`:

  - **A `data.name` that disagrees with the `name` argument is refused** with a
    locating `VALIDATION_ERROR` (status 400), before anything is stored. The
    previous behaviours resolved the disagreement silently in opposite
    directions per implementation (argument-wins on the Map-backed stores,
    document-wins on the pre-#7511 facade), either of which can file an item
    under a key the author never wrote. A document carrying no `name` of its own
    still registers under the argument — absence is not a disagreement.
  - **A non-object `data` (primitive, `null`, array) is refused** the same way.
    It was previously accepted-then-dropped by `MetadataFacade` (readable back
    through no member) and interim-fixed by boxing into `{ name, content }`; the
    ruling forbids both the drop and the coercion.
  - **Type stores are keyed on the canonical (singular) type**: `'objects'` and
    `'object'` now address ONE store on every implementation, in both the write
    and the read direction, converging with the platform's enforced
    plural→singular normalization (`PLURAL_TO_SINGULAR`, `canonicalMetaType`
    #4432, `check:meta-type-normalized`).

  Callers that register with a matching (or absent) `data.name` and plain-object
  documents — every in-tree caller — are unaffected. A caller that relied on a
  mismatched `data.name` being silently resolved must pass the intended key as
  the argument and make `data.name` match it; a caller storing a bare value must
  wrap it in a document whose shape its type's schema accepts.

### Patch Changes

- d21c001: feat(spec)!: declarative `apis:` publishes again — the blanket refusal narrows to per-endpoint publish gates, and declared endpoints go LIVE (#5111, #5040 E7)

  ⚠️ **Read this as a security note, not a schema note.** Declarative endpoints
  **execute** from protocol 17. Before this release the surface was inert end to
  end — nothing mounted a declared `path`, no matcher existed, and every key
  including `authRequired` parsed green and gated nothing — which is why #4936
  refused a non-empty `apis:` outright. The #5040 E-series built the executor
  (mount seam, endpoint matcher, policy keys, execution targets, mapping keys,
  OpenAPI enrichment), so the refusal's premise is gone and keeping it would be
  the lie in the other direction.

  ## BREAKING — the refusal narrows, and what passes it is served

  `apis: [ …endpoints… ]` no longer fails wholesale. Each entry is now gated
  individually, and **an endpoint that passes the gate is mounted and answers
  real requests as soon as the stack is published.**

  **Before you upgrade, review every historical `apis:` block** — including any
  you restored, generated from an older doc, or left in place because it was
  known to do nothing. Pay particular attention to any entry that explicitly
  declares **`authRequired: false`**: the schema default is `true`, so an
  _omission_ is safe and needs no review, while an explicit `false` is the only
  thing that opens **anonymous** access to that endpoint. ADR-0121 D6 now pairs
  it with a mandatory armed rate limit — and "armed" means
  `rateLimit: { enabled: true, … }`, because `enabled` defaults to `false`, so a
  budget written without it meters nothing.

  ## The gates, each rejecting with its own prescription

  | gate                           | rejected shape                                                                                                                                                                                                                                                                  |
  | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **namespace** (ADR-0121 D1/D2) | a `path` that is not `/api/v1/apps/<manifest.namespace>/<subpath>`, or a stack that declares `apis:` without an explicit `manifest.namespace` (no derivation from `manifest.id`)                                                                                                |
  | **supported subset**           | `type: 'script'` / `'proxy'`; an `object_operation` missing `objectParams.object` or `.operation`; a `flow` with an empty `target`                                                                                                                                              |
  | **mapping**                    | any `transform`; an unusable `source`/`target` path (empty, empty segment `a..b`, `__proto__`/`prototype`/`constructor`); two entries whose `target`s collide (same path, or one inside another); `inputMapping` on a `find`/`get`/`delete` operation, which never reads a body |
  | **policy**                     | `authRequired: false` without `rateLimit.enabled === true`; an armed budget with `maxRequests`/`windowMs` ≤ 0; a negative `cacheTtl`; `cacheTtl` on a non-GET method                                                                                                            |
  | **uniqueness**                 | two endpoints in one stack claiming the same METHOD + path (one trailing slash trimmed, the matcher's own rule)                                                                                                                                                                 |

  **FROM → TO.** `path: '/api/v1/<anything>/thing'` →
  `path: '/api/v1/apps/<manifest.namespace>/thing'`, with `manifest.namespace`
  declared explicitly. `authRequired: false` → either delete the key (the safe
  default `true` applies) or keep it **and** add
  `rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 }`. Every other
  key is unchanged: the `ApiEndpoint` vocabulary is frozen — this release adds,
  removes and renames nothing on it. The gates are validation logic over the keys
  that already existed.

  The runtime keeps its own refusals for a declaration that reached the store
  without passing publish (a direct `metadata.register()`), so the two ends agree:
  what publish accepts is exactly what the executor serves.

  `normalizeEndpointPath` is now exported from `@objectstack/spec/api` and is the
  one canonical form of a declared path — the publish gate and the endpoint
  matcher (`@objectstack/metadata`) read the same rule instead of each carrying a
  copy, so a stack can never publish a duplicate the matcher would silently
  resolve to a single winner.

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

- 533a0a4: fix(metadata): 集群对端的元数据写入现在会失效本节点的 `listCache` / registry (#5109)

  多节点部署下,节点 A 改一条 `view` / `permission` / `flow`,节点 B 收到
  `metadata.changed` 广播后**只叫醒了 watcher,却没有失效自己的缓存**。
  `attachClusterPubSub()` 的订阅回调此前只做一件事 —— `notifyWatchersLocal()`,
  既不碰 `this.registry` 也不碰 `this.listCache`。后果是 B 上任何走 `list(type)`
  的读在 `LIST_CACHE_TTL_MS`(30 秒)窗口内继续返回改动前的清单;更糟的是,被叫醒的
  watcher(ObjectQL SchemaRegistry 桥、Studio HMR SSE)如果回头调 `list()` 重新拉取,
  拉到的还是旧的 —— 一份「失效通知」附带着失效数据。单机部署完全无感,只有多节点才暴露。

  这与该通道自己声明的用途相反(`ClusterMetadataChangedPayload`:"consumed by peers
  to **invalidate their local caches**",另见 `content/docs/kernel/cluster.mdx` §6.2
  与 `metadata-lifecycle.mdx`);现在实现与声明一致。

  修法沿用同文件里 `applyRepoEvent()` 自 ADR-0008 PR-6 起就用对的那条路径,并把两条
  「外部写入」缝(仓库 watch 循环、集群对端回放)收敛到同一个私有方法
  `invalidateForForeignWrite(type, name)`:

  - **删除而不预填。** 即便事件带着 body,也只删除 registry 条目而不写入 ——
    那份 body 是别人那次写入的快照,可能已被后续写入取代,预填会与真实 head 竞态,
    并要求我们去规范化一份自己没有加载过的定义。删除后 `get()` 自然穿透到 loader /
    repository,也就是真相所在。
  - **同步失效,先失效再通知。** 失效发生在收到消息的当拍(不在 `setImmediate` 内),
    通知仍然延迟派发。`setImmediate` 的存在理由是不让**消费方的 watcher 回调**背压
    pubsub 派发循环;而失效只是两次 `Map.delete`,不执行任何消费方代码,没有需要延迟的
    东西——把它一起延迟只会留下「已收到广播、尚未失效」的读窗口,请求处理器里任何一个
    `await` 都足以撞进去。先失效后通知也与本文件其他写入路径
    (`register` / `unregister` / `applyRepoEvent`)一致,于是回头 `list()` 的 watcher
    拿到的是写后清单。
  - **无名事件只失效清单缓存。** `MetadataWatchEvent.name` 在 spec 里是可选的,无名事件
    无法定位 registry 条目;此时不会把整个 type 的 registry 一并清掉 —— 那会驱逐
    `registerInMemory()` 注册的、任何 loader 都无法恢复的代码态构件(如 `origin:'code'`
    的 datasource)。

  回环抑制(`originNode`)仍然先于失效判断,本节点自己的广播不会让自己白白重建缓存。

- c4ab50b: fix(metadata): `sys_metadata` 的 DDL 失败不再被静默吞掉 —— 只有「表已存在」这一种原因可以静音 (#4728)

  `DatabaseLoader.ensureSchema()` 过去用一个空 `catch` 吞掉 **全部** DDL 失败,并且照样把
  `schemaReady` 置为 `true`:

  ```ts
  } catch {
    // If syncSchema fails (e.g. table already exists), mark ready and continue
    this.schemaReady = true;
  }
  ```

  注释里的免责理由只覆盖了失败原因中最良性的一种,却用它为**所有**原因开脱。真实的失败
  (权限不足、数据源根本没连上、列类型冲突)之后,表或新列压根不存在,而进程的状态与成功
  路径**逐字节相同**,启动日志里一行痕迹都没有 —— 这正是 #4420 的形态:声称已持久化、实
  际没落盘、系统看起来完全健康。#4632 把它定成规则(AGENTS.md → "Degradation log levels"),
  机械检查 `pnpm check:durability-log-level` 已经能发现这一处。

  现在按**错误类型**判别,而不是按注释里的乐观假设:

  - **良性的「已存在」**(SQLite 的 `table … already exists` / `duplicate column name`、
    Postgres 的 SQLSTATE `42P07`/`42701`/`42710`、MySQL 的 `ER_TABLE_EXISTS_ERROR` 等及其
    `errno`,并跟随 `cause` 链)—— 表确实已就绪,当作 no-op 静默通过,并照常执行后续的
    `project_id → environment_id` 迁移与 ADR-0005 索引。
  - **其余一切失败** —— 以 `console.error` 上报,文案同时说清**后果**(`sys_metadata` 的表/
    列未创建,后续每一次元数据写入都会报错、或在宽松驱动上悄悄丢列,而服务器仍报告健康)
    与**修复动作**(修掉下面那条驱动/数据源错误后重启)。只说**一次**,不是每次写入都刷屏。
  - `schemaReady` **不再**在真实失败后置 `true`。启动依旧不被阻断(该方法不抛),但 loader
    不再声称一个它并不具备的就绪状态,下一次元数据操作会重试 —— 数据源只是还在连接这类瞬
    时故障因此可以自愈,恢复时补一条 `info`。

  `ensureHistorySchema()` 按同一规则对齐:良性「已存在」不再每次写入都打一条 `error`(过度
  使用 `error` 是镜像失败),真实失败则同样只响亮一次并保持重试。

  无 API / schema 变更;新增内部工具 `isSchemaAlreadyExistsError()`(未从包入口导出)。
  `scripts/durability-degradation.baseline.json` 中指向本单的条目随之删除(该文件 shrink-only)。

- 3133cda: fix(metadata): `DatabaseLoader` 的读故障不再被吞成「什么都没声明」(#5108)

  `DatabaseLoader` 的五个读方法此前都把**任何**存储异常 `catch {}` 成各自的空值 ——
  `load` → `null`、`loadMany` → `[]`、`exists` → `false`、`stat` → `null`、
  `list` → `[]`。于是 `sys_metadata` 所在库不可达时,`loadMany('permission')` 与
  「这个环境一条 permission 都没声明」返回**完全一样的值**,而且异常是在 loader 内部
  就被抹掉的:`MetadataManager` 那几个 `try/catch` 降级分支拿到的是一次「成功的空读」,
  根本不会触发,整条链上没有任何一处会说出「读失败了」。

  现在按**错误类型**判决(#4632 立的规矩,#4728 / #4825 已经在同一个文件里用过两次的
  形状,判据复用现成的 `isMissingTableError`):

  - 唯一良性的失败原因是 `sys_metadata` 尚未 provisioned —— 那时确实没有行,
    「什么都没声明」就是事实,首次启动照旧返回空值、不报错、不缓存;
  - 其余全部原因(连接断开、超时、权限不足、查询出错)意味着行还在、只是这次没读到,
    一律把驱动原始异常**原样抛出**,由调用方决定降级姿态。判据保守:无法正面识别为
    「表不存在」的错误一律当作真故障。

  由此上层三个已有的机制第一次真的生效:

  - `MetadataManager.list()` 的降级分支会真的进,并且**升级到 `error`**
    (AGENTS.md「Degradation log levels」:系统看着正常、它声称掌握的清单其实是残缺的),
    日志写明后果与修法,每次故障只说一次、恢复时再说一次;`list()` 仍然尽力返回可读
    loader 的内容 —— 这个 best-effort 姿态是刻意保留的。兄弟方法
    `MetadataManager.loadMany()` 的同一条缝走同一个判决,不让同一次故障在同一个文件里
    报出两个级别;
  - `MetadataManager.loadDiagnosed()`(ADR-0110 D3)对 `DatabaseLoader` 终于能报出
    `degraded` / `errors`,而不是把 outage 报成 miss;
  - `listForIndex()` / `matchEndpoint`(#5089)契约要求「读不到存储必须抛出,不得伪装成
    miss(miss 会变成 404)」—— 这条此前对 `MemoryLoader` / `RemoteLoader` 有效、对
    `DatabaseLoader` 无效,现在对真实的 datasource loader 也成立了。

  **行为变化**:`MetadataManager.exists()` 与 `listNames()` 本来就没有 `try/catch`,
  所以存储故障现在会从它们抛出,而不再静默答「不存在」/「空清单」。这正是本次修复要的
  姿态 —— 可用性故障不是一次「没有」。

- c794f78: fix(metadata): a known-partial `list()` result is cached as degraded, on a 2s TTL instead of 30s (#5184)

  Since #5108 a loader that cannot read its store throws rather than answering
  `[]`, so `MetadataManager.list()` catches, reports the outage once at `error`,
  and keeps serving what the reachable loaders hold. That best-effort posture is
  deliberate. What was not deliberate is what happened on the next line: the
  known-short result went into `listCache` on the same 30s TTL as a complete read,
  with nothing on the entry to say it was partial.

  The consequences were all invisible from outside. That one `error` line covered a
  **30s window in which the failing loader was never asked again** — no retry, no
  second signal, the manager simply re-served a set it already knew was short. When
  the store came back, nothing noticed for up to another 30s, so #5108's recovery
  line (`reportLoaderReadRecovered`) arrived that late too. And because the entry
  carried no marker, no consumer of the cache — including that once-only report —
  could tell a partial answer from a complete one.

  Not caching degraded reads at all was considered and rejected on evidence. The
  `listCache` field comment records why the cache exists: security middleware
  calling `list('permission')` from inside a user-initiated DB transaction, where
  `DatabaseLoader`'s `engine.find('sys_metadata', …)` tries to take a second knex
  connection while the transaction holds SQLite's only one, and knex waits out
  `acquireConnectionTimeout` (60s). That hazard was re-verified against the current
  driver stack and is still live — `DatabaseLoader._find()` still does not thread
  the caller's transaction, `driver-sql` still models SQLite as a
  single-connection pool (`activeTransactions`, `assertBareKnexSafe`, the latter a
  dev/test guard that no-ops in production), and `plugin-audit` still threads the
  transaction by hand for the same reason. Skipping the cache would have traded one
  30s silent window for a fresh 60s stall per call.

  So the entry is still cached, but as what it is:

  - `listCache` entries carry a `degraded` flag, set when at least one loader threw
    while the result was being assembled. It lives on the entry rather than in a
    side table, so every reader can distinguish a complete answer from a partial
    one; entries are read through a single `readCachedList()` helper that applies
    the flag and its TTL in one place.
  - A degraded entry expires after **2s** (`DEGRADED_LIST_CACHE_TTL_MS`) instead of
    30s. The burst of repeated lookups inside one transaction is still absorbed —
    those are milliseconds apart — while the window in which a known-short set is
    served without re-asking anyone shrinks 15×, and recovery is noticed (and
    logged) within seconds of the store healing.
  - A complete read is unchanged: cached, not degraded, 30s TTL.
  - The outage message now names the degraded TTL as the retry interval, since it
    previously promised the 30s one.

  Also closes a `declared ≠ enforced` defect in the same field's comment: it claimed
  the cache kept "only positive (non-empty) hits or repeated hits with a stable miss
  signature". No such condition ever existed in `cacheListResult()`. The comment now
  describes the policy the code actually implements, and the behaviour it claims
  (an empty complete read _is_ cached) is pinned by a test.

  Internal caching policy only — no change to the `IMetadataService` contract or to
  any public export.

- 55da611: fix(metadata,objectql): stop restating the object name inside driver queries — and stop casting away the query's type to do it (#6231)

  `DriverQuery` (`Omit<QueryAST, 'object'>`) landed in #6076 and five drivers
  followed in #6075, but five **call sites** stayed as they were, because they
  were hidden behind a cast where the compiler could not see them. This removes
  the redundant key at all five and, with it, the casts that existed only to
  carry it.

  The redundant key was never the expensive half. `git grep 'query\.object' --
'packages/drivers/*/src'` is zero: no driver reads it, so the key itself was
  inert. **The cast was the cost.** `as any` on a query argument does not
  suppress one key — it switches off checking for `where`, `orderBy` and
  `fields` as well, which is precisely the account #5181's changeset opened
  (cloud#1053 measured 20 such sites; cloud#1030's `$like` — an operator the
  filter dialect does not have — survived compilation and reached the runtime
  through exactly this hole). `packages/metadata`'s `DatabaseLoader` is the
  main metadata read path, so it was the worst place to be running unchecked.

  The five sites:

  - `metadata` `DatabaseLoader._find` / `._findOne` / `._count` — each was
    `driver.find(table, { object: table, ...query } as any)`. The helpers now
    declare `query: DriverQuery` and hand it to the driver unchanged and uncast,
    so all nine of their call sites' `where` / `orderBy` / `fields` are checked
    again.
  - `objectql` `ObjectQL.resolveSecret` — the `sys_secret` read was
    `{ object: 'sys_secret', where: { id } } as QueryAST`, where the cast existed
    only to satisfy the AST's then-required `object`. Both are gone.
  - `objectql` `LifecycleService` governance counter — `count(obj.name,
{ object: obj.name })` carried no cast; it was admitted by a hand-written
    driver shape whose `query` was `Record<string, unknown>`, which would equally
    have admitted a `where` the dialect does not have. That shape is now the named
    `CountCapableDriver` typed with `DriverQuery`, and the call passes argument
    one only.

  No behaviour changes: the key was inert on every path, and the object name has
  always travelled as the driver methods' first argument. What changes is that
  these call sites are type-checked again, and that re-adding the key is now a
  compile error (`TS2353`) rather than something a cast quietly absorbs.

- 3c7bcc0: feat(spec)!: converge the 11 contracts-vs-domain dual-source type names (#4538)

  `packages/spec/src/contracts/` hand-wrote parameter/result interfaces whose
  names collided with same-named zod-derived types in the domains — the #4411
  trap, tracked as 11 rows of `dual-source-exports.baseline.json`. Each name was
  judged individually against a three-repo import-level scan (framework, cloud,
  objectui): which declaration actually flows at runtime decides the direction.
  All 11 rows are deleted from the baseline; no name below is exported twice
  anymore.

  **Converged — `./contracts` now re-exports the domain zod type (same
  declaration on both entries, imports keep compiling from either):**

  - `NotificationChannel` → `system/notification.zod`'s
    `z.infer<NotificationChannelSchema>` (member sets were identical).
  - `ValidationResult` → `kernel/plugin-validator.zod` (shapes were identical).
  - `HealthStatus` → `kernel/startup-orchestrator.zod` (`details` narrows
    `Record<string, any>` → `Record<string, unknown>`).
  - `PluginStartupResult` → `kernel/startup-orchestrator.zod`. FROM `plugin:
Plugin` (live object) and `error?: Error` TO the serializable projection
    (`plugin: { name, version? }`-passthrough, `error?: { name, message,
stack?, code? }`). Neither side had any consumer outside spec; the
    zod-validatable shape wins.
  - `StartupOptions` → `kernel/startup-orchestrator.zod` — the PARSED tier
    (defaults applied). `IStartupOrchestrator.orchestrateStartup` now takes
    `StartupOptionsInput` (the caller-authored all-optional tier, also
    re-exported from `./contracts`). Fix for callers typed to the old
    all-optional `StartupOptions`: rename to `StartupOptionsInput`.
  - `JobExecution` → `system/job.zod`. The system schema's `duration` field is
    RENAMED `durationMs` — that is what every job adapter produces and what the
    `sys_job_run.duration_ms` column round-trips; the schema described records
    nothing ever wrote. Fix: `duration` → `durationMs` when parsing
    `JobExecutionSchema` payloads.
  - `AnalyticsQuery` → `data/analytics.zod`. The domain schema aligned to the
    contract's semantics first: `timezone` LOST its `.default('UTC')` — absence
    is meaningful (the engine resolves org timezone, #1982/#2018; the
    `/analytics` entry always refused to apply that default). The schema is now
    transform-free, so `AnalyticsQuery` ≡ `AnalyticsQueryInput` (both kept
    exported). Fix for code that relied on `.parse()` injecting `timezone:
'UTC'`: pass the timezone explicitly or resolve it via the engine chain
    (`selection.timezone ?? context.timezone ?? 'UTC'`).

  **Renamed — two genuinely different concepts were sharing one name (both
  flow at runtime):**

  - `./contracts` `DriverCapabilities` → **`AnalyticsDriverCapabilities`**
    (`{ nativeSql, objectqlAggregate, inMemory }`, the analytics strategy-chain
    execution-path probe). The `DriverCapabilities` name now belongs solely to
    the data domain's driver feature-flag record (`DriverCapabilitiesSchema`,
    what `IDataDriver.supports` declares). Fix: importers of the trio from
    `@objectstack/spec/contracts` (or `@objectstack/service-analytics`, whose
    re-export is renamed in lockstep) rename the import; importers who meant
    the driver flags import `DriverCapabilities` from `@objectstack/spec/data`.

  **Removed — the domain-side declaration was dead (zero import-level consumers
  in framework/cloud/objectui; the #4411 family's last survivors):**

  - `system` `MetadataExportOptionsSchema` / `MetadataExportOptions` and
    `MetadataImportOptionsSchema` / `MetadataImportOptions` (the
    `output`/`source`-directory bags). The names now have ONE declaration each:
    the `IMetadataService.exportMetadata` / `importMetadata` parameter
    interfaces on `./contracts` (`types`/`namespaces`/`format` and
    `conflictResolution`/`validate`/`dryRun`), which `MetadataManager`
    implements. No tombstone/D2 conversion, deliberately — these are runtime
    option-bag types, not authorable metadata (same reasoning as #4458).
    `@objectstack/metadata` re-exports the two names from `./contracts` now
    (it previously re-exported the dead system-side shapes its own manager
    did not accept).
  - `system` `JobSchedule` (the `= Schedule` back-compat alias). The name's one
    declaration is the `IJobService.schedule` boundary shape on `./contracts`
    (plain-string cron `expression`); the authored metadata type keeps its real
    name `Schedule`. Fix: `import type { JobSchedule } from
'@objectstack/spec/system'` → `Schedule` (authoring tier) or the
    `./contracts` `JobSchedule` (service boundary), whichever you meant.

- 8b06bba: fix(spec): `EngineQueryOptionsSchema.search` accepts the bare query string ADR-0061 D1 calls canonical (#7178)

  Two sibling schemas in `packages/spec` described the same key and disagreed.
  `BaseQuerySchema.search` (`query.zod.ts`, hence `QueryAST`, hence `DriverQuery`)
  has been `z.union([z.string(), FullTextSearchSchema])` since its own drift
  repair, with a doc comment saying why: the bare string **is** the canonical
  Tier-1 contract (ADR-0061 D1 — "the client sends only the query text; the server
  resolves which fields to search from object metadata"), it is what every surface
  sends, and it is what the dogfood HTTP proof pins.
  `EngineQueryOptionsSchema.search` — the options type of `IDataEngine.find` /
  `findOne` — declared the structured `FullTextSearchSchema` **only**.

  The runtime never agreed with that narrowing. `expandSearchOnAst`
  (`objectql/src/engine.ts`) reads `search` through `normalizeSearch`, whose first
  line is `if (typeof raw === 'string') return { query: raw }`, and
  `protocol-data.test.ts` asserts the protocol layer hands the engine a bare
  string. So the type forbade what the engine serves, and callers paid the
  standard price: `as any` on the query argument — which does not suppress
  `search` alone, it switches off checking for `where` / `orderBy` / `fields` in
  the same literal. Since this schema is not `.strict()`, an unknown key there is
  **silently dropped**, so the cast this divergence forced was precisely the cast
  `check:query-options-erasure` exists to stop.

  This is the same-family drift REPAIR, not a new dialect — the identical fix
  `BaseQuerySchema.search` already carries, for the identical reason. On the query
  side the divergence surfaced as a validation failure the moment #3899 started
  validating request bodies; here it surfaced as a type error, when #6231 retyped
  `DatabaseLoader`'s read helpers to `DriverQuery` and the **engine** branch alone
  refused to compile (TS2345 — `DriverQuery` not assignable to
  `EngineQueryOptionsParsed`, purely because of `search`; nothing else differs).

  Consumer census before landing, per the card's own guard: every site that reads
  object-form members off an engine-options `search` already narrows with `typeof`
  — `engine.ts` (`typeof raw === 'object' ? raw?.fields : undefined`),
  `search-filter.ts` `normalizeSearch`, and `metadata-protocol/protocol.ts`'s
  `searchFields` ingress gate. No consumer needed a guard added, and none changes
  behavior: they were all written for the union already. `count` is untouched —
  `EngineCountOptionsSchema` declares no `search` key at all.

  With the schemas agreed, the casts the divergence forced are deleted:
  `DatabaseLoader`'s three engine-branch `as any` (`_find` / `_findOne` /
  `_count`), which restores real `where` / `orderBy` / `fields` checking on the
  metadata main read path, and the seven `as any` in
  `engine-findone-contract.test.ts` that were passing the canonical spelling.
  `scripts/query-options-erasure-baseline.json` is ratcheted down accordingly.

- 2b2175b: fix(metadata): an unreadable file is no longer announced as `data: null` (#5228)

  `NodeMetadataManager.handleFileEvent()` — the chokidar handler behind
  `watch: true` — wrapped its re-read in a `try/catch` that logged
  "Failed to load changed file" and returned without announcing. That `catch` was
  **unreachable for the failure it was written to catch**. `load()` is
  `(await loadDiagnosed(...)).data`, and `loadDiagnosed` (ADR-0110 D3)
  deliberately absorbs a loader throw: it records the message in `errors[]` and
  answers `{ data: null, degraded: true }`. `FilesystemLoader.load()` does throw
  on an unparseable file — the throw simply died one frame below the handler, so
  the `catch` never ran and the `logger.error` inside it never printed once.

  What went out instead was a watch event carrying `data: null`, which is the wire
  shape of "this metadata legitimately holds nothing". A file the loader could not
  read and a file the author had emptied reached every subscriber in exactly the
  same shape — the miss/outage distinction ADR-0110 D3 exists to preserve, erased
  at the one call site that had picked the variant which throws it away.

  The handler now reads through `loadDiagnosed` and splits on `degraded`:

  - **Degraded** (a loader threw and none answered — an unreadable or unparseable
    file): take the road the dead `catch` meant to take. Log `filePath`, the
    metadata type and name, and `loadDiagnosed`'s `errors[]`, and announce
    nothing. A developer who breaks a metadata file now gets told; before, the
    event claimed the definition had been emptied and nothing was logged.
  - **Clean miss** (`data: null`, no loader threw — the file is gone or
    legitimately empty): unchanged, announced exactly as before.
  - **Deleted** events never read, so a deletion can never be degraded and is
    always announced.

  Cache invalidation is unaffected and deliberately runs **before** the read, so
  the read's verdict can never decide whether the caches are dropped. #5218's
  contract holds in full: an unreadable file is still a real change to the stored
  set (`loadMany` skips it), so `listCache` and the `registry` entry still go, and
  the `api` endpoint index still rebuilds — `invalidateListCache` is that index's
  first invalidation seam (#5089), so suppressing the announcement costs it
  nothing.

  No in-repo subscriber loses invalidation or reload correctness: the endpoint
  index is covered by the seam above, `ObjectQLPlugin`'s `subscribe('object', …)`
  answers events by re-reading (an unreadable file yields nothing to re-read
  either way), and the email-template bridge falls through `event.data ?? get(...)`
  to the same empty result. One behaviour does change for the dev HMR/SSE stream:
  a file left permanently unparseable no longer wakes the Studio, which keeps
  showing the last known-good definition until the next event instead of watching
  it vanish.

- 729a43a: fix(metadata): 文件系统改动同样失效本节点的 `listCache`/`registry`,不再只叫醒 watcher (#5218)

  `NodeMetadataManager.handleFileEvent()` 在 chokidar 报告 `add` / `change` /
  `unlink` 之后只做两件事:重新 `load()` 一次文件内容,然后 `notifyWatchers()`。
  它既不碰 `listCache` 也不碰 `registry` —— 而 `load()` 是纯读路径(它委托给
  `loadDiagnosed`,后者只遍历 loader),两个缓存都不写。

  后果是**同一个 manager 的两个读接口互相矛盾**。手改 `rootDir` 下的
  `view/<name>.json` 之后:

  - `get(type, name)` 是新的 —— 它穿透到 `FilesystemLoader`;
  - `list(type)` 在 `LIST_CACHE_TTL_MS`(30 秒)窗口内继续返回改动前的清单 ——
    REST `/api/v1/metadata/:type`、Studio 左栏、`listViews()` 等一切走 `list()`
    的读都受影响。

  更糟的是被这次事件叫醒的消费者(Studio HMR/SSE 流、ObjectQL SchemaRegistry
  桥)正是通过回头拉 `list()` 来响应的,于是这次唤醒**递回了它自己刚刚宣告已失效
  的那份数据**。

  这与 #5109(集群对端写入不失效本节点缓存)是同一形状、不同触发源,因此复用该
  修复落地的 `invalidateForForeignWrite(type, name)`(可见性由 `private` 放宽为
  `protected`):文件改动正是「不是经由本 manager 写接口发生的写入」,没有任何东西
  替它刷新过缓存,delete-而非-预填 的语义也正好对上 —— 穿透回 loader 读到的就是
  文件的真相。

  两点与基类其余写路径一致的约束:

  - **先失效,再通知**(`register` / `unregister` / `applyRepoEvent` / 集群订阅者
    都是这个次序),使 watcher 不可能同时观察到事件与事件前的缓存;
  - **registry 条目一并删除**,不只是列表缓存。FS 加载的条目本来就不进 registry,
    通常无可删;但当同名条目此前被 `register()` / `registerInMemory()` 写过时,
    它在 `get()` 和 `list()` 中都会**遮蔽** loader,只删列表缓存会让那份陈旧副本
    一直应答下去。

  命中面主要是开发期:`MetadataPlugin` 默认 `watch: true`,在
  `bootstrap: 'artifact-only'` 下被强制关闭,`standalone-stack` 显式传
  `watch: false`。因此 artifact 模式的 `os dev` 与 standalone 不受影响,非 artifact
  的默认 `MetadataPlugin` 装配受影响。

  `type === 'api'` 的行为不变:端点索引此前已由 #5089 装的 `subscribe('api', …)`
  那条缝覆盖,本次改动把 `invalidateListCache` 那条缝也接上,两条缝对称。
  `EndpointMatcher.invalidate()` 是两次赋 `undefined`,重复失效幂等。

- f985b3f: fix(spec,core,cloud-connection,metadata): one HTTP contract, one canonical slot name — and the dead shadow copy that helped cause the false exemption is deleted (#4251)

  **`packages/core/src/contracts/` was a dead near-copy of the real contracts,
  and it is gone.** The directory (http-server.ts, data-engine.ts, logger.ts) had
  ZERO importers — no relative import, no subpath export, not a tsup entry;
  core's barrel has re-exported the `@objectstack/spec/contracts` versions all
  along ("Re-export contracts from @objectstack/spec for backward
  compatibility"). But the shadow had already **diverged** from the live
  contract (spec's `IHttpResponse` grew `write?`/`end?` and `IHttpRequest` grew
  `rawBody?`; the copy never did), so anyone who grepped their way into it read a
  stale contract that nothing enforces — the exact both-humans-and-AI failure
  mode behind the false `http.server` exemption (#4382). Deleting it is
  zero-risk by construction: nothing could reach it.

  **`http.server` is the canonical slot name, and the ledger now says so.**
  `ServiceSlotContracts` gains `'http.server': IHttpServer` plus the deprecated
  `'http-server'` alias entry (same instance — hono-plugin and qa's node-plugin
  register both two lines apart; cloud's two server entrypoints do the same).
  Canonical is the only name present on EVERY provider path: runtime's
  `config.server` path registers no alias, so the three cloud-connection plugins
  that read the alias alone (marketplace-proxy, runtime-config,
  marketplace-install-local) found an empty slot there — a live miss, now fixed:
  all readers go canonical-first with the alias as a fallback that dies with the
  alias registrations. The registrations themselves are untouched this release;
  both sites now carry the deprecation note.

  **`getRawApp?(): any` joins `IHttpServer`** — the deliberate framework-handle
  escape, declared once. Four consumers were each declaring it locally
  (cloud-connection ×2, metadata's HMR routes, cloud's serverless node-server);
  those local `RawAppHost`/`HttpServerWithRawApp` types are deleted. The `any`
  return is deliberate and documented at the single declaration: the handle's
  real type belongs to the framework, and naming it would give the contract a
  framework dependency. Adapters are not required to expose it; consumers
  feature-detect.

  **`IMetadataService.bulkRegister`/`bulkUnregister` declare the write options
  their implementation has always accepted.** `bulkRegister`'s contract options
  dropped the `MetadataWriteOptions` half its implementation intersects in
  (`notify` is destructured on the method's first line); `bulkUnregister`
  declared no options at all while the manager takes them. Same shape as the
  `IDataEngine` read-methods gap from B2: a caller typed to the contract could
  not reach the channel without erasing the lookup. Both additive; no implementor
  or caller breaks.

  Slot-lookup baseline ratchets 168 → 167 (marketplace-install-local's lookup
  typed while touched).

- 10575f3: fix(lint,metadata): revoke the `http.server` lint exemption — its stated reason was false (#4251)

  `http.server` was added to `UNCONTRACTED_SLOTS` in #4321 on the ground that
  "no IHttpServer contract exists". The contract does exist —
  `packages/spec/src/contracts/http-server.ts` — and eight call sites were
  already resolving the slot as `getService<IHttpServer>(…)` when the exemption
  was written. An exemption is a claim like any other, and this one rested on a
  premise nobody checked: the same shape as the gaps the rule exists to find.

  Revoked. That surfaced **9 erasures the exemption had been hiding** — 7 in
  files never grandfathered, 2 as count growth inside grandfathered ones, none of
  which the baseline could legally absorb. All typed to `IHttpServer`;
  `packages/metadata/src/plugin.ts` came out clean entirely, so the baseline
  ratchets **DOWN to 168 sites in 36 files** and loses a file.

  Two things confirmed on the way, reported rather than changed:

  **`http.server` and `http-server` are the same instance under two names.**
  plugin-hono-server and qa's node-plugin each register it twice, two lines
  apart; runtime's `config.server` path registers only `http.server`.
  `metadata/src/plugin.ts` reads both with a `??`, which is how it survived. No
  registration is removed here — that is a runtime-behaviour change and belongs
  with whoever picks the canonical name.

  **`IHttpServer` is defined twice and the two have already diverged.**
  `packages/spec/src/contracts/http-server.ts` (15 importers) declares `write?()`
  and `end?()`; `packages/core/src/contracts/http-server.ts` (8 importers) does
  not. Spec's is the superset and the one the ledger points at, so it is the
  source; core's is a stale near-copy and should re-export it. Left for its own
  change — collapsing a duplicated contract is not a lint fix.

  Also worth a note for whoever writes the wider HTTP contract: `getRawApp()` now
  has a **third** independent consumer (metadata's HMR routes, joining
  cloud-connection's two). It is deliberately absent from `IHttpServer` — the
  contract is framework-agnostic and the raw app is the framework's own handle —
  so each consumer names it locally. Three is enough evidence to decide whether
  that stays the right answer.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- 95b4f0d: fix(metadata): `list()` reads are single-flight, so the "one loader hit per TTL window" promise finally holds for concurrent callers too (#5253)

  `MetadataManager.list()` was a bare "read the cache → walk the loaders → write
  the cache" sequence. The cache is written only once a read has **finished**, so
  it absorbed the caller that arrived second in _time_ but never the caller that
  arrived second in _flight_: every `list(type)` issued while the first read was
  still walking the loaders missed, and each one walked every loader itself. The
  `listCache` field comment states the guarantee the cache exists to provide —
  "the loader is only hit once per TTL window" — and that guarantee held for
  sequential callers only.

  That is not a rounding error on the path the cache was built for. The comment
  names it: security/permission middleware calling `list('permission')` on the
  request path while `DatabaseLoader`'s read sits inside a transaction that holds
  SQLite's only connection, waiting out knex's `acquireConnectionTimeout` (60s).
  Every concurrent request arriving during those 60s used to burn its own 60s,
  because nothing had been written to the cache yet. The everyday version is
  milder but constant: cold start, and the small burst of concurrent `list()`
  calls that follows every invalidation point — `register()` / `unregister()`, a
  cluster peer's write (#5109), a filesystem change (#5218) — each repeated the
  full loader walk.

  Reads of one metadata type are now single-flight. A `list(type)` that finds a
  read already running for that type joins it instead of starting a second
  identical walk.

  - **Sharers share the outcome — as an explicit contract, not an accident.**
    Every caller joining an in-flight read receives that read's exact result,
    including when a loader was unreadable and the answer is known-partial.
    `list()` is the best-effort listing seam and does not throw (the strict
    counterparts remain `listForIndex()` and `loadDiagnosed()`), so a lost loader
    is not an error to fail over from — it is the answer, and re-running the read
    privately for a joiner would walk the same loaders against the same outage in
    the same window.
  - **#5184's degraded judgment is unchanged and is not bypassed.** A shared read
    that lost a loader is still memoized `degraded: true` on the 2s TTL, never
    laundered onto the 30s healthy TTL by having been shared, and every sharer
    received that same partial set.
  - **A write landing mid-read wins.** `invalidateListCache()` now retracts the
    in-flight read as well as the finished entry. The retracted read keeps running
    for the callers already waiting on it — they asked before the write — but it
    loses the right to memoize its pre-write answer, so that answer cannot outlive
    the write it predates; and a caller arriving after the write starts a fresh
    read rather than joining a pre-write one. That second half is #5219 / #5229's
    ordering bar restated for concurrency: a consumer woken by a metadata change
    must not observe the event and pre-event state together.
  - The in-flight map is self-cleaning — an entry is dropped when its read
    settles, by that read only, so a fresh read that replaced it keeps its slot.

  Internal caching policy only — no change to the `IMetadataService` contract or to
  any public export. Sequential callers behave exactly as before.

- f78dd83: fix(metadata,client): `subscribeMetadata` callbacks receive real `MetadataEvent`s — the producer now fulfils the declared contract (#4602)

  `@objectstack/spec/api`'s `MetadataEvent` declares top-level `id` (uuid,
  required), `metadataType`, `name`, `definition?`, `userId?` — and after
  #4587's convergence it is the **only** declared contract for realtime
  metadata-change events. But the producer (`MetadataManager`) published a raw
  `RealtimeEventPayload` envelope with everything nested under `payload` and no
  `id`/`userId`, while the client SDK force-cast that envelope into the callback
  (`callback(event as any as MetadataEvent)`). Subscribers who wrote
  `event.name` / `event.metadataType` — exactly what the types promised —
  compiled green and read `undefined` at runtime.

  Producer now fulfils the contract:

  - `MetadataManager.register()` / `unregister()` build a true `MetadataEvent`
    (generated uuid `id`, flattened top-level fields, `userId` when the write
    declares an actor) and validate it with `MetadataEventSchema.parse` before
    publishing. The transport envelope is unchanged (`RealtimeEventPayload`,
    with `payload` carrying the complete `MetadataEvent`).
  - A `register()` **overwrite now publishes `metadata.{type}.updated`** instead
    of a second `.created`, mirroring the existing `added`/`changed` watcher
    split. Previously `.updated` was declared with no producer at all.
  - `MetadataEventType` is a closed enum: metadata types outside it (e.g.
    `translation`) have no declared realtime event, so nothing is published for
    them (debug-logged) instead of emitting an event every schema-compliant
    consumer must reject.

  Consumer validates instead of casting:

  - `@objectstack/client`'s `subscribeMetadata` (and therefore
    `@objectstack/client-react`'s metadata hooks, which delegate to it) unwraps
    the envelope and runs `MetadataEventSchema.safeParse` at the boundary. An
    off-contract payload is rejected loudly (handler error, callback never
    invoked) — never coerced or passed through. The `as any as MetadataEvent`
    double-cast is gone.

  New seam: `MetadataWriteOptions.userId` (`@objectstack/spec/contracts`) lets
  write paths that know the acting user carry it into the published event's
  `userId`. Existing callers are unaffected — the field is optional and absence
  means "no human actor".

- 1c625ca: metadata: `getDiagnosed` — a metadata read that FAILED stops arriving as "nobody declared this"

  `MetadataManager.loadDiagnosed` computes the ADR-0110 D3 verdict (a MISS and an OUTAGE
  are different facts with opposite security meanings) and `get()` discarded it two hops
  later: `load()` kept only `.data`, `get()` turned that `null` into `undefined`. Every
  consumer of `get()` therefore received one `undefined` for two opposite facts and could
  not have told them apart even if it had wanted to.

  **New read.** `MetadataManager.getDiagnosed(type, name)` returns
  `{ data, degraded, errors }` — the registry-first counterpart of `loadDiagnosed`, declared
  as an optional member of `IMetadataService`. A registry hit is never degraded (it
  consulted no loader); a clean miss is never degraded (every loader answered).

  **`get()` is unchanged — zero breaking.** Same signature, same answer, same behaviour for
  every existing caller, including the microtask-level ordering `register()`'s watchers
  depend on. Only callers that ASK for the verdict pay for it. Making `get()` throw on
  `degraded` was deliberately not done: the boot path degrades on purpose.

  **Consumers switched**, each with a disposition argued for its own context rather than one
  blanket rule:

  - `getMetaItem` / `getMetaItemCached` — a degraded MetadataService read with nothing in
    the registry now raises `503 SERVICE_UNAVAILABLE` instead of falling through to
    `404 RESOURCE_NOT_FOUND`. This is the half that made the existing `#5532` comment ("
    reaching here now means a real miss") untrue.
  - `getMetaItemLayered` — the `code` layer joins the rule its `overlay` layer already
    followed. `code: null` is a positive claim, and `lockSource = code ?? overlay ?? {}`
    derives from it, so an outage could render an item the packager locked
    (`_lock: 'full'`) as `editable: true, deletable: true`.
  - `ObjectQLPlugin`'s `object` metadata-event refresh — logs `warn` naming the consequence
    (the registry keeps the previous definition; nothing retries) and the fix, instead of
    `debug` "metadata service has no fresh body". `warn` and not `error` because the write
    already landed; only a re-read failed.

  Hosts whose `metadata` slot is a shim that predates `getDiagnosed` are read as
  "not degraded" — exactly what they could express before — so their behaviour is unchanged.

- b5459bc: fix(metadata): `capabilities.write` now means BOTH directions — a writable datasource loader must implement `delete()` (#5276)

  `MetadataLoader` declared `save?` and no `delete`, so `capabilities.write` meant
  two different things at the two ends of an item's life: to `register()` it meant
  "persist into me", and to `unregister()` it guaranteed nothing at all.
  `unregister()` duck-typed `delete` at the call site and, when a loader had none,
  **silently skipped it** — then dropped the registry entry, invalidated the list
  cache and announced a `deleted` event anyway. The caller (Studio/Setup, REST
  DELETE, the CLI, a package teardown) was told the delete succeeded while the row
  stayed in the loader's store, was read straight back out by the next
  `list()`/`get()`, and survived every restart with nothing to retry it.

  Two changes, both making the declaration binding instead of decorative:

  - **`MetadataLoader` now declares `delete?(type: string, name: string): Promise<void>`.**
    The capability is stated on the contract, next to `save?`, instead of being
    guessed at by each caller. A loader implemented against the interface can now
    see that the method exists.
  - **`MetadataManager.registerLoader()` rejects the combination that cannot
    honour it.** A loader declaring `protocol: 'datasource:'` **and**
    `capabilities.write: true` **without** a `delete()` method is refused at
    registration with an error naming the loader, the consequence, and both
    repairs. `registerLoader()` is the sole writer of the loader map — the
    constructor's `config.loaders` funnel through it — so the combination can no
    longer reach the runtime and lose a deletion there.

  **Does this affect you?** Only if you register a custom metadata loader that
  declares `protocol: 'datasource:'` with `capabilities.write: true`. If it does
  and has no `delete()`, registration now throws where it previously succeeded and
  quietly discarded your deletions. Two ways to fix it, both stated in the error:

  1. implement `async delete(type: string, name: string): Promise<void>` on the
     loader, removing the item from its store (`DatabaseLoader` in this package is
     the reference implementation); or
  2. if the loader is genuinely read-only, declare `capabilities.write: false` — a
     read-only `datasource:` loader registers without complaint and is never
     written to in the first place.

  Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are
  unaffected in either direction: `MetadataManager` never persists to them at
  runtime, so it has no deletion of its own to take back, and they may declare
  `capabilities.write` without a `delete()` exactly as before. The one
  `datasource:` loader shipped in this package, `DatabaseLoader`, has always
  implemented `delete()` and is unchanged.

- 1624f4a: fix(metadata): `capabilities.write` now also binds `save()` — a writable datasource loader must implement both halves of the write (#5654)

  #5276 (shipped in v17.0.0-rc) made `capabilities.write` binding on `delete()`:
  a loader declaring `protocol: 'datasource:'` with `capabilities.write: true`
  and no `delete()` is refused at registration, because `unregister()` used to
  skip it silently and announce the deletion anyway. The gate stopped there, so
  **one declaration was binding at one end of an item's life and decorative at
  the other**.

  `MetadataManager.register()` had the identical hole one direction over. Its
  persistence loop read `loader.save &&` first, so a `datasource:` loader
  declaring `capabilities.write: true` **without** a `save()` method was
  **silently skipped** — no warn, no error. `register()` then wrote the in-memory
  registry, invalidated the list cache, announced `created`/`updated` and notified
  watchers, so the caller (Studio/Setup, REST PUT, the CLI, a package publish) was
  told the write succeeded. The item read back correctly for the life of the
  process and was **gone at the next restart**, with nothing to retry it — a
  durability degradation that leaves the system looking entirely healthy.

  `registerLoader()`'s gate (renamed `assertWritableLoaderContract`) now requires
  **both** `save()` and `delete()` for that combination, and rejects with one
  message naming which method is missing, the consequence, and both repairs.
  `registerLoader()` is the sole writer of the loader map — the constructor's
  `config.loaders` funnel through it — so the combination can no longer reach the
  runtime and lose a write there. The `save` short-circuit inside `register()`
  survives as defensive code whose unreachability is now guaranteed by
  construction, exactly like `unregister()`'s.

  **Does this affect you?** Only if you register a custom metadata loader that
  declares `protocol: 'datasource:'` with `capabilities.write: true`. If it does
  and has no `save()`, registration now throws where it previously succeeded and
  quietly discarded your writes. Two ways to fix it, both stated in the error:

  1. implement
     `async save(type: string, name: string, data: any, options?: MetadataSaveOptions): Promise<MetadataSaveResult>`
     on the loader, persisting the item into its store (`DatabaseLoader` in this
     package is the reference implementation); or
  2. if the loader is genuinely read-only, declare `capabilities.write: false` — a
     read-only `datasource:` loader registers without complaint and is never
     written to in the first place.

  Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are
  unaffected: `MetadataManager` never persists to them at runtime, so they may
  declare `capabilities.write` without a `save()`/`delete()` exactly as before.
  The one `datasource:` loader shipped in this package, `DatabaseLoader`, has
  always implemented both and is unchanged.

- 7c6261a: refactor(metadata): peel the stored envelope before an `api` row is parsed as an endpoint (#5309)

  Internal refactor — no authored format changes, no observable acceptance change
  for the shapes the platform stores today.

  A metadata _type name_ is worn by two different documents: the **authored
  declaration** (exactly its spec vocabulary) and the **stored row** (that
  declaration plus the metadata layer's own bookkeeping — `packageId`, `state`,
  `version`, `publishedDefinition`, `publishedAt`, `publishedBy`, written by
  `MetadataManager.register` / `publishPackage` and read back by `publishPackage`'s
  package filter). Both `ApiEndpointSchema` parse sites — `buildEndpointIndex` (the
  load-time backstop) and `gateApiItemsForPublish` (the publish gate) — used to hand
  the whole stored row to the schema, and only its unknown-key _stripping_ kept the
  bookkeeping from being judged as endpoint vocabulary.

  `peelStoredEnvelope` (`packages/metadata/src/stored-envelope.ts`) now takes the
  envelope off first, so the schema sees the authored body and nothing else:

  - a row carrying a `metadata` value IS an envelope around it — the body is that
    value, everything beside it is bookkeeping. This is the `data.metadata ?? data`
    rule the publish gate, `publishedDefinition` and `getPublished` already shared;
  - otherwise the body is the row minus the declared bookkeeping keys.

  The peel returns views and never mutates the row, so every existing envelope
  reader (`publishPackage`'s `packageId` filter, `query`'s `state` / `packageId`
  filters, `revertPackage`) is untouched, and `publishedDefinition` still snapshots
  `data.metadata ?? data` verbatim.

  One consequence worth naming: `buildEndpointIndex` was the last reader that did
  NOT follow the layer's body-selection rule, so a publish envelope
  (`{ name, packageId, state, metadata: {…} }`) used to pass the publish gate and
  then be excluded from the endpoint index — its route answered 404. The two doors
  now read the same document.

  This is the prerequisite for tightening `ApiEndpointSchema` (#5384): with the
  schema flipped to `strictObject` locally, `packages/metadata` went from 11 failing
  tests to 1, and the one left is an authored non-vocabulary key being refused by
  name — which is what that tightening is for.

- 1da39f5: fix(metadata): `isMissingTableError` no longer reads Postgres' write-path missing-COLUMN message as a missing TABLE (#6347)

  `isMissingTableError` is the single predicate that licenses a caller to treat a
  failed read as "the table is not provisioned yet, so there are genuinely no
  rows". Its own docblock names `column "x" does not exist` (SQLSTATE 42703) as a
  real failure that must stay loud — "a case where 'start numbering at 1' would be
  the wrong answer against a table that may be full of rows" — and the code did
  not honour that, in one direction only.

  Postgres has **two** missing-column phrasings:

  | path                              | message                                                | judged                        |
  | :-------------------------------- | :----------------------------------------------------- | :---------------------------- |
  | read (`SELECT`)                   | `column "bogus" does not exist`                        | correctly NOT a missing table |
  | write (`INSERT`/`UPDATE`/`ALTER`) | `column "label" of relation "sys_team" does not exist` | **wrongly** a missing table   |

  The write-path phrase contains a complete, legal missing-table phrase —
  `relation "sys_team" does not exist` — as a substring, so the table-scoped
  message test matched it. The code channel did not rescue it either: the matcher
  is a sequential OR, so an error carrying `code: '42703'` falls past both code
  lines and is decided by its message. The same superstring covers every other
  sub-object of a relation Postgres phrases this way, e.g.
  `constraint "uq_x" of relation "sys_team" does not exist` (42704).

  A message regex can never exclude a superstring, so the repair is a
  **front-exclusion** evaluated before any positive test: the column-level
  SQLSTATEs the docblock already names (`42703`, `42704`, `3D000`) and the
  `"x" of relation "y"` sub-object phrasing. Recognising one ends the question
  with `false` — it does not descend into `cause`, because an error that
  identifies as "a column of an existing relation" is that error whatever it
  wraps.

  What changes for you: a driver error of that shape now propagates instead of
  being silenced. Every consumer of the predicate is affected the same way, and
  all of them get louder rather than quieter — `DatabaseLoader.nextEventSeq` and
  `SysMetadataRepository`'s history counters no longer restart `event_seq` at 1,
  `ObjectQLEngine`'s autonumber seed no longer reseeds from 0, and the metadata
  loaders no longer answer "nothing declared". The set of errors judged benign
  shrinks; nothing that was loud becomes quiet. Genuine missing-table detection is
  unchanged for PostgreSQL, MySQL/MariaDB and the SQLite family.

- beefe89: fix(metadata): 历史序号 `event_seq` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4825)

  `DatabaseLoader.nextEventSeq()` 过去把读 `sys_metadata_history` 的**全部**失败折成同一个答案:

  ```ts
  } catch {
    // Table not provisioned yet or driver error — start at 1.
    return 1;
  }
  ```

  注释同时点名了两种原因,然后用同一个 `return 1` 对待。这是 #4728 刚修掉的同一种形状,但危害是
  **更贵的那一半**:#4728 是「字节没落盘」,本条是「**落盘的字节是错的**」。历史表里已经有 N 行时,
  一次瞬时读失败(连接抖动、超时、权限)会让下一条历史拿到 `event_seq = 1`,与既有行**直接撞号**,
  而 insert **成功**、日志**一行没有**。`event_seq` 正是历史列表排序与 rollback 定位的依据,撞号之后
  版本顺序就永久不可信 —— 重试不修、重启也不修。

  现在按**错误类型**判别,复用 #4728 落地的那套判别机制(`packages/metadata/src/utils/schema-sync-errors.ts`
  里新增的 `isMissingTableError()` 与既有 `isSchemaAlreadyExistsError()` 共用同一个 code / errno /
  message + `cause` 链匹配器,而不是在同一个包里另起一套错误判别):

  - **良性的「表还没建」**(SQLite `no such table: …`、Postgres SQLSTATE `42P01` /
    `relation "…" does not exist`、MySQL `ER_NO_SUCH_TABLE` / errno `1146`,并跟随 `cause` 链)——
    没有行,就没有可撞的号,`1` 确实是下一个号,静默返回。
  - **其余一切读失败** —— `nextEventSeq()` 原样抛出。调用方 `createHistoryRecord()` 以
    `console.error` 上报**后果**(该条历史记录未写入;元数据写入本身已成功,所以服务器仍报告健康,
    而变更历史正在悄悄出现空洞,版本时间线与 rollback 目标将不完整)、**为什么是空洞而不是错号**
    (从 1 发号会与既有行撞号,把「不完整」变成「顺序错误」,后者无人能发现)与**修复动作**,
    然后**跳过这条历史记录**。
  - 判别的方向刻意保守:凡是没有被正面识别为「表不存在」的,一律当作真实失败。`does not exist`
    本身不够 —— `role "…" does not exist`、`database "…" does not exist`、`column "…" does not exist`
    都是真实失败,对着一张可能满是行的表返回 1 正是要避免的事,所以消息匹配要求 table/relation 与
    该短语同现。

  两条边界保持不变:元数据写入本身**不**因此失败(记录已经落盘,把它报成失败是比原缺陷更糟的谎),
  以及本路径已知的并发撞号限制(非事务,canonical producer 仍是 `SysMetadataRepository`)——那是被
  记录过的限制,与「读失败静默重置到 1」是两回事。报告只说**一次**,恢复时补一条 `info`。

  无 API / schema 变更;新增内部工具 `isMissingTableError()`(未从包入口导出)。

- 4e9e184: chore(deps): OSV security batch — bump tar to ^7.5.21 (GHSA-r292-9mhp-454m) and
  js-yaml to ^5.2.2 (GHSA-pm4m-ph32-ghv5)

  Both are declared-range bumps to the patched releases, so downstream installs
  resolve the fixed versions from the published manifests, not just this
  workspace's lockfile. The same batch clears the remaining transitive advisories
  (next 16.2.11 in apps/docs; workspace overrides for brace-expansion, sharp,
  react-router, @sveltejs/kit, @hono/node-server) — those live in pnpm-workspace.yaml
  and the private docs app, which do not ship.

- d13004a: feat(core,runtime): plugin ordering is a declared, kernel-enforced contract (ADR-0116, #4131)

  `kernel.use()` registration order was never a contract — the kernel resolves
  init/start order from the plugin dependency graph — but a plugin that needed a
  service at init _when its provider is composed_ while also booting _without_
  the provider had no way to declare that. `AppPlugin` was the standing example:
  it grabs `manifest`/`objectql` synchronously in `init()`, declared nothing
  (a hard dependency would break empty-env / metadata-only / mock-engine
  kernels), and so its correctness rode on which array slot each caller put it
  in. That convention failed the same way twice (`DefaultDatasourcePlugin`'s
  first cut; then #4085, disguised for months as "crashes when the artifact is
  missing").

  The kernel `Plugin` contract gains three additive fields, enforced by both
  `ObjectKernel` and `LiteKernel` through one shared implementation
  (`plugin-order.ts` — the previously duplicated topological sort is unified
  there):

  - **`optionalDependencies: string[]`** — order-if-present: hoisted ahead
    exactly like `dependencies` when composed (real topology edges, including
    cycle detection), silently skipped when absent.
  - **`requiresServices: string[]`** — services resolved synchronously during
    `init()` with no fallback. Validated **before Phase 1**: a required service
    whose only declared provider initializes later fails the boot with an error
    naming both plugins, both slots, and the fix — before any init side
    effects. Re-checked immediately before the plugin's own init, where a still-
    missing service becomes a named composition error exactly where the old
    bare `Service not found` crash fired.
  - **`providesServices: string[]`** — services a plugin's `init()`
    unconditionally registers; powers the validation and the diagnostics.

  Plugins that declare nothing get the diagnosis too: a `getService` miss
  during Phase 1 now appends which plugin was initializing and — when a
  composed plugin declares the service — who provides it and how to declare the
  ordering. The `Service '<name>' not found` prefix and the factory-backed
  `is async - use await` message are unchanged.

  First adopters: `AppPlugin` declares
  `optionalDependencies: ['com.objectstack.engine.objectql']` +
  `requiresServices: ['manifest']` (cleared on the empty-env no-op path), so
  the #4085 composition — AppPlugin registered before the engine — now boots
  correctly in every slot; `ObjectQLPlugin` declares
  `providesServices: ['objectql', 'data', 'manifest', 'lifecycle']` and
  `MetadataPlugin` declares `providesServices: ['metadata']`.

  Everything is additive — plugins that declare nothing keep their exact
  ordering semantics; no existing declaration changes meaning.

- 91cefb8: refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

  Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

  正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

  **两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

  - `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
  - `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

  把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

  行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。

- 857a6cf: fix(cli,core,metadata,runtime): `os serve` boots with no compiled artifact — the platform does not need an application to start (#4085)

  The artifact (`dist/objectstack.json`) defines an **application**. ObjectStack is
  a development platform, so it has to start without one — but `os serve
objectstack.config.ts` died during boot whenever the artifact was absent:

  ```
    Loading objectstack.config.ts...
  [StandaloneStack] artifact read FAILED: path='…/dist/objectstack.json' error=ENOENT…

    ✗ Service 'manifest' is async - use await
  ```

  Exit 1 — on a **known-good app** (`examples/app-todo` fails the same way with
  only its `dist/objectstack.json` moved aside), and on every freshly authored
  project between `os init` and its first `os compile`. The message named neither
  the missing artifact nor a fix, so it read as an internal kernel fault.

  Three separate faults, each of which alone was enough to refuse the boot:

  - **`serve` registered the config-derived `AppPlugin` before the stack's own
    `plugins[]`.** Registration order _is_ the kernel's init/start order, and that
    slot sits ahead of `ObjectQLPlugin` (which registers `manifest`/`objectql`) and
    `DefaultDatasourcePlugin` (which connects the database the app seeds through).
    The wrap is now **appended** to `plugins[]`, the same slot
    `createStandaloneStack` gives its artifact-derived `AppPlugin` — so config-boot
    and artifact-boot share one plugin order. The artifact path never hit this,
    which is exactly what made a plugin-**order** bug look artifact-related.

  - **`ctx.getService()` reported a never-registered service as "is async".**
    `PluginLoader.getService` is an `async` method, so its return value is _always_
    a Promise and its internal "not found" rejection can never surface
    synchronously — the kernel read the answer off that Promise and told every
    caller to `await` a service that did not exist, while the `not found` branch
    below it was unreachable. It now decides from the registry: absent ⇒
    `[Kernel] Service 'x' not found`, registered-but-uninstantiated ⇒ the unchanged
    `Service 'x' is async - use await`. The same crash now reads
    `[Kernel] Service 'manifest' not found`, which points at the layer that is
    actually wrong.

  - **`MetadataPlugin` treated an absent `local-file` artifact as fatal.**
    `createStandaloneStack` always points it at `dist/objectstack.json`, so a stack
    with no app at all could not boot. A **missing** local artifact is now "nothing
    compiled yet": it logs, starts empty, and leaves the artifact watcher armed, so
    a later `os compile` hydrates the running server. The tolerance is
    ENOENT-only — a malformed or unreadable artifact stays fatal — and
    `bootstrap: 'artifact-only'` (sealed runtime, where the artifact _is_ the
    deployment) keeps failing loudly rather than silently serving an empty runtime.

  `[StandaloneStack] artifact read FAILED … ENOENT` is likewise no longer shouted
  at callers for whom "no artifact" is a healthy state; a present-but-unusable
  artifact keeps the loud warning.

  Pinned by an e2e pair that drives the real `os serve` with **no `os compile`
  anywhere**: an app defined only by `objectstack.config.ts` (asserting its object
  is in the started plugin set, not merely that boot survived) and a bare
  `export default {}` platform. The #4012 fixture drops the `os compile` this bug
  had forced on it.

- 3de535b: fix(metadata,repo): every enumeration of the stack-collection set is now answerable to `stack.zod.ts`, and the artifact map stops aiming `data:` at the analytics kind (#6242)

  `ObjectStackDefinitionSchema` decides which collections a stack may declare — 32
  of them today. **Seven** other places re-enumerate that same set by hand (eight
  enumerations in all, because ObjectQL declares its list twice), and nothing
  compared any of them to the schema or to each other:

  | Enumeration                                   | Site                                                  |
  | --------------------------------------------- | ----------------------------------------------------- |
  | `MAP_SUPPORTED_FIELDS` / `PLURAL_TO_SINGULAR` | `packages/spec/src/shared/metadata-collection.zod.ts` |
  | `MetadataCategoryEnum`                        | `packages/spec/src/kernel/package-artifact.zod.ts`    |
  | `metadataArrayKeys` ×2                        | `packages/objectql/src/engine.ts`                     |
  | `ARTIFACT_FIELD_TO_TYPE`                      | `packages/metadata/src/plugin.ts`                     |
  | `APP_CATEGORY_KEYS`                           | `packages/runtime/src/app-plugin.ts`                  |
  | `STACK_COLLECTION_COVERAGE`                   | `examples/app-showcase/src/coverage.ts`               |

  They had drifted independently: `ragPipelines` mapped in three of them though no
  schema declares it; `workflows` / `approvals` / `roles` / `profiles` / `policies`
  still iterated by both ObjectQL loops after ADR-0019 / ADR-0020 / ADR-0088 /
  ADR-0090 retired them; `triggers` + `workflows` still legal artifact categories;
  19 of 32 collections absent from that enum.

  Every row looks like a one-line typo in isolation, and each **has** been fixed
  one line at a time before — `docs` in `ARTIFACT_FIELD_TO_TYPE`, `roles` →
  `positions` in the same map, `capabilities` in `metadataArrayKeys` — each still
  carrying its "this key was missing and it silently dropped X" comment. The cause
  is structural: `KIND_COVERAGE` is answerable to the metadata-type registry and
  fails CI when a kind is added without an entry, and the liveness ledger is
  answerable to the same registry. The collection maps were answerable to nothing.

  **The gate.** `pnpm check:stack-collection-maps` (root
  `scripts/check-stack-collection-maps.mjs`, wired into the lint job) derives the
  collection set from `ObjectStackDefinitionSchema` — top-level keys whose value is
  `z.array(<X>Schema)`, a mechanical rule rather than a second hand-kept list — and
  reconciles all eight enumerations against it in **both** directions. Deriving them
  is not possible today (they disagree on purpose as often as by accident: `views`
  has no `name`, `data` seeds key by `object`, `translations` is a record), so each
  deviation must instead be a waiver row **carrying its reason**, and the list is a
  ratchet: a waiver that no longer applies fails, like a stale ledger row. An
  enumeration whose symbol cannot be extracted fails too — an empty list would
  reconcile against everything.

  Writing it immediately found a **seventh** site the hand-audit had missed
  (`APP_CATEGORY_KEYS`) and one divergence _between_ the two ObjectQL copies that
  neither list shows alone: `jobs`, `emailTemplates`, `tools` and `skills` are
  registered from a manifest and **not** from a nested plugin, so a package
  shipping them from a nested plugin registers nothing and stamps no ADR-0010
  provenance. `capabilities` was added to that copy for exactly this reason
  (#5870); nobody then asked what else the two lists disagreed about. Recorded as
  a waiver with the measurement, not fixed here — closing it changes what a nested
  plugin registers at boot.

  **The one code change**: `ARTIFACT_FIELD_TO_TYPE` no longer maps `data:` (the
  SEED collection) to `'dataset'` (the ADR-0021 analytics kind) — the exact name
  collision `metadata-plugin.zod.ts` warns about in prose. The entry was provably
  inert (`SeedSchema` declares no `name`, and the ingest loop skips nameless
  items), so nothing changes at runtime; what changes is that a dead pointer aimed
  at the wrong kind is gone, instead of waiting for either side to move. Not
  repointed at `'seed'`: seeds are applied by `SeedLoaderService` off the bundle,
  never registered as metadata items, so that would be new behaviour rather than a
  corrected name. The absence is now pinned by the gate.

  Everything else the gate reports is recorded as a waiver with its reason and left
  alone, deliberately — three of the drift rows sit on **acceptance faces**
  (`MetadataCategoryEnum` decides what a published artifact may declare) and the
  rest are `engine-core` behaviour changes owing their own verification. The value
  landing today is that all eight enumerations now have a checked relationship to
  the schema rather than an assumed one.

- 5d21a48: feat(spec,metadata-protocol,metadata,objectql,service-automation): stored metadata replays the full conversion chain at rehydration (#3903)

  Every mechanism the platform has for evolving the metadata contract — schema
  transforms, the ADR-0087 D2 conversion layer, the D3 migration chain, the
  protocol-17 tombstones — operated on **authored source** only. Metadata **at
  rest** (`sys_metadata` rows written by Studio or the runtime authoring APIs)
  was rehydrated unparsed and unconverted, so the authored and stored contracts
  silently diverged: a pre-17 row carrying `conditionalRequired` or `execute`
  read as whatever each ad-hoc consumer happened to do with it.

  **New spec primitive — `applyConversionsToStoredItem(type, item, options?)`**
  (exported from the package root). Wraps one stored item of a given metadata
  type and replays the **full** conversion chain over it — `retiredFromLoadPath`
  entries included, because retirement is an _authoring-surface_ event: the
  window exists to teach a live author, and a row at rest has no author to
  teach. Idempotent, never throws, never validates.

  Wired at every stored-row rehydration seam:

  - `metadata-protocol`: `loadMetaFromDb`, `getMetaItems` (active + draft
    preview), `getMetaItem` (active + draft), `getMetaItemLayered`, and
    `duplicatePackage` (a copy re-saves through the schema gate, so legacy
    sources now duplicate successfully — and the copy is canonical).
  - `metadata`: the DatabaseLoader's live-row reads (`load` / `loadMany`).
    History reads stay verbatim — history records what was written.
  - `objectql`: the authored-action / authored-hook direct table reads, so
    runtime-authored actions stored with the removed `execute` alias dispatch
    via `target` again.
  - `service-automation`: `AutomationEngine.registerFlow` now passes
    `includeRetired` — stored flows keep canonicalizing after their conversions
    graduate out of the load window. (The generic metadata seams deliberately
    skip `type: 'flow'`: flow conversions carry the open-namespace conflict
    guard, which needs this engine's live executor registry.)

  **Boot hydration diagnoses instead of shrugging.** `loadMetaFromDb` now
  returns `{ loaded, errors, invalid }`: each row is validated against its
  type's spec schema _after_ conversion, and a genuine contract violation is
  counted and warned with a stable `[metadata_spec_invalid]` marker — but still
  registered, deliberately: refusing at boot would unhook live tables and make
  the row unlistable and unfixable in Studio. The write path (`saveMetaItem` → 422) and the read-side `_diagnostics` envelope remain the enforcing gates; the
  `SchemaRegistry.registerItem` validation hook is now documented as exactly
  that diagnostic.

  **Retired accommodation.** With the chain running on every stored read path,
  the rule-validator's `requiredWhen ?? conditionalRequired` fallback — kept in
  #3883 with a retirement promise that had no mechanism — is deleted. If you
  call `evaluateValidationRules` directly with raw legacy field definitions,
  convert them first (`applyConversionsToStoredItem('object', def)`) or author
  `requiredWhen`; the platform's own read paths already hand you canonical
  shapes.

- dca25e1: fix(metadata-protocol): `SysMetadataRepository` 的 `event_seq` / `version` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4867)

  `SysMetadataRepository.nextEventSeq()` 与 `nextItemVersion()` 各有一个同形的 `catch`,把读
  `sys_metadata_history` 的**全部**失败折成同一个答案:

  ```ts
  } catch {
    // Table not provisioned yet (fresh DB) — start at 1.
    return 1;
  }
  ```

  这是 #4825 刚在 `DatabaseLoader`(TSDoc 自称 legacy、非事务的那条路径)上修掉的形状,原样长在
  **canonical 路径**上 —— #4825 正文把 `SysMetadataRepository` 称作「历史写入应当收敛过去的地方」。
  而且这里有两个数字:

  - **`event_seq`** —— 历史排序与 rollback 定位的依据。表里已有 N 行时,一次瞬时读失败(连接抖动、
    超时、权限)让下一条拿到 `1`,与既有行撞号;
  - **`version`** —— `nextItemVersion()` 的 TSDoc 明说它刻意从 history 取 MAX「so delete + recreate
    continues incrementing instead of restarting at 1」。一次读失败正好把它**恢复成它明确要避免的那个
    行为**:lineage 从 1 重启并与既有 lineage 撞号,而 `MetadataManager.rollback(type, name, version)`
    与 `POST /api/v1/meta/:type/:name/rollback` 正是按这个数字定位快照 —— 撞号之后回滚可能落到另一条
    记录的同号版本上。

  关键危害与 #4825 相同,是「**落盘的字节是错的**」而不是「字节没落盘」:insert 成功、日志一行没有、
  系统对外完全正常,重试不修、重启也不修。

  **「在事务里」并不能挡住它。** 事务解决的是*并发*撞号;它对「从一次失败的读推导出来的数字」没有任何
  意见,一个成功提交的事务照样把错号提交得同样持久。事务真正给出的是干净的补救:抛出去,整笔写入回滚,
  而不是提交一个编造的号。

  现在按**错误类型**判别,复用 #4825 落地的那套判别器(不另起一套):

  - **良性的「表还没建」** —— 没有行,就没有可撞的号,`1` 确实是下一个号,静默返回,fresh DB 照常启动;
  - **其余一切读失败** —— 按 AGENTS.md「Degradation log levels」以 `error` 上报**后果**(写入已被中止、
    事务回滚、什么都没提交;若按旧行为发 `1` 会与既有行撞号,使版本顺序不可信、回滚目标可能指向另一条
    记录的同号版本,且无人能发现、重启也修不回来)与**修复动作**(修数据源/驱动错误后重试写入),然后
    **原样抛出**,让事务回滚。一次故障只说一次,恢复时补一条 `info`。

  ### `@objectstack/metadata` 新增子路径导出 `@objectstack/metadata/errors`

  判别器 `isMissingTableError()`(#4728/#4825 家族)此前是 `@objectstack/metadata` 的内部工具,而本次
  消费者在另一个包。三个选项中选了「从现有归属地**显式导出**」:在 `metadata-protocol` 里复制一份会重建
  #4825 刚消灭的双源问题(同一个问题两套「哪些驱动错误算良性」的词汇表,谁先学会一个驱动怪癖谁就先漂移);
  下沉到公共依赖本轮不可行(`packages/spec` 冻结、`packages/types` 有并行改动),且本次导出并不妨碍维护者
  之后再下沉。

  新增的是一个**叶子子路径**而不是包入口导出:`@objectstack/metadata` 的根入口会拖进 manager、全部
  loader 与其 YAML/文件系统依赖,只为一个 40 行谓词付这个重量,正是把下一个作者推回「复制一份」的原因。
  `@objectstack/metadata/errors` 只 re-export 一个叶子模块,跨包依赖边因此仍是叶子边,也是将来下沉时
  一个可 grep、可删除的单点。仅导出 `isMissingTableError`;同族的 `isSchemaAlreadyExistsError` 在包外
  没有消费者,保持内部(导出一个无人 import 的符号是白许的承诺)。

  无 API 破坏、无 schema 变更、无 `packages/spec` 改动。

- 52d1a7d: Fix commit-revert answering `VERSION_NOT_FOUND` over a row `/history` lists, and the package-level revert route answering 500

  **Revert (`revertCommit` / `rollbackMetaItem`).** Both revert callers resolved their overlay repository from the caller's _active organization_, while the publish that recorded the commit routes each draft to the draft's **own** scope (the ADR-0005 / #3115 rule `SysMetadataRepository.listDrafts` states, and `publishPackageDrafts` already follows). So an env-wide artifact — what Studio and AI authoring write — published from a console request carrying an active org stored its `sys_metadata_history` rows at `organization_id = NULL` and was then read back at `organization_id = <org>`: no match, and the revert answered `VERSION_NOT_FOUND: No history row at version 2` for a version the history endpoint lists. The revert now resolves the scope the item's lineage actually lives in (the caller's own overlay first, env-wide second), per item for a batch revert. The same resolution reaches the `#6602` registry heal and the `#4636` package-binding read, which an org-scoped revert of an env-wide row was previously skipping while reporting success.

  **`POST /packages/:id/revert`.** The route now answers a declared 4xx instead of 500 (ADR-0112). The cause was entirely in the thrown shape, not the route: `MetadataManager.revertPackage` threw bare `Error`s carrying no `code` or `status`, and `errorFromThrown` — which the route's handler already reaches through one enclosing `catch` — falls back to 500 only when it finds neither. An unknown package id now answers `RESOURCE_NOT_FOUND` / 404 and a never-published package `RESOURCE_CONFLICT` / 409; 500 remains only as the fallback for a genuinely unexpected throw.

- 7309c81: test(runtime,client,metadata): back the remaining suites with in-memory SQLite instead of the mingo driver (#4065)

  Ten test files used `InMemoryDriver` as a convenience backing store — somewhere
  for rows to go while the suite proved something else (REST routing, datasource
  auto-connect, the batch `$ref` contract, metadata history). They now run on
  `SqliteWasmDriver` at `:memory:`, the same engine `@objectstack/verify`'s
  `bootStack` already gives the dogfood gate: pure JS (no native build, CI-safe on
  any runner) and real SQL semantics.

  The point is fidelity, not tidiness. Production runs SQL, and mingo differs from
  it in ways that let a suite pass while the behaviour it stands for is broken.
  Every failure this migration produced was a fixture defect the memory driver had
  been absorbing:

  - **Tables were never created.** `driver.create()` on the memory driver is a
    bare `table.push()` onto an auto-vivified array, so an object registered
    _after_ `kernel.bootstrap()` — which misses the boot-time schema sync — looked
    fine. On SQL the first write fails with `no such table`, which the REST error
    mapper turns into a **404 `OBJECT_NOT_FOUND`**: a routing-shaped symptom for a
    DDL-shaped cause. Four suites needed an explicit `syncObjectSchema`.
  - **A missing object declaration read as working.** `notifications.hono.integration`
    writes `sys_notification`, which `MessagingServicePlugin` does not declare —
    it is a platform object, and that lean kernel never booted `platform-objects`.
    Auto-vivification hid the omission entirely. The suite now registers the real
    `SysNotification` rather than a hand-copied stand-in, so there is still exactly
    one schema for it (Prime Directive #12).
  - **`connect()` was optional.** The memory driver needs none; a SQL driver does.

  What deliberately did NOT move: `read-coercion-conformance` keeps its two-driver
  matrix (proving a stored value reads back as its declared type on _both_ engines
  is the entire point of that gate), and the suites whose subject IS the memory
  driver or its wiring — `standalone-stack` (`memory://` scheme),
  `sqlite-driver-fallback` (the dev step-down), the CLI's driver-label tests, and
  driver-memory's own suite.

  `datasource-autoconnect` is in that second group as of #4083, which landed a
  regression test there for exactly the memory-pool property this PR originally
  proposed to migrate away from. Moving that file to SQLite would have left the
  new test passing vacuously — a wasm-SQLite pool never writes `.objectstack/` at
  all — so it stays on the memory driver and keeps guarding what it was written
  to guard.

  No new coverage is claimed here: each suite asserts exactly what it asserted
  before, against a more faithful store.

- e92e2c3: fix(metadata): `unregister()` invalidates the list cache AFTER the storage delete lands (#5259)

  `MetadataManager.unregister()` dropped the registry entry and called
  `invalidateListCache(type)` **before** awaiting `loader.delete()`. Those two steps
  are separated by a real await window — one DB round-trip per writable loader — and
  inside it the manager held a state that exists nowhere else: **registry already
  empty, loader not yet empty**. `list()` merges the two, so a read arriving in that
  window missed the just-cleared cache, assembled the still-stored row into its
  answer, and memoized it as a _complete_ read — the full 30s healthy TTL, because no
  loader threw and #5184's 2s degraded TTL therefore never applied.

  Nothing invalidated again once the delete landed (`notifyWatchers()` does not touch
  `listCache`), so an item that was gone from storage kept being enumerated for up to
  half a minute. `list()` is the enumeration seam behind `GET /api/v1/metadata/:type`,
  the Studio left rail, sync/export and every consumer that decides existence from a
  declared set — and `get()`, which never reads that cache, said the item was gone the
  whole time. For a gating type (`permission`, `api`) the two faces of one manager
  answered opposite questions about whether a declaration exists.

  **Fixed by ordering, not by an extra invalidation.** `register()` never had this
  defect because it writes the registry _first_ and the registry outranks every loader
  in the merge, so its own save window already shows the post-write state. The
  invariant is therefore not "invalidate early" but _invalidate last, once every store
  already holds the announced state_. `unregister()` now deletes from storage first,
  then drops the registry entry and invalidates with **nothing awaited between them**,
  then publishes and announces — #5219's invalidate-before-notify discipline unchanged.
  A `list()` racing the delete now either sees a coherent pre-delete state (the delete
  has not landed and has not been announced — that answer is the truth) or the
  post-delete state; it can no longer cache the pre-delete answer past the delete.

  This composes with #5253's single-flight rather than duplicating it: a read still
  _in flight_ when the delete lands cannot be reached by dropping `listCache` — it has
  not written its entry yet and would write the pre-delete answer afterwards.
  `invalidateListCache()` also retracts that read's `inflightListReads` registration,
  so it resolves for the callers already waiting on it but loses the right to memoize,
  while a caller arriving later starts a fresh read.

  **A storage delete that fails is now loud.** It used to `logger.warn('Failed to
delete …')` and continue. Per AGENTS.md "Degradation log levels" this is
  durability/consistency degradation, not functional: `unregister()` resolves
  normally, the caller is told the delete succeeded, and the surviving row is read
  straight back out of storage by the very next `list()`/`get()` — permanently, since
  nothing retries it. It now logs at `error`, once per un-deleted item, naming the
  consequence and the fix. The registry entry is still dropped in that case,
  deliberately: the loader still holds the row so the item is served either way, and
  keeping the entry would only pin an in-memory copy on top of a stored row nobody
  maintains — dropping it makes the next read fall through to storage, which is the
  actual truth after a failed delete, and makes it visible immediately instead of at
  the next restart.

  No API change. `unregister()` still resolves rather than throwing when a loader
  refuses the delete.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
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
- Updated dependencies [c44dd5e]
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
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [52200b4]
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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
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
- Updated dependencies [121852d]
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
- Updated dependencies [87aca93]
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
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
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
- Updated dependencies [32d3800]
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
- Updated dependencies [db0d53c]
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
- Updated dependencies [f598aa8]
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
- Updated dependencies [08f93bc]
- Updated dependencies [a1b66ef]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [c7e7900]
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
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [3670cf9]
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
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
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
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [a1686f9]
- Updated dependencies [ab07b53]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
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
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [fda61e4]
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
- Updated dependencies [4921a95]
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
- Updated dependencies [684ab22]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [db48ad5]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [65f184b]
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
- Updated dependencies [91cefb8]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
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
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [51a587d]
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
- Updated dependencies [e787608]
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
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [c073b8c]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
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
- Updated dependencies [d71ff32]
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
- Updated dependencies [9aa5510]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
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
- Updated dependencies [946a131]
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
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
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
  - @objectstack/platform-objects@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/metadata-core@17.0.0
  - @objectstack/metadata-fs@17.0.0

## 17.0.0-rc.6

### Major Changes

- 9960cd2: fix(metadata): remove the second, stale-keyed producer of `idx_sys_metadata_overlay_active` (#6771)

  **Breaking:** `addSysMetadataOverlayIndex` and its `AddSysMetadataOverlayIndexResult`
  type are removed from `@objectstack/metadata/migrations`. Nothing needs to replace
  them — see below.

  One index name, `idx_sys_metadata_overlay_active`, had **two** producers with
  **different** keys:

  | producer                                                                 | key                                                                                |
  | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
  | `metadata-protocol`'s `ensureMetadataOverlayIndexes` (runtime, ADR-0048) | `(type, name, organization_id, COALESCE(package_id, ''))` `WHERE state = 'active'` |
  | this package's `addSysMetadataOverlayIndex`                              | `(type, name, organization_id, environment_id, scope)`                             |

  The second key is the pre-ADR-0048 one. `environment_id` has been retired since
  ADR-0005 (2026-05 revision) — `saveMetaItem` no longer writes it and overlay reads
  never consult it, so it is NULL on every new row, and SQL UNIQUE treats NULLs as
  DISTINCT. `scope` is not part of the current discriminator at all. Both producers
  used `IF NOT EXISTS`, so whichever ran first claimed the name and the other
  silently became a no-op — decided by boot order, not by any declaration.

  Measured against real SQLite before removal:

  - On a normal `DatabaseLoader` boot the stored DDL is
    `` CREATE UNIQUE INDEX `idx_sys_metadata_overlay_active` on `sys_metadata` (`type`, `name`, `organization_id`, `package_id`) `` —
    the **declared** index from `metadata-core`'s `sys-metadata.object.ts`, materialized
    by `SqlDriver.syncDeclaredIndexes`, already holds the name with the current key.
    `addSysMetadataOverlayIndex` therefore changed nothing, while still returning
    `status: 'created'`.
  - In the one window where it was _not_ a no-op — the table present but its declared
    indexes not yet materialized, which the engine path hits by construction because
    ObjectQL's startup owns the sync — it installed the **retired** key. Since
    `syncDeclaredIndexes` skips by name, nothing ever repaired it afterwards, and
    overlay uniqueness was left unenforced on every new row.

  So the function could only ever do nothing or do harm. Overlay uniqueness keeps the
  two producers that are correctly keyed and deliberate: the runtime partial,
  NULL-safe index from `metadata-protocol`, and — for stacks assembled without it —
  the coarser unrestricted UNIQUE that the declaration in `metadata-core` materializes,
  exactly as that file documents.

  Both call sites in `DatabaseLoader.ensureSchema()` are gone with it, and the empty
  `catch` that surrounded the engine-path one now reports per the ADR-0120 D4 shape
  (name what did not happen, point at the fix, never block the boot) instead of
  swallowing driver-resolution failures.

  **Migration:** if you called `addSysMetadataOverlayIndex(driver)` directly, delete
  the call. Assemble `metadata-protocol` for the partial, active-scoped index, or rely
  on the declared index that `syncSchema` already builds.

  <!-- adr-0087: not-required (no-migration-prescription) what is removed is a TypeScript function export, not an authored metadata surface: no metadata key, no key spelling and no stored value moves, so `objectstack migrate meta` has nothing to rewrite and the ledger has no upgrader to reach. The index itself is unchanged in the only spelling that ever reached a database from a correct producer. Measured: the export had zero call sites outside its own package across objectstack, cloud and objectui. -->

### Patch Changes

- 55da611: fix(metadata,objectql): stop restating the object name inside driver queries — and stop casting away the query's type to do it (#6231)

  `DriverQuery` (`Omit<QueryAST, 'object'>`) landed in #6076 and five drivers
  followed in #6075, but five **call sites** stayed as they were, because they
  were hidden behind a cast where the compiler could not see them. This removes
  the redundant key at all five and, with it, the casts that existed only to
  carry it.

  The redundant key was never the expensive half. `git grep 'query\.object' --
'packages/drivers/*/src'` is zero: no driver reads it, so the key itself was
  inert. **The cast was the cost.** `as any` on a query argument does not
  suppress one key — it switches off checking for `where`, `orderBy` and
  `fields` as well, which is precisely the account #5181's changeset opened
  (cloud#1053 measured 20 such sites; cloud#1030's `$like` — an operator the
  filter dialect does not have — survived compilation and reached the runtime
  through exactly this hole). `packages/metadata`'s `DatabaseLoader` is the
  main metadata read path, so it was the worst place to be running unchecked.

  The five sites:

  - `metadata` `DatabaseLoader._find` / `._findOne` / `._count` — each was
    `driver.find(table, { object: table, ...query } as any)`. The helpers now
    declare `query: DriverQuery` and hand it to the driver unchanged and uncast,
    so all nine of their call sites' `where` / `orderBy` / `fields` are checked
    again.
  - `objectql` `ObjectQL.resolveSecret` — the `sys_secret` read was
    `{ object: 'sys_secret', where: { id } } as QueryAST`, where the cast existed
    only to satisfy the AST's then-required `object`. Both are gone.
  - `objectql` `LifecycleService` governance counter — `count(obj.name,
{ object: obj.name })` carried no cast; it was admitted by a hand-written
    driver shape whose `query` was `Record<string, unknown>`, which would equally
    have admitted a `where` the dialect does not have. That shape is now the named
    `CountCapableDriver` typed with `DriverQuery`, and the call passes argument
    one only.

  No behaviour changes: the key was inert on every path, and the object name has
  always travelled as the driver methods' first argument. What changes is that
  these call sites are type-checked again, and that re-adding the key is now a
  compile error (`TS2353`) rather than something a cast quietly absorbs.

- 8b06bba: fix(spec): `EngineQueryOptionsSchema.search` accepts the bare query string ADR-0061 D1 calls canonical (#7178)

  Two sibling schemas in `packages/spec` described the same key and disagreed.
  `BaseQuerySchema.search` (`query.zod.ts`, hence `QueryAST`, hence `DriverQuery`)
  has been `z.union([z.string(), FullTextSearchSchema])` since its own drift
  repair, with a doc comment saying why: the bare string **is** the canonical
  Tier-1 contract (ADR-0061 D1 — "the client sends only the query text; the server
  resolves which fields to search from object metadata"), it is what every surface
  sends, and it is what the dogfood HTTP proof pins.
  `EngineQueryOptionsSchema.search` — the options type of `IDataEngine.find` /
  `findOne` — declared the structured `FullTextSearchSchema` **only**.

  The runtime never agreed with that narrowing. `expandSearchOnAst`
  (`objectql/src/engine.ts`) reads `search` through `normalizeSearch`, whose first
  line is `if (typeof raw === 'string') return { query: raw }`, and
  `protocol-data.test.ts` asserts the protocol layer hands the engine a bare
  string. So the type forbade what the engine serves, and callers paid the
  standard price: `as any` on the query argument — which does not suppress
  `search` alone, it switches off checking for `where` / `orderBy` / `fields` in
  the same literal. Since this schema is not `.strict()`, an unknown key there is
  **silently dropped**, so the cast this divergence forced was precisely the cast
  `check:query-options-erasure` exists to stop.

  This is the same-family drift REPAIR, not a new dialect — the identical fix
  `BaseQuerySchema.search` already carries, for the identical reason. On the query
  side the divergence surfaced as a validation failure the moment #3899 started
  validating request bodies; here it surfaced as a type error, when #6231 retyped
  `DatabaseLoader`'s read helpers to `DriverQuery` and the **engine** branch alone
  refused to compile (TS2345 — `DriverQuery` not assignable to
  `EngineQueryOptionsParsed`, purely because of `search`; nothing else differs).

  Consumer census before landing, per the card's own guard: every site that reads
  object-form members off an engine-options `search` already narrows with `typeof`
  — `engine.ts` (`typeof raw === 'object' ? raw?.fields : undefined`),
  `search-filter.ts` `normalizeSearch`, and `metadata-protocol/protocol.ts`'s
  `searchFields` ingress gate. No consumer needed a guard added, and none changes
  behavior: they were all written for the union already. `count` is untouched —
  `EngineCountOptionsSchema` declares no `search` key at all.

  With the schemas agreed, the casts the divergence forced are deleted:
  `DatabaseLoader`'s three engine-branch `as any` (`_find` / `_findOne` /
  `_count`), which restores real `where` / `orderBy` / `fields` checking on the
  metadata main read path, and the seven `as any` in
  `engine-findone-contract.test.ts` that were passing the canonical spelling.
  `scripts/query-options-erasure-baseline.json` is ratcheted down accordingly.

- 7c6261a: refactor(metadata): peel the stored envelope before an `api` row is parsed as an endpoint (#5309)

  Internal refactor — no authored format changes, no observable acceptance change
  for the shapes the platform stores today.

  A metadata _type name_ is worn by two different documents: the **authored
  declaration** (exactly its spec vocabulary) and the **stored row** (that
  declaration plus the metadata layer's own bookkeeping — `packageId`, `state`,
  `version`, `publishedDefinition`, `publishedAt`, `publishedBy`, written by
  `MetadataManager.register` / `publishPackage` and read back by `publishPackage`'s
  package filter). Both `ApiEndpointSchema` parse sites — `buildEndpointIndex` (the
  load-time backstop) and `gateApiItemsForPublish` (the publish gate) — used to hand
  the whole stored row to the schema, and only its unknown-key _stripping_ kept the
  bookkeeping from being judged as endpoint vocabulary.

  `peelStoredEnvelope` (`packages/metadata/src/stored-envelope.ts`) now takes the
  envelope off first, so the schema sees the authored body and nothing else:

  - a row carrying a `metadata` value IS an envelope around it — the body is that
    value, everything beside it is bookkeeping. This is the `data.metadata ?? data`
    rule the publish gate, `publishedDefinition` and `getPublished` already shared;
  - otherwise the body is the row minus the declared bookkeeping keys.

  The peel returns views and never mutates the row, so every existing envelope
  reader (`publishPackage`'s `packageId` filter, `query`'s `state` / `packageId`
  filters, `revertPackage`) is untouched, and `publishedDefinition` still snapshots
  `data.metadata ?? data` verbatim.

  One consequence worth naming: `buildEndpointIndex` was the last reader that did
  NOT follow the layer's body-selection rule, so a publish envelope
  (`{ name, packageId, state, metadata: {…} }`) used to pass the publish gate and
  then be excluded from the endpoint index — its route answered 404. The two doors
  now read the same document.

  This is the prerequisite for tightening `ApiEndpointSchema` (#5384): with the
  schema flipped to `strictObject` locally, `packages/metadata` went from 11 failing
  tests to 1, and the one left is an authored non-vocabulary key being refused by
  name — which is what that tightening is for.

- 1da39f5: fix(metadata): `isMissingTableError` no longer reads Postgres' write-path missing-COLUMN message as a missing TABLE (#6347)

  `isMissingTableError` is the single predicate that licenses a caller to treat a
  failed read as "the table is not provisioned yet, so there are genuinely no
  rows". Its own docblock names `column "x" does not exist` (SQLSTATE 42703) as a
  real failure that must stay loud — "a case where 'start numbering at 1' would be
  the wrong answer against a table that may be full of rows" — and the code did
  not honour that, in one direction only.

  Postgres has **two** missing-column phrasings:

  | path                              | message                                                | judged                        |
  | :-------------------------------- | :----------------------------------------------------- | :---------------------------- |
  | read (`SELECT`)                   | `column "bogus" does not exist`                        | correctly NOT a missing table |
  | write (`INSERT`/`UPDATE`/`ALTER`) | `column "label" of relation "sys_team" does not exist` | **wrongly** a missing table   |

  The write-path phrase contains a complete, legal missing-table phrase —
  `relation "sys_team" does not exist` — as a substring, so the table-scoped
  message test matched it. The code channel did not rescue it either: the matcher
  is a sequential OR, so an error carrying `code: '42703'` falls past both code
  lines and is decided by its message. The same superstring covers every other
  sub-object of a relation Postgres phrases this way, e.g.
  `constraint "uq_x" of relation "sys_team" does not exist` (42704).

  A message regex can never exclude a superstring, so the repair is a
  **front-exclusion** evaluated before any positive test: the column-level
  SQLSTATEs the docblock already names (`42703`, `42704`, `3D000`) and the
  `"x" of relation "y"` sub-object phrasing. Recognising one ends the question
  with `false` — it does not descend into `cause`, because an error that
  identifies as "a column of an existing relation" is that error whatever it
  wraps.

  What changes for you: a driver error of that shape now propagates instead of
  being silenced. Every consumer of the predicate is affected the same way, and
  all of them get louder rather than quieter — `DatabaseLoader.nextEventSeq` and
  `SysMetadataRepository`'s history counters no longer restart `event_seq` at 1,
  `ObjectQLEngine`'s autonumber seed no longer reseeds from 0, and the metadata
  loaders no longer answer "nothing declared". The set of errors judged benign
  shrinks; nothing that was loud becomes quiet. Genuine missing-table detection is
  unchanged for PostgreSQL, MySQL/MariaDB and the SQLite family.

- 91cefb8: refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

  Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

  正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

  **两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

  - `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
  - `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

  把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

  行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。

- 3de535b: fix(metadata,repo): every enumeration of the stack-collection set is now answerable to `stack.zod.ts`, and the artifact map stops aiming `data:` at the analytics kind (#6242)

  `ObjectStackDefinitionSchema` decides which collections a stack may declare — 32
  of them today. **Seven** other places re-enumerate that same set by hand (eight
  enumerations in all, because ObjectQL declares its list twice), and nothing
  compared any of them to the schema or to each other:

  | Enumeration                                   | Site                                                  |
  | --------------------------------------------- | ----------------------------------------------------- |
  | `MAP_SUPPORTED_FIELDS` / `PLURAL_TO_SINGULAR` | `packages/spec/src/shared/metadata-collection.zod.ts` |
  | `MetadataCategoryEnum`                        | `packages/spec/src/kernel/package-artifact.zod.ts`    |
  | `metadataArrayKeys` ×2                        | `packages/objectql/src/engine.ts`                     |
  | `ARTIFACT_FIELD_TO_TYPE`                      | `packages/metadata/src/plugin.ts`                     |
  | `APP_CATEGORY_KEYS`                           | `packages/runtime/src/app-plugin.ts`                  |
  | `STACK_COLLECTION_COVERAGE`                   | `examples/app-showcase/src/coverage.ts`               |

  They had drifted independently: `ragPipelines` mapped in three of them though no
  schema declares it; `workflows` / `approvals` / `roles` / `profiles` / `policies`
  still iterated by both ObjectQL loops after ADR-0019 / ADR-0020 / ADR-0088 /
  ADR-0090 retired them; `triggers` + `workflows` still legal artifact categories;
  19 of 32 collections absent from that enum.

  Every row looks like a one-line typo in isolation, and each **has** been fixed
  one line at a time before — `docs` in `ARTIFACT_FIELD_TO_TYPE`, `roles` →
  `positions` in the same map, `capabilities` in `metadataArrayKeys` — each still
  carrying its "this key was missing and it silently dropped X" comment. The cause
  is structural: `KIND_COVERAGE` is answerable to the metadata-type registry and
  fails CI when a kind is added without an entry, and the liveness ledger is
  answerable to the same registry. The collection maps were answerable to nothing.

  **The gate.** `pnpm check:stack-collection-maps` (root
  `scripts/check-stack-collection-maps.mjs`, wired into the lint job) derives the
  collection set from `ObjectStackDefinitionSchema` — top-level keys whose value is
  `z.array(<X>Schema)`, a mechanical rule rather than a second hand-kept list — and
  reconciles all eight enumerations against it in **both** directions. Deriving them
  is not possible today (they disagree on purpose as often as by accident: `views`
  has no `name`, `data` seeds key by `object`, `translations` is a record), so each
  deviation must instead be a waiver row **carrying its reason**, and the list is a
  ratchet: a waiver that no longer applies fails, like a stale ledger row. An
  enumeration whose symbol cannot be extracted fails too — an empty list would
  reconcile against everything.

  Writing it immediately found a **seventh** site the hand-audit had missed
  (`APP_CATEGORY_KEYS`) and one divergence _between_ the two ObjectQL copies that
  neither list shows alone: `jobs`, `emailTemplates`, `tools` and `skills` are
  registered from a manifest and **not** from a nested plugin, so a package
  shipping them from a nested plugin registers nothing and stamps no ADR-0010
  provenance. `capabilities` was added to that copy for exactly this reason
  (#5870); nobody then asked what else the two lists disagreed about. Recorded as
  a waiver with the measurement, not fixed here — closing it changes what a nested
  plugin registers at boot.

  **The one code change**: `ARTIFACT_FIELD_TO_TYPE` no longer maps `data:` (the
  SEED collection) to `'dataset'` (the ADR-0021 analytics kind) — the exact name
  collision `metadata-plugin.zod.ts` warns about in prose. The entry was provably
  inert (`SeedSchema` declares no `name`, and the ingest loop skips nameless
  items), so nothing changes at runtime; what changes is that a dead pointer aimed
  at the wrong kind is gone, instead of waiting for either side to move. Not
  repointed at `'seed'`: seeds are applied by `SeedLoaderService` off the bundle,
  never registered as metadata items, so that would be new behaviour rather than a
  corrected name. The absence is now pinned by the gate.

  Everything else the gate reports is recorded as a waiver with its reason and left
  alone, deliberately — three of the drift rows sit on **acceptance faces**
  (`MetadataCategoryEnum` decides what a published artifact may declare) and the
  rest are `engine-core` behaviour changes owing their own verification. The value
  landing today is that all eight enumerations now have a checked relationship to
  the schema rather than an assumed one.

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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [121852d]
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
- Updated dependencies [a1b66ef]
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
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [ab07b53]
- Updated dependencies [a954634]
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
- Updated dependencies [684ab22]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
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
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
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
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/metadata-core@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/metadata-fs@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

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
  - @objectstack/metadata-core@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5
  - @objectstack/metadata-fs@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- ecc61ab: feat(metadata): 端点匹配器 —— `MetadataManager.matchEndpoint` 惰性索引实现 (#5089)

  `IMetadataService.matchEndpoint?` 的契约在 #5080/#5097 落地(声明先行),本变更补上
  `metadata` 槽位占位者 `MetadataManager` 的实现:把已声明的 `api` 元数据条目编成
  **METHOD → 精确路径 → 端点** 的惰性索引,供 HTTP 分发器在「没有内建域认领这条路径」
  与「回答语义 404」之间做一次查表。这是 #5040 端点执行器程序的 E2 单。

  **结构性不可达,零行为变更。** 17.x 里没有任何东西会调用 `matchEndpoint`:挂载 seam
  是 #5090 的面,而 publish/validate 对非空 `apis:` 仍然硬拒(#4936)。新代码在真实组合
  里不暴露任何 HTTP 行为;测试直接驱动服务,这正是 #5040 设计选定的验收姿态。

  实现要点(逐字实现契约文本,`packages/spec/src/contracts/metadata-service.ts`):

  - **匹配维度**:`method` 大写规整后比较(请求动词大小写不敏感);`path` 去掉**一个**
    尾斜杠后**整串精确**比较,两侧同规则。17.x 不做百分号解码、不做 Unicode 规整、
    不做大小写折叠 —— 原串即键。词表(ADR-0121)未定义任何路径模板语法,因此
    `params` **恒为 `{}`**;此处不发明只存在于实现里的方言。
  - **答案是 parse 后的形状**:每条经 `ApiEndpointSchema.safeParse`,默认值已物化 ——
    作者省略 `authRequired` 时消费方拿到的是 `true`,不可能把「缺省」误读为放行。
  - **坏条目响亮缺席**:解析失败的存量条目被跳过并以 `error` 级点名(说明该路由将回 404
    及如何修),绝不返回半合法形状,也绝不牵连同批的好条目。
  - **重复声明确定性收敛**:两条条目声明同一 METHOD+path 时,`name` 字典序在前者保留
    路由,被弃者连同规则一并 `error` 级点名 —— 不是静默 last-write-wins,每个节点、每次
    启动的解析结果一致。
  - **断存储抛错,不伪装 404**:`undefined` 只表示「无声明拥有这条路由」;读不到存储时
    抛出(与 `loadDiagnosed` 的 miss/outage 之分同源,ADR-0110 D3),因为 miss 会变成
    404,而故障不得伪装成 404。构建失败不缓存,下次调用重试。
  - **失效**:挂在仓内既有机制上,不新造事件系统 —— `invalidateListCache('api')` 覆盖
    全部本地写入(含 artifact 装载 / HMR 的 `{ notify: false }` 写入,这些按构造不经过
    watcher),`subscribe('api', …)` 覆盖集群对端回放(它只经 `notifyWatchersLocal`)。
    失效后下次调用整体重建。

  `ApiEndpointSchema` 与 `packages/spec` 未做任何改动(词表冻结)。

- c52e608: fix(metadata,spec): the endpoint publish gates now guard the metadata write path too (#5189, #5040 E7b)

  #5111 (E7) hung the five per-endpoint `apis:` gates on
  `ObjectStackDefinitionSchema`, which every path that parses a **stack** runs
  through — `defineStack`, `os validate`, the lint scorer, artifact ingest,
  `EnvironmentArtifactSchema.metadata`. #5189 proved a stored `api` item need
  never have been part of a stack: `MetadataManager.publishPackage`, a direct
  `metadata.register()` and a Studio metadata write each mint one item at a time
  and saw no gate at all.

  Three of the five gates degrade safely when bypassed — the executor answers a
  structured 501 naming the item, and a path outside the `apps/<namespace>/`
  carve-out simply matches nothing. **ADR-0121 D6 has no runtime counterpart**:
  the runtime honours `authRequired: false` faithfully and `deriveBucketConfig`
  returns `null` for a budget whose `enabled` is not `true`, so the bypass minted
  an anonymous, zero-quota execution entry point — the exact shape D6 exists to
  forbid.

  Two doors now, both running the SAME gate function rather than a second copy of
  the criteria:

  - **Publish** — `MetadataManager.publishPackage` runs
    `validateApiEndpointDeclarations` over the package's `api` items and fails
    the publish, naming each endpoint and the key to fix, on the same
    `validationErrors` surface it already uses. This pass is **not** governed by
    `options.validate`: an opt-out on a security gate is the bypass this fixed.
  - **Load** — the endpoint matcher's index build re-applies the _identity-free_
    subset (supported subset, mapping, policy/D6) to every stored item. A
    declaration that never passed publish is EXCLUDED from the index and named at
    `error` level, so a bypassed endpoint answers 404 with a loud log instead of
    answering anonymously and unmetered. The namespace and uniqueness gates are
    deliberately not applied there — both need a stack identity a stored row does
    not carry.

  **New in `@objectstack/spec/api`** (the module was package-internal in #5111,
  whose only consumer was one file away):
  `validateApiEndpointDeclarations`, `identityFreeEndpointGateFailure`,
  `EndpointGateIssue`, `EndpointGateIdentity`.

  **New option — `publishPackage(id, { namespace })`.** `MetadataManager` indexes
  items by `packageId` and carries no manifest, so it cannot prove a namespace on
  its own and will **not** infer one from the items it is judging (an
  author-supplied value would make the ADR-0121 D1/D2 carve-out gate vacuous).
  Callers that hold the package manifest pass its explicit `manifest.namespace`;
  without it the namespace gate fails and the package's `api` items do not
  publish — which is the rule, not a limitation: a publish that cannot prove a
  namespace must not mint a URL under one. Packages that declare no `api` items
  are untouched.

### Patch Changes

- d21c001: feat(spec)!: declarative `apis:` publishes again — the blanket refusal narrows to per-endpoint publish gates, and declared endpoints go LIVE (#5111, #5040 E7)

  ⚠️ **Read this as a security note, not a schema note.** Declarative endpoints
  **execute** from protocol 17. Before this release the surface was inert end to
  end — nothing mounted a declared `path`, no matcher existed, and every key
  including `authRequired` parsed green and gated nothing — which is why #4936
  refused a non-empty `apis:` outright. The #5040 E-series built the executor
  (mount seam, endpoint matcher, policy keys, execution targets, mapping keys,
  OpenAPI enrichment), so the refusal's premise is gone and keeping it would be
  the lie in the other direction.

  ## BREAKING — the refusal narrows, and what passes it is served

  `apis: [ …endpoints… ]` no longer fails wholesale. Each entry is now gated
  individually, and **an endpoint that passes the gate is mounted and answers
  real requests as soon as the stack is published.**

  **Before you upgrade, review every historical `apis:` block** — including any
  you restored, generated from an older doc, or left in place because it was
  known to do nothing. Pay particular attention to any entry that explicitly
  declares **`authRequired: false`**: the schema default is `true`, so an
  _omission_ is safe and needs no review, while an explicit `false` is the only
  thing that opens **anonymous** access to that endpoint. ADR-0121 D6 now pairs
  it with a mandatory armed rate limit — and "armed" means
  `rateLimit: { enabled: true, … }`, because `enabled` defaults to `false`, so a
  budget written without it meters nothing.

  ## The gates, each rejecting with its own prescription

  | gate                           | rejected shape                                                                                                                                                                                                                                                                  |
  | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **namespace** (ADR-0121 D1/D2) | a `path` that is not `/api/v1/apps/<manifest.namespace>/<subpath>`, or a stack that declares `apis:` without an explicit `manifest.namespace` (no derivation from `manifest.id`)                                                                                                |
  | **supported subset**           | `type: 'script'` / `'proxy'`; an `object_operation` missing `objectParams.object` or `.operation`; a `flow` with an empty `target`                                                                                                                                              |
  | **mapping**                    | any `transform`; an unusable `source`/`target` path (empty, empty segment `a..b`, `__proto__`/`prototype`/`constructor`); two entries whose `target`s collide (same path, or one inside another); `inputMapping` on a `find`/`get`/`delete` operation, which never reads a body |
  | **policy**                     | `authRequired: false` without `rateLimit.enabled === true`; an armed budget with `maxRequests`/`windowMs` ≤ 0; a negative `cacheTtl`; `cacheTtl` on a non-GET method                                                                                                            |
  | **uniqueness**                 | two endpoints in one stack claiming the same METHOD + path (one trailing slash trimmed, the matcher's own rule)                                                                                                                                                                 |

  **FROM → TO.** `path: '/api/v1/<anything>/thing'` →
  `path: '/api/v1/apps/<manifest.namespace>/thing'`, with `manifest.namespace`
  declared explicitly. `authRequired: false` → either delete the key (the safe
  default `true` applies) or keep it **and** add
  `rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 }`. Every other
  key is unchanged: the `ApiEndpoint` vocabulary is frozen — this release adds,
  removes and renames nothing on it. The gates are validation logic over the keys
  that already existed.

  The runtime keeps its own refusals for a declaration that reached the store
  without passing publish (a direct `metadata.register()`), so the two ends agree:
  what publish accepts is exactly what the executor serves.

  `normalizeEndpointPath` is now exported from `@objectstack/spec/api` and is the
  one canonical form of a declared path — the publish gate and the endpoint
  matcher (`@objectstack/metadata`) read the same rule instead of each carrying a
  copy, so a stack can never publish a duplicate the matcher would silently
  resolve to a single winner.

- 533a0a4: fix(metadata): 集群对端的元数据写入现在会失效本节点的 `listCache` / registry (#5109)

  多节点部署下,节点 A 改一条 `view` / `permission` / `flow`,节点 B 收到
  `metadata.changed` 广播后**只叫醒了 watcher,却没有失效自己的缓存**。
  `attachClusterPubSub()` 的订阅回调此前只做一件事 —— `notifyWatchersLocal()`,
  既不碰 `this.registry` 也不碰 `this.listCache`。后果是 B 上任何走 `list(type)`
  的读在 `LIST_CACHE_TTL_MS`(30 秒)窗口内继续返回改动前的清单;更糟的是,被叫醒的
  watcher(ObjectQL SchemaRegistry 桥、Studio HMR SSE)如果回头调 `list()` 重新拉取,
  拉到的还是旧的 —— 一份「失效通知」附带着失效数据。单机部署完全无感,只有多节点才暴露。

  这与该通道自己声明的用途相反(`ClusterMetadataChangedPayload`:"consumed by peers
  to **invalidate their local caches**",另见 `content/docs/kernel/cluster.mdx` §6.2
  与 `metadata-lifecycle.mdx`);现在实现与声明一致。

  修法沿用同文件里 `applyRepoEvent()` 自 ADR-0008 PR-6 起就用对的那条路径,并把两条
  「外部写入」缝(仓库 watch 循环、集群对端回放)收敛到同一个私有方法
  `invalidateForForeignWrite(type, name)`:

  - **删除而不预填。** 即便事件带着 body,也只删除 registry 条目而不写入 ——
    那份 body 是别人那次写入的快照,可能已被后续写入取代,预填会与真实 head 竞态,
    并要求我们去规范化一份自己没有加载过的定义。删除后 `get()` 自然穿透到 loader /
    repository,也就是真相所在。
  - **同步失效,先失效再通知。** 失效发生在收到消息的当拍(不在 `setImmediate` 内),
    通知仍然延迟派发。`setImmediate` 的存在理由是不让**消费方的 watcher 回调**背压
    pubsub 派发循环;而失效只是两次 `Map.delete`,不执行任何消费方代码,没有需要延迟的
    东西——把它一起延迟只会留下「已收到广播、尚未失效」的读窗口,请求处理器里任何一个
    `await` 都足以撞进去。先失效后通知也与本文件其他写入路径
    (`register` / `unregister` / `applyRepoEvent`)一致,于是回头 `list()` 的 watcher
    拿到的是写后清单。
  - **无名事件只失效清单缓存。** `MetadataWatchEvent.name` 在 spec 里是可选的,无名事件
    无法定位 registry 条目;此时不会把整个 type 的 registry 一并清掉 —— 那会驱逐
    `registerInMemory()` 注册的、任何 loader 都无法恢复的代码态构件(如 `origin:'code'`
    的 datasource)。

  回环抑制(`originNode`)仍然先于失效判断,本节点自己的广播不会让自己白白重建缓存。

- 3133cda: fix(metadata): `DatabaseLoader` 的读故障不再被吞成「什么都没声明」(#5108)

  `DatabaseLoader` 的五个读方法此前都把**任何**存储异常 `catch {}` 成各自的空值 ——
  `load` → `null`、`loadMany` → `[]`、`exists` → `false`、`stat` → `null`、
  `list` → `[]`。于是 `sys_metadata` 所在库不可达时,`loadMany('permission')` 与
  「这个环境一条 permission 都没声明」返回**完全一样的值**,而且异常是在 loader 内部
  就被抹掉的:`MetadataManager` 那几个 `try/catch` 降级分支拿到的是一次「成功的空读」,
  根本不会触发,整条链上没有任何一处会说出「读失败了」。

  现在按**错误类型**判决(#4632 立的规矩,#4728 / #4825 已经在同一个文件里用过两次的
  形状,判据复用现成的 `isMissingTableError`):

  - 唯一良性的失败原因是 `sys_metadata` 尚未 provisioned —— 那时确实没有行,
    「什么都没声明」就是事实,首次启动照旧返回空值、不报错、不缓存;
  - 其余全部原因(连接断开、超时、权限不足、查询出错)意味着行还在、只是这次没读到,
    一律把驱动原始异常**原样抛出**,由调用方决定降级姿态。判据保守:无法正面识别为
    「表不存在」的错误一律当作真故障。

  由此上层三个已有的机制第一次真的生效:

  - `MetadataManager.list()` 的降级分支会真的进,并且**升级到 `error`**
    (AGENTS.md「Degradation log levels」:系统看着正常、它声称掌握的清单其实是残缺的),
    日志写明后果与修法,每次故障只说一次、恢复时再说一次;`list()` 仍然尽力返回可读
    loader 的内容 —— 这个 best-effort 姿态是刻意保留的。兄弟方法
    `MetadataManager.loadMany()` 的同一条缝走同一个判决,不让同一次故障在同一个文件里
    报出两个级别;
  - `MetadataManager.loadDiagnosed()`(ADR-0110 D3)对 `DatabaseLoader` 终于能报出
    `degraded` / `errors`,而不是把 outage 报成 miss;
  - `listForIndex()` / `matchEndpoint`(#5089)契约要求「读不到存储必须抛出,不得伪装成
    miss(miss 会变成 404)」—— 这条此前对 `MemoryLoader` / `RemoteLoader` 有效、对
    `DatabaseLoader` 无效,现在对真实的 datasource loader 也成立了。

  **行为变化**:`MetadataManager.exists()` 与 `listNames()` 本来就没有 `try/catch`,
  所以存储故障现在会从它们抛出,而不再静默答「不存在」/「空清单」。这正是本次修复要的
  姿态 —— 可用性故障不是一次「没有」。

- c794f78: fix(metadata): a known-partial `list()` result is cached as degraded, on a 2s TTL instead of 30s (#5184)

  Since #5108 a loader that cannot read its store throws rather than answering
  `[]`, so `MetadataManager.list()` catches, reports the outage once at `error`,
  and keeps serving what the reachable loaders hold. That best-effort posture is
  deliberate. What was not deliberate is what happened on the next line: the
  known-short result went into `listCache` on the same 30s TTL as a complete read,
  with nothing on the entry to say it was partial.

  The consequences were all invisible from outside. That one `error` line covered a
  **30s window in which the failing loader was never asked again** — no retry, no
  second signal, the manager simply re-served a set it already knew was short. When
  the store came back, nothing noticed for up to another 30s, so #5108's recovery
  line (`reportLoaderReadRecovered`) arrived that late too. And because the entry
  carried no marker, no consumer of the cache — including that once-only report —
  could tell a partial answer from a complete one.

  Not caching degraded reads at all was considered and rejected on evidence. The
  `listCache` field comment records why the cache exists: security middleware
  calling `list('permission')` from inside a user-initiated DB transaction, where
  `DatabaseLoader`'s `engine.find('sys_metadata', …)` tries to take a second knex
  connection while the transaction holds SQLite's only one, and knex waits out
  `acquireConnectionTimeout` (60s). That hazard was re-verified against the current
  driver stack and is still live — `DatabaseLoader._find()` still does not thread
  the caller's transaction, `driver-sql` still models SQLite as a
  single-connection pool (`activeTransactions`, `assertBareKnexSafe`, the latter a
  dev/test guard that no-ops in production), and `plugin-audit` still threads the
  transaction by hand for the same reason. Skipping the cache would have traded one
  30s silent window for a fresh 60s stall per call.

  So the entry is still cached, but as what it is:

  - `listCache` entries carry a `degraded` flag, set when at least one loader threw
    while the result was being assembled. It lives on the entry rather than in a
    side table, so every reader can distinguish a complete answer from a partial
    one; entries are read through a single `readCachedList()` helper that applies
    the flag and its TTL in one place.
  - A degraded entry expires after **2s** (`DEGRADED_LIST_CACHE_TTL_MS`) instead of
    30s. The burst of repeated lookups inside one transaction is still absorbed —
    those are milliseconds apart — while the window in which a known-short set is
    served without re-asking anyone shrinks 15×, and recovery is noticed (and
    logged) within seconds of the store healing.
  - A complete read is unchanged: cached, not degraded, 30s TTL.
  - The outage message now names the degraded TTL as the retry interval, since it
    previously promised the 30s one.

  Also closes a `declared ≠ enforced` defect in the same field's comment: it claimed
  the cache kept "only positive (non-empty) hits or repeated hits with a stable miss
  signature". No such condition ever existed in `cacheListResult()`. The comment now
  describes the policy the code actually implements, and the behaviour it claims
  (an empty complete read _is_ cached) is pinned by a test.

  Internal caching policy only — no change to the `IMetadataService` contract or to
  any public export.

- 2b2175b: fix(metadata): an unreadable file is no longer announced as `data: null` (#5228)

  `NodeMetadataManager.handleFileEvent()` — the chokidar handler behind
  `watch: true` — wrapped its re-read in a `try/catch` that logged
  "Failed to load changed file" and returned without announcing. That `catch` was
  **unreachable for the failure it was written to catch**. `load()` is
  `(await loadDiagnosed(...)).data`, and `loadDiagnosed` (ADR-0110 D3)
  deliberately absorbs a loader throw: it records the message in `errors[]` and
  answers `{ data: null, degraded: true }`. `FilesystemLoader.load()` does throw
  on an unparseable file — the throw simply died one frame below the handler, so
  the `catch` never ran and the `logger.error` inside it never printed once.

  What went out instead was a watch event carrying `data: null`, which is the wire
  shape of "this metadata legitimately holds nothing". A file the loader could not
  read and a file the author had emptied reached every subscriber in exactly the
  same shape — the miss/outage distinction ADR-0110 D3 exists to preserve, erased
  at the one call site that had picked the variant which throws it away.

  The handler now reads through `loadDiagnosed` and splits on `degraded`:

  - **Degraded** (a loader threw and none answered — an unreadable or unparseable
    file): take the road the dead `catch` meant to take. Log `filePath`, the
    metadata type and name, and `loadDiagnosed`'s `errors[]`, and announce
    nothing. A developer who breaks a metadata file now gets told; before, the
    event claimed the definition had been emptied and nothing was logged.
  - **Clean miss** (`data: null`, no loader threw — the file is gone or
    legitimately empty): unchanged, announced exactly as before.
  - **Deleted** events never read, so a deletion can never be degraded and is
    always announced.

  Cache invalidation is unaffected and deliberately runs **before** the read, so
  the read's verdict can never decide whether the caches are dropped. #5218's
  contract holds in full: an unreadable file is still a real change to the stored
  set (`loadMany` skips it), so `listCache` and the `registry` entry still go, and
  the `api` endpoint index still rebuilds — `invalidateListCache` is that index's
  first invalidation seam (#5089), so suppressing the announcement costs it
  nothing.

  No in-repo subscriber loses invalidation or reload correctness: the endpoint
  index is covered by the seam above, `ObjectQLPlugin`'s `subscribe('object', …)`
  answers events by re-reading (an unreadable file yields nothing to re-read
  either way), and the email-template bridge falls through `event.data ?? get(...)`
  to the same empty result. One behaviour does change for the dev HMR/SSE stream:
  a file left permanently unparseable no longer wakes the Studio, which keeps
  showing the last known-good definition until the next event instead of watching
  it vanish.

- 729a43a: fix(metadata): 文件系统改动同样失效本节点的 `listCache`/`registry`,不再只叫醒 watcher (#5218)

  `NodeMetadataManager.handleFileEvent()` 在 chokidar 报告 `add` / `change` /
  `unlink` 之后只做两件事:重新 `load()` 一次文件内容,然后 `notifyWatchers()`。
  它既不碰 `listCache` 也不碰 `registry` —— 而 `load()` 是纯读路径(它委托给
  `loadDiagnosed`,后者只遍历 loader),两个缓存都不写。

  后果是**同一个 manager 的两个读接口互相矛盾**。手改 `rootDir` 下的
  `view/<name>.json` 之后:

  - `get(type, name)` 是新的 —— 它穿透到 `FilesystemLoader`;
  - `list(type)` 在 `LIST_CACHE_TTL_MS`(30 秒)窗口内继续返回改动前的清单 ——
    REST `/api/v1/metadata/:type`、Studio 左栏、`listViews()` 等一切走 `list()`
    的读都受影响。

  更糟的是被这次事件叫醒的消费者(Studio HMR/SSE 流、ObjectQL SchemaRegistry
  桥)正是通过回头拉 `list()` 来响应的,于是这次唤醒**递回了它自己刚刚宣告已失效
  的那份数据**。

  这与 #5109(集群对端写入不失效本节点缓存)是同一形状、不同触发源,因此复用该
  修复落地的 `invalidateForForeignWrite(type, name)`(可见性由 `private` 放宽为
  `protected`):文件改动正是「不是经由本 manager 写接口发生的写入」,没有任何东西
  替它刷新过缓存,delete-而非-预填 的语义也正好对上 —— 穿透回 loader 读到的就是
  文件的真相。

  两点与基类其余写路径一致的约束:

  - **先失效,再通知**(`register` / `unregister` / `applyRepoEvent` / 集群订阅者
    都是这个次序),使 watcher 不可能同时观察到事件与事件前的缓存;
  - **registry 条目一并删除**,不只是列表缓存。FS 加载的条目本来就不进 registry,
    通常无可删;但当同名条目此前被 `register()` / `registerInMemory()` 写过时,
    它在 `get()` 和 `list()` 中都会**遮蔽** loader,只删列表缓存会让那份陈旧副本
    一直应答下去。

  命中面主要是开发期:`MetadataPlugin` 默认 `watch: true`,在
  `bootstrap: 'artifact-only'` 下被强制关闭,`standalone-stack` 显式传
  `watch: false`。因此 artifact 模式的 `os dev` 与 standalone 不受影响,非 artifact
  的默认 `MetadataPlugin` 装配受影响。

  `type === 'api'` 的行为不变:端点索引此前已由 #5089 装的 `subscribe('api', …)`
  那条缝覆盖,本次改动把 `invalidateListCache` 那条缝也接上,两条缝对称。
  `EndpointMatcher.invalidate()` 是两次赋 `undefined`,重复失效幂等。

- 95b4f0d: fix(metadata): `list()` reads are single-flight, so the "one loader hit per TTL window" promise finally holds for concurrent callers too (#5253)

  `MetadataManager.list()` was a bare "read the cache → walk the loaders → write
  the cache" sequence. The cache is written only once a read has **finished**, so
  it absorbed the caller that arrived second in _time_ but never the caller that
  arrived second in _flight_: every `list(type)` issued while the first read was
  still walking the loaders missed, and each one walked every loader itself. The
  `listCache` field comment states the guarantee the cache exists to provide —
  "the loader is only hit once per TTL window" — and that guarantee held for
  sequential callers only.

  That is not a rounding error on the path the cache was built for. The comment
  names it: security/permission middleware calling `list('permission')` on the
  request path while `DatabaseLoader`'s read sits inside a transaction that holds
  SQLite's only connection, waiting out knex's `acquireConnectionTimeout` (60s).
  Every concurrent request arriving during those 60s used to burn its own 60s,
  because nothing had been written to the cache yet. The everyday version is
  milder but constant: cold start, and the small burst of concurrent `list()`
  calls that follows every invalidation point — `register()` / `unregister()`, a
  cluster peer's write (#5109), a filesystem change (#5218) — each repeated the
  full loader walk.

  Reads of one metadata type are now single-flight. A `list(type)` that finds a
  read already running for that type joins it instead of starting a second
  identical walk.

  - **Sharers share the outcome — as an explicit contract, not an accident.**
    Every caller joining an in-flight read receives that read's exact result,
    including when a loader was unreadable and the answer is known-partial.
    `list()` is the best-effort listing seam and does not throw (the strict
    counterparts remain `listForIndex()` and `loadDiagnosed()`), so a lost loader
    is not an error to fail over from — it is the answer, and re-running the read
    privately for a joiner would walk the same loaders against the same outage in
    the same window.
  - **#5184's degraded judgment is unchanged and is not bypassed.** A shared read
    that lost a loader is still memoized `degraded: true` on the 2s TTL, never
    laundered onto the 30s healthy TTL by having been shared, and every sharer
    received that same partial set.
  - **A write landing mid-read wins.** `invalidateListCache()` now retracts the
    in-flight read as well as the finished entry. The retracted read keeps running
    for the callers already waiting on it — they asked before the write — but it
    loses the right to memoize its pre-write answer, so that answer cannot outlive
    the write it predates; and a caller arriving after the write starts a fresh
    read rather than joining a pre-write one. That second half is #5219 / #5229's
    ordering bar restated for concurrency: a consumer woken by a metadata change
    must not observe the event and pre-event state together.
  - The in-flight map is self-cleaning — an entry is dropped when its read
    settles, by that read only, so a fresh read that replaced it keeps its slot.

  Internal caching policy only — no change to the `IMetadataService` contract or to
  any public export. Sequential callers behave exactly as before.

- 1c625ca: metadata: `getDiagnosed` — a metadata read that FAILED stops arriving as "nobody declared this"

  `MetadataManager.loadDiagnosed` computes the ADR-0110 D3 verdict (a MISS and an OUTAGE
  are different facts with opposite security meanings) and `get()` discarded it two hops
  later: `load()` kept only `.data`, `get()` turned that `null` into `undefined`. Every
  consumer of `get()` therefore received one `undefined` for two opposite facts and could
  not have told them apart even if it had wanted to.

  **New read.** `MetadataManager.getDiagnosed(type, name)` returns
  `{ data, degraded, errors }` — the registry-first counterpart of `loadDiagnosed`, declared
  as an optional member of `IMetadataService`. A registry hit is never degraded (it
  consulted no loader); a clean miss is never degraded (every loader answered).

  **`get()` is unchanged — zero breaking.** Same signature, same answer, same behaviour for
  every existing caller, including the microtask-level ordering `register()`'s watchers
  depend on. Only callers that ASK for the verdict pay for it. Making `get()` throw on
  `degraded` was deliberately not done: the boot path degrades on purpose.

  **Consumers switched**, each with a disposition argued for its own context rather than one
  blanket rule:

  - `getMetaItem` / `getMetaItemCached` — a degraded MetadataService read with nothing in
    the registry now raises `503 SERVICE_UNAVAILABLE` instead of falling through to
    `404 RESOURCE_NOT_FOUND`. This is the half that made the existing `#5532` comment ("
    reaching here now means a real miss") untrue.
  - `getMetaItemLayered` — the `code` layer joins the rule its `overlay` layer already
    followed. `code: null` is a positive claim, and `lockSource = code ?? overlay ?? {}`
    derives from it, so an outage could render an item the packager locked
    (`_lock: 'full'`) as `editable: true, deletable: true`.
  - `ObjectQLPlugin`'s `object` metadata-event refresh — logs `warn` naming the consequence
    (the registry keeps the previous definition; nothing retries) and the fix, instead of
    `debug` "metadata service has no fresh body". `warn` and not `error` because the write
    already landed; only a re-read failed.

  Hosts whose `metadata` slot is a shim that predates `getDiagnosed` are read as
  "not degraded" — exactly what they could express before — so their behaviour is unchanged.

- b5459bc: fix(metadata): `capabilities.write` now means BOTH directions — a writable datasource loader must implement `delete()` (#5276)

  `MetadataLoader` declared `save?` and no `delete`, so `capabilities.write` meant
  two different things at the two ends of an item's life: to `register()` it meant
  "persist into me", and to `unregister()` it guaranteed nothing at all.
  `unregister()` duck-typed `delete` at the call site and, when a loader had none,
  **silently skipped it** — then dropped the registry entry, invalidated the list
  cache and announced a `deleted` event anyway. The caller (Studio/Setup, REST
  DELETE, the CLI, a package teardown) was told the delete succeeded while the row
  stayed in the loader's store, was read straight back out by the next
  `list()`/`get()`, and survived every restart with nothing to retry it.

  Two changes, both making the declaration binding instead of decorative:

  - **`MetadataLoader` now declares `delete?(type: string, name: string): Promise<void>`.**
    The capability is stated on the contract, next to `save?`, instead of being
    guessed at by each caller. A loader implemented against the interface can now
    see that the method exists.
  - **`MetadataManager.registerLoader()` rejects the combination that cannot
    honour it.** A loader declaring `protocol: 'datasource:'` **and**
    `capabilities.write: true` **without** a `delete()` method is refused at
    registration with an error naming the loader, the consequence, and both
    repairs. `registerLoader()` is the sole writer of the loader map — the
    constructor's `config.loaders` funnel through it — so the combination can no
    longer reach the runtime and lose a deletion there.

  **Does this affect you?** Only if you register a custom metadata loader that
  declares `protocol: 'datasource:'` with `capabilities.write: true`. If it does
  and has no `delete()`, registration now throws where it previously succeeded and
  quietly discarded your deletions. Two ways to fix it, both stated in the error:

  1. implement `async delete(type: string, name: string): Promise<void>` on the
     loader, removing the item from its store (`DatabaseLoader` in this package is
     the reference implementation); or
  2. if the loader is genuinely read-only, declare `capabilities.write: false` — a
     read-only `datasource:` loader registers without complaint and is never
     written to in the first place.

  Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are
  unaffected in either direction: `MetadataManager` never persists to them at
  runtime, so it has no deletion of its own to take back, and they may declare
  `capabilities.write` without a `delete()` exactly as before. The one
  `datasource:` loader shipped in this package, `DatabaseLoader`, has always
  implemented `delete()` and is unchanged.

- 1624f4a: fix(metadata): `capabilities.write` now also binds `save()` — a writable datasource loader must implement both halves of the write (#5654)

  #5276 (shipped in v17.0.0-rc) made `capabilities.write` binding on `delete()`:
  a loader declaring `protocol: 'datasource:'` with `capabilities.write: true`
  and no `delete()` is refused at registration, because `unregister()` used to
  skip it silently and announce the deletion anyway. The gate stopped there, so
  **one declaration was binding at one end of an item's life and decorative at
  the other**.

  `MetadataManager.register()` had the identical hole one direction over. Its
  persistence loop read `loader.save &&` first, so a `datasource:` loader
  declaring `capabilities.write: true` **without** a `save()` method was
  **silently skipped** — no warn, no error. `register()` then wrote the in-memory
  registry, invalidated the list cache, announced `created`/`updated` and notified
  watchers, so the caller (Studio/Setup, REST PUT, the CLI, a package publish) was
  told the write succeeded. The item read back correctly for the life of the
  process and was **gone at the next restart**, with nothing to retry it — a
  durability degradation that leaves the system looking entirely healthy.

  `registerLoader()`'s gate (renamed `assertWritableLoaderContract`) now requires
  **both** `save()` and `delete()` for that combination, and rejects with one
  message naming which method is missing, the consequence, and both repairs.
  `registerLoader()` is the sole writer of the loader map — the constructor's
  `config.loaders` funnel through it — so the combination can no longer reach the
  runtime and lose a write there. The `save` short-circuit inside `register()`
  survives as defensive code whose unreachability is now guaranteed by
  construction, exactly like `unregister()`'s.

  **Does this affect you?** Only if you register a custom metadata loader that
  declares `protocol: 'datasource:'` with `capabilities.write: true`. If it does
  and has no `save()`, registration now throws where it previously succeeded and
  quietly discarded your writes. Two ways to fix it, both stated in the error:

  1. implement
     `async save(type: string, name: string, data: any, options?: MetadataSaveOptions): Promise<MetadataSaveResult>`
     on the loader, persisting the item into its store (`DatabaseLoader` in this
     package is the reference implementation); or
  2. if the loader is genuinely read-only, declare `capabilities.write: false` — a
     read-only `datasource:` loader registers without complaint and is never
     written to in the first place.

  Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are
  unaffected: `MetadataManager` never persists to them at runtime, so they may
  declare `capabilities.write` without a `save()`/`delete()` exactly as before.
  The one `datasource:` loader shipped in this package, `DatabaseLoader`, has
  always implemented both and is unchanged.

- dca25e1: fix(metadata-protocol): `SysMetadataRepository` 的 `event_seq` / `version` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4867)

  `SysMetadataRepository.nextEventSeq()` 与 `nextItemVersion()` 各有一个同形的 `catch`,把读
  `sys_metadata_history` 的**全部**失败折成同一个答案:

  ```ts
  } catch {
    // Table not provisioned yet (fresh DB) — start at 1.
    return 1;
  }
  ```

  这是 #4825 刚在 `DatabaseLoader`(TSDoc 自称 legacy、非事务的那条路径)上修掉的形状,原样长在
  **canonical 路径**上 —— #4825 正文把 `SysMetadataRepository` 称作「历史写入应当收敛过去的地方」。
  而且这里有两个数字:

  - **`event_seq`** —— 历史排序与 rollback 定位的依据。表里已有 N 行时,一次瞬时读失败(连接抖动、
    超时、权限)让下一条拿到 `1`,与既有行撞号;
  - **`version`** —— `nextItemVersion()` 的 TSDoc 明说它刻意从 history 取 MAX「so delete + recreate
    continues incrementing instead of restarting at 1」。一次读失败正好把它**恢复成它明确要避免的那个
    行为**:lineage 从 1 重启并与既有 lineage 撞号,而 `MetadataManager.rollback(type, name, version)`
    与 `POST /api/v1/meta/:type/:name/rollback` 正是按这个数字定位快照 —— 撞号之后回滚可能落到另一条
    记录的同号版本上。

  关键危害与 #4825 相同,是「**落盘的字节是错的**」而不是「字节没落盘」:insert 成功、日志一行没有、
  系统对外完全正常,重试不修、重启也不修。

  **「在事务里」并不能挡住它。** 事务解决的是*并发*撞号;它对「从一次失败的读推导出来的数字」没有任何
  意见,一个成功提交的事务照样把错号提交得同样持久。事务真正给出的是干净的补救:抛出去,整笔写入回滚,
  而不是提交一个编造的号。

  现在按**错误类型**判别,复用 #4825 落地的那套判别器(不另起一套):

  - **良性的「表还没建」** —— 没有行,就没有可撞的号,`1` 确实是下一个号,静默返回,fresh DB 照常启动;
  - **其余一切读失败** —— 按 AGENTS.md「Degradation log levels」以 `error` 上报**后果**(写入已被中止、
    事务回滚、什么都没提交;若按旧行为发 `1` 会与既有行撞号,使版本顺序不可信、回滚目标可能指向另一条
    记录的同号版本,且无人能发现、重启也修不回来)与**修复动作**(修数据源/驱动错误后重试写入),然后
    **原样抛出**,让事务回滚。一次故障只说一次,恢复时补一条 `info`。

  ### `@objectstack/metadata` 新增子路径导出 `@objectstack/metadata/errors`

  判别器 `isMissingTableError()`(#4728/#4825 家族)此前是 `@objectstack/metadata` 的内部工具,而本次
  消费者在另一个包。三个选项中选了「从现有归属地**显式导出**」:在 `metadata-protocol` 里复制一份会重建
  #4825 刚消灭的双源问题(同一个问题两套「哪些驱动错误算良性」的词汇表,谁先学会一个驱动怪癖谁就先漂移);
  下沉到公共依赖本轮不可行(`packages/spec` 冻结、`packages/types` 有并行改动),且本次导出并不妨碍维护者
  之后再下沉。

  新增的是一个**叶子子路径**而不是包入口导出:`@objectstack/metadata` 的根入口会拖进 manager、全部
  loader 与其 YAML/文件系统依赖,只为一个 40 行谓词付这个重量,正是把下一个作者推回「复制一份」的原因。
  `@objectstack/metadata/errors` 只 re-export 一个叶子模块,跨包依赖边因此仍是叶子边,也是将来下沉时
  一个可 grep、可删除的单点。仅导出 `isMissingTableError`;同族的 `isSchemaAlreadyExistsError` 在包外
  没有消费者,保持内部(导出一个无人 import 的符号是白许的承诺)。

  无 API 破坏、无 schema 变更、无 `packages/spec` 改动。

- e92e2c3: fix(metadata): `unregister()` invalidates the list cache AFTER the storage delete lands (#5259)

  `MetadataManager.unregister()` dropped the registry entry and called
  `invalidateListCache(type)` **before** awaiting `loader.delete()`. Those two steps
  are separated by a real await window — one DB round-trip per writable loader — and
  inside it the manager held a state that exists nowhere else: **registry already
  empty, loader not yet empty**. `list()` merges the two, so a read arriving in that
  window missed the just-cleared cache, assembled the still-stored row into its
  answer, and memoized it as a _complete_ read — the full 30s healthy TTL, because no
  loader threw and #5184's 2s degraded TTL therefore never applied.

  Nothing invalidated again once the delete landed (`notifyWatchers()` does not touch
  `listCache`), so an item that was gone from storage kept being enumerated for up to
  half a minute. `list()` is the enumeration seam behind `GET /api/v1/metadata/:type`,
  the Studio left rail, sync/export and every consumer that decides existence from a
  declared set — and `get()`, which never reads that cache, said the item was gone the
  whole time. For a gating type (`permission`, `api`) the two faces of one manager
  answered opposite questions about whether a declaration exists.

  **Fixed by ordering, not by an extra invalidation.** `register()` never had this
  defect because it writes the registry _first_ and the registry outranks every loader
  in the merge, so its own save window already shows the post-write state. The
  invariant is therefore not "invalidate early" but _invalidate last, once every store
  already holds the announced state_. `unregister()` now deletes from storage first,
  then drops the registry entry and invalidates with **nothing awaited between them**,
  then publishes and announces — #5219's invalidate-before-notify discipline unchanged.
  A `list()` racing the delete now either sees a coherent pre-delete state (the delete
  has not landed and has not been announced — that answer is the truth) or the
  post-delete state; it can no longer cache the pre-delete answer past the delete.

  This composes with #5253's single-flight rather than duplicating it: a read still
  _in flight_ when the delete lands cannot be reached by dropping `listCache` — it has
  not written its entry yet and would write the pre-delete answer afterwards.
  `invalidateListCache()` also retracts that read's `inflightListReads` registration,
  so it resolves for the callers already waiting on it but loses the right to memoize,
  while a caller arriving later starts a fresh read.

  **A storage delete that fails is now loud.** It used to `logger.warn('Failed to
delete …')` and continue. Per AGENTS.md "Degradation log levels" this is
  durability/consistency degradation, not functional: `unregister()` resolves
  normally, the caller is told the delete succeeded, and the surviving row is read
  straight back out of storage by the very next `list()`/`get()` — permanently, since
  nothing retries it. It now logs at `error`, once per un-deleted item, naming the
  consequence and the fix. The registry entry is still dropped in that case,
  deliberately: the loader still holds the row so the item is served either way, and
  keeping the entry would only pin an in-memory copy on top of a stored row nobody
  maintains — dropping it makes the next read fall through to storage, which is the
  actual truth after a failed delete, and makes it visible immediately instead of at
  the next restart.

  No API change. `unregister()` still resolves rather than throwing when a loader
  refuses the delete.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
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
- Updated dependencies [db0d53c]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
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
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [f104bab]
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
- Updated dependencies [946a131]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/metadata-core@17.0.0-rc.4
  - @objectstack/metadata-fs@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- c4ab50b: fix(metadata): `sys_metadata` 的 DDL 失败不再被静默吞掉 —— 只有「表已存在」这一种原因可以静音 (#4728)

  `DatabaseLoader.ensureSchema()` 过去用一个空 `catch` 吞掉 **全部** DDL 失败,并且照样把
  `schemaReady` 置为 `true`:

  ```ts
  } catch {
    // If syncSchema fails (e.g. table already exists), mark ready and continue
    this.schemaReady = true;
  }
  ```

  注释里的免责理由只覆盖了失败原因中最良性的一种,却用它为**所有**原因开脱。真实的失败
  (权限不足、数据源根本没连上、列类型冲突)之后,表或新列压根不存在,而进程的状态与成功
  路径**逐字节相同**,启动日志里一行痕迹都没有 —— 这正是 #4420 的形态:声称已持久化、实
  际没落盘、系统看起来完全健康。#4632 把它定成规则(AGENTS.md → "Degradation log levels"),
  机械检查 `pnpm check:durability-log-level` 已经能发现这一处。

  现在按**错误类型**判别,而不是按注释里的乐观假设:

  - **良性的「已存在」**(SQLite 的 `table … already exists` / `duplicate column name`、
    Postgres 的 SQLSTATE `42P07`/`42701`/`42710`、MySQL 的 `ER_TABLE_EXISTS_ERROR` 等及其
    `errno`,并跟随 `cause` 链)—— 表确实已就绪,当作 no-op 静默通过,并照常执行后续的
    `project_id → environment_id` 迁移与 ADR-0005 索引。
  - **其余一切失败** —— 以 `console.error` 上报,文案同时说清**后果**(`sys_metadata` 的表/
    列未创建,后续每一次元数据写入都会报错、或在宽松驱动上悄悄丢列,而服务器仍报告健康)
    与**修复动作**(修掉下面那条驱动/数据源错误后重启)。只说**一次**,不是每次写入都刷屏。
  - `schemaReady` **不再**在真实失败后置 `true`。启动依旧不被阻断(该方法不抛),但 loader
    不再声称一个它并不具备的就绪状态,下一次元数据操作会重试 —— 数据源只是还在连接这类瞬
    时故障因此可以自愈,恢复时补一条 `info`。

  `ensureHistorySchema()` 按同一规则对齐:良性「已存在」不再每次写入都打一条 `error`(过度
  使用 `error` 是镜像失败),真实失败则同样只响亮一次并保持重试。

  无 API / schema 变更;新增内部工具 `isSchemaAlreadyExistsError()`(未从包入口导出)。
  `scripts/durability-degradation.baseline.json` 中指向本单的条目随之删除(该文件 shrink-only)。

- 3c7bcc0: feat(spec)!: converge the 11 contracts-vs-domain dual-source type names (#4538)

  `packages/spec/src/contracts/` hand-wrote parameter/result interfaces whose
  names collided with same-named zod-derived types in the domains — the #4411
  trap, tracked as 11 rows of `dual-source-exports.baseline.json`. Each name was
  judged individually against a three-repo import-level scan (framework, cloud,
  objectui): which declaration actually flows at runtime decides the direction.
  All 11 rows are deleted from the baseline; no name below is exported twice
  anymore.

  **Converged — `./contracts` now re-exports the domain zod type (same
  declaration on both entries, imports keep compiling from either):**

  - `NotificationChannel` → `system/notification.zod`'s
    `z.infer<NotificationChannelSchema>` (member sets were identical).
  - `ValidationResult` → `kernel/plugin-validator.zod` (shapes were identical).
  - `HealthStatus` → `kernel/startup-orchestrator.zod` (`details` narrows
    `Record<string, any>` → `Record<string, unknown>`).
  - `PluginStartupResult` → `kernel/startup-orchestrator.zod`. FROM `plugin:
Plugin` (live object) and `error?: Error` TO the serializable projection
    (`plugin: { name, version? }`-passthrough, `error?: { name, message,
stack?, code? }`). Neither side had any consumer outside spec; the
    zod-validatable shape wins.
  - `StartupOptions` → `kernel/startup-orchestrator.zod` — the PARSED tier
    (defaults applied). `IStartupOrchestrator.orchestrateStartup` now takes
    `StartupOptionsInput` (the caller-authored all-optional tier, also
    re-exported from `./contracts`). Fix for callers typed to the old
    all-optional `StartupOptions`: rename to `StartupOptionsInput`.
  - `JobExecution` → `system/job.zod`. The system schema's `duration` field is
    RENAMED `durationMs` — that is what every job adapter produces and what the
    `sys_job_run.duration_ms` column round-trips; the schema described records
    nothing ever wrote. Fix: `duration` → `durationMs` when parsing
    `JobExecutionSchema` payloads.
  - `AnalyticsQuery` → `data/analytics.zod`. The domain schema aligned to the
    contract's semantics first: `timezone` LOST its `.default('UTC')` — absence
    is meaningful (the engine resolves org timezone, #1982/#2018; the
    `/analytics` entry always refused to apply that default). The schema is now
    transform-free, so `AnalyticsQuery` ≡ `AnalyticsQueryInput` (both kept
    exported). Fix for code that relied on `.parse()` injecting `timezone:
'UTC'`: pass the timezone explicitly or resolve it via the engine chain
    (`selection.timezone ?? context.timezone ?? 'UTC'`).

  **Renamed — two genuinely different concepts were sharing one name (both
  flow at runtime):**

  - `./contracts` `DriverCapabilities` → **`AnalyticsDriverCapabilities`**
    (`{ nativeSql, objectqlAggregate, inMemory }`, the analytics strategy-chain
    execution-path probe). The `DriverCapabilities` name now belongs solely to
    the data domain's driver feature-flag record (`DriverCapabilitiesSchema`,
    what `IDataDriver.supports` declares). Fix: importers of the trio from
    `@objectstack/spec/contracts` (or `@objectstack/service-analytics`, whose
    re-export is renamed in lockstep) rename the import; importers who meant
    the driver flags import `DriverCapabilities` from `@objectstack/spec/data`.

  **Removed — the domain-side declaration was dead (zero import-level consumers
  in framework/cloud/objectui; the #4411 family's last survivors):**

  - `system` `MetadataExportOptionsSchema` / `MetadataExportOptions` and
    `MetadataImportOptionsSchema` / `MetadataImportOptions` (the
    `output`/`source`-directory bags). The names now have ONE declaration each:
    the `IMetadataService.exportMetadata` / `importMetadata` parameter
    interfaces on `./contracts` (`types`/`namespaces`/`format` and
    `conflictResolution`/`validate`/`dryRun`), which `MetadataManager`
    implements. No tombstone/D2 conversion, deliberately — these are runtime
    option-bag types, not authorable metadata (same reasoning as #4458).
    `@objectstack/metadata` re-exports the two names from `./contracts` now
    (it previously re-exported the dead system-side shapes its own manager
    did not accept).
  - `system` `JobSchedule` (the `= Schedule` back-compat alias). The name's one
    declaration is the `IJobService.schedule` boundary shape on `./contracts`
    (plain-string cron `expression`); the authored metadata type keeps its real
    name `Schedule`. Fix: `import type { JobSchedule } from
'@objectstack/spec/system'` → `Schedule` (authoring tier) or the
    `./contracts` `JobSchedule` (service boundary), whichever you meant.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- f78dd83: fix(metadata,client): `subscribeMetadata` callbacks receive real `MetadataEvent`s — the producer now fulfils the declared contract (#4602)

  `@objectstack/spec/api`'s `MetadataEvent` declares top-level `id` (uuid,
  required), `metadataType`, `name`, `definition?`, `userId?` — and after
  #4587's convergence it is the **only** declared contract for realtime
  metadata-change events. But the producer (`MetadataManager`) published a raw
  `RealtimeEventPayload` envelope with everything nested under `payload` and no
  `id`/`userId`, while the client SDK force-cast that envelope into the callback
  (`callback(event as any as MetadataEvent)`). Subscribers who wrote
  `event.name` / `event.metadataType` — exactly what the types promised —
  compiled green and read `undefined` at runtime.

  Producer now fulfils the contract:

  - `MetadataManager.register()` / `unregister()` build a true `MetadataEvent`
    (generated uuid `id`, flattened top-level fields, `userId` when the write
    declares an actor) and validate it with `MetadataEventSchema.parse` before
    publishing. The transport envelope is unchanged (`RealtimeEventPayload`,
    with `payload` carrying the complete `MetadataEvent`).
  - A `register()` **overwrite now publishes `metadata.{type}.updated`** instead
    of a second `.created`, mirroring the existing `added`/`changed` watcher
    split. Previously `.updated` was declared with no producer at all.
  - `MetadataEventType` is a closed enum: metadata types outside it (e.g.
    `translation`) have no declared realtime event, so nothing is published for
    them (debug-logged) instead of emitting an event every schema-compliant
    consumer must reject.

  Consumer validates instead of casting:

  - `@objectstack/client`'s `subscribeMetadata` (and therefore
    `@objectstack/client-react`'s metadata hooks, which delegate to it) unwraps
    the envelope and runs `MetadataEventSchema.safeParse` at the boundary. An
    off-contract payload is rejected loudly (handler error, callback never
    invoked) — never coerced or passed through. The `as any as MetadataEvent`
    double-cast is gone.

  New seam: `MetadataWriteOptions.userId` (`@objectstack/spec/contracts`) lets
  write paths that know the acting user carry it into the published event's
  `userId`. Existing callers are unaffected — the field is optional and absence
  means "no human actor".

- beefe89: fix(metadata): 历史序号 `event_seq` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4825)

  `DatabaseLoader.nextEventSeq()` 过去把读 `sys_metadata_history` 的**全部**失败折成同一个答案:

  ```ts
  } catch {
    // Table not provisioned yet or driver error — start at 1.
    return 1;
  }
  ```

  注释同时点名了两种原因,然后用同一个 `return 1` 对待。这是 #4728 刚修掉的同一种形状,但危害是
  **更贵的那一半**:#4728 是「字节没落盘」,本条是「**落盘的字节是错的**」。历史表里已经有 N 行时,
  一次瞬时读失败(连接抖动、超时、权限)会让下一条历史拿到 `event_seq = 1`,与既有行**直接撞号**,
  而 insert **成功**、日志**一行没有**。`event_seq` 正是历史列表排序与 rollback 定位的依据,撞号之后
  版本顺序就永久不可信 —— 重试不修、重启也不修。

  现在按**错误类型**判别,复用 #4728 落地的那套判别机制(`packages/metadata/src/utils/schema-sync-errors.ts`
  里新增的 `isMissingTableError()` 与既有 `isSchemaAlreadyExistsError()` 共用同一个 code / errno /
  message + `cause` 链匹配器,而不是在同一个包里另起一套错误判别):

  - **良性的「表还没建」**(SQLite `no such table: …`、Postgres SQLSTATE `42P01` /
    `relation "…" does not exist`、MySQL `ER_NO_SUCH_TABLE` / errno `1146`,并跟随 `cause` 链)——
    没有行,就没有可撞的号,`1` 确实是下一个号,静默返回。
  - **其余一切读失败** —— `nextEventSeq()` 原样抛出。调用方 `createHistoryRecord()` 以
    `console.error` 上报**后果**(该条历史记录未写入;元数据写入本身已成功,所以服务器仍报告健康,
    而变更历史正在悄悄出现空洞,版本时间线与 rollback 目标将不完整)、**为什么是空洞而不是错号**
    (从 1 发号会与既有行撞号,把「不完整」变成「顺序错误」,后者无人能发现)与**修复动作**,
    然后**跳过这条历史记录**。
  - 判别的方向刻意保守:凡是没有被正面识别为「表不存在」的,一律当作真实失败。`does not exist`
    本身不够 —— `role "…" does not exist`、`database "…" does not exist`、`column "…" does not exist`
    都是真实失败,对着一张可能满是行的表返回 1 正是要避免的事,所以消息匹配要求 table/relation 与
    该短语同现。

  两条边界保持不变:元数据写入本身**不**因此失败(记录已经落盘,把它报成失败是比原缺陷更糟的谎),
  以及本路径已知的并发撞号限制(非事务,canonical producer 仍是 `SysMetadataRepository`)——那是被
  记录过的限制,与「读失败静默重置到 1」是两回事。报告只说**一次**,恢复时补一条 `info`。

  无 API / schema 变更;新增内部工具 `isMissingTableError()`(未从包入口导出)。

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
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
- Updated dependencies [b25a116]
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
- Updated dependencies [65f184b]
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
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/metadata-core@17.0.0-rc.2
  - @objectstack/metadata-fs@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- ac6c0be: refactor(metadata)!: remove the `artifact-api` artifact source (#4246)

  `MetadataPluginOptions.artifactSource` loses its `artifact-api` union member;
  `{ mode: 'local-file', path }` is now the single artifact source. The
  `_loadFromArtifactApi` loader, its `environmentId` pre-flight guard, and the
  Bearer-token support in `_fetchJson` go with it.

  **Why removal, not the doc fix this branch first carried.** #4246 found the
  declaration and the implementation contradicting each other — the option's
  comment called `artifact-api` "reserved for M3/M4" while the loader shipped and
  all three bootstrap modes dispatched to it — and asked the owner to pick a
  direction. Auditing both repos to answer that settled it:

  - **Zero consumers anywhere.** No `mode: 'artifact-api'` call site exists in
    this repo or in cloud. The two real "pull an artifact from the cloud" paths
    both bypass it: the cloud runtime uses its own `ArtifactApiClient` (TTL
    cache, singleflight, hostname resolution, runtime config injection — a
    superset this option was never going to grow into), and package distribution
    into a running OSS instance goes through `@objectstack/cloud-connection`
    (`os package install`, ADR-0008).
  - **Half its input contract had been dead since v5.0 with no one noticing.**
    The URL builder decided "append the canonical path vs use as-is" by testing
    for an `/api/v{n}/cloud/projects/` segment that the v5.0
    `project → environment` rename deleted, so every already-resolved URL got
    the path appended a second time and 404'd. A year of silence on a bug like
    that is consumer-count evidence of its own.
  - **Its one non-replaceable capability was declined.** A Bearer-authenticated
    pull of a _private_ environment artifact is the single thing `local-file`
    cannot do (`local-file` URLs fetch verbatim, unauthenticated). The owner
    confirmed that sealed-private-artifact deployments are not a supported need
    right now, which removed the last reason to keep the mode.

  **Migration.** Public or commit-pinned artifacts load through the existing
  `local-file` URL form, which every bootstrap mode already honors:

  ```ts
  artifactSource: {
    mode: 'local-file',
    path: 'https://cloud.example.com/pub/v1/environments/env_42/artifact?commit=cmt_1a2b',
  }
  ```

  (`private` environments still serve exact-commit deep links through the same
  `/pub` route; fully private pulls have no replacement — by decision, not
  oversight.) For installing packages into a running runtime, use
  `os package install` / `@objectstack/cloud-connection`.

  **The removal is loud, not silent.** A still-configured `artifact-api` source
  (reachable from JS or `any`-typed config now that the TS union is
  single-member) throws at `start()` with the migration pointer above. This
  guard exists because the dispatch's old fall-through would have treated
  "unsupported source" as "no source" — under `eager` that silently scans the
  filesystem instead of loading the artifact the caller named. Tests pin the
  rejection in `artifact-only` and `eager`, and pin the migration target
  (`local-file` fetching an http(s) URL and registering the envelope) so the
  path the error message points at stays real.

  Also replaces a test that passed for the wrong reason: "artifact-only
  bootstrap rejects the not-yet-implemented artifact-api source" matched
  `/artifact-api/` against the missing-`environmentId` guard's message — which
  merely contained the string — proving nothing about implementation status.
  The doc comment, `implementation-status.mdx`, `metadata-service.mdx`, and the
  package ROADMAP now all describe the single `local-file` source, ending the
  docs-audit loop #4246 was filed to stop.

### Minor Changes

- ffb003c: **ADR-0110 — an action's identity is its `name`, and anything executable over a
  governed surface must have a declaration.**

  `POST /api/v1/actions/:object/:action` resolved the DECLARATION from the URL
  segment as a `name` but dispatched the HANDLER using that same segment as a
  registry key. For a target-bound action (`{ name: 'complete_task', target:
'completeTask' }`) those are different strings, so the two documented callers
  each worked on exactly the half the other broke: the documented curl resolved
  the declaration then 404ed, while the Console's `target`-addressed call
  dispatched fine and resolved no declaration — silently skipping the ADR-0066 D4
  capability gate and the ADR-0104 param contract (#3935).

  - **D1/D2** — identity is always the declarative `name`; the handler key is
    derived from the resolved declaration through a rotation now shared with the
    MCP `run_action` bridge (`resolveActionHandlerKeys`, `executeRegisteredAction`).
    The REST route previously rotated only the object key, never the handler key.
  - **D3 (breaking)** — declaration resolution is a trichotomy. A genuinely
    undeclared handler is **refused (404)** with the `defineAction` to add, rather
    than executed ungated with system privileges; an unreachable metadata plane is
    a **503** rather than a silent ungating (`MetadataManager.loadDiagnosed` tells
    a clean miss from an outage). `OS_ALLOW_UNDECLARED_ACTIONS=1` is the migration
    valve — it warns on every invocation and is removed in 18.
  - **D5** — `reconcileActionRegistrations` plus `ObjectQLEngine.listRegisteredActions`
    power a `kernel:ready` inventory logging every registered-but-undeclared
    handler (refused at dispatch) and every declared script action bound to no
    handler — the ADR-0078 converse, mechanised.
  - **D6** — security-gate strictness is opt-**out** (`OS_ALLOW_*`), never opt-in.

  Apps whose actions are all declared need no changes beyond gaining enforcement
  of the `requiredPermissions` they already declared.

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

- f985b3f: fix(spec,core,cloud-connection,metadata): one HTTP contract, one canonical slot name — and the dead shadow copy that helped cause the false exemption is deleted (#4251)

  **`packages/core/src/contracts/` was a dead near-copy of the real contracts,
  and it is gone.** The directory (http-server.ts, data-engine.ts, logger.ts) had
  ZERO importers — no relative import, no subpath export, not a tsup entry;
  core's barrel has re-exported the `@objectstack/spec/contracts` versions all
  along ("Re-export contracts from @objectstack/spec for backward
  compatibility"). But the shadow had already **diverged** from the live
  contract (spec's `IHttpResponse` grew `write?`/`end?` and `IHttpRequest` grew
  `rawBody?`; the copy never did), so anyone who grepped their way into it read a
  stale contract that nothing enforces — the exact both-humans-and-AI failure
  mode behind the false `http.server` exemption (#4382). Deleting it is
  zero-risk by construction: nothing could reach it.

  **`http.server` is the canonical slot name, and the ledger now says so.**
  `ServiceSlotContracts` gains `'http.server': IHttpServer` plus the deprecated
  `'http-server'` alias entry (same instance — hono-plugin and qa's node-plugin
  register both two lines apart; cloud's two server entrypoints do the same).
  Canonical is the only name present on EVERY provider path: runtime's
  `config.server` path registers no alias, so the three cloud-connection plugins
  that read the alias alone (marketplace-proxy, runtime-config,
  marketplace-install-local) found an empty slot there — a live miss, now fixed:
  all readers go canonical-first with the alias as a fallback that dies with the
  alias registrations. The registrations themselves are untouched this release;
  both sites now carry the deprecation note.

  **`getRawApp?(): any` joins `IHttpServer`** — the deliberate framework-handle
  escape, declared once. Four consumers were each declaring it locally
  (cloud-connection ×2, metadata's HMR routes, cloud's serverless node-server);
  those local `RawAppHost`/`HttpServerWithRawApp` types are deleted. The `any`
  return is deliberate and documented at the single declaration: the handle's
  real type belongs to the framework, and naming it would give the contract a
  framework dependency. Adapters are not required to expose it; consumers
  feature-detect.

  **`IMetadataService.bulkRegister`/`bulkUnregister` declare the write options
  their implementation has always accepted.** `bulkRegister`'s contract options
  dropped the `MetadataWriteOptions` half its implementation intersects in
  (`notify` is destructured on the method's first line); `bulkUnregister`
  declared no options at all while the manager takes them. Same shape as the
  `IDataEngine` read-methods gap from B2: a caller typed to the contract could
  not reach the channel without erasing the lookup. Both additive; no implementor
  or caller breaks.

  Slot-lookup baseline ratchets 168 → 167 (marketplace-install-local's lookup
  typed while touched).

- 10575f3: fix(lint,metadata): revoke the `http.server` lint exemption — its stated reason was false (#4251)

  `http.server` was added to `UNCONTRACTED_SLOTS` in #4321 on the ground that
  "no IHttpServer contract exists". The contract does exist —
  `packages/spec/src/contracts/http-server.ts` — and eight call sites were
  already resolving the slot as `getService<IHttpServer>(…)` when the exemption
  was written. An exemption is a claim like any other, and this one rested on a
  premise nobody checked: the same shape as the gaps the rule exists to find.

  Revoked. That surfaced **9 erasures the exemption had been hiding** — 7 in
  files never grandfathered, 2 as count growth inside grandfathered ones, none of
  which the baseline could legally absorb. All typed to `IHttpServer`;
  `packages/metadata/src/plugin.ts` came out clean entirely, so the baseline
  ratchets **DOWN to 168 sites in 36 files** and loses a file.

  Two things confirmed on the way, reported rather than changed:

  **`http.server` and `http-server` are the same instance under two names.**
  plugin-hono-server and qa's node-plugin each register it twice, two lines
  apart; runtime's `config.server` path registers only `http.server`.
  `metadata/src/plugin.ts` reads both with a `??`, which is how it survived. No
  registration is removed here — that is a runtime-behaviour change and belongs
  with whoever picks the canonical name.

  **`IHttpServer` is defined twice and the two have already diverged.**
  `packages/spec/src/contracts/http-server.ts` (15 importers) declares `write?()`
  and `end?()`; `packages/core/src/contracts/http-server.ts` (8 importers) does
  not. Spec's is the superset and the one the ledger points at, so it is the
  source; core's is a stale near-copy and should re-export it. Left for its own
  change — collapsing a duplicated contract is not a lint fix.

  Also worth a note for whoever writes the wider HTTP contract: `getRawApp()` now
  has a **third** independent consumer (metadata's HMR routes, joining
  cloud-connection's two). It is deliberately absent from `IHttpServer` — the
  contract is framework-agnostic and the raw app is the framework's own handle —
  so each consumer names it locally. Three is enough evidence to decide whether
  that stays the right answer.

- d13004a: feat(core,runtime): plugin ordering is a declared, kernel-enforced contract (ADR-0116, #4131)

  `kernel.use()` registration order was never a contract — the kernel resolves
  init/start order from the plugin dependency graph — but a plugin that needed a
  service at init _when its provider is composed_ while also booting _without_
  the provider had no way to declare that. `AppPlugin` was the standing example:
  it grabs `manifest`/`objectql` synchronously in `init()`, declared nothing
  (a hard dependency would break empty-env / metadata-only / mock-engine
  kernels), and so its correctness rode on which array slot each caller put it
  in. That convention failed the same way twice (`DefaultDatasourcePlugin`'s
  first cut; then #4085, disguised for months as "crashes when the artifact is
  missing").

  The kernel `Plugin` contract gains three additive fields, enforced by both
  `ObjectKernel` and `LiteKernel` through one shared implementation
  (`plugin-order.ts` — the previously duplicated topological sort is unified
  there):

  - **`optionalDependencies: string[]`** — order-if-present: hoisted ahead
    exactly like `dependencies` when composed (real topology edges, including
    cycle detection), silently skipped when absent.
  - **`requiresServices: string[]`** — services resolved synchronously during
    `init()` with no fallback. Validated **before Phase 1**: a required service
    whose only declared provider initializes later fails the boot with an error
    naming both plugins, both slots, and the fix — before any init side
    effects. Re-checked immediately before the plugin's own init, where a still-
    missing service becomes a named composition error exactly where the old
    bare `Service not found` crash fired.
  - **`providesServices: string[]`** — services a plugin's `init()`
    unconditionally registers; powers the validation and the diagnostics.

  Plugins that declare nothing get the diagnosis too: a `getService` miss
  during Phase 1 now appends which plugin was initializing and — when a
  composed plugin declares the service — who provides it and how to declare the
  ordering. The `Service '<name>' not found` prefix and the factory-backed
  `is async - use await` message are unchanged.

  First adopters: `AppPlugin` declares
  `optionalDependencies: ['com.objectstack.engine.objectql']` +
  `requiresServices: ['manifest']` (cleared on the empty-env no-op path), so
  the #4085 composition — AppPlugin registered before the engine — now boots
  correctly in every slot; `ObjectQLPlugin` declares
  `providesServices: ['objectql', 'data', 'manifest', 'lifecycle']` and
  `MetadataPlugin` declares `providesServices: ['metadata']`.

  Everything is additive — plugins that declare nothing keep their exact
  ordering semantics; no existing declaration changes meaning.

- 857a6cf: fix(cli,core,metadata,runtime): `os serve` boots with no compiled artifact — the platform does not need an application to start (#4085)

  The artifact (`dist/objectstack.json`) defines an **application**. ObjectStack is
  a development platform, so it has to start without one — but `os serve
objectstack.config.ts` died during boot whenever the artifact was absent:

  ```
    Loading objectstack.config.ts...
  [StandaloneStack] artifact read FAILED: path='…/dist/objectstack.json' error=ENOENT…

    ✗ Service 'manifest' is async - use await
  ```

  Exit 1 — on a **known-good app** (`examples/app-todo` fails the same way with
  only its `dist/objectstack.json` moved aside), and on every freshly authored
  project between `os init` and its first `os compile`. The message named neither
  the missing artifact nor a fix, so it read as an internal kernel fault.

  Three separate faults, each of which alone was enough to refuse the boot:

  - **`serve` registered the config-derived `AppPlugin` before the stack's own
    `plugins[]`.** Registration order _is_ the kernel's init/start order, and that
    slot sits ahead of `ObjectQLPlugin` (which registers `manifest`/`objectql`) and
    `DefaultDatasourcePlugin` (which connects the database the app seeds through).
    The wrap is now **appended** to `plugins[]`, the same slot
    `createStandaloneStack` gives its artifact-derived `AppPlugin` — so config-boot
    and artifact-boot share one plugin order. The artifact path never hit this,
    which is exactly what made a plugin-**order** bug look artifact-related.

  - **`ctx.getService()` reported a never-registered service as "is async".**
    `PluginLoader.getService` is an `async` method, so its return value is _always_
    a Promise and its internal "not found" rejection can never surface
    synchronously — the kernel read the answer off that Promise and told every
    caller to `await` a service that did not exist, while the `not found` branch
    below it was unreachable. It now decides from the registry: absent ⇒
    `[Kernel] Service 'x' not found`, registered-but-uninstantiated ⇒ the unchanged
    `Service 'x' is async - use await`. The same crash now reads
    `[Kernel] Service 'manifest' not found`, which points at the layer that is
    actually wrong.

  - **`MetadataPlugin` treated an absent `local-file` artifact as fatal.**
    `createStandaloneStack` always points it at `dist/objectstack.json`, so a stack
    with no app at all could not boot. A **missing** local artifact is now "nothing
    compiled yet": it logs, starts empty, and leaves the artifact watcher armed, so
    a later `os compile` hydrates the running server. The tolerance is
    ENOENT-only — a malformed or unreadable artifact stays fatal — and
    `bootstrap: 'artifact-only'` (sealed runtime, where the artifact _is_ the
    deployment) keeps failing loudly rather than silently serving an empty runtime.

  `[StandaloneStack] artifact read FAILED … ENOENT` is likewise no longer shouted
  at callers for whom "no artifact" is a healthy state; a present-but-unusable
  artifact keeps the loud warning.

  Pinned by an e2e pair that drives the real `os serve` with **no `os compile`
  anywhere**: an app defined only by `objectstack.config.ts` (asserting its object
  is in the started plugin set, not merely that boot survived) and a bare
  `export default {}` platform. The #4012 fixture drops the `os compile` this bug
  had forced on it.

- 5d21a48: feat(spec,metadata-protocol,metadata,objectql,service-automation): stored metadata replays the full conversion chain at rehydration (#3903)

  Every mechanism the platform has for evolving the metadata contract — schema
  transforms, the ADR-0087 D2 conversion layer, the D3 migration chain, the
  protocol-17 tombstones — operated on **authored source** only. Metadata **at
  rest** (`sys_metadata` rows written by Studio or the runtime authoring APIs)
  was rehydrated unparsed and unconverted, so the authored and stored contracts
  silently diverged: a pre-17 row carrying `conditionalRequired` or `execute`
  read as whatever each ad-hoc consumer happened to do with it.

  **New spec primitive — `applyConversionsToStoredItem(type, item, options?)`**
  (exported from the package root). Wraps one stored item of a given metadata
  type and replays the **full** conversion chain over it — `retiredFromLoadPath`
  entries included, because retirement is an _authoring-surface_ event: the
  window exists to teach a live author, and a row at rest has no author to
  teach. Idempotent, never throws, never validates.

  Wired at every stored-row rehydration seam:

  - `metadata-protocol`: `loadMetaFromDb`, `getMetaItems` (active + draft
    preview), `getMetaItem` (active + draft), `getMetaItemLayered`, and
    `duplicatePackage` (a copy re-saves through the schema gate, so legacy
    sources now duplicate successfully — and the copy is canonical).
  - `metadata`: the DatabaseLoader's live-row reads (`load` / `loadMany`).
    History reads stay verbatim — history records what was written.
  - `objectql`: the authored-action / authored-hook direct table reads, so
    runtime-authored actions stored with the removed `execute` alias dispatch
    via `target` again.
  - `service-automation`: `AutomationEngine.registerFlow` now passes
    `includeRetired` — stored flows keep canonicalizing after their conversions
    graduate out of the load window. (The generic metadata seams deliberately
    skip `type: 'flow'`: flow conversions carry the open-namespace conflict
    guard, which needs this engine's live executor registry.)

  **Boot hydration diagnoses instead of shrugging.** `loadMetaFromDb` now
  returns `{ loaded, errors, invalid }`: each row is validated against its
  type's spec schema _after_ conversion, and a genuine contract violation is
  counted and warned with a stable `[metadata_spec_invalid]` marker — but still
  registered, deliberately: refusing at boot would unhook live tables and make
  the row unlistable and unfixable in Studio. The write path (`saveMetaItem` → 422) and the read-side `_diagnostics` envelope remain the enforcing gates; the
  `SchemaRegistry.registerItem` validation hook is now documented as exactly
  that diagnostic.

  **Retired accommodation.** With the chain running on every stored read path,
  the rule-validator's `requiredWhen ?? conditionalRequired` fallback — kept in
  #3883 with a retirement promise that had no mechanism — is deleted. If you
  call `evaluateValidationRules` directly with raw legacy field definitions,
  convert them first (`applyConversionsToStoredItem('object', def)`) or author
  `requiredWhen`; the platform's own read paths already hand you canonical
  shapes.

- 7309c81: test(runtime,client,metadata): back the remaining suites with in-memory SQLite instead of the mingo driver (#4065)

  Ten test files used `InMemoryDriver` as a convenience backing store — somewhere
  for rows to go while the suite proved something else (REST routing, datasource
  auto-connect, the batch `$ref` contract, metadata history). They now run on
  `SqliteWasmDriver` at `:memory:`, the same engine `@objectstack/verify`'s
  `bootStack` already gives the dogfood gate: pure JS (no native build, CI-safe on
  any runner) and real SQL semantics.

  The point is fidelity, not tidiness. Production runs SQL, and mingo differs from
  it in ways that let a suite pass while the behaviour it stands for is broken.
  Every failure this migration produced was a fixture defect the memory driver had
  been absorbing:

  - **Tables were never created.** `driver.create()` on the memory driver is a
    bare `table.push()` onto an auto-vivified array, so an object registered
    _after_ `kernel.bootstrap()` — which misses the boot-time schema sync — looked
    fine. On SQL the first write fails with `no such table`, which the REST error
    mapper turns into a **404 `OBJECT_NOT_FOUND`**: a routing-shaped symptom for a
    DDL-shaped cause. Four suites needed an explicit `syncObjectSchema`.
  - **A missing object declaration read as working.** `notifications.hono.integration`
    writes `sys_notification`, which `MessagingServicePlugin` does not declare —
    it is a platform object, and that lean kernel never booted `platform-objects`.
    Auto-vivification hid the omission entirely. The suite now registers the real
    `SysNotification` rather than a hand-copied stand-in, so there is still exactly
    one schema for it (Prime Directive #12).
  - **`connect()` was optional.** The memory driver needs none; a SQL driver does.

  What deliberately did NOT move: `read-coercion-conformance` keeps its two-driver
  matrix (proving a stored value reads back as its declared type on _both_ engines
  is the entire point of that gate), and the suites whose subject IS the memory
  driver or its wiring — `standalone-stack` (`memory://` scheme),
  `sqlite-driver-fallback` (the dev step-down), the CLI's driver-label tests, and
  driver-memory's own suite.

  `datasource-autoconnect` is in that second group as of #4083, which landed a
  regression test there for exactly the memory-pool property this PR originally
  proposed to migrate away from. Moving that file to SQLite would have left the
  new test passing vacuously — a wasm-SQLite pool never writes `.objectstack/` at
  all — so it stays on the memory driver and keeps guarding what it was written
  to guard.

  No new coverage is claimed here: each suite asserts exactly what it asserted
  before, against a more faithful store.

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
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
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
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
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
- Updated dependencies [d5749d7]
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
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
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
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/metadata-core@17.0.0-rc.1
  - @objectstack/metadata-fs@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- 4e9e184: chore(deps): OSV security batch — bump tar to ^7.5.21 (GHSA-r292-9mhp-454m) and
  js-yaml to ^5.2.2 (GHSA-pm4m-ph32-ghv5)

  Both are declared-range bumps to the patched releases, so downstream installs
  resolve the fixed versions from the published manifests, not just this
  workspace's lockfile. The same batch clears the remaining transitive advisories
  (next 16.2.11 in apps/docs; workspace overrides for brace-expansion, sharp,
  react-router, @sveltejs/kit, @hono/node-server) — those live in pnpm-workspace.yaml
  and the private docs app, which do not ship.

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
- Updated dependencies [840ee4b]
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
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
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
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [030125b]
- Updated dependencies [67452d1]
- Updated dependencies [4921a95]
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
- Updated dependencies [db48ad5]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [c073b8c]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/metadata-core@17.0.0-rc.0
  - @objectstack/metadata-fs@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/metadata-core@16.1.0
  - @objectstack/types@16.1.0
  - @objectstack/metadata-fs@16.1.0

## 16.0.0

### Patch Changes

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

- d2723e2: **`MetadataManager.register()` / `unregister()` now announce to `subscribe()` watchers.** Both updated the registry, persisted to writable loaders and published to realtime, but never fired the watch callbacks — so `subscribe()` looked like it covered every write while silently missing all of them. Only the `saveMetaItem` path (via the repository watch stream) and the filesystem watcher ever reached a subscriber. Runtime consumers that cache metadata — notably ObjectQL's SchemaRegistry bridge, the component that decides what is queryable — went stale on every other write until the process restarted.

  Announcing is now the **default**, so a new call site is correct without knowing this contract exists. This is a contract fix rather than a bug fix: the one live behavior change is that runtime datasource writes (`datasource-admin`) now reach the HMR SSE stream, which subscribes to every registered type. `unregisterPackage()` / `bulkUnregister()` also announce their deletes now — correct, but latent, since neither has a production caller today.

  Bulk ingest opts out explicitly with the new `MetadataWriteOptions` (`{ notify: false }`) — boot-time filesystem priming, artifact ingest, and ObjectQL's registry bridge, each of which either runs before consumers cache anything or announces the whole batch once (as the artifact reload path does via `metadata:reloaded`). The bridge in particular MUST stay silent: it copies objects out of the SchemaRegistry, and announcing would feed them back through a handler that re-registers under `_packageId ?? 'metadata-service'`, overwriting the true package provenance of every object whose body carries no `_packageId`.

  Additive only — `register(type, name, data)` and `unregister(type, name)` keep working unchanged.

  Fixes #3112.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
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
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [06cb319]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/metadata-core@16.0.0
  - @objectstack/types@16.0.0
  - @objectstack/metadata-fs@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/metadata-core@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1
  - @objectstack/metadata-fs@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

- d2723e2: **`MetadataManager.register()` / `unregister()` now announce to `subscribe()` watchers.** Both updated the registry, persisted to writable loaders and published to realtime, but never fired the watch callbacks — so `subscribe()` looked like it covered every write while silently missing all of them. Only the `saveMetaItem` path (via the repository watch stream) and the filesystem watcher ever reached a subscriber. Runtime consumers that cache metadata — notably ObjectQL's SchemaRegistry bridge, the component that decides what is queryable — went stale on every other write until the process restarted.

  Announcing is now the **default**, so a new call site is correct without knowing this contract exists. This is a contract fix rather than a bug fix: the one live behavior change is that runtime datasource writes (`datasource-admin`) now reach the HMR SSE stream, which subscribes to every registered type. `unregisterPackage()` / `bulkUnregister()` also announce their deletes now — correct, but latent, since neither has a production caller today.

  Bulk ingest opts out explicitly with the new `MetadataWriteOptions` (`{ notify: false }`) — boot-time filesystem priming, artifact ingest, and ObjectQL's registry bridge, each of which either runs before consumers cache anything or announces the whole batch once (as the artifact reload path does via `metadata:reloaded`). The bridge in particular MUST stay silent: it copies objects out of the SchemaRegistry, and announcing would feed them back through a handler that re-registers under `_packageId ?? 'metadata-service'`, overwriting the true package provenance of every object whose body carries no `_packageId`.

  Additive only — `register(type, name, data)` and `unregister(type, name)` keep working unchanged.

  Fixes #3112.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [06cb319]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/metadata-core@16.0.0-rc.0
  - @objectstack/metadata-fs@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/metadata-core@15.1.1
- @objectstack/metadata-fs@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Patch Changes

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
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0
  - @objectstack/metadata-core@15.1.0
  - @objectstack/metadata-fs@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/metadata-core@15.0.0
  - @objectstack/types@15.0.0
  - @objectstack/metadata-fs@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/metadata-core@14.8.0
  - @objectstack/types@14.8.0
  - @objectstack/metadata-fs@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/metadata-core@14.7.0
  - @objectstack/platform-objects@14.7.0
  - @objectstack/metadata-fs@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/metadata-core@14.6.0
  - @objectstack/types@14.6.0
  - @objectstack/metadata-fs@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/metadata-core@14.5.0
  - @objectstack/types@14.5.0
  - @objectstack/metadata-fs@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/metadata-core@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/types@14.4.0
  - @objectstack/metadata-fs@14.4.0

## 14.3.0

### Minor Changes

- 02f6af4: ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

  - **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
    the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
    properties): anonymous callers see only `public` books/docs;
    `{ permissionSet }`-gated books require the caller to hold the named set;
    a doc's effective audience is the union over the books that CLAIM it
    (unclaimed docs default to `org`; orphan rendering never inherits `public`).
    Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
    single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
  - **spec**: new pure helpers powering that gate — `audienceAllows`,
    `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
    (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
    per the launch-window convention (pre-1.0 semantics — breaking changes do
    not burn a major version number while the whole stack is in lockstep):
    `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
    registered form (the `position` type had LOST its form layout in the P1
    rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
    retired `roles`/`profiles`.
  - **plugin-security**: the `security` service exposes
    `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
    enforcement, for the docs gate.
  - **metadata**: artifact ingestion maps `positions → 'position'` (the stale
    `roles → 'role'` mapping matched nothing since the P1 rename, silently
    dropping compiled positions from metadata registration).
  - **lint**: books join the D3 role-word scan (their `audience` is a
    permission-model reference now), and a new advisory rule
    `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
    naming a set the stack does not declare (runtime fails closed — the typo
    cost is "nobody can read the book", so say it at author time).
  - **platform-objects**: metadata-form translations regain `position` (all four
    locales) and drop the retired `role`/`profile` groups, with a vocabulary
    regression test.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/metadata-core@14.3.0
  - @objectstack/types@14.3.0
  - @objectstack/metadata-fs@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/metadata-core@14.2.0
  - @objectstack/types@14.2.0
  - @objectstack/metadata-fs@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/metadata-core@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/types@14.1.0
  - @objectstack/metadata-fs@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/metadata-core@14.0.0
  - @objectstack/types@14.0.0
  - @objectstack/metadata-fs@14.0.0

## 13.0.0

### Major Changes

- 6d83431: ADR-0090 P1 breaking wave — permission model v2 concept convergence.

  Pre-launch one-step renames and secure defaults (no compatibility aliases, per
  ADR-0090 D3/D4 superseding ADR-0057 D5/D7's alias discipline):

  - `sys_role` → `sys_position`, `sys_user_role` → `sys_user_position` (field
    `role` → `position`), `sys_role_permission_set` → `sys_position_permission_set`
    (field `role_id` → `position_id`); `RoleSchema`/`defineRole` →
    `PositionSchema`/`definePosition` with **no `parent`** (positions are flat;
    hierarchy lives on the business-unit tree).
  - `ExecutionContext.roles[]` → `positions[]`; the EvalUser/CEL contract
    `current_user.roles` → `current_user.positions` (formula validators updated);
    stack property `roles:` → `positions:`; metadata kinds `role`/`profile` →
    `position` (profile kind removed).
  - `isProfile` removed from `PermissionSetSchema` (ADR-0090 D2); `isDefault`
    narrows to an install-time suggestion; `appDefaultProfileName` →
    `appDefaultPermissionSetName` (isDefault-only).
  - OWD enum drops legacy aliases `read`/`read_write`/`full`; new optional
    `externalSharingModel` (external dial, `private` default) lands as P1 spec
    shape (ADR-0090 D11).
  - **Secure default (D1)**: a custom object with an owner field and NO
    `sharingModel` now resolves `private` (was: fully public). System objects
    keep their explicit posture. Unrecognised stored values fail closed.
  - ExecutionContext gains the P1 principal-taxonomy shape (D10):
    `principalKind` / `audience` / `onBehalfOf` (optional, semantics phase in
    later).
  - Sharing recipients: `role` → `position` (expanded via `sys_user_position`
    ∪ the better-auth membership transition source); `role_and_subordinates`
    removed — `unit_and_subordinates` now expands the business-unit subtree
    (finishes ADR-0057 D5's re-homing).

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/metadata-core@13.0.0
  - @objectstack/metadata-fs@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/metadata-core@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/types@12.6.0
  - @objectstack/metadata-fs@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/metadata-core@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/types@12.5.0
  - @objectstack/metadata-fs@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/metadata-core@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/types@12.4.0
  - @objectstack/metadata-fs@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/metadata-core@12.3.0
  - @objectstack/platform-objects@12.3.0
  - @objectstack/types@12.3.0
  - @objectstack/metadata-fs@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/metadata-core@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/platform-objects@12.2.0
  - @objectstack/types@12.2.0
  - @objectstack/metadata-fs@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/metadata-core@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/types@12.1.0
  - @objectstack/metadata-fs@12.1.0

## 12.0.0

### Patch Changes

- 9860de4: Surface view-key collisions during view container expansion instead of renaming silently.

  `expandViewContainer` keeps its backward-compatible rename behaviour (`<object>.<key>` →
  `<object>.<key>_2` on collision) but now stamps a machine-readable
  `_diagnostics.warnings` entry on the renamed `ExpandedViewItem`, explaining that
  references targeting the requested name (form action targets, navigation `viewName`s)
  will resolve to the _other_ view. Both flattening loaders — the ObjectQL engine and the
  MetadataPlugin — log these warnings at boot so the collision is visible instead of
  manifesting as a form action opening a list view (#2554).

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/metadata-core@12.0.0
  - @objectstack/types@12.0.0
  - @objectstack/metadata-fs@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/metadata-core@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/types@11.10.0
  - @objectstack/metadata-fs@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/metadata-core@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/types@11.9.0
  - @objectstack/metadata-fs@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/types@11.8.0
  - @objectstack/metadata-core@11.8.0
  - @objectstack/metadata-fs@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/metadata-core@11.7.0
  - @objectstack/types@11.7.0
  - @objectstack/metadata-fs@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/metadata-core@11.6.0
- @objectstack/metadata-fs@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/metadata-core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/types@11.5.0
  - @objectstack/metadata-fs@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/metadata-core@11.4.0
  - @objectstack/platform-objects@11.4.0
  - @objectstack/types@11.4.0
  - @objectstack/metadata-fs@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/metadata-core@11.3.0
  - @objectstack/platform-objects@11.3.0
  - @objectstack/types@11.3.0
  - @objectstack/metadata-fs@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/metadata-core@11.2.0
  - @objectstack/platform-objects@11.2.0
  - @objectstack/types@11.2.0
  - @objectstack/metadata-fs@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/metadata-core@11.1.0
  - @objectstack/metadata-fs@11.1.0

## 11.0.0

### Patch Changes

- 4b5ec6e: fix(automation): re-bind scheduled-flow jobs on `os dev` hot-reload

  Editing a schedule-triggered flow under `objectstack dev` silently kept firing
  the OLD definition until a full server restart. The dev watcher recompiles
  `dist/objectstack.json` and MetadataPlugin reloads it into the MetadataManager
  (so GET /meta reads + UI HMR are fresh), but the AutomationEngine pulls its flow
  definitions and trigger/job bindings ONCE at boot — nothing re-registered them
  on reload. So the scheduled job bound at boot kept running the pre-edit flow
  (old `runAs`, schedule, or logic) on its timer, with no signal that the edit had
  no effect.

  Fix: MetadataPlugin now fires a generic `metadata:reloaded` hook after each
  artifact reload (the HMR POST handler and the server-side artifact-file watcher;
  never on the initial boot load). AutomationServicePlugin subscribes and re-syncs
  the engine from the metadata service — re-registering every current flow
  (idempotent: `registerFlow` re-binds the trigger, and `ScheduleTrigger.start`
  cancels + reschedules the job) and unregistering flows removed from the artifact
  so their jobs stop firing. This covers all auto-triggered flow types
  (schedule / record-change / api), not just scheduled ones, since record-change
  flows were also executing their boot-time definitions after an edit. Production
  deployments are unaffected — nothing reloads the artifact there.

- Updated dependencies [4d99a5c]
- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
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
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/metadata-core@11.0.0
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/metadata-fs@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/types@10.3.0
- @objectstack/metadata-core@10.3.0
- @objectstack/metadata-fs@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/metadata-core@10.2.0
  - @objectstack/platform-objects@10.2.0
  - @objectstack/types@10.2.0
  - @objectstack/metadata-fs@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/metadata-core@10.1.0
  - @objectstack/platform-objects@10.1.0
  - @objectstack/types@10.1.0
  - @objectstack/metadata-fs@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/metadata-core@10.0.0
  - @objectstack/types@10.0.0
  - @objectstack/metadata-fs@10.0.0

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
  - @objectstack/metadata-core@9.11.0
  - @objectstack/platform-objects@9.11.0
  - @objectstack/types@9.11.0
  - @objectstack/metadata-fs@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/metadata-core@9.10.0
  - @objectstack/types@9.10.0
  - @objectstack/metadata-fs@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/metadata-core@9.9.1
- @objectstack/metadata-fs@9.9.1
- @objectstack/platform-objects@9.9.1

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
  - @objectstack/metadata-core@9.9.0
  - @objectstack/platform-objects@9.9.0
  - @objectstack/types@9.9.0
  - @objectstack/metadata-fs@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/metadata-core@9.8.0
  - @objectstack/platform-objects@9.8.0
  - @objectstack/types@9.8.0
  - @objectstack/metadata-fs@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0
- @objectstack/metadata-core@9.7.0
- @objectstack/metadata-fs@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/metadata-core@9.6.0
  - @objectstack/platform-objects@9.6.0
  - @objectstack/types@9.6.0
  - @objectstack/metadata-fs@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/metadata-core@9.5.1
  - @objectstack/platform-objects@9.5.1
  - @objectstack/types@9.5.1
  - @objectstack/metadata-fs@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/metadata-core@9.5.0
  - @objectstack/types@9.5.0
  - @objectstack/metadata-fs@9.5.0

## 9.4.0

### Patch Changes

- 2c8e607: fix(ADR-0046): serve package docs at runtime, not just in the compiled artifact

  Package docs (`src/docs/*.md`) compiled into a bundle were never reaching the
  runtime, so `GET /meta/doc` returned an empty list and the docs were invisible
  even though `os build` produced them.

  Two gaps:

  - **`os dev` / `os serve` (config-load path)** re-derives metadata from
    `defineStack(...)`, which never carries the markdown docs — those are
    collected only at compile time. `serve.ts` now collects `src/docs/*.md` into
    the stack on the config-load path too (collection only — additive, never
    blocks boot), so docs serve in dev exactly as from a built artifact.
  - **The MetadataPlugin artifact loader** (`ARTIFACT_FIELD_TO_TYPE`) omitted the
    `docs` → `doc` mapping, so the bundle's `docs` array was skipped when loading
    through that path. Added the mapping (with a regression test) for parity with
    the ObjectQL engine's `metadataArrayKeys`.

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/metadata-core@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0
  - @objectstack/types@9.4.0
  - @objectstack/metadata-fs@9.4.0

## 9.3.0

### Minor Changes

- b10aa78: Metadata registered through the metadata-service path now carries package provenance. `loadMetadataFromService` and `MetadataFacade.register` pass each item's own `_packageId` through to `registry.registerItem` so `applyProtection` stamps `_packageId`/`_provenance: 'package'` (never a synthetic id — `isArtifactBacked()` write authorization keys off `_packageId`). New `MetadataPluginOptions.packageId` lets hosts running the filesystem scanner declare the owning package id for scanned source-file metadata, closing the same gap for hand-wired kernels. GET /api/v1/meta/:type consumers (e.g. objectui NavigationSyncEffect) can now distinguish package-shipped items from user-authored rows without name heuristics.

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/metadata-core@9.3.0
  - @objectstack/types@9.3.0
  - @objectstack/metadata-fs@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/metadata-core@9.2.0
  - @objectstack/platform-objects@9.2.0
  - @objectstack/types@9.2.0
  - @objectstack/metadata-fs@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/metadata-core@9.1.0
  - @objectstack/platform-objects@9.1.0
  - @objectstack/types@9.1.0
  - @objectstack/metadata-fs@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/metadata-core@9.0.1
  - @objectstack/platform-objects@9.0.1
  - @objectstack/types@9.0.1
  - @objectstack/metadata-fs@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/metadata-core@9.0.0
  - @objectstack/platform-objects@9.0.0
  - @objectstack/types@9.0.0
  - @objectstack/metadata-fs@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/metadata-core@8.0.1
- @objectstack/metadata-fs@8.0.1
- @objectstack/platform-objects@8.0.1

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
  - @objectstack/metadata-core@8.0.0
  - @objectstack/platform-objects@8.0.0
  - @objectstack/types@8.0.0
  - @objectstack/metadata-fs@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0
- @objectstack/metadata-core@7.9.0
- @objectstack/metadata-fs@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/metadata-core@7.8.0
  - @objectstack/platform-objects@7.8.0
  - @objectstack/types@7.8.0
  - @objectstack/metadata-fs@7.8.0

## 7.7.0

### Patch Changes

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/metadata-core@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0
  - @objectstack/metadata-fs@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/types@7.6.0
  - @objectstack/metadata-core@7.6.0
  - @objectstack/metadata-fs@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/metadata-core@7.5.0
- @objectstack/metadata-fs@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/metadata-core@7.4.1
- @objectstack/metadata-fs@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/types@7.4.0
  - @objectstack/metadata-core@7.4.0
  - @objectstack/metadata-fs@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/types@7.3.0
  - @objectstack/metadata-core@7.3.0
  - @objectstack/metadata-fs@7.3.0

## 7.2.1

### Patch Changes

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/metadata-core@7.2.1
  - @objectstack/metadata-fs@7.2.1
  - @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/types@7.2.0
- @objectstack/metadata-core@7.2.0
- @objectstack/metadata-fs@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- 47a92f4: Promote `email_template` to a first-class metadata type using the canonical
  `EmailTemplateDefinitionSchema`.

  Previously `email_template` had two competing Zod schemas (Prime Directive
  #8 violation): the legacy `EmailTemplateSchema` (a sub-shape of
  `Notification`) and the richer `EmailTemplateDefinitionSchema`. The runtime
  metadata protocol (`packages/objectql/src/protocol.ts`) and Studio's
  property panel registered the legacy one, which is why all the new fields
  (`name`, `label`, `category`, `locale`, `bodyHtml`, `bodyText`, …) were
  reported as “declared in form layout but missing from schema”.

  This change:

  - Repoints the `email_template` entry in `TYPE_TO_SCHEMA`
    (`packages/objectql/src/protocol.ts`) and in
    `BUILTIN_METADATA_TYPE_SCHEMAS`
    (`packages/spec/src/kernel/metadata-type-schemas.ts`) to
    `EmailTemplateDefinitionSchema`. The legacy `EmailTemplateSchema` is
    kept only as an inline sub-shape inside `Notification`.
  - Adds an `emailTemplates` collection to `defineStack()` input
    (`packages/spec/src/stack.zod.ts`), registers it in
    `MAP_SUPPORTED_FIELDS`/`PLURAL_TO_SINGULAR`
    (`packages/spec/src/shared/metadata-collection.zod.ts`), wires it into
    `ARTIFACT_FIELD_TO_TYPE` (`packages/metadata/src/plugin.ts`) and
    `APP_CATEGORY_KEYS` (`packages/runtime/src/app-plugin.ts`).
  - Rewrites `packages/spec/src/system/email-template.form.ts` for the new
    schema with sections for Identity, Subject, HTML body, Plain-text body,
    Variables, Delivery overrides, Status.
  - Ships three reference templates in `examples/app-crm/src/emails/`:
    `crm.deal_won` (rewritten to canonical shape), `crm.welcome` (new),
    `crm.lead_followup` (new), and wires them into the CRM stack via
    `emailTemplates: Object.values(emails)`.

  End-to-end verified in Studio: list view at
  `/_console/apps/studio/metadata/email_template` shows all three entries;
  the detail view renders the EmailTemplatePreview iframe and the property
  panel cleanly renders every canonical field (no missing-schema warnings).
  `GET /api/v1/meta` now returns the new `properties` set
  (`name, label, category, locale, subject, bodyHtml, bodyText, variables,
fromOverride, replyTo, active, isSystem, description`).

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/types@7.1.0
  - @objectstack/metadata-core@7.1.0
  - @objectstack/metadata-fs@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/types@7.0.0
  - @objectstack/metadata-core@7.0.0
  - @objectstack/metadata-fs@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/types@6.9.0
- @objectstack/metadata-core@6.9.0
- @objectstack/metadata-fs@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/types@6.8.1
- @objectstack/metadata-core@6.8.1
- @objectstack/metadata-fs@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/types@6.8.0
  - @objectstack/metadata-core@6.8.0
  - @objectstack/metadata-fs@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/types@6.7.1
- @objectstack/metadata-core@6.7.1
- @objectstack/metadata-fs@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/types@6.7.0
  - @objectstack/metadata-core@6.7.0
  - @objectstack/metadata-fs@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0
  - @objectstack/types@6.6.0
  - @objectstack/metadata-core@6.6.0
  - @objectstack/metadata-fs@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/types@6.5.1
- @objectstack/metadata-core@6.5.1
- @objectstack/metadata-fs@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/types@6.5.0
- @objectstack/metadata-core@6.5.0
- @objectstack/metadata-fs@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0
  - @objectstack/types@6.4.0
  - @objectstack/metadata-core@6.4.0
  - @objectstack/metadata-fs@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/types@6.3.0
- @objectstack/metadata-core@6.3.0
- @objectstack/metadata-fs@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0
  - @objectstack/types@6.2.0
  - @objectstack/metadata-core@6.2.0
  - @objectstack/metadata-fs@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/types@6.1.1
- @objectstack/metadata-core@6.1.1
- @objectstack/metadata-fs@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0
  - @objectstack/types@6.1.0
  - @objectstack/metadata-core@6.1.0
  - @objectstack/metadata-fs@6.1.0

## 6.0.0

### Major Changes

- 944f187: # v5.0 — `project` → `environment` hard rename

  The runtime concept previously called **"project"** (per-tenant business
  workspace; Org → **Project** → Branch hierarchy; per-project ObjectKernel,
  per-project DB, per-project artifact) is now uniformly called
  **"environment"**.

  This is a **hard rename with no aliases, deprecation shims, or compatibility
  layer**. Upgrade requires a coordinated update of CLI, runtime, server, and any
  clients calling the REST API.

  > Note: "project" in the npm / monorepo sense (the framework itself, `package.json`,
  > tsconfig project references, vitest `projects` config) is **unchanged**.

  ## Breaking changes

  ### CLI

  - Flags renamed:
    - `--project` / `-p` → `--environment` / `-e` (`os publish`, `os rollback`)
    - `--project-id` → `--environment-id` (`os dev`)
  - Default local env id: `proj_local` → `env_local`.
  - Env var: `OS_PROJECT_ID` → `OS_ENVIRONMENT_ID`.
  - Command group renamed: `os projects ...` → `os environments ...`
    (`bind`, `create`, `list`, `show`, `switch`).
  - Persisted auth-config key: `activeProjectId` → `activeEnvironmentId`.

  ### HTTP / REST

  - Scoped routes: `/api/v1/projects/:projectId/...` → `/api/v1/environments/:environmentId/...`.
  - Cloud control-plane routes: `/api/v1/cloud/projects/...` → `/api/v1/cloud/environments/...`
    (including `/cloud/environments/:id/artifact`, `/cloud/environments/:id/metadata`,
    `/cloud/environments/:id/credentials/rotate`, etc.).
  - Header: `X-Project-Id` (and lowercase `x-project-id`) → `X-Environment-Id`
    (`x-environment-id`).
  - Route param name in handlers: `req.params.projectId` → `req.params.environmentId`.
  - Hostname-routing and tenant-resolution code-paths use `environmentId` end-to-end.

  ### Runtime / spec

  - Exported symbols (no aliases):
    - `createSystemProjectPlugin` → `createSystemEnvironmentPlugin`
    - `SYSTEM_PROJECT_ID` → `SYSTEM_ENVIRONMENT_ID`
    - `ProjectArtifactSchema` → `EnvironmentArtifactSchema`
    - `PROJECT_ARTIFACT_SCHEMA_VERSION` → `ENVIRONMENT_ARTIFACT_SCHEMA_VERSION`
    - `ObjectOSProjectPlugin` → `ObjectOSEnvironmentPlugin`
    - `createSingleProjectPlugin` → `createSingleEnvironmentPlugin`
  - Plugin identifier strings:
    - `com.objectstack.runtime.objectos-project` → `objectos-environment`
    - `com.objectstack.studio.single-project` → `single-environment`
    - `com.objectstack.multi-project` → `multi-environment`
    - `com.objectstack.runtime.system-project` → `system-environment`
  - Provisioning hook: `provisionSystemProject` → `provisionSystemEnvironment`.

  ### Database / schemas

  - Column renames on `sys_metadata` and `sys_metadata_history`:
    `project_id` → `environment_id`.
  - Column renames on `sys_activity`: `project_id` → `environment_id` (plus index).
  - Object renames in platform-objects metadata: `sys_project` → `sys_environment`
    (lookup targets), `sys_project_member` → `sys_environment_member`,
    `sys_project_credential` → `sys_environment_credential`.
  - Auth-context field: `active_project_id` → `active_environment_id`.
  - JSON schemas under `packages/spec/json-schema/system/`:
    `ProjectArtifact*.json` → `EnvironmentArtifact*.json` (regenerated at build).

  ### Automatic forward migration

  A new migration `migrateProjectIdToEnvironmentId`
  (`packages/metadata/src/migrations/migrate-project-id-to-environment-id.ts`)
  auto-runs from `DatabaseLoader.ensureSchema()` on bootstrap and rewrites any
  existing `project_id` column on `sys_metadata` / `sys_metadata_history` to
  `environment_id` (idempotent, best-effort). Existing rows are preserved.

  The legacy reverse migration `migrateEnvIdToProjectId` is retained verbatim
  for historical / disaster-recovery use; it is **not** auto-run.

  ## Migration guide

  ```diff
  -os publish --project proj_xyz
  +os publish --environment env_xyz

  -curl -H "X-Project-Id: env_xyz" https://api.example.com/api/v1/data/customer
  +curl -H "X-Environment-Id: env_xyz" https://api.example.com/api/v1/data/customer

  -OS_PROJECT_ID=env_xyz os dev
  +OS_ENVIRONMENT_ID=env_xyz os dev

  -import { createSystemProjectPlugin, SYSTEM_PROJECT_ID } from "@objectstack/runtime";
  +import { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from "@objectstack/runtime";

  -import { ProjectArtifactSchema } from "@objectstack/spec";
  +import { EnvironmentArtifactSchema } from "@objectstack/spec";
  ```

  If you maintain a Cloud control-plane deployment, the `cloud` repository must
  be updated in lockstep to pick up the new plugin identifier strings
  (`single-environment`, `multi-environment`, `objectos-environment`).

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/types@6.0.0
  - @objectstack/metadata-core@6.0.0
  - @objectstack/metadata-fs@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/metadata-core@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/types@5.2.0
  - @objectstack/metadata-fs@5.2.0

## 5.1.0

### Patch Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

- 823d559: Remove `sys_metadata_history.metadata_id` column.

  The column was originally a `Field.lookup` FK into `sys_metadata.id`,
  then downgraded to plain `text` during the M1 history-writes work so
  that DELETE tombstones could keep an orphaned ref. After M1 we
  concluded the column carries no business value:

  - Audit-time joins use `(organization_id, type, name, version)`,
    which is already a UNIQUE composite key.
  - The physical row id is a database-internal detail with no logical
    identity — it cannot follow an item through delete + recreate.
  - No code reader was ever added.

  This release removes the column outright:

  - Dropped `metadata_id` from `SysMetadataHistoryObject`
    (`@objectstack/platform-objects`).
  - Dropped `metadataId` from `MetadataHistoryRecordSchema`
    (`@objectstack/spec`).
  - `SysMetadataRepository.put`/`delete` no longer write the column.
  - Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
    `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
    (no parent-row lookup needed).
  - `MetadataHistoryCleanup` `maxVersions` policy groups by
    `(type, name)` instead of `metadata_id`.

  **Migration**: Drop the column from existing `sys_metadata_history`
  tables in a follow-up SQL migration. Existing history rows remain
  queryable since `(organization_id, type, name, version)` is already
  the canonical lookup key. No consumer code should be reading
  `metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

  See ADR-0008 §14 for the full rationale.

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/metadata-core@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/metadata-fs@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/types@5.1.0

## 5.0.0

### Minor Changes

- 5e9dcb4: **BREAKING — metadata: remove `project` and `branch` from `MetaRef`**

  The metadata layer no longer models project or branch. Customisation is now
  scoped purely to **organisation**. Project remains exclusively as an artifact
  packaging concept (the `objectstack.json` bundle envelope); branching is left
  to Git.

  What changed:

  - `MetaRef` is now `{ org, type, name, version? }` (was
    `{ org, project, branch, type, name, version? }`). `refKey()` is the two
    segment string `${org}/${type}/${name}` (was five segments).
  - `MetadataItem.seq` is monotonic **per org** (was per branch).
  - `BranchRef`, `MergeStrategy`, `MergeResult` types and the optional
    `fork`/`merge` methods on `MetadataRepository` are removed.
  - `ListFilter` / `WatchFilter` / `HistoryOptions` no longer accept `project`
    or `branch`.
  - `FileSystemRepository` disk layout simplified to
    `<root>/<type>/<name>.json` (was `<root>/<project>/<branch>/<type>/<name>.json`);
    change-log path is now `.objectstack/.log/main.jsonl` regardless of any
    branch concept. Constructor no longer accepts `project` / `branch`.
  - `SysMetadataRepository`: removed `projectLabel` / `branchLabel` options;
    the `sys_metadata` schema's `project_id` / `branch` columns (if present)
    are ignored. A future major release will `DROP` them.
  - `MetadataManager.setRepository(repo, opts)` no longer takes an opts object
    with `branch`.

  Migration:

  ```diff
  -const ref = { org: 'acme', project: 'crm', branch: 'main', type: 'view', name: 'home' };
  +const ref = { org: 'acme', type: 'view', name: 'home' };

  -new FileSystemRepository({ root, org: 'acme', project: 'crm', branch: 'main' });
  +new FileSystemRepository({ root, org: 'acme' });
  ```

  Existing `sys_metadata` rows continue to load; the deprecated columns are
  ignored at read time.

- 8b298c7: Attach an `@objectstack/metadata-core` `MetadataRepository` as a
  supplementary event source on `MetadataManager` (ADR-0008 M0 PR-6).

  When a repository is configured via `manager.setRepository(repo)`:

  - the manager subscribes to `repo.watch({ branch: 'main' })` and re-emits
    each event through the legacy `MetadataWatchEvent` channel that
    `manager.subscribe(type, cb)` already exposes, so existing HMR / SSE
    pipelines pick up changes from the new layer automatically;
  - each event also invalidates the in-memory registry entry and the
    `list()` cache for the affected type, so subsequent reads fall
    through to the repository / loaders instead of returning stale data;
  - a new `manager.dispose()` method drains the watch loop and the FS
    watcher cleanly. `MetadataPlugin.stop()` calls it.

  `MetadataPlugin.start()` now instantiates a `FileSystemRepository`
  rooted at `<rootDir>/.objectstack/metadata/` (separate from user source
  files) and attaches it automatically when not in `artifact-only` mode.

  No write-mirroring yet — `register()` / `unregister()` / `save()` keep
  their existing semantics; the canonical write path migrates in PR-10.

- 9e51868: Server-side artifact-file watcher; CLI no longer posts to the HMR
  endpoint on recompile (ADR-0008 M0 PR-8).

  `MetadataPlugin.start()` now attaches a chokidar watcher on the
  `artifactSource.path` when running in local-file mode with `watch !==
false`. On every artifact change it re-invokes `_loadFromLocalFile`
  and broadcasts a `reload` event through the HMR hub. This replaces
  the previous arrangement where `os dev`'s watch-recompile loop POSTed
  `/api/v1/dev/metadata-events` to trigger a reload — the server is now
  autonomous.

  The CLI `dev` command's recompile loop drops the POST call; the
  `/api/v1/dev/metadata-events` route remains available for external
  trigger sources (cloud webhooks, git hooks, ad-hoc curl).

  `MetadataPlugin.stop()` closes the artifact watcher cleanly.

- ddf8080: ADR-0008 M0 PR-9: thread the canonical server-side change-log `seq` from
  `MetadataRepository` events through to the Studio HMR badge. The
  `useMetadataHmr()` hook now exposes `lastSeq` alongside the local
  `version` counter, and the badge tooltip renders "Repo seq: #N" so
  operators can correlate Studio reloads with what other replicas observe.
  Legacy chokidar-driven events still work — they simply leave `seq`
  undefined and consumers fall back to the local counter.

### Patch Changes

- 96ad4df: Fix dev-mode HMR data-reload for `*.view.ts` / `*.flow.ts` source-file edits.

  Three coordinated fixes close the long-standing gap where editing a
  declarative-metadata source file in dev (e.g. `case.view.ts`) would
  recompile `dist/objectstack.json` but the running server kept serving
  the stale boot-time value:

  1. **`@objectstack/objectql`** — `ObjectStackProtocolImplementation.getMetaItem`
     now consults `MetadataService` (HMR-aware) **before** the in-memory
     `SchemaRegistry` (boot-time cache). Previously the registry shadowed
     freshly-registered values: `manager.register('view','case',newDef)`
     updated MetadataManager but `getMetaItem` returned the stale registry
     copy because step 2 (registry) ran before step 3 (service). Reordered
     to "1. sys_metadata overlay → 2. MetadataService → 3. SchemaRegistry".

  2. **`@objectstack/runtime`** — `createStandaloneStack` now enables the
     `MetadataPlugin` artifact-file watcher in non-production environments
     (`NODE_ENV !== 'production'`). Previously hard-coded to `watch: false`,
     leaving nothing watching `dist/objectstack.json` when the CLI dev mode
     recompiled it.

  3. **`@objectstack/metadata`** & **`@objectstack/metadata-fs`** — Both
     chokidar watchers now use `usePolling: true` to avoid `fs.watch`
     EMFILE on macOS / busy dev hosts where the native file-descriptor
     pool can be exhausted by other long-running node processes.

  With these three changes:

  - CLI edits source → recompile artifact (~400ms)
  - Server's polling chokidar detects artifact change → `_loadFromLocalFile`
  - `_loadFromLocalFile` calls `manager.register(type, name, item)`
  - MetadataService now has the fresh value
  - Read path returns the fresh value via the new step-2 lookup
  - Studio SSE listeners re-render

- df18ae9: Fix dev-mode HMR data-reload for view metadata.

  `MetadataPlugin._parseAndRegisterArtifact` previously required a top-level
  `name` on every artifact item and silently skipped those without one.
  View bundles in the compiled artifact carry no top-level `name` (their
  identity is the target object, encoded under `list.data.object` /
  `form.data.object` — same pattern used by `ObjectQL.SchemaRegistry`'s
  `resolveMetadataItemName`). As a result, artifact-loaded views never
  reached `MetadataManager`, and HMR file pushes never affected the read
  path: API responses kept returning the boot-time `SchemaRegistry` copy.

  This change derives the registration key from `list.data.object` (or
  `form.data.object`) when no top-level `name` is present, mirroring the
  ObjectQL convention.

  Also splits the `MetadataPlugin` watch flag into two independent
  options so dev mode can enable artifact-file HMR without paying the
  cost of the source-file scanner:

  - `watch` — controls `NodeMetadataManager`'s recursive source scan
    (default `false`; turning it on in artifact mode would polling-scan
    the entire project root including `node_modules`).
  - `artifactWatch` — controls the cheap single-file polling watcher on
    the compiled artifact (`dist/objectstack.json`). The standalone stack
    enables this automatically when `NODE_ENV !== 'production'`.

- Updated dependencies [5e9dcb4]
- Updated dependencies [4150fe4]
- Updated dependencies [8337cdb]
- Updated dependencies [58835a6]
- Updated dependencies [8cc30b4]
- Updated dependencies [32ce912]
- Updated dependencies [888a5c1]
- Updated dependencies [96ad4df]
- Updated dependencies [2f9073a]
  - @objectstack/metadata-core@5.0.0
  - @objectstack/metadata-fs@5.0.0
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/types@5.0.0

## 4.2.0

### Patch Changes

- 3a99239: Metadata HMR via SSE — close the agent-edits → preview-refresh loop.

  - `@objectstack/metadata`: register `/api/v1/dev/metadata-events` SSE endpoint unconditionally;
    add `POST` trigger that reloads the artifact and broadcasts a `reload` event to all listeners.
  - `@objectstack/cli` (`os dev`): chokidar-based watch on `objectstack.config.ts` and `src/`;
    debounced recompile + `POST` to the HMR endpoint so the server reloads without restart.
  - `@objectstack/studio`: `useMetadataHmr` provider opens an `EventSource`, exposes a version
    counter; previews include it in their query deps, and a top-bar badge surfaces connection
    state and event counts for diagnostics.

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0
  - @objectstack/types@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/types@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.1.0

### Minor Changes

- 1234920: v3.1 — Runtime controls & read-through cache.

  - Generic `LRUCache` (lazy TTL, promote-on-get, size cap, hits/misses/hitRate stats) wired into `DatabaseLoader.{load,loadMany,list,stat}` with write invalidation. Configured via `cache.databaseLoader`.
  - `MetadataPluginConfig.bootstrap` modes: `eager` (default), `lazy`, `artifact-only`. `artifact-only` requires `artifactSource.mode = 'local-file'`.
  - `MetadataManagerConfig.persistence` two-axis write gates: `writable` (gates `register()`) and `overlayWritable` (gates `saveOverlay()`). Both default `true`; either becomes a throw under `validation.throwOnError`.
  - Single-source schema discipline: canonical `MetadataManagerConfigSchema` / `MetadataFallbackStrategySchema` live in `kernel/metadata-loader.zod.ts` and are re-exported from `system/metadata-persistence.zod.ts`.

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0
  - @objectstack/types@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/types@4.0.5
  - @objectstack/platform-objects@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/types@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/types@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/types@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/types@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/types@3.3.1

## 3.3.0

### Patch Changes

- Fix ERR_MODULE_NOT_FOUND on Vercel: add `"type": "module"` and update exports to use `.js`/`.cjs` pattern (consistent with @objectstack/core, @objectstack/runtime)
- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/types@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9
- @objectstack/types@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/types@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/types@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/types@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/types@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/types@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/types@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/types@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/types@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/types@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/types@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/types@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/types@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/types@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/types@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/types@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/types@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/types@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/types@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/types@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/types@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/types@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/types@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/types@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/types@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/types@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/types@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/types@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/types@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/types@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/types@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/types@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/types@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/types@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/spec@1.0.10
  - @objectstack/types@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9
- @objectstack/core@1.0.9
- @objectstack/types@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8
- @objectstack/core@1.0.8
- @objectstack/types@1.0.8

## 1.0.7

### Patch Changes

- @objectstack/spec@1.0.7
- @objectstack/core@1.0.7
- @objectstack/types@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/types@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/core@1.0.5
  - @objectstack/types@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/spec@1.0.4
- @objectstack/core@1.0.4
- @objectstack/types@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
  - @objectstack/core@1.0.3
  - @objectstack/spec@1.0.3
  - @objectstack/types@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2
  - @objectstack/types@1.0.2

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1
- @objectstack/core@1.0.1
- @objectstack/types@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/types@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/types@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/types@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/core@0.8.1
- @objectstack/types@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/types@1.0.0

## 0.7.2

### Patch Changes

- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/types@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/types@0.7.1
  - @objectstack/core@0.7.1
