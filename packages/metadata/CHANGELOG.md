# @objectstack/metadata

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
