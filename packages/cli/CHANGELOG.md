# @objectstack/cli

## 14.8.0

### Minor Changes

- 16b4bf6: ADR-0087 P2:可重放迁移链 + 机器可读变更清单(D3 / D4)。

  **D3 —— 迁移链(`@objectstack/spec` 新增 `migrations/`)。** 一条永久、有序、按协议大版本组织的迁移链。每个大版本的步骤由两个来源合成:**已毕业的转换**(P1 的 D2 转换条目从加载路径退役后,以其 id 引用复用,作为该大版本的“机械变换”,转换与 fixture 不重复)和**语义变更**(无损映射无法表达的破坏,以结构化 TODO —— surface / 原因 / 验收标准 —— 呈现,而非静默或有损自动改写)。

  - `applyMetaMigrations(stack, fromMajor, toMajor?)` 折叠 `fromMajor+1 … 当前` 的步骤,一次性把任意历史大版本的元数据迁到当前;跨大版本是设计主场景。每一跳(hop)都做检查点,便于逐跳验证与二分定位。**时效性从不承重** —— 迟到的使用方到达时重放链即可。
  - `composeMigrationChain`、`MigrationFloorError`,以及显式的发布策略旋钮 `MIGRATION_SUPPORT_FLOOR`(链能回溯到多久)。
  - 种子:protocol 11 步骤 —— 机械项为三条已毕业的 P1 转换;语义项为两个真实存量窗口:`titleFormat` 复合模板 → `nameField`(需公式字段,非无损)、SQL 式 RLS 谓词 → 规范 CEL。
  - CI 把整条链当作链来测:每条转换的 old-shape fixture 从支持下限重放到目标大版本,组合性破坏即发布阻断。

  **D4 —— `spec-changes.json` 变更清单。** Zod 定义的机器可读记录 `{ from, to, added, converted, migrated, removed }`,由 `composeSpecChanges(from, to, surfaceDiff?)` 跨大版本折叠转换表(D2)与迁移集(D3),并与发布期 api-surface 差异连接。按大版本的清单可组合成单一 `from→to` 视图;后续生成式升级指南与 P3 的 MCP `spec_changes` 工具都是它的投影。

  **CLI —— `objectstack migrate meta --from N`。** 重放迁移链:展示生成的、经 `ObjectStackDefinitionSchema` 校验的机械变更 diff(逐条 `path: 旧 → 新`)与需人工判断的语义 TODO;`--to`、`--step`(逐跳检查点)、`--out <file.json>`(把规范化后的栈写为可 diff 的 JSON 快照)、`--json`。命令不静默改写 TS 配置源(AST 改写不安全且有损)—— 输出供使用方 agent 审阅采纳,这正是握手错误(P0)所指向的命令。

  `normalizeStackInput` 新增可选 `convert: false`(仅做 map→array,不跑 D2 转换),供 `migrate meta` 对原始编写源重放链、把每处改写归因到对应链步。新增导出纯增量,无破坏性移除。

- 10e8983: ADR-0089 D3b: add the `validateVisibilityPredicates` lint rule for conditional-visibility keys, wired into `os validate` and `os compile` as advisory warnings.

  Two rules, both `warning` (never fail the build):

  - `visibility-alias-deprecated` — a `visibleOn` (view form section/field) or `visibility` (page component) key in authored source. It still works — the schema normalizes it to `visibleWhen` at parse — but the canonical key is `visibleWhen`. Fix: rename the key (same CEL value).
  - `visibility-root-mislayered` — a runtime view/page visibility predicate rooted at `data.` (the metadata-editing-form root). Runtime record surfaces bind `record` + `current_user` (pages also expose `page.<var>`), so a `data.`-rooted predicate here never matches and the element renders unconditionally. Fix: use `record.`/`page.`.

  The rule runs on the **pre-parse** stack (like `validate-list-view-mode`) so it can see the deprecated alias the author actually wrote before the schema folds it into `visibleWhen`.

- 5540ced: feat(cli): surface the migration guide when an app's specVersion trails the installed platform

  `os validate`, `os build`/`os compile`, and `os doctor` now emit a non-blocking
  advisory when the app's authored `manifest.specVersion` declares an OLDER major
  than the `@objectstack/spec` actually installed in its `node_modules` — pointing
  at the curated per-major migration guide (`https://docs.objectstack.ai/docs/releases/v<major>`,
  guaranteed to exist by `scripts/check-release-notes.mjs`).

  This closes a discoverability gap for downstream/third-party apps: on a platform
  upgrade the release notes were only reachable by reverse-engineering per-package
  `CHANGELOG.md` files. The advisory now surfaces the guide at the exact moment the
  upgrade is exercised. It never fails a build/validate and is not gated by
  `--strict`; it also appears in the `--json` output as `specVersionGap`. Logic
  lives in a new shared `checkSpecVersionGap()` util (unit-tested; installed
  version injectable for tests).

- bb71321: i18n: translate the system account/messaging surfaces end to end.

  - **spec**: `ObjectTranslationDataSchema` / `ObjectTranslationNodeSchema` now
    accept `_views.<view>.emptyState.{title,message}` so list-view empty states
    are translatable (contract-first for the extractor below).
  - **cli**: `os i18n extract` emits `_views.<view>.emptyState` keys when a view
    declares an empty state.
  - **platform-objects**: fill every missing zh-CN/ja-JP/es-ES translation for
    `sys_user`, `sys_organization` and `sys_business_unit` (fields, options,
    views, actions); replace the hardcoded English tab/section/action labels in
    the `sys_user`, `sys_organization` and `sys_position` detail pages with
    inline i18n label objects, and route the user Security tab through
    `record:quick_actions` so object action labels localize.
  - **service-messaging**: new ADR-0029 D8 translation bundle
    (`MessagingTranslations`) covering the seven `sys_*` messaging objects
    (inbox message, receipts, deliveries, preferences, subscriptions, templates,
    HTTP deliveries), registered on `kernel:ready`; zh-CN is fully translated
    and ja-JP/es-ES cover `sys_inbox_message` (incl. the `mine` view empty
    state).

### Patch Changes

- eaff014: `os validate` now runs the ADR-0090 D7 security posture check, restoring its documented contract of being the artifact-free run of the same gates as `os compile`/`os build`. Previously a stack could pass `validate` and then fail the build — e.g. a custom object with no explicit `sharingModel` (OWD), which the posture linter rejects at compile. Error findings gate validation; advisory findings print as warnings (and join the `--json` warnings array).
- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [10e8983]
- Updated dependencies [a199626]
- Updated dependencies [d1b1a94]
- Updated dependencies [84650c5]
- Updated dependencies [607aaf4]
- Updated dependencies [e46169c]
- Updated dependencies [f0acf25]
- Updated dependencies [712328a]
- Updated dependencies [1dede32]
- Updated dependencies [bb71321]
- Updated dependencies [a199626]
  - @objectstack/spec@14.8.0
  - @objectstack/service-automation@14.8.0
  - @objectstack/lint@14.8.0
  - @objectstack/plugin-security@14.8.0
  - @objectstack/console@14.8.0
  - @objectstack/driver-sql@14.8.0
  - @objectstack/rest@14.8.0
  - @objectstack/plugin-reports@14.8.0
  - @objectstack/client@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/service-messaging@14.8.0
  - @objectstack/driver-sqlite-wasm@14.8.0
  - @objectstack/account@14.8.0
  - @objectstack/setup@14.8.0
  - @objectstack/cloud-connection@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/mcp@14.8.0
  - @objectstack/metadata@14.8.0
  - @objectstack/objectql@14.8.0
  - @objectstack/observability@14.8.0
  - @objectstack/driver-memory@14.8.0
  - @objectstack/driver-mongodb@14.8.0
  - @objectstack/plugin-approvals@14.8.0
  - @objectstack/plugin-audit@14.8.0
  - @objectstack/plugin-auth@14.8.0
  - @objectstack/plugin-email@14.8.0
  - @objectstack/plugin-hono-server@14.8.0
  - @objectstack/plugin-sharing@14.8.0
  - @objectstack/plugin-webhooks@14.8.0
  - @objectstack/runtime@14.8.0
  - @objectstack/service-analytics@14.8.0
  - @objectstack/service-cache@14.8.0
  - @objectstack/service-datasource@14.8.0
  - @objectstack/service-job@14.8.0
  - @objectstack/service-package@14.8.0
  - @objectstack/service-queue@14.8.0
  - @objectstack/service-realtime@14.8.0
  - @objectstack/service-settings@14.8.0
  - @objectstack/service-sms@14.8.0
  - @objectstack/service-storage@14.8.0
  - @objectstack/trigger-api@14.8.0
  - @objectstack/trigger-record-change@14.8.0
  - @objectstack/trigger-schedule@14.8.0
  - @objectstack/types@14.8.0
  - @objectstack/verify@14.8.0

## 14.7.0

### Minor Changes

- 824a395: Tenancy mode as a first-class capability + a single owner for the user→membership
  lifecycle (ADR-0093, Phases 1–3).

  **Tenancy service (`@objectstack/types`, `@objectstack/plugin-auth`).** plugin-auth
  registers a `tenancy` service — the single source of truth for tenancy mode
  (`mode`, `isolationActive`, `requested`, `degraded`, `defaultOrgId()`). It derives
  `isolationActive` from the presence of the `org-scoping` service, so the
  enterprise `@objectstack/organizations` package lights it up with no change.
  SecurityPlugin's RLS-strip gate and `/auth/config` (`features.multiOrgEnabled`,
  new `features.degradedTenancy`) now consume it instead of re-deriving the fact.

  **Fail-fast on degraded tenancy (`@objectstack/cli`, ADR-0093 D5).**
  `OS_MULTI_ORG_ENABLED=true` without a working `@objectstack/organizations` now
  **refuses to boot** — a deployment that requested tenant isolation must not serve
  traffic without it (tenant RLS would be silently stripped). Escape hatch:
  `OS_ALLOW_DEGRADED_TENANCY=1` boots in an explicitly branded degraded state
  (`features.degradedTenancy`). **This may halt upgrades for deployments that were
  silently degraded — intentionally; install the enterprise package or set the
  escape hatch.**

  **Membership reconciler (`@objectstack/plugin-auth`, ADR-0093 D1–D3, D6).** A
  single reconciler composed into better-auth's `user.create.after` hook owns the
  "every new user gets a membership" invariant across all creation paths (signup,
  admin create-user, import, SSO JIT). It yields to any existing membership (host
  hooks win), honors a new `membershipPolicy: 'auto' | 'invite-only'` auth option
  (default `auto`), and binds only to an unambiguous target org (single-org default;
  multi-org binds nothing). A bounded, idempotent `kernel:ready` backfill covers
  pre-existing member-less users in single-org/auto deployments
  (`OS_SKIP_MEMBERSHIP_BACKFILL=1` to opt out). The endpoint-level create-user bind
  from #2882 now delegates to this shared reconciler.

  New env vars: `OS_ALLOW_DEGRADED_TENANCY`, `OS_SKIP_MEMBERSHIP_BACKFILL`. New docs:
  Deployment → Tenancy Modes & Membership.

### Patch Changes

- Updated dependencies [9f03fdd]
- Updated dependencies [f71339c]
- Updated dependencies [35f6c61]
- Updated dependencies [956208e]
- Updated dependencies [d6a72eb]
- Updated dependencies [da5e686]
- Updated dependencies [824a395]
- Updated dependencies [f344ee1]
  - @objectstack/console@14.7.0
  - @objectstack/spec@14.7.0
  - @objectstack/plugin-sharing@14.7.0
  - @objectstack/plugin-auth@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/plugin-security@14.7.0
  - @objectstack/plugin-webhooks@14.7.0
  - @objectstack/account@14.7.0
  - @objectstack/setup@14.7.0
  - @objectstack/client@14.7.0
  - @objectstack/cloud-connection@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/lint@14.7.0
  - @objectstack/mcp@14.7.0
  - @objectstack/metadata@14.7.0
  - @objectstack/objectql@14.7.0
  - @objectstack/observability@14.7.0
  - @objectstack/platform-objects@14.7.0
  - @objectstack/driver-memory@14.7.0
  - @objectstack/driver-mongodb@14.7.0
  - @objectstack/driver-sql@14.7.0
  - @objectstack/driver-sqlite-wasm@14.7.0
  - @objectstack/plugin-approvals@14.7.0
  - @objectstack/plugin-audit@14.7.0
  - @objectstack/plugin-email@14.7.0
  - @objectstack/plugin-hono-server@14.7.0
  - @objectstack/plugin-reports@14.7.0
  - @objectstack/rest@14.7.0
  - @objectstack/runtime@14.7.0
  - @objectstack/service-analytics@14.7.0
  - @objectstack/service-automation@14.7.0
  - @objectstack/service-cache@14.7.0
  - @objectstack/service-datasource@14.7.0
  - @objectstack/service-job@14.7.0
  - @objectstack/service-messaging@14.7.0
  - @objectstack/service-package@14.7.0
  - @objectstack/service-queue@14.7.0
  - @objectstack/service-realtime@14.7.0
  - @objectstack/service-settings@14.7.0
  - @objectstack/service-sms@14.7.0
  - @objectstack/service-storage@14.7.0
  - @objectstack/trigger-api@14.7.0
  - @objectstack/trigger-record-change@14.7.0
  - @objectstack/trigger-schedule@14.7.0
  - @objectstack/verify@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [160d565]
- Updated dependencies [b42ae3d]
- Updated dependencies [1d4c359]
- Updated dependencies [1d4c359]
- Updated dependencies [e4cf774]
- Updated dependencies [ce6d151]
- Updated dependencies [8f4a261]
- Updated dependencies [6e2b8ae]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/plugin-auth@14.6.0
  - @objectstack/console@14.6.0
  - @objectstack/client@14.6.0
  - @objectstack/driver-sql@14.6.0
  - @objectstack/objectql@14.6.0
  - @objectstack/plugin-security@14.6.0
  - @objectstack/account@14.6.0
  - @objectstack/setup@14.6.0
  - @objectstack/cloud-connection@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0
  - @objectstack/lint@14.6.0
  - @objectstack/mcp@14.6.0
  - @objectstack/metadata@14.6.0
  - @objectstack/observability@14.6.0
  - @objectstack/driver-memory@14.6.0
  - @objectstack/driver-mongodb@14.6.0
  - @objectstack/driver-sqlite-wasm@14.6.0
  - @objectstack/plugin-approvals@14.6.0
  - @objectstack/plugin-audit@14.6.0
  - @objectstack/plugin-email@14.6.0
  - @objectstack/plugin-hono-server@14.6.0
  - @objectstack/plugin-reports@14.6.0
  - @objectstack/plugin-sharing@14.6.0
  - @objectstack/plugin-webhooks@14.6.0
  - @objectstack/rest@14.6.0
  - @objectstack/runtime@14.6.0
  - @objectstack/service-analytics@14.6.0
  - @objectstack/service-automation@14.6.0
  - @objectstack/service-cache@14.6.0
  - @objectstack/service-datasource@14.6.0
  - @objectstack/service-job@14.6.0
  - @objectstack/service-messaging@14.6.0
  - @objectstack/service-package@14.6.0
  - @objectstack/service-queue@14.6.0
  - @objectstack/service-realtime@14.6.0
  - @objectstack/service-settings@14.6.0
  - @objectstack/service-sms@14.6.0
  - @objectstack/service-storage@14.6.0
  - @objectstack/trigger-api@14.6.0
  - @objectstack/trigger-record-change@14.6.0
  - @objectstack/trigger-schedule@14.6.0
  - @objectstack/types@14.6.0
  - @objectstack/verify@14.6.0

## 14.5.0

### Minor Changes

- 526805e: ADR-0057 data-lifecycle follow-ups (#2834): the per-plugin retention sweepers are retired, telemetry separation goes live in dev, and the lifecycle contract reaches the Studio.

  - **BREAKING (ships as minor per the launch-window convention)**: `JobRunRetention` / `NotificationRetention` and the `retentionDays` / `retentionSweepMs` options on `JobServicePlugin` / `MessagingServicePlugin` are removed. The platform LifecycleService enforces the same windows from the `lifecycle` declarations (`sys_job_run` 30d, notification pipeline 90d); tune them at runtime via the `lifecycle` settings namespace (`retention_overrides`, tenant-scoped).
  - **Fix**: `sys_automation_run` no longer declares a blanket 30d lifecycle retention — that table interleaves live SUSPENDED runs (an approval may stay paused for months) with terminal history, and a blanket age reap could strand in-flight approvals. Bounding stays with the automation store's terminal-only sweep.
  - **CLI**: `objectstack dev` now provisions a dedicated `telemetry` datasource (`<primary>.telemetry.db`) for file-backed SQLite primaries, so lifecycle-classed system data stops sharing the business dev DB (`OS_TELEMETRY_DB=0` opts out; `OS_TELEMETRY_DB=<path>` opts in anywhere). New `os db clean` runs the one-time `VACUUM` that lets legacy files adopt `auto_vacuum=INCREMENTAL` and reports reclaimed bytes.
  - **Studio**: the object metadata form exposes the `lifecycle` block (class + retention/TTL/rotation/archive/reclaim); metadata-forms i18n bundles regenerated with curated zh-CN translations.

### Patch Changes

- decd174: fix(cli): resolve `http.server` asynchronously in the console / runtime-assets static plugins

  `createConsoleStaticPlugin` and `createRuntimeAssetsPlugin` fetched the
  `http.server` service with the **synchronous** `ctx.getService('http.server')`.
  When `http.server` is registered as an async factory (the console /
  schema-migration boot path), that accessor throws
  `Service 'http.server' is async - use await`; because the call sat outside
  any try/catch, the throw escaped the plugin's `start()` and rolled back
  kernel bootstrap — crashing the CONSOLE/migration boot
  (`Plugin startup failed: com.objectstack.runtime-assets`). The runtime
  `serve` path, where `http.server` is registered synchronously, was
  unaffected, which is why only the control-plane migration boot broke.

  Resolve both plugins' `http.server` through a shared `resolveHttpServer`
  helper that prefers the async accessor (`getServiceAsync`, which resolves a
  sync- or async-registered service) and falls back to the sync one, mirroring
  plugin-auth's async `cache` lookup. The helper never throws, so these
  optional static-asset plugins skip cleanly when no HTTP server is present
  instead of taking down boot.

- Updated dependencies [526805e]
- Updated dependencies [e8cedec]
- Updated dependencies [5f43f88]
- Updated dependencies [6da03ee]
- Updated dependencies [0719fc7]
- Updated dependencies [0719fc7]
- Updated dependencies [261aff5]
- Updated dependencies [f70eb2c]
- Updated dependencies [d79ca07]
- Updated dependencies [a348394]
- Updated dependencies [4d9dd7b]
- Updated dependencies [5bced2f]
- Updated dependencies [3fd87b2]
- Updated dependencies [33ebd34]
- Updated dependencies [6da03ee]
- Updated dependencies [e2c05d6]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/service-job@14.5.0
  - @objectstack/service-messaging@14.5.0
  - @objectstack/service-automation@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/mcp@14.5.0
  - @objectstack/runtime@14.5.0
  - @objectstack/console@14.5.0
  - @objectstack/plugin-security@14.5.0
  - @objectstack/plugin-sharing@14.5.0
  - @objectstack/plugin-auth@14.5.0
  - @objectstack/rest@14.5.0
  - @objectstack/objectql@14.5.0
  - @objectstack/plugin-hono-server@14.5.0
  - @objectstack/service-settings@14.5.0
  - @objectstack/account@14.5.0
  - @objectstack/setup@14.5.0
  - @objectstack/client@14.5.0
  - @objectstack/cloud-connection@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0
  - @objectstack/lint@14.5.0
  - @objectstack/metadata@14.5.0
  - @objectstack/observability@14.5.0
  - @objectstack/driver-memory@14.5.0
  - @objectstack/driver-mongodb@14.5.0
  - @objectstack/driver-sql@14.5.0
  - @objectstack/driver-sqlite-wasm@14.5.0
  - @objectstack/plugin-approvals@14.5.0
  - @objectstack/plugin-audit@14.5.0
  - @objectstack/plugin-email@14.5.0
  - @objectstack/plugin-reports@14.5.0
  - @objectstack/plugin-webhooks@14.5.0
  - @objectstack/service-analytics@14.5.0
  - @objectstack/service-cache@14.5.0
  - @objectstack/service-datasource@14.5.0
  - @objectstack/service-package@14.5.0
  - @objectstack/service-queue@14.5.0
  - @objectstack/service-realtime@14.5.0
  - @objectstack/service-sms@14.5.0
  - @objectstack/service-storage@14.5.0
  - @objectstack/trigger-api@14.5.0
  - @objectstack/trigger-record-change@14.5.0
  - @objectstack/trigger-schedule@14.5.0
  - @objectstack/types@14.5.0
  - @objectstack/verify@14.5.0

## 14.4.0

### Patch Changes

- 1c19139: refactor(sms): rename `@objectstack/plugin-sms` to `@objectstack/service-sms`

  Infrastructure services follow the `service-*` convention
  (`service-messaging`, `service-settings`, …) — the `plugin-*` prefix was a
  misfit for a package whose whole job is registering the `sms` kernel
  service (`plugin-email` is legacy debt, not precedent). Same exports, same
  `SmsServicePlugin` class, same `sms` service id and settings namespace —
  only the package name and its home (`packages/services/service-sms`)
  change. The one published `@objectstack/plugin-sms@14.3.0` release should
  be npm-deprecated in favour of `@objectstack/service-sms`.

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [9887465]
- Updated dependencies [7449476]
- Updated dependencies [1c19139]
  - @objectstack/spec@14.4.0
  - @objectstack/objectql@14.4.0
  - @objectstack/driver-sql@14.4.0
  - @objectstack/driver-sqlite-wasm@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/service-messaging@14.4.0
  - @objectstack/service-automation@14.4.0
  - @objectstack/plugin-audit@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/plugin-security@14.4.0
  - @objectstack/plugin-sharing@14.4.0
  - @objectstack/lint@14.4.0
  - @objectstack/plugin-auth@14.4.0
  - @objectstack/service-sms@14.4.0
  - @objectstack/account@14.4.0
  - @objectstack/setup@14.4.0
  - @objectstack/client@14.4.0
  - @objectstack/cloud-connection@14.4.0
  - @objectstack/formula@14.4.0
  - @objectstack/mcp@14.4.0
  - @objectstack/observability@14.4.0
  - @objectstack/driver-memory@14.4.0
  - @objectstack/driver-mongodb@14.4.0
  - @objectstack/plugin-approvals@14.4.0
  - @objectstack/plugin-email@14.4.0
  - @objectstack/plugin-hono-server@14.4.0
  - @objectstack/plugin-reports@14.4.0
  - @objectstack/plugin-webhooks@14.4.0
  - @objectstack/rest@14.4.0
  - @objectstack/runtime@14.4.0
  - @objectstack/service-analytics@14.4.0
  - @objectstack/service-cache@14.4.0
  - @objectstack/service-datasource@14.4.0
  - @objectstack/service-job@14.4.0
  - @objectstack/service-package@14.4.0
  - @objectstack/service-queue@14.4.0
  - @objectstack/service-realtime@14.4.0
  - @objectstack/service-settings@14.4.0
  - @objectstack/service-storage@14.4.0
  - @objectstack/trigger-api@14.4.0
  - @objectstack/trigger-record-change@14.4.0
  - @objectstack/trigger-schedule@14.4.0
  - @objectstack/types@14.4.0
  - @objectstack/verify@14.4.0
  - @objectstack/console@14.4.0

## 14.3.0

### Minor Changes

- 8f0b9df: fix(cli,plugin-security): `os meta resync` to re-materialize default permission sets from dist (#2705)

  The default permission sets (`admin_full_access` / `member_default` /
  `viewer_readonly` …) were seeded **insert-once** at boot: `bootstrapPlatformAdmin`
  skipped any row that already existed and never wrote the shipped declaration
  back. So editing a default set's source, recompiling, and restarting `os dev`
  **without** `--fresh` left the runtime serving the OLD value — silently, because
  the runtime authz resolver hydrates permission sets from the `sys_permission_set`
  row (`resolve-authz-context.ts`), not from the in-memory dist. A permission-gated
  surface (e.g. `setup.access`) would keep its stale behavior with no error, which
  repeatedly misled debugging. Every _other_ metadata seed (declared permission
  sets, positions, built-in roles, capabilities) already upserts on boot, leaving
  the platform-default path the lone insert-once holdout — a gap ADR-0090 widened
  by persisting more facets (`system_permissions`, delegated-admin `admin_scope`)
  onto the same row.

  The insert-once posture is deliberate for prod (it protects an admin's Setup
  edits and keeps the defaults env-authored — the exact posture
  `bootstrapDeclaredPermissions` relies on), so this is **not** switched to a blind
  upsert. Instead:

  - `bootstrapPlatformAdmin` gains a `resync` option. Default boot behavior is
    unchanged (insert-once). Under `resync`, an existing row is reconciled to the
    shipped dist **only** when the platform still owns it (`managed_by` absent or
    `'platform'`); a row an admin took over (`managed_by:'user'`) or a package owns
    (`'package'`) is an intentional override and is left untouched.
  - New `os meta resync` command boots the runtime, reconciles the default
    permission-set rows to the compiled dist, and reports what was reconciled /
    preserved / newly seeded — **without touching business data** and without a
    `--fresh` wipe. Gated behind a confirmation prompt (`--yes` to skip; `--json`
    for scripting).

  Prod boot is unaffected; the fix is entirely opt-in via the new command.

- c1064f1: feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

  #2766 shipped phone+password sign-in but no OTP — the platform had no SMS
  delivery capability. This adds the missing infrastructure end to end:

  - **New `@objectstack/plugin-sms`** — `ISmsService`/`ISmsTransport` contracts
    (spec) with Aliyun SMS (ACS3-HMAC-SHA256, template-based) and Twilio
    transports plus a dev log fallback. Configured through the new `sms`
    settings namespace (live provider rebind, encrypted secrets, send-test
    action; `OS_SMS_*` env keys win at the resolver). Deliberately NO message
    persistence and NO body logging — SMS bodies carry OTP codes.
  - **Messaging `sms` channel** — registered at kernel:ready when an `sms`
    service is present; `notify(channels:['sms'])` resolves
    `sys_user.phone_number`, renders `(topic,'sms',locale)` templates, and
    inherits outbox retry/dead-letter.
  - **Phone OTP flows open** — the phoneNumber plugin's `sendOTP` /
    `sendPasswordResetOTP` now deliver via SMS, enabling
    `/phone-number/send-otp` + `/verify` (OTP sign-in/verification) and
    `/phone-number/request-password-reset` + `/reset-password` (self-service
    reset). Without a deliverable SMS service they keep failing loudly
    (NOT_SUPPORTED); `features.phoneNumberOtp` advertises real availability.
    Shipped with the abuse hardening: explicit `allowedAttempts: 3`, always-on
    per-number cooldown (60s) + rolling-hour cap (5, secondaryStorage-shared
    across nodes), `/phone-number/*` in the settings-bound per-IP rate-limit
    rules, and OTP codes never reach logs or error messages.
  - **Import SMS invites** — `/admin/import-users`'s `invite` policy now
    supports phone-only rows: a credential-free invitation SMS points the
    employee at phone-OTP first sign-in followed by self-set password; mixed
    files validate the reachable channel per row.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [8f0b9df]
- Updated dependencies [ff648ad]
- Updated dependencies [c1064f1]
- Updated dependencies [bea4b92]
  - @objectstack/plugin-auth@14.3.0
  - @objectstack/platform-objects@14.3.0
  - @objectstack/rest@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/plugin-security@14.3.0
  - @objectstack/lint@14.3.0
  - @objectstack/objectql@14.3.0
  - @objectstack/plugin-sms@14.3.0
  - @objectstack/service-messaging@14.3.0
  - @objectstack/service-settings@14.3.0
  - @objectstack/runtime@14.3.0
  - @objectstack/verify@14.3.0
  - @objectstack/account@14.3.0
  - @objectstack/setup@14.3.0
  - @objectstack/plugin-approvals@14.3.0
  - @objectstack/plugin-audit@14.3.0
  - @objectstack/plugin-email@14.3.0
  - @objectstack/plugin-reports@14.3.0
  - @objectstack/plugin-sharing@14.3.0
  - @objectstack/service-job@14.3.0
  - @objectstack/service-queue@14.3.0
  - @objectstack/service-realtime@14.3.0
  - @objectstack/service-storage@14.3.0
  - @objectstack/client@14.3.0
  - @objectstack/cloud-connection@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0
  - @objectstack/mcp@14.3.0
  - @objectstack/observability@14.3.0
  - @objectstack/driver-memory@14.3.0
  - @objectstack/driver-mongodb@14.3.0
  - @objectstack/driver-sql@14.3.0
  - @objectstack/driver-sqlite-wasm@14.3.0
  - @objectstack/plugin-hono-server@14.3.0
  - @objectstack/plugin-webhooks@14.3.0
  - @objectstack/service-analytics@14.3.0
  - @objectstack/service-automation@14.3.0
  - @objectstack/service-cache@14.3.0
  - @objectstack/service-datasource@14.3.0
  - @objectstack/service-package@14.3.0
  - @objectstack/trigger-api@14.3.0
  - @objectstack/trigger-record-change@14.3.0
  - @objectstack/trigger-schedule@14.3.0
  - @objectstack/types@14.3.0
  - @objectstack/console@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/plugin-hono-server@14.2.0
  - @objectstack/plugin-security@14.2.0
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/client@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/service-datasource@14.2.0
  - @objectstack/verify@14.2.0
  - @objectstack/account@14.2.0
  - @objectstack/setup@14.2.0
  - @objectstack/cloud-connection@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/lint@14.2.0
  - @objectstack/mcp@14.2.0
  - @objectstack/objectql@14.2.0
  - @objectstack/observability@14.2.0
  - @objectstack/driver-memory@14.2.0
  - @objectstack/driver-mongodb@14.2.0
  - @objectstack/driver-sql@14.2.0
  - @objectstack/driver-sqlite-wasm@14.2.0
  - @objectstack/plugin-approvals@14.2.0
  - @objectstack/plugin-audit@14.2.0
  - @objectstack/plugin-auth@14.2.0
  - @objectstack/plugin-email@14.2.0
  - @objectstack/plugin-reports@14.2.0
  - @objectstack/plugin-sharing@14.2.0
  - @objectstack/plugin-webhooks@14.2.0
  - @objectstack/rest@14.2.0
  - @objectstack/service-analytics@14.2.0
  - @objectstack/service-automation@14.2.0
  - @objectstack/service-cache@14.2.0
  - @objectstack/service-job@14.2.0
  - @objectstack/service-messaging@14.2.0
  - @objectstack/service-package@14.2.0
  - @objectstack/service-queue@14.2.0
  - @objectstack/service-realtime@14.2.0
  - @objectstack/service-settings@14.2.0
  - @objectstack/service-storage@14.2.0
  - @objectstack/trigger-api@14.2.0
  - @objectstack/trigger-record-change@14.2.0
  - @objectstack/trigger-schedule@14.2.0
  - @objectstack/types@14.2.0
  - @objectstack/console@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/plugin-approvals@14.1.0
  - @objectstack/lint@14.1.0
  - @objectstack/account@14.1.0
  - @objectstack/setup@14.1.0
  - @objectstack/client@14.1.0
  - @objectstack/cloud-connection@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/mcp@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/observability@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/driver-memory@14.1.0
  - @objectstack/driver-mongodb@14.1.0
  - @objectstack/driver-sql@14.1.0
  - @objectstack/driver-sqlite-wasm@14.1.0
  - @objectstack/plugin-audit@14.1.0
  - @objectstack/plugin-auth@14.1.0
  - @objectstack/plugin-email@14.1.0
  - @objectstack/plugin-hono-server@14.1.0
  - @objectstack/plugin-reports@14.1.0
  - @objectstack/plugin-security@14.1.0
  - @objectstack/plugin-sharing@14.1.0
  - @objectstack/plugin-webhooks@14.1.0
  - @objectstack/rest@14.1.0
  - @objectstack/runtime@14.1.0
  - @objectstack/service-analytics@14.1.0
  - @objectstack/service-automation@14.1.0
  - @objectstack/service-cache@14.1.0
  - @objectstack/service-datasource@14.1.0
  - @objectstack/service-job@14.1.0
  - @objectstack/service-messaging@14.1.0
  - @objectstack/service-package@14.1.0
  - @objectstack/service-queue@14.1.0
  - @objectstack/service-realtime@14.1.0
  - @objectstack/service-settings@14.1.0
  - @objectstack/service-storage@14.1.0
  - @objectstack/trigger-api@14.1.0
  - @objectstack/trigger-record-change@14.1.0
  - @objectstack/trigger-schedule@14.1.0
  - @objectstack/types@14.1.0
  - @objectstack/verify@14.1.0
  - @objectstack/console@14.1.0

## 14.0.0

### Patch Changes

- e2fa074: feat(data): make object `enable.feeds`/`enable.activities` real opt-out gates; define the `enable.trackHistory` contract (#2707)

  `ObjectSchema.enable.{files,trackHistory,activities,feeds}` were parsed but
  (mostly) unconsumed — an author setting them got nothing, silently. Per the
  enforce-or-remove doctrine, each flag now has a defined enforcement contract:

  - `enable.activities` — opt-OUT writer gate. Spec default flips
    `false → true`; plugin-audit keeps mirroring CRUD into the `sys_activity`
    timeline unless the object declares an explicit `activities: false`
    (behavior-preserving for every existing stack; the off-switch is the
    per-object lever for activity-row growth, ADR-0057). The compliance
    `sys_audit_log` row is NOT gated.
  - `enable.feeds` — opt-OUT with server-side enforcement. Spec default flips
    `false → true`; an explicit `feeds: false` now rejects `sys_comment`
    creation targeting that object at the engine hook seam
    (403 `FEEDS_DISABLED`, fail-closed like `CLONE_DISABLED`).
  - `enable.trackHistory` — was misclassified `dead` in the liveness ledger:
    the console has gated the record History tab on it since 2026-05.
    Reclassified live with the two-grain contract documented (object flag =
    History-tab master switch; per-field `trackHistory` = diff selector; audit
    _capture_ stays unconditional as a compliance ledger).
  - `enable.files` — stays dead + authorWarn (reserved for the future generic
    Attachments panel; use `Field.file`/`Field.image` meanwhile). Its
    `describe()` now says so instead of advertising a capability that
    doesn't exist.

  The default flips can't be avoided: with `default(false)`, compiled output
  materializes `false` for every object with an `enable` block, making
  "author explicitly opted out" indistinguishable from "schema default" — so
  opt-out semantics require the default to be `true` (same posture as
  `trash`/`mru`/`clone`). Liveness ledger + reference docs regenerated;
  compile-time authorWarn now fires only for `enable.files`.

- 23c8668: feat(data): `enable.files` goes live — opt-in gate for the generic Attachments surface (#2727)

  The last dead ObjectCapabilities flag gets its enforcement contract.
  `enable.files` is opt-IN (spec default stays `false`): the generic record
  Attachments panel is a new surface, not an existing behavior.

  - plugin-audit registers a `sys_attachment` beforeInsert hook: attachment
    join rows may only target objects that explicitly declare
    `enable: { files: true }` — anything else (absent block, absent flag,
    explicit false, unknown object) rejects fail-closed with
    403 `FILES_DISABLED` (CLONE_DISABLED / FEEDS_DISABLED pattern).
  - `mapDataError` maps `FILES_DISABLED` → 403 with the gated target object
    (generic data routes bypass `sendError`'s `.status` passthrough — the
    #2707 lesson, applied at introduction time).
  - `Field.file` / `Field.image` are deliberately independent: they store
    the file URL in the record's own column and never create
    `sys_attachment` rows, so field-level attachments work regardless of
    this flag.
  - Liveness ledger: `enable.files` dead→live, authorWarn dropped —
    ObjectCapabilities is now 100% live. The compile-time
    liveness-dead-property warning no longer fires for it; `describe()` and
    the reference docs state the real contract.

  Companion objectui PR ships `RecordAttachmentsPanel` (upload/list/
  download/delete over the presigned three-step storage flow), rendered on
  record pages when the flag is true.

- 29f017d: chore(liveness): authorWarn sweep across all governed types + lint coverage to match

  Every remaining _misleading_ dead property now warns at compile time (12 new
  markings): `flow.errorHandling.fallbackNodeId` (engine uses fault edges),
  `flow.nodes[].outputSchema` (never validated), `flow.template`,
  `action.timeout` (no runtime enforcement), `object.tenancy.strategy` /
  `crossTenantAccess` (only enabled+tenantField are read), `object.abstract`,
  `field.dependencies`, `agent.tenantId`, `tool.permissions` (invocation not
  permission-gated), `permission.contextVariables` (RLS reads current_user.\*
  only), `dataset.measures[].certified` (governance flag unenforced).

  The compile-time lint previously only checked objects+fields, so markings on
  other types were silent — it now covers every governed type (flat stack
  collections) and fans container checks out over arrays (one finding per
  item+path). Benign display metadata (label/description/tags) stays unmarked
  per the README's signal rules.

  Also re-anchors the README: the counts table had drifted badly (field listed
  as 34 live/39 dead vs the ledger's actual 54/6; `action.disabled` was still
  described as ignored though it went live via metadata-admin) — replaced with
  regenerable numbers plus the script to regenerate them, and added the
  cross-repo evidence rule (grep ../objectui before classifying dead — the
  enable.trackHistory lesson, #2707).

- 216fa9a: Add a `position` approver type so approvals can route to org positions (ADR-0090 D3 fallout).

  Post ADR-0090 D3 the `role` approver type resolves against the better-auth org-membership
  tier (`sys_member.role`: `owner`/`admin`/`member`) — it was never a position. Downstream
  apps that authored `{ type: 'role', value: 'sales_manager' }` silently routed approvals to
  nobody. Now:

  - **spec**: `ApproverType` gains `'position'` — `value` is the position machine name; the
    approver expands to its holders via `sys_user_position`. Authoring guidance: keep
    `type: 'role'` ONLY for membership tiers; for org positions use
    `{ type: 'position', value: '<position_name>' }` (one-line fix for the mismatch above).
  - **plugin-approvals**: the engine resolves `position` approvers via `sys_user_position` ∪
    the `sys_member.role` transition source (same semantics as `PositionGraphService` in
    plugin-sharing). The `department` approver type is now honored by its spec spelling
    (previously only the off-spec `business_unit`/`bu` dialect matched).
  - **lint**: new `validateApprovalApprovers` rule — `approval-role-not-membership-tier`
    warns when a `role` approver's value is not a membership tier and prescribes the
    `position` rewrite; `approval-approver-type-unknown` flags off-spec approver types
    (with a `business_unit` → `department` fix-it). Wired into `os lint`.

- Updated dependencies [57b8fe0]
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [ac08698]
- Updated dependencies [23c8668]
- Updated dependencies [2f3581f]
- Updated dependencies [29f017d]
- Updated dependencies [bc26360]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
- Updated dependencies [bd39dc5]
- Updated dependencies [1056c5f]
  - @objectstack/runtime@14.0.0
  - @objectstack/spec@14.0.0
  - @objectstack/plugin-sharing@14.0.0
  - @objectstack/plugin-security@14.0.0
  - @objectstack/mcp@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/plugin-audit@14.0.0
  - @objectstack/rest@14.0.0
  - @objectstack/lint@14.0.0
  - @objectstack/driver-sql@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/plugin-approvals@14.0.0
  - @objectstack/client@14.0.0
  - @objectstack/cloud-connection@14.0.0
  - @objectstack/verify@14.0.0
  - @objectstack/account@14.0.0
  - @objectstack/setup@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/formula@14.0.0
  - @objectstack/observability@14.0.0
  - @objectstack/driver-memory@14.0.0
  - @objectstack/driver-mongodb@14.0.0
  - @objectstack/driver-sqlite-wasm@14.0.0
  - @objectstack/plugin-auth@14.0.0
  - @objectstack/plugin-email@14.0.0
  - @objectstack/plugin-hono-server@14.0.0
  - @objectstack/plugin-reports@14.0.0
  - @objectstack/plugin-webhooks@14.0.0
  - @objectstack/service-analytics@14.0.0
  - @objectstack/service-automation@14.0.0
  - @objectstack/service-cache@14.0.0
  - @objectstack/service-datasource@14.0.0
  - @objectstack/service-job@14.0.0
  - @objectstack/service-messaging@14.0.0
  - @objectstack/service-package@14.0.0
  - @objectstack/service-queue@14.0.0
  - @objectstack/service-realtime@14.0.0
  - @objectstack/service-settings@14.0.0
  - @objectstack/service-storage@14.0.0
  - @objectstack/trigger-api@14.0.0
  - @objectstack/trigger-record-change@14.0.0
  - @objectstack/trigger-schedule@14.0.0
  - @objectstack/types@14.0.0
  - @objectstack/console@14.0.0

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

### Minor Changes

- b271691: ADR-0090 P3 — security-domain publish linter (D7) and delegated administration (D12).

  **D7 — `validateSecurityPosture` (@objectstack/lint), wired into `os compile` (errors gate the build) and `os lint`.** Rules, each with a failing fixture: `security-owd-unset` (custom object with no `sharingModel` — the objectui#2348 leave_request shape), `security-owd-alias` (retired D4 alias values, with fix-it), `security-external-wider-than-internal` (D11 `external ≤ internal`), `security-wildcard-vama` (`'*'` + View/Modify All outside the platform admin set, ADR-0066), `security-anchor-high-privilege` (an `isDefault`/everyone-suggested set carrying anchor-forbidden bits), `security-role-word` (D3 vocabulary freeze in security identifiers/labels; ARIA/page roles exempt), and advisory `security-private-no-readscope`.

  **D12 — delegated administration (@objectstack/plugin-security `DelegatedAdminGate`).** `PermissionSetSchema.adminScope` (new in spec, persisted as `sys_permission_set.admin_scope`) declares WHERE (a `sys_business_unit` subtree), WHAT (`manageAssignments` / `manageBindings` / `authorEnvironmentSets`), and WHICH sets a delegate may hand out (`assignablePermissionSets` allowlist). Writes to `sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`, and `sys_permission_set` are now governed: tenant-level admins (ADR-0066 superuser wildcard) pass through; delegates need a covering scope — inside their subtree, allowlisted sets only (to others AND themselves), single-row writes, `granted_by` audit-stamped; everyone else (including holders of plain CRUD on RBAC tables) is denied. Granting or authoring a set that itself carries an `adminScope` requires a held scope that STRICTLY contains it. The `everyone`/`guest` anchors stay tenant-level only, and direct position assignments to an anchor are rejected for every caller.

  **ADR-0090 Addendum — assignment-level BU anchor.** `sys_user_position.business_unit_id` lands with its three consumers scoped: D12 delegation boundary (enforced here), audit fact, and the depth-anchor contract for enterprise `hierarchy-scope-resolver` implementations (documented on `IHierarchyScopeResolver`).

  **D9 tier tightening.** `describeHighPrivilegeBits` moved to `@objectstack/spec/security` (re-exported from plugin-security) alongside new `describeAnchorForbiddenBits`: `guest` bindings now additionally reject edit bits (read-only by default; create stays the case-by-case exception).

  **BREAKING (@objectstack/plugin-security):** exports renamed to the ADR-0090 D3 vocabulary — `SysRole`→`SysPosition`, `SysUserRole`→`SysUserPosition`, `SysRolePermissionSet`→`SysPositionPermissionSet` (no aliases, pre-launch one-step rename). `sys_position` row actions/list views renamed (`activate_position`, …), labels relabeled Role→Position. Non-tenant-admin writes to the RBAC link tables without an `adminScope` are now denied (previously any CRUD grant on those tables sufficed).

  **BREAKING (@objectstack/platform-objects):** `sys_business_unit_member.role_in_business_unit` → `function_in_business_unit` (D3 reserved-word sweep; values member/lead/deputy unchanged).

- a5a1e41: ADR-0090 P4 — explain engine (D6), access-matrix snapshot gate, recalibrated benchmark.

  **Explain contract (@objectstack/spec).** `ExplainRequestSchema` / `ExplainDecisionSchema` / `ExplainLayerSchema`: `explain(principal, object, operation)` reports the verdict of every evaluation-pipeline layer in order (principal → required_permissions → object_crud → fls → owd_baseline → depth → sharing → vama_bypass → rls), with per-layer contributor attribution (which permission set, reached via which position/baseline) and — for reads — the composed row filter as the machine artifact. Carries the D10 dual attribution (`principalKind`, `onBehalfOf`).

  **Explain engine (@objectstack/plugin-security).** `explainAccess` is "explained by construction": it calls the SAME permission-set resolution, evaluator, FLS mask, and RLS composition the enforcement middleware calls (injected from `SecurityPlugin`), so the report cannot drift from enforcement. Exposed on the `security` kernel service as `explain(request, callerContext)`; explaining another user requires `manage_users` (the target's context is reconstructed from `sys_user_position` / `sys_user_permission_set` with everyone-anchor semantics via `buildContextForUser`).

  **Access-matrix snapshot gate (@objectstack/lint + os compile).** `buildAccessMatrix(stack)` derives the (permission set × object) capability matrix purely from metadata; `diffAccessMatrix` renders semantic review lines ("'crm_admin' gains delete on 'crm_lead'", depth changes, OWD swings, entry add/remove). `os compile` gains an opt-in gate: with `access-matrix.json` committed next to the config, any drift fails the build with those lines until re-snapshotted via `--update-access-matrix` — every capability change becomes a reviewable diff. Seeded for `examples/app-crm`.

  **Benchmark (ADR-0090 Addendum).** `scripts/bench/permission-bench.mts` — single-org 10k users × 1M rows per the recalibrated topology; asserts the O()-shape property (per-request cost independent of user population; unit-depth IN-set cost tracks unit size). Passing at 0.1µs/eval and 59ms/1M-row IN-set scan.

- 57b89b4: feat(mcp): the MCP surface is now **default-on** — a core platform capability (#2698)

  `/api/v1/mcp` is served (and advertised in `/discovery`) out of the box; the
  OAuth 2.1 authorization track and Dynamic Client Registration follow it, so a
  fresh deployment is connectable by any MCP client with zero configuration.
  Operators opt OUT with `OS_MCP_SERVER_ENABLED=false`.

  - New single decision point `isMcpServerEnabled()` in `@objectstack/types`
    (default on; explicit `false`/`0`/`off`/`no` disables). The runtime
    dispatcher's `/mcp` route gate, the CLI's MCP plugin auto-load, the REST
    `/discovery` advertisement, and the auth service's OAuth/DCR follow-defaults
    all delegate to it — the served route, the advertised route, and the
    authorization track can never disagree.
  - The env var is now effectively tri-state: unset → HTTP surface on;
    explicit `true` → additionally auto-start the long-lived **stdio** transport
    at boot (unchanged, still opt-in — a default must not claim the process's
    stdin/stdout); explicit `false` → everything off, fail-closed (404, no
    metadata, no DCR).
  - The OAuth 2.1 TLS rule is unaffected: on a plain-HTTP non-loopback origin
    the OAuth track stays dark and the default-on surface remains API-key-only.

### Patch Changes

- 466adf6: Author-time capability-reference lint (ADR-0066 ⑨) — `os validate` / `os lint`
  now warn when a `requiredPermissions` names a capability that is registered
  nowhere.

  `requiredPermissions` (on objects, fields, apps, actions) is a free string, so a
  typo like `mange_users` is schema-valid and fails closed at runtime (the caller
  is denied) — safe, but silent. The new `validateCapabilityReferences` rule
  (`@objectstack/lint`) resolves every reference against the author-time known set
  and warns on the unresolved ones:

  - built-in platform capabilities — now sourced from a single canonical list in
    `@objectstack/spec` (`security/capabilities.ts`: `PLATFORM_CAPABILITIES` /
    `PLATFORM_CAPABILITY_NAMES`), which `@objectstack/plugin-security`'s
    `bootstrapSystemCapabilities` also seeds from (one source of truth, no drift),
  - any capability a permission set in the stack grants via `systemPermissions`
    (granting is what declares it — mirrors the runtime derived-defaults rule), and
  - any `sys_capability` row shipped as seed data.

  It is a **warning**, not an error: a single package can't see capabilities
  declared by other installed packages, and the reference fails closed anyway.
  `systemPermissions` itself is never flagged — it is the declaration side, and a
  package legitimately introduces new capabilities there. The object case also
  understands the per-operation `requiredPermissions` map form (ADR-0066 ⑤) and
  points a finding at the exact operation slice.

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [799b285]
- Updated dependencies [b1081b8]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [e097576]
- Updated dependencies [148beb4]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/runtime@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/rest@13.0.0
  - @objectstack/plugin-security@13.0.0
  - @objectstack/plugin-sharing@13.0.0
  - @objectstack/plugin-auth@13.0.0
  - @objectstack/service-automation@13.0.0
  - @objectstack/trigger-record-change@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/lint@13.0.0
  - @objectstack/plugin-hono-server@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/mcp@13.0.0
  - @objectstack/plugin-email@13.0.0
  - @objectstack/account@13.0.0
  - @objectstack/setup@13.0.0
  - @objectstack/client@13.0.0
  - @objectstack/cloud-connection@13.0.0
  - @objectstack/observability@13.0.0
  - @objectstack/driver-memory@13.0.0
  - @objectstack/driver-mongodb@13.0.0
  - @objectstack/driver-sql@13.0.0
  - @objectstack/driver-sqlite-wasm@13.0.0
  - @objectstack/plugin-approvals@13.0.0
  - @objectstack/plugin-audit@13.0.0
  - @objectstack/plugin-reports@13.0.0
  - @objectstack/plugin-webhooks@13.0.0
  - @objectstack/service-analytics@13.0.0
  - @objectstack/service-cache@13.0.0
  - @objectstack/service-datasource@13.0.0
  - @objectstack/service-job@13.0.0
  - @objectstack/service-messaging@13.0.0
  - @objectstack/service-package@13.0.0
  - @objectstack/service-queue@13.0.0
  - @objectstack/service-realtime@13.0.0
  - @objectstack/service-settings@13.0.0
  - @objectstack/service-storage@13.0.0
  - @objectstack/trigger-api@13.0.0
  - @objectstack/trigger-schedule@13.0.0
  - @objectstack/verify@13.0.0
  - @objectstack/console@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [c4fd39f]
- Updated dependencies [0adcc1c]
- Updated dependencies [b5a87eb]
- Updated dependencies [3fd3576]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/service-settings@12.6.0
  - @objectstack/service-automation@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/verify@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/rest@12.6.0
  - @objectstack/driver-sql@12.6.0
  - @objectstack/account@12.6.0
  - @objectstack/setup@12.6.0
  - @objectstack/client@12.6.0
  - @objectstack/cloud-connection@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/lint@12.6.0
  - @objectstack/mcp@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/observability@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/driver-memory@12.6.0
  - @objectstack/driver-mongodb@12.6.0
  - @objectstack/driver-sqlite-wasm@12.6.0
  - @objectstack/plugin-approvals@12.6.0
  - @objectstack/plugin-audit@12.6.0
  - @objectstack/plugin-auth@12.6.0
  - @objectstack/plugin-email@12.6.0
  - @objectstack/plugin-hono-server@12.6.0
  - @objectstack/plugin-org-scoping@12.6.0
  - @objectstack/plugin-reports@12.6.0
  - @objectstack/plugin-security@12.6.0
  - @objectstack/plugin-sharing@12.6.0
  - @objectstack/plugin-webhooks@12.6.0
  - @objectstack/service-analytics@12.6.0
  - @objectstack/service-cache@12.6.0
  - @objectstack/service-datasource@12.6.0
  - @objectstack/service-job@12.6.0
  - @objectstack/service-messaging@12.6.0
  - @objectstack/service-package@12.6.0
  - @objectstack/service-queue@12.6.0
  - @objectstack/service-realtime@12.6.0
  - @objectstack/service-storage@12.6.0
  - @objectstack/trigger-api@12.6.0
  - @objectstack/trigger-record-change@12.6.0
  - @objectstack/trigger-schedule@12.6.0
  - @objectstack/types@12.6.0
  - @objectstack/console@12.6.0

## 12.5.0

### Patch Changes

- 3b9fd94: `os dev` / `os start` / `os serve` no longer default-load the `@objectstack/studio` app package.

  The console ships a dedicated Studio surface at `/_console/studio/<package-id>/<pillar>`,
  so Studio no longer needs to exist as a navigable app tile in the home "Your apps" list.
  The `@objectstack/studio` package is unchanged and can still be registered explicitly;
  Setup and Account remain default-loaded (ADR-0048 one-app-per-package mechanism).

- f85635e: Drop the `@objectstack/studio` dependency from `cli` and `plugin-dev`. Since Studio is no longer default-loaded by `os dev` / `os start` / `os serve` (the console hosts it at `/_console/studio/...`), neither package imports it at runtime any more. The only remaining consumer was the ADR-0048 app-split test in `cli`, which now exercises the identical one-app-package code path via Setup + Account. The `@objectstack/studio` package itself is unchanged and still registerable explicitly.
- Updated dependencies [8b3d363]
- Updated dependencies [12e11b6]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/trigger-record-change@12.5.0
  - @objectstack/service-automation@12.5.0
  - @objectstack/console@12.5.0
  - @objectstack/account@12.5.0
  - @objectstack/setup@12.5.0
  - @objectstack/client@12.5.0
  - @objectstack/cloud-connection@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/lint@12.5.0
  - @objectstack/mcp@12.5.0
  - @objectstack/observability@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/driver-memory@12.5.0
  - @objectstack/driver-mongodb@12.5.0
  - @objectstack/driver-sql@12.5.0
  - @objectstack/driver-sqlite-wasm@12.5.0
  - @objectstack/plugin-approvals@12.5.0
  - @objectstack/plugin-audit@12.5.0
  - @objectstack/plugin-auth@12.5.0
  - @objectstack/plugin-email@12.5.0
  - @objectstack/plugin-hono-server@12.5.0
  - @objectstack/plugin-org-scoping@12.5.0
  - @objectstack/plugin-reports@12.5.0
  - @objectstack/plugin-security@12.5.0
  - @objectstack/plugin-sharing@12.5.0
  - @objectstack/plugin-webhooks@12.5.0
  - @objectstack/rest@12.5.0
  - @objectstack/runtime@12.5.0
  - @objectstack/service-analytics@12.5.0
  - @objectstack/service-cache@12.5.0
  - @objectstack/service-datasource@12.5.0
  - @objectstack/service-job@12.5.0
  - @objectstack/service-messaging@12.5.0
  - @objectstack/service-package@12.5.0
  - @objectstack/service-queue@12.5.0
  - @objectstack/service-realtime@12.5.0
  - @objectstack/service-settings@12.5.0
  - @objectstack/service-storage@12.5.0
  - @objectstack/trigger-api@12.5.0
  - @objectstack/trigger-schedule@12.5.0
  - @objectstack/types@12.5.0
  - @objectstack/verify@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [f66e8af]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/console@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/account@12.4.0
  - @objectstack/setup@12.4.0
  - @objectstack/studio@12.4.0
  - @objectstack/client@12.4.0
  - @objectstack/cloud-connection@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/lint@12.4.0
  - @objectstack/mcp@12.4.0
  - @objectstack/observability@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/driver-memory@12.4.0
  - @objectstack/driver-mongodb@12.4.0
  - @objectstack/driver-sql@12.4.0
  - @objectstack/driver-sqlite-wasm@12.4.0
  - @objectstack/plugin-approvals@12.4.0
  - @objectstack/plugin-audit@12.4.0
  - @objectstack/plugin-auth@12.4.0
  - @objectstack/plugin-email@12.4.0
  - @objectstack/plugin-hono-server@12.4.0
  - @objectstack/plugin-org-scoping@12.4.0
  - @objectstack/plugin-reports@12.4.0
  - @objectstack/plugin-security@12.4.0
  - @objectstack/plugin-sharing@12.4.0
  - @objectstack/plugin-webhooks@12.4.0
  - @objectstack/rest@12.4.0
  - @objectstack/service-analytics@12.4.0
  - @objectstack/service-automation@12.4.0
  - @objectstack/service-cache@12.4.0
  - @objectstack/service-datasource@12.4.0
  - @objectstack/service-job@12.4.0
  - @objectstack/service-messaging@12.4.0
  - @objectstack/service-package@12.4.0
  - @objectstack/service-queue@12.4.0
  - @objectstack/service-realtime@12.4.0
  - @objectstack/service-settings@12.4.0
  - @objectstack/service-storage@12.4.0
  - @objectstack/trigger-api@12.4.0
  - @objectstack/trigger-record-change@12.4.0
  - @objectstack/trigger-schedule@12.4.0
  - @objectstack/types@12.4.0
  - @objectstack/verify@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/client@12.3.0
  - @objectstack/plugin-sharing@12.3.0
  - @objectstack/rest@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/trigger-record-change@12.3.0
  - @objectstack/verify@12.3.0
  - @objectstack/account@12.3.0
  - @objectstack/setup@12.3.0
  - @objectstack/studio@12.3.0
  - @objectstack/cloud-connection@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/lint@12.3.0
  - @objectstack/mcp@12.3.0
  - @objectstack/observability@12.3.0
  - @objectstack/platform-objects@12.3.0
  - @objectstack/driver-memory@12.3.0
  - @objectstack/driver-mongodb@12.3.0
  - @objectstack/driver-sql@12.3.0
  - @objectstack/driver-sqlite-wasm@12.3.0
  - @objectstack/plugin-approvals@12.3.0
  - @objectstack/plugin-audit@12.3.0
  - @objectstack/plugin-auth@12.3.0
  - @objectstack/plugin-email@12.3.0
  - @objectstack/plugin-hono-server@12.3.0
  - @objectstack/plugin-org-scoping@12.3.0
  - @objectstack/plugin-reports@12.3.0
  - @objectstack/plugin-security@12.3.0
  - @objectstack/plugin-webhooks@12.3.0
  - @objectstack/service-analytics@12.3.0
  - @objectstack/service-automation@12.3.0
  - @objectstack/service-cache@12.3.0
  - @objectstack/service-datasource@12.3.0
  - @objectstack/service-job@12.3.0
  - @objectstack/service-messaging@12.3.0
  - @objectstack/service-package@12.3.0
  - @objectstack/service-queue@12.3.0
  - @objectstack/service-realtime@12.3.0
  - @objectstack/service-settings@12.3.0
  - @objectstack/service-storage@12.3.0
  - @objectstack/trigger-api@12.3.0
  - @objectstack/trigger-schedule@12.3.0
  - @objectstack/types@12.3.0
  - @objectstack/console@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/rest@12.2.0
  - @objectstack/spec@12.2.0
  - @objectstack/plugin-security@12.2.0
  - @objectstack/objectql@12.2.0
  - @objectstack/runtime@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/plugin-sharing@12.2.0
  - @objectstack/verify@12.2.0
  - @objectstack/account@12.2.0
  - @objectstack/setup@12.2.0
  - @objectstack/studio@12.2.0
  - @objectstack/client@12.2.0
  - @objectstack/cloud-connection@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/lint@12.2.0
  - @objectstack/mcp@12.2.0
  - @objectstack/observability@12.2.0
  - @objectstack/platform-objects@12.2.0
  - @objectstack/driver-memory@12.2.0
  - @objectstack/driver-mongodb@12.2.0
  - @objectstack/driver-sql@12.2.0
  - @objectstack/driver-sqlite-wasm@12.2.0
  - @objectstack/plugin-approvals@12.2.0
  - @objectstack/plugin-audit@12.2.0
  - @objectstack/plugin-auth@12.2.0
  - @objectstack/plugin-email@12.2.0
  - @objectstack/plugin-hono-server@12.2.0
  - @objectstack/plugin-org-scoping@12.2.0
  - @objectstack/plugin-reports@12.2.0
  - @objectstack/plugin-webhooks@12.2.0
  - @objectstack/service-analytics@12.2.0
  - @objectstack/service-automation@12.2.0
  - @objectstack/service-cache@12.2.0
  - @objectstack/service-datasource@12.2.0
  - @objectstack/service-job@12.2.0
  - @objectstack/service-messaging@12.2.0
  - @objectstack/service-package@12.2.0
  - @objectstack/service-queue@12.2.0
  - @objectstack/service-realtime@12.2.0
  - @objectstack/service-settings@12.2.0
  - @objectstack/service-storage@12.2.0
  - @objectstack/trigger-api@12.2.0
  - @objectstack/trigger-record-change@12.2.0
  - @objectstack/trigger-schedule@12.2.0
  - @objectstack/types@12.2.0
  - @objectstack/console@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [8bcd994]
- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/service-automation@12.1.0
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/plugin-approvals@12.1.0
  - @objectstack/trigger-record-change@12.1.0
  - @objectstack/trigger-schedule@12.1.0
  - @objectstack/verify@12.1.0
  - @objectstack/client@12.1.0
  - @objectstack/cloud-connection@12.1.0
  - @objectstack/account@12.1.0
  - @objectstack/setup@12.1.0
  - @objectstack/studio@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/lint@12.1.0
  - @objectstack/mcp@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/observability@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/driver-memory@12.1.0
  - @objectstack/driver-mongodb@12.1.0
  - @objectstack/driver-sql@12.1.0
  - @objectstack/driver-sqlite-wasm@12.1.0
  - @objectstack/plugin-audit@12.1.0
  - @objectstack/plugin-auth@12.1.0
  - @objectstack/plugin-email@12.1.0
  - @objectstack/plugin-hono-server@12.1.0
  - @objectstack/plugin-org-scoping@12.1.0
  - @objectstack/plugin-reports@12.1.0
  - @objectstack/plugin-security@12.1.0
  - @objectstack/plugin-sharing@12.1.0
  - @objectstack/plugin-webhooks@12.1.0
  - @objectstack/rest@12.1.0
  - @objectstack/service-analytics@12.1.0
  - @objectstack/service-cache@12.1.0
  - @objectstack/service-datasource@12.1.0
  - @objectstack/service-job@12.1.0
  - @objectstack/service-messaging@12.1.0
  - @objectstack/service-package@12.1.0
  - @objectstack/service-queue@12.1.0
  - @objectstack/service-realtime@12.1.0
  - @objectstack/service-settings@12.1.0
  - @objectstack/service-storage@12.1.0
  - @objectstack/trigger-api@12.1.0
  - @objectstack/types@12.1.0
  - @objectstack/console@12.1.0

## 12.0.0

### Minor Changes

- e695fe0: feat(spec,lint): reject userFilters on object list views (ADR-0053 phase 4)

  ADR-0053 reserves `userFilters`/`quickFilters` for page lists ("filters" mode);
  on an object list view ("views" mode — where the `ViewTabBar` is the only nav
  control) they are silently dropped. This lands the phase-4 guardrail as a
  layered defence, so the wrong-context authoring mistake is caught without
  breaking existing metadata:

  - **Type-level (author time):** new `ObjectListViewSchema` = `ListViewSchema`
    minus `userFilters`. Object built-in `listViews` and `defineView`
    `list`/`listViews` now use it, so `userFilters` on an object list view is a
    `tsc` error. The full `ListViewSchema` (page "filters" mode) is untouched.
  - **Runtime (back-compat):** the field is STRIPPED at parse (default strip, no
    throw), so existing metadata keeps loading — `ObjectSchema.parse` never fails
    on a stray `userFilters`.
  - **Author/CI (actionable):** new `@objectstack/lint` rule
    `validateListViewMode`, wired into `os validate`, reports the wrong-context
    field PRE-parse (before the schema strips it) with a fix hint.

  Closes the schema half of objectui #2219; supersedes the interim runtime warn in
  objectui #2220.

- 069c205: Add a build-time view-reference lint that fails `os compile` on a broken form-view reference, and surfaces the previously-silent `_2` rename collision as a warning (#2554).

  `expandViewContainer` gains a behaviour-preserving companion `expandViewContainerWithDiagnostics` that also reports every `<object>.<key>` name collision. List and form views share one namespace during expansion, and the default `list` implicitly claims `<object>.default`; a colliding key was previously renamed to `<object>.<key>_2` **silently**, so references (form action `target`s, navigation `viewName`s) resolved to the _other_ view.

  The new `lint-view-refs` build lint consumes those diagnostics with a broken/fragile severity split, tuned so an upgrade does NOT break existing apps that merely have a colliding key:

  - **view-ref-form-target-kind** — ERROR (fails the build): a `type:'form'` action whose `target` resolves to an existing LIST view — the concrete #2554 breakage (a blank form, a silently no-op submit). High-confidence, so it fails.
  - **view-key-collision** — WARNING: a key silently renamed on collision. Fragile, not broken — it breaks something only if the requested name is referenced — so it warns.
  - **view-ref-form-target-missing** — WARNING: a form target resolving to no view; probably a typo, but possibly a view the lint failed to collect, so it warns rather than risk a false-positive build failure.

  This shifts objectui's runtime `viewKind` guard left to compile time: the author — very often an AI generating templates — discovers the mistake on `os compile` instead of when an end user clicks. It mirrors the existing broken/fragile two-level authoring lints (flow-patterns, autonumber, liveness). `expandViewContainer`'s runtime behaviour is unchanged; the fix is diagnostics-only plus the build gate.

### Patch Changes

- 7c09621: feat(security)!: `api.requireAuth` now defaults to `true` — anonymous access to the data API is denied by default (ADR-0056 D2 flip)

  **BREAKING.** The global `requireAuth` default flipped FROM `false` TO `true`
  (`RestApiConfigSchema.requireAuth` in `@objectstack/spec`, mirrored by
  `RestServer.normalizeConfig` in `@objectstack/rest`). Anonymous requests to
  the `/data/*` CRUD + batch endpoints are now rejected with HTTP 401 unless the
  deployment explicitly opts out. (Scope note: this gate covers the REST
  `/data/*` surface — the metadata read/write endpoints and the dispatcher
  GraphQL route have their own pre-existing anonymous posture, tracked
  separately; this flip does not change them.)

  **Migration (one line):** a deployment that intentionally serves data publicly
  (demo / playground / kiosk) sets the flag on the stack config — now a declared
  `ObjectStackDefinitionSchema.api` field, so it survives `defineStack` strict
  parsing (previously an undeclared top-level `api` key was silently stripped):

  ```ts
  export default defineStack({
    // …
    api: { requireAuth: false },
  });
  ```

  The REST plugin logs a boot warning for the explicit opt-out so a fail-open
  posture is always visible. A misplaced `api.requireAuth` at the plugin level
  (one nesting short) is now also called out with a boot warning instead of
  being silently ignored.

  **What keeps working with no action:**

  - **Share links** — validate their token, then read under a system context.
  - **Public forms** — self-authorizing via the declaration-derived
    `publicFormGrant` (create + read-back on the declared target object only);
    no `guest_portal` profile needed.
  - **Control plane** — `/auth`, `/health`, `/discovery` are exempt.
  - **`objectstack serve` with an auth-less stack** — the CLI passes an explicit
    `requireAuth: false` for stacks whose tier set has no `auth` (nothing could
    authenticate against them), with the boot warning.

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [1b1b34e]
- Updated dependencies [9796e7c]
- Updated dependencies [f84f8d5]
- Updated dependencies [9693a36]
- Updated dependencies [ffafb30]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [48ad533]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/lint@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/plugin-auth@12.0.0
  - @objectstack/plugin-security@12.0.0
  - @objectstack/service-automation@12.0.0
  - @objectstack/runtime@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/rest@12.0.0
  - @objectstack/verify@12.0.0
  - @objectstack/account@12.0.0
  - @objectstack/setup@12.0.0
  - @objectstack/studio@12.0.0
  - @objectstack/client@12.0.0
  - @objectstack/cloud-connection@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0
  - @objectstack/mcp@12.0.0
  - @objectstack/observability@12.0.0
  - @objectstack/driver-memory@12.0.0
  - @objectstack/driver-mongodb@12.0.0
  - @objectstack/driver-sql@12.0.0
  - @objectstack/driver-sqlite-wasm@12.0.0
  - @objectstack/plugin-approvals@12.0.0
  - @objectstack/plugin-audit@12.0.0
  - @objectstack/plugin-email@12.0.0
  - @objectstack/plugin-hono-server@12.0.0
  - @objectstack/plugin-org-scoping@12.0.0
  - @objectstack/plugin-reports@12.0.0
  - @objectstack/plugin-sharing@12.0.0
  - @objectstack/plugin-webhooks@12.0.0
  - @objectstack/service-analytics@12.0.0
  - @objectstack/service-cache@12.0.0
  - @objectstack/service-datasource@12.0.0
  - @objectstack/service-job@12.0.0
  - @objectstack/service-messaging@12.0.0
  - @objectstack/service-package@12.0.0
  - @objectstack/service-queue@12.0.0
  - @objectstack/service-realtime@12.0.0
  - @objectstack/service-settings@12.0.0
  - @objectstack/service-storage@12.0.0
  - @objectstack/trigger-api@12.0.0
  - @objectstack/trigger-record-change@12.0.0
  - @objectstack/trigger-schedule@12.0.0
  - @objectstack/types@12.0.0
  - @objectstack/console@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [996c548]
- Updated dependencies [e82a495]
- Updated dependencies [3500820]
- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/lint@11.10.0
  - @objectstack/console@11.10.0
  - @objectstack/spec@11.10.0
  - @objectstack/plugin-audit@11.10.0
  - @objectstack/plugin-approvals@11.10.0
  - @objectstack/plugin-security@11.10.0
  - @objectstack/plugin-sharing@11.10.0
  - @objectstack/plugin-webhooks@11.10.0
  - @objectstack/service-storage@11.10.0
  - @objectstack/service-automation@11.10.0
  - @objectstack/service-messaging@11.10.0
  - @objectstack/service-realtime@11.10.0
  - @objectstack/account@11.10.0
  - @objectstack/setup@11.10.0
  - @objectstack/studio@11.10.0
  - @objectstack/client@11.10.0
  - @objectstack/cloud-connection@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/mcp@11.10.0
  - @objectstack/objectql@11.10.0
  - @objectstack/observability@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/driver-memory@11.10.0
  - @objectstack/driver-mongodb@11.10.0
  - @objectstack/driver-sql@11.10.0
  - @objectstack/driver-sqlite-wasm@11.10.0
  - @objectstack/plugin-auth@11.10.0
  - @objectstack/plugin-email@11.10.0
  - @objectstack/plugin-hono-server@11.10.0
  - @objectstack/plugin-org-scoping@11.10.0
  - @objectstack/plugin-reports@11.10.0
  - @objectstack/rest@11.10.0
  - @objectstack/runtime@11.10.0
  - @objectstack/service-analytics@11.10.0
  - @objectstack/service-cache@11.10.0
  - @objectstack/service-datasource@11.10.0
  - @objectstack/service-job@11.10.0
  - @objectstack/service-package@11.10.0
  - @objectstack/service-queue@11.10.0
  - @objectstack/service-settings@11.10.0
  - @objectstack/trigger-api@11.10.0
  - @objectstack/trigger-record-change@11.10.0
  - @objectstack/trigger-schedule@11.10.0
  - @objectstack/types@11.10.0
  - @objectstack/verify@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
- Updated dependencies [8d87930]
- Updated dependencies [1a29234]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/driver-sql@11.9.0
  - @objectstack/console@11.9.0
  - @objectstack/client@11.9.0
  - @objectstack/cloud-connection@11.9.0
  - @objectstack/verify@11.9.0
  - @objectstack/account@11.9.0
  - @objectstack/setup@11.9.0
  - @objectstack/studio@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/lint@11.9.0
  - @objectstack/mcp@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/observability@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/driver-memory@11.9.0
  - @objectstack/driver-mongodb@11.9.0
  - @objectstack/driver-sqlite-wasm@11.9.0
  - @objectstack/plugin-approvals@11.9.0
  - @objectstack/plugin-audit@11.9.0
  - @objectstack/plugin-auth@11.9.0
  - @objectstack/plugin-email@11.9.0
  - @objectstack/plugin-hono-server@11.9.0
  - @objectstack/plugin-org-scoping@11.9.0
  - @objectstack/plugin-reports@11.9.0
  - @objectstack/plugin-security@11.9.0
  - @objectstack/plugin-sharing@11.9.0
  - @objectstack/plugin-webhooks@11.9.0
  - @objectstack/rest@11.9.0
  - @objectstack/service-analytics@11.9.0
  - @objectstack/service-automation@11.9.0
  - @objectstack/service-cache@11.9.0
  - @objectstack/service-datasource@11.9.0
  - @objectstack/service-job@11.9.0
  - @objectstack/service-messaging@11.9.0
  - @objectstack/service-package@11.9.0
  - @objectstack/service-queue@11.9.0
  - @objectstack/service-realtime@11.9.0
  - @objectstack/service-settings@11.9.0
  - @objectstack/service-storage@11.9.0
  - @objectstack/trigger-api@11.9.0
  - @objectstack/trigger-record-change@11.9.0
  - @objectstack/trigger-schedule@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [5c15ccd]
- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/console@11.8.0
  - @objectstack/platform-objects@11.8.0
  - @objectstack/account@11.8.0
  - @objectstack/setup@11.8.0
  - @objectstack/studio@11.8.0
  - @objectstack/plugin-approvals@11.8.0
  - @objectstack/plugin-audit@11.8.0
  - @objectstack/plugin-auth@11.8.0
  - @objectstack/plugin-email@11.8.0
  - @objectstack/plugin-org-scoping@11.8.0
  - @objectstack/plugin-reports@11.8.0
  - @objectstack/plugin-security@11.8.0
  - @objectstack/plugin-sharing@11.8.0
  - @objectstack/rest@11.8.0
  - @objectstack/service-job@11.8.0
  - @objectstack/service-queue@11.8.0
  - @objectstack/service-realtime@11.8.0
  - @objectstack/service-settings@11.8.0
  - @objectstack/service-storage@11.8.0
  - @objectstack/runtime@11.8.0
  - @objectstack/verify@11.8.0
  - @objectstack/client@11.8.0
  - @objectstack/cloud-connection@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/types@11.8.0
  - @objectstack/objectql@11.8.0
  - @objectstack/observability@11.8.0
  - @objectstack/formula@11.8.0
  - @objectstack/lint@11.8.0
  - @objectstack/driver-memory@11.8.0
  - @objectstack/driver-sql@11.8.0
  - @objectstack/driver-mongodb@11.8.0
  - @objectstack/driver-sqlite-wasm@11.8.0
  - @objectstack/plugin-hono-server@11.8.0
  - @objectstack/mcp@11.8.0
  - @objectstack/plugin-webhooks@11.8.0
  - @objectstack/trigger-record-change@11.8.0
  - @objectstack/trigger-api@11.8.0
  - @objectstack/trigger-schedule@11.8.0
  - @objectstack/service-analytics@11.8.0
  - @objectstack/service-automation@11.8.0
  - @objectstack/service-cache@11.8.0
  - @objectstack/service-datasource@11.8.0
  - @objectstack/service-messaging@11.8.0
  - @objectstack/service-package@11.8.0

## 11.7.0

### Patch Changes

- 5178906: ADR-0085: object presentation intent is declared as cross-surface semantic
  roles, never as per-surface hint blocks.

  **@objectstack/spec**

  - New top-level `stageField: string | false` — names the object's linear
    lifecycle field (`false` declares the status-like field non-linear and
    suppresses every consumer's stage heuristics). Legitimizes the key the UI
    runtime already read but the schema rejected.
  - `compactLayout` → **`highlightFields`** (the value is an ordered field
    list, not a layout; "highlight" is already the renderer-side term of art).
    `compactLayout` stays accepted as a parse-time alias and is preserved on
    output — the ADR-0079 `displayNameField → nameField` pattern.
  - `fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` replaces
    `defaultExpanded` AND the UI-dialect `collapsible`/`collapsed` boolean pair
    (which had drifted two ways: spec declared a key no renderer read, renderers
    read keys the spec rejected). Old keys map onto the enum at parse and remain
    accepted for one minor.
  - `fieldGroups[].visibleOn` removed (no consumer anywhere — ADR-0049
    enforce-or-remove; re-add together with its enforcement when a surface
    evaluates it).
  - The `detail: { … }.passthrough()` UI-hints block is **removed**. Every key
    in it was either unauthorable, a proven no-op for spec authors
    (`hideReferenceRail` — the rail is default-off and its enabling key was
    never typed), or a per-page toggle that belongs to an assigned Page. Zero
    authors existed across framework and objectui (evidence in ADR-0085); the
    removal ships as a minor under the documented dead-surface exception
    (PR #2272 precedent).
  - New `deriveFieldGroupLayout(def)` in `@objectstack/spec/data` — the single
    source of the fieldGroups rendering semantics (declared order, empty groups
    dropped, ungrouped trailing bucket minus audit/system fields, collapse
    passthrough incl. deprecated aliases). UI renderers consume this instead of
    their two pre-existing near-identical local copies.

  **@objectstack/lint / @objectstack/cli**

  - New `validateSemanticRoles` (wired into `os lint`): warns on
    `Field.group` → undeclared group, declared-but-unreferenced groups, and
    `stageField`/`highlightFields` entries naming non-existent fields — the
    dangling-pointer shapes that are Zod-valid but silently inert at render
    time (ADR-0078 completeness gate).

  **@objectstack/platform-objects**

  - All 35 system objects renamed `compactLayout:` → `highlightFields:`
    (behaviour unchanged via the alias).

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/lint@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/account@11.7.0
  - @objectstack/setup@11.7.0
  - @objectstack/studio@11.7.0
  - @objectstack/client@11.7.0
  - @objectstack/cloud-connection@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/mcp@11.7.0
  - @objectstack/objectql@11.7.0
  - @objectstack/observability@11.7.0
  - @objectstack/driver-memory@11.7.0
  - @objectstack/driver-mongodb@11.7.0
  - @objectstack/driver-sql@11.7.0
  - @objectstack/driver-sqlite-wasm@11.7.0
  - @objectstack/plugin-approvals@11.7.0
  - @objectstack/plugin-audit@11.7.0
  - @objectstack/plugin-auth@11.7.0
  - @objectstack/plugin-email@11.7.0
  - @objectstack/plugin-hono-server@11.7.0
  - @objectstack/plugin-org-scoping@11.7.0
  - @objectstack/plugin-reports@11.7.0
  - @objectstack/plugin-security@11.7.0
  - @objectstack/plugin-sharing@11.7.0
  - @objectstack/plugin-webhooks@11.7.0
  - @objectstack/rest@11.7.0
  - @objectstack/runtime@11.7.0
  - @objectstack/service-analytics@11.7.0
  - @objectstack/service-automation@11.7.0
  - @objectstack/service-cache@11.7.0
  - @objectstack/service-datasource@11.7.0
  - @objectstack/service-job@11.7.0
  - @objectstack/service-messaging@11.7.0
  - @objectstack/service-package@11.7.0
  - @objectstack/service-queue@11.7.0
  - @objectstack/service-realtime@11.7.0
  - @objectstack/service-settings@11.7.0
  - @objectstack/service-storage@11.7.0
  - @objectstack/trigger-api@11.7.0
  - @objectstack/trigger-record-change@11.7.0
  - @objectstack/trigger-schedule@11.7.0
  - @objectstack/types@11.7.0
  - @objectstack/verify@11.7.0
  - @objectstack/console@11.7.0

## 11.6.0

### Patch Changes

- Updated dependencies [b990bc2]
- Updated dependencies [e778a93]
  - @objectstack/console@11.6.0
  - @objectstack/spec@11.6.0
  - @objectstack/cloud-connection@11.6.0
  - @objectstack/core@11.6.0
  - @objectstack/client@11.6.0
  - @objectstack/types@11.6.0
  - @objectstack/objectql@11.6.0
  - @objectstack/observability@11.6.0
  - @objectstack/formula@11.6.0
  - @objectstack/lint@11.6.0
  - @objectstack/platform-objects@11.6.0
  - @objectstack/studio@11.6.0
  - @objectstack/setup@11.6.0
  - @objectstack/runtime@11.6.0
  - @objectstack/rest@11.6.0
  - @objectstack/driver-memory@11.6.0
  - @objectstack/driver-sql@11.6.0
  - @objectstack/driver-mongodb@11.6.0
  - @objectstack/driver-sqlite-wasm@11.6.0
  - @objectstack/plugin-approvals@11.6.0
  - @objectstack/plugin-audit@11.6.0
  - @objectstack/plugin-auth@11.6.0
  - @objectstack/plugin-email@11.6.0
  - @objectstack/plugin-hono-server@11.6.0
  - @objectstack/mcp@11.6.0
  - @objectstack/plugin-org-scoping@11.6.0
  - @objectstack/plugin-reports@11.6.0
  - @objectstack/plugin-security@11.6.0
  - @objectstack/plugin-sharing@11.6.0
  - @objectstack/plugin-webhooks@11.6.0
  - @objectstack/trigger-record-change@11.6.0
  - @objectstack/trigger-api@11.6.0
  - @objectstack/trigger-schedule@11.6.0
  - @objectstack/service-analytics@11.6.0
  - @objectstack/service-automation@11.6.0
  - @objectstack/service-cache@11.6.0
  - @objectstack/service-datasource@11.6.0
  - @objectstack/service-job@11.6.0
  - @objectstack/service-messaging@11.6.0
  - @objectstack/service-package@11.6.0
  - @objectstack/service-queue@11.6.0
  - @objectstack/service-realtime@11.6.0
  - @objectstack/service-settings@11.6.0
  - @objectstack/service-storage@11.6.0
  - @objectstack/account@11.6.0
  - @objectstack/verify@11.6.0

## 11.5.0

### Minor Changes

- 5a5bf61: ADR-0081 Phase 2: a build-time prop check for `kind:'react'` pages. After the
  syntax gate, `validateReactPageProps` parses the real JSX (TypeScript compiler)
  and checks each usage of an injected block (`<ObjectForm>`, `<ListView>`, …)
  against the react-tier contract (`REACT_BLOCKS` from `@objectstack/spec/ui`):
  missing a required binding (e.g. `<ObjectForm>` with no `objectName`) is an
  error; a near-miss prop (`onSucces` → `onSuccess`) is a warning. Wired into
  `os validate`. Curated data props are not flagged (low false-positive); a spread
  `{...props}` escapes the required check. (`typescript` moves to `@objectstack/lint`
  dependencies so it externalizes instead of bundling into the CLI.)
- ec7175d: Add the source-page styling guardrail (ADR-0065): `os validate`/`os build` now flags Tailwind `className` in `kind:'html'`/`kind:'react'` page source, which silently produces no CSS because the build never scans authored metadata. New `validatePageSourceStyling` rule with an actionable inline-style/`hsl(var(--token))` fix; also corrects the react-blocks contract, the objectstack-ui skill, the layout-dsl docs, and ADR-0080/0081 away from the "HTML + Tailwind" framing.

### Patch Changes

- c77a8f5: Guard against `@objectstack/console` version drift. The vendored Console SPA in `packages/console/dist` is a gitignored, locally-built artifact that only `scripts/build-console.sh` (`pnpm objectui:build` / `objectui:refresh` / `release` / CI) produces — `turbo run build` never rebuilds it. Pulling a branch that bumps the committed `.objectui-sha` pin therefore left a stale dist in place, and the CLI would silently serve a Console built from a different objectui commit (the npm-major version guard can't see a SHA move under one package version).

  `build-console.sh` now stamps the built objectui SHA into `dist/.objectui-sha`. A new `pnpm check:console-sha` compares that stamp against the pin and fails loudly on drift (hard-gating `pnpm dev` / `dev:crm` / `dev:todo`), and `resolveConsolePath` warns at serve time when it selects a drifted dist. Remediation is `pnpm objectui:build` (rebuild at the pinned SHA). Published installs ship no pin, so their stamped dist stays authoritative and the guard is a no-op.

- Updated dependencies [6ee4f04]
- Updated dependencies [cabce27]
- Updated dependencies [c1e3a65]
- Updated dependencies [5a5bf61]
- Updated dependencies [ec7175d]
  - @objectstack/spec@11.5.0
  - @objectstack/console@11.5.0
  - @objectstack/lint@11.5.0
  - @objectstack/account@11.5.0
  - @objectstack/setup@11.5.0
  - @objectstack/studio@11.5.0
  - @objectstack/client@11.5.0
  - @objectstack/cloud-connection@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/mcp@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/observability@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/driver-memory@11.5.0
  - @objectstack/driver-mongodb@11.5.0
  - @objectstack/driver-sql@11.5.0
  - @objectstack/driver-sqlite-wasm@11.5.0
  - @objectstack/plugin-approvals@11.5.0
  - @objectstack/plugin-audit@11.5.0
  - @objectstack/plugin-auth@11.5.0
  - @objectstack/plugin-email@11.5.0
  - @objectstack/plugin-hono-server@11.5.0
  - @objectstack/plugin-org-scoping@11.5.0
  - @objectstack/plugin-reports@11.5.0
  - @objectstack/plugin-security@11.5.0
  - @objectstack/plugin-sharing@11.5.0
  - @objectstack/plugin-webhooks@11.5.0
  - @objectstack/rest@11.5.0
  - @objectstack/runtime@11.5.0
  - @objectstack/service-analytics@11.5.0
  - @objectstack/service-automation@11.5.0
  - @objectstack/service-cache@11.5.0
  - @objectstack/service-datasource@11.5.0
  - @objectstack/service-job@11.5.0
  - @objectstack/service-messaging@11.5.0
  - @objectstack/service-package@11.5.0
  - @objectstack/service-queue@11.5.0
  - @objectstack/service-realtime@11.5.0
  - @objectstack/service-settings@11.5.0
  - @objectstack/service-storage@11.5.0
  - @objectstack/trigger-api@11.5.0
  - @objectstack/trigger-record-change@11.5.0
  - @objectstack/trigger-schedule@11.5.0
  - @objectstack/types@11.5.0
  - @objectstack/verify@11.5.0

## 11.4.0

### Minor Changes

- 5821c51: ADR-0081: split the AI page-authoring surface into honest tiers.

  - `PageSchema.kind` gains `'html'` and `'react'`. `'html'` is the constrained
    parse-never-execute tier (the renamed `'jsx'`, kept as a deprecated alias);
    `'react'` is the real-React tier (executed at render by
    `@object-ui/react-runtime`). It runs author JS, so it is gated by a host
    capability that **defaults ON** (the platform trusts reviewed, draft-gated
    authors) and is disabled **server-side** via the `OS_PAGE_REACT=off`
    env toggle. The completeness gate now requires `source` for all three kinds.
  - `@objectstack/cli` console serving injects the disable global into the served
    HTML when `OS_PAGE_REACT=off` (read per request, no rebuild).
  - `validate-jsx-pages` lints `html`/`jsx` (constrained parse). A new
    `validate-react-pages` transpiles `react` source with Sucrase (transpile-only,
    never executed) so syntax errors fail at `os build` instead of at render.

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/lint@11.4.0
  - @objectstack/account@11.4.0
  - @objectstack/setup@11.4.0
  - @objectstack/studio@11.4.0
  - @objectstack/client@11.4.0
  - @objectstack/cloud-connection@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/mcp@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/observability@11.4.0
  - @objectstack/platform-objects@11.4.0
  - @objectstack/driver-memory@11.4.0
  - @objectstack/driver-mongodb@11.4.0
  - @objectstack/driver-sql@11.4.0
  - @objectstack/driver-sqlite-wasm@11.4.0
  - @objectstack/plugin-approvals@11.4.0
  - @objectstack/plugin-audit@11.4.0
  - @objectstack/plugin-auth@11.4.0
  - @objectstack/plugin-email@11.4.0
  - @objectstack/plugin-hono-server@11.4.0
  - @objectstack/plugin-org-scoping@11.4.0
  - @objectstack/plugin-reports@11.4.0
  - @objectstack/plugin-security@11.4.0
  - @objectstack/plugin-sharing@11.4.0
  - @objectstack/plugin-webhooks@11.4.0
  - @objectstack/rest@11.4.0
  - @objectstack/runtime@11.4.0
  - @objectstack/service-analytics@11.4.0
  - @objectstack/service-automation@11.4.0
  - @objectstack/service-cache@11.4.0
  - @objectstack/service-datasource@11.4.0
  - @objectstack/service-job@11.4.0
  - @objectstack/service-messaging@11.4.0
  - @objectstack/service-package@11.4.0
  - @objectstack/service-queue@11.4.0
  - @objectstack/service-realtime@11.4.0
  - @objectstack/service-settings@11.4.0
  - @objectstack/service-storage@11.4.0
  - @objectstack/trigger-api@11.4.0
  - @objectstack/trigger-record-change@11.4.0
  - @objectstack/trigger-schedule@11.4.0
  - @objectstack/types@11.4.0
  - @objectstack/verify@11.4.0
  - @objectstack/console@11.4.0

## 11.3.0

### Minor Changes

- e296e1d: ADR-0080: wire the SDUI manifest end-to-end. `build-console.sh` now (best-effort, guarded) generates `sdui.manifest.json` from the just-built console's public-tier registry into `@objectstack/console/dist/`; the `os build` / `os validate` JSX gate resolves the manifest from `@objectstack/console` (in addition to the project root) and does full component/prop validation when present. Activating full validation requires bumping `.objectui-sha` to an objectui commit that ships the dump tooling (>=96b1293); until then the gate falls back to parse-level and the build step skips.

### Patch Changes

- 58e8e31: feat(lint): ADR-0079 record-title gate — deprecate titleFormat + record-title validator

  A record's human title is a structural invariant (ADR-0079): every object
  resolves a primary title from a real STORED field via `nameField` (the
  canonical pointer; `displayNameField` is the deprecated alias) or a
  deterministic derivation. This adds build-time diagnostics so `os build` /
  `os lint`, the MCP authoring surface, and hand-authoring all get the coverage
  cloud graph-lint already has (the ADR-0078 "not cloud-only" principle):

  - `title-format-retired` — flags an object that declares a `titleFormat`. That
    key is a render-only template the server can neither return nor query;
    ADR-0079 retires it in favour of `nameField`. The schema still parses it
    (existing metadata keeps loading), so this is advisory, not an error.
  - `title-unresolvable` — flags an object whose title cannot be resolved from any
    stored field (`objectTitleCompleteness` reports `status: 'none'`).

  `@objectstack/spec` carries the `titleFormat` `.describe()` deprecation note;
  the `@objectstack/cli` `lint` command wires the new validator into its run.

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
- Updated dependencies [59576d0]
  - @objectstack/lint@11.3.0
  - @objectstack/spec@11.3.0
  - @objectstack/plugin-auth@11.3.0
  - @objectstack/account@11.3.0
  - @objectstack/setup@11.3.0
  - @objectstack/studio@11.3.0
  - @objectstack/client@11.3.0
  - @objectstack/cloud-connection@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/mcp@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/observability@11.3.0
  - @objectstack/platform-objects@11.3.0
  - @objectstack/driver-memory@11.3.0
  - @objectstack/driver-mongodb@11.3.0
  - @objectstack/driver-sql@11.3.0
  - @objectstack/driver-sqlite-wasm@11.3.0
  - @objectstack/plugin-approvals@11.3.0
  - @objectstack/plugin-audit@11.3.0
  - @objectstack/plugin-email@11.3.0
  - @objectstack/plugin-hono-server@11.3.0
  - @objectstack/plugin-org-scoping@11.3.0
  - @objectstack/plugin-reports@11.3.0
  - @objectstack/plugin-security@11.3.0
  - @objectstack/plugin-sharing@11.3.0
  - @objectstack/plugin-webhooks@11.3.0
  - @objectstack/rest@11.3.0
  - @objectstack/runtime@11.3.0
  - @objectstack/service-analytics@11.3.0
  - @objectstack/service-automation@11.3.0
  - @objectstack/service-cache@11.3.0
  - @objectstack/service-datasource@11.3.0
  - @objectstack/service-job@11.3.0
  - @objectstack/service-messaging@11.3.0
  - @objectstack/service-package@11.3.0
  - @objectstack/service-queue@11.3.0
  - @objectstack/service-realtime@11.3.0
  - @objectstack/service-settings@11.3.0
  - @objectstack/service-storage@11.3.0
  - @objectstack/trigger-api@11.3.0
  - @objectstack/trigger-record-change@11.3.0
  - @objectstack/trigger-schedule@11.3.0
  - @objectstack/types@11.3.0
  - @objectstack/verify@11.3.0
  - @objectstack/console@11.3.0

## 11.2.0

### Minor Changes

- 8ea1f4f: ADR-0080 M3b②: `os validate` / `os build` now parse `kind:'jsx'` page `source` via `@objectstack/sdui-parser` (new `validateJsxPages` lint rule) — malformed JSX fails loudly at author time (ADR-0078) instead of being stored and breaking only at render. Parse-level for now (syntax, tag matching, forbidden constructs like event handlers / dangerouslySetInnerHTML); full component/prop whitelist validation arrives once the registry manifest is threaded through `compile()`.
- 21c37d8: ADR-0080 M3b① (consumption seam): the `os build` / `os validate` JSX gate now does **full component/prop validation** (unknown component, missing/wrong prop, bad enum, bindings) when a `sdui.manifest.json` is present at the project root — falling back to parse-level otherwise. `validateJsxPages` accepts an optional manifest; the validate command loads the file when present. Generating + shipping that manifest from the registry's public tier remains a build/CI step.

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [8ea1f4f]
- Updated dependencies [21c37d8]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/lint@11.2.0
  - @objectstack/account@11.2.0
  - @objectstack/setup@11.2.0
  - @objectstack/studio@11.2.0
  - @objectstack/client@11.2.0
  - @objectstack/cloud-connection@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/mcp@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/observability@11.2.0
  - @objectstack/platform-objects@11.2.0
  - @objectstack/driver-memory@11.2.0
  - @objectstack/driver-mongodb@11.2.0
  - @objectstack/driver-sql@11.2.0
  - @objectstack/driver-sqlite-wasm@11.2.0
  - @objectstack/plugin-approvals@11.2.0
  - @objectstack/plugin-audit@11.2.0
  - @objectstack/plugin-auth@11.2.0
  - @objectstack/plugin-email@11.2.0
  - @objectstack/plugin-hono-server@11.2.0
  - @objectstack/plugin-org-scoping@11.2.0
  - @objectstack/plugin-reports@11.2.0
  - @objectstack/plugin-security@11.2.0
  - @objectstack/plugin-sharing@11.2.0
  - @objectstack/plugin-webhooks@11.2.0
  - @objectstack/rest@11.2.0
  - @objectstack/runtime@11.2.0
  - @objectstack/service-analytics@11.2.0
  - @objectstack/service-automation@11.2.0
  - @objectstack/service-cache@11.2.0
  - @objectstack/service-datasource@11.2.0
  - @objectstack/service-job@11.2.0
  - @objectstack/service-messaging@11.2.0
  - @objectstack/service-package@11.2.0
  - @objectstack/service-queue@11.2.0
  - @objectstack/service-realtime@11.2.0
  - @objectstack/service-settings@11.2.0
  - @objectstack/service-storage@11.2.0
  - @objectstack/trigger-api@11.2.0
  - @objectstack/trigger-record-change@11.2.0
  - @objectstack/trigger-schedule@11.2.0
  - @objectstack/types@11.2.0
  - @objectstack/verify@11.2.0
  - @objectstack/console@11.2.0

## 11.1.0

### Minor Changes

- fdb41c0: Remove ObjectStack's own legacy env-var aliases (11.0); ecosystem-standard names stay.

  The framework's renamed env vars no longer accept their old ObjectStack names —
  rename them:

  | removed legacy name                 | use                    |
  | ----------------------------------- | ---------------------- |
  | `OS_MULTI_TENANT`                   | `OS_MULTI_ORG_ENABLED` |
  | `OBJECTSTACK_METADATA_WRITABLE`     | `OS_METADATA_WRITABLE` |
  | `OS_AUTH_BASE_URL`, `AUTH_BASE_URL` | `OS_AUTH_URL`          |

  **Ecosystem-standard names are NOT removed** — they remain accepted (and no longer
  emit a deprecation warning, since they are permanent conventions, not legacy):
  `DATABASE_URL`, `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PORT`,
  `CORS_*`, `LOG_LEVEL`, `ROOT_DOMAIN`, `MCP_SERVER_*`. The generic
  `readEnvWithDeprecation` helper is unchanged.

### Patch Changes

- Updated dependencies [574e7a3]
- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [18f9713]
- Updated dependencies [7cf81a7]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [8c84c97]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [13dbcf2]
- Updated dependencies [9ccfcd6]
- Updated dependencies [dc2990f]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/plugin-security@11.1.0
  - @objectstack/plugin-auth@11.1.0
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/service-settings@11.1.0
  - @objectstack/rest@11.1.0
  - @objectstack/runtime@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/observability@11.1.0
  - @objectstack/plugin-hono-server@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/client@11.1.0
  - @objectstack/driver-memory@11.1.0
  - @objectstack/verify@11.1.0
  - @objectstack/account@11.1.0
  - @objectstack/setup@11.1.0
  - @objectstack/studio@11.1.0
  - @objectstack/plugin-approvals@11.1.0
  - @objectstack/plugin-audit@11.1.0
  - @objectstack/plugin-email@11.1.0
  - @objectstack/plugin-org-scoping@11.1.0
  - @objectstack/plugin-reports@11.1.0
  - @objectstack/plugin-sharing@11.1.0
  - @objectstack/service-job@11.1.0
  - @objectstack/service-queue@11.1.0
  - @objectstack/service-realtime@11.1.0
  - @objectstack/service-storage@11.1.0
  - @objectstack/cloud-connection@11.1.0
  - @objectstack/mcp@11.1.0
  - @objectstack/driver-mongodb@11.1.0
  - @objectstack/driver-sql@11.1.0
  - @objectstack/driver-sqlite-wasm@11.1.0
  - @objectstack/plugin-webhooks@11.1.0
  - @objectstack/service-analytics@11.1.0
  - @objectstack/service-automation@11.1.0
  - @objectstack/service-cache@11.1.0
  - @objectstack/service-datasource@11.1.0
  - @objectstack/service-messaging@11.1.0
  - @objectstack/service-package@11.1.0
  - @objectstack/trigger-api@11.1.0
  - @objectstack/trigger-record-change@11.1.0
  - @objectstack/trigger-schedule@11.1.0
  - @objectstack/formula@11.1.0
  - @objectstack/lint@11.1.0
  - @objectstack/console@11.1.0

## 11.0.0

### Minor Changes

- cb5b393: Auth: account lockout + rate-limit tuning (ADR-0069 D2, P1)

  Second slice of ADR-0069 — per-identity brute-force protection, reusing the setting→enforcement pattern from the HIBP PR.

  - **Account lockout** `[custom][field]`: new `sys_user.failed_login_count` / `sys_user.locked_until` columns; `auth` settings `lockout_threshold` (0 = off) + `lockout_duration_minutes`. Enforced in the `/sign-in/email` before/after hooks — failures increment the counter, crossing the threshold stamps `locked_until`, and a locked account is rejected **even with the correct password** (survives IP rotation, unlike rate limiting). A successful sign-in resets both.
  - **Admin Unlock**: new admin-guarded `POST /api/v1/auth/admin/unlock-user` route + an `unlock_user` action on `sys_user`.
  - **Rate-limit tuning** `[native]`: `auth` settings `rate_limit_max` / `rate_limit_window_seconds` wire better-auth's core `rateLimit` with stricter `customRules` for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.

  All settings default off / to safe values; additive (no upgrade behavior change). Per ADR-0049 each setting ships with its enforcement. Timestamps are written as `Date` (never epoch-ms) per ADR-0074.

- ab5718a: Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

  First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

  - **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
  - **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
  - **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
  - **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

  Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).

- 4845c12: feat(cli): make the AI service opt-in via a declared dependency; honor `config.tiers`

  **AI edition boundary (cli).** The CLI auto-registered the headless `AIServicePlugin`
  whenever the `ai` tier was enabled (default) and `@objectstack/service-ai` was
  merely _resolvable_. In a workspace/monorepo the package is hoist-resolvable even
  when an app does not declare it, so every app got the AI service — discovery
  reported `services.ai: available` and the agent runtime served any
  metadata-defined agents — including Community-Edition apps that ship no AI.

  Now the _declared_ dependency is the boundary: AIService auto-registers only when
  the host app declares `@objectstack/service-ai` **or** `@objectstack/service-ai-studio`
  (Studio attaches its personas via the base service's `ai:ready` hook, so declaring
  Studio implies the base). A CE app that declares neither gets no AI service, no
  agents, and `services.ai: { enabled: false, status: 'unavailable' }` in discovery
  (so the console hides its AI surface). MCP and every other capability are
  unaffected. The `app-showcase`/`app-crm` examples now declare `@objectstack/service-ai`.

  **`config.tiers` now honored (spec).** `ObjectStackDefinitionSchema` gains a `tiers`
  field, so `defineStack` no longer strips it. `config.tiers` (e.g. a list WITHOUT
  `ai`) now actually overrides the `--preset` default — previously it was silently
  dropped by schema validation, making the `--preset` help text inaccurate. This is
  a second, in-place way to disable AI for a deployment without touching dependencies.

- ad143ce: fix(security): surface the schedule/user-less `runAs:'user'` fail-open (#1888 follow-up)

  With `flow.runAs` now enforced (#1888), a **schedule-triggered** flow with the
  default `runAs:'user'` has no trigger user. `resolveRunDataContext` returns
  `undefined` for that case, so the CRUD nodes pass no ObjectQL `options.context`
  and the security middleware — which _skips_ when there is no identity (it
  delegates auth to the auth layer) — runs the operation **UNSCOPED** (effectively
  elevated). An author who left `runAs` at the `'user'` default expecting a
  restricted run silently gets an unscoped one — a fail-open footgun (ADR-0049: a
  security property must not silently do the opposite of what it implies).

  This is the **product decision** to make that explicit, chosen to keep legitimate
  scheduled CRUD working (denying outright would break it, and silently elevating
  would hide the author's intent). Prevention happens where the platform can tell
  intent apart (author/build time); the runtime stays non-breaking but is no longer
  silent:

  - **Author-time lint** (`@objectstack/cli`, `lintFlowPatterns`): a new advisory
    rule `flow-schedule-runas-unscoped` flags a schedule-triggered flow whose
    effective `runAs` is `user` (explicit or unset) and which performs a data
    operation — pointing the author at `runAs:'system'`. Catches the footgun at
    compile time, before deploy (most flows are AI-authored).
  - **Runtime warning** (`@objectstack/service-automation`): the engine now emits a
    clear one-per-run warning when a user-mode run resolves no trigger identity and
    the flow touches data — the fail-open is _audible_ rather than silent. Behavior
    is otherwise unchanged (the run still executes), so scheduled CRUD that relied
    on this is not broken. New helpers `runIsUnscopedUserMode`, `flowTouchesData`,
    and `DATA_NODE_TYPES` are exported alongside `resolveRunDataContext`.
  - **Spec describe** (`@objectstack/spec`): `FlowSchema.runAs` now states that a
    scheduled run has no user, so under `user` it runs unscoped — declare `system`.

  The first-party example apps that tripped the new lint are fixed to declare
  `runAs:'system'` explicitly (`stale_opportunity_sweep`, the app-todo
  `task_reminder` / `overdue_escalation` sweeps) — they read/write across owners and
  were running unscoped by default.

  Longer term, attributing scheduled runs to a dedicated service principal (so they
  are scopable + audit-attributable rather than unscoped) is the right enforcement;
  tracked as M2 follow-up.

  Proven by a service-automation unit test (the engine warns once for a user-less
  user-mode data run; stays silent for `system`, for an identified user, and for a
  data-less flow), an end-to-end test wiring the **real `ScheduleTrigger` to the
  real engine** (`@objectstack/trigger-schedule`) that fires a job and asserts the
  user-less identity reaches the engine + trips the warning through the actual cron
  path, and a dogfood gate (`flow-runas-schedule.dogfood.test.ts`) that drives
  user-less runs through the real automation + security + data stack: a
  `runAs:'user'` run reads + writes an owner-scoped note a member cannot — audibly —
  while `runAs:'system'` is the explicit, warning-free equivalent.

  Refs #1888, ADR-0049.

### Patch Changes

- 84784fc: feat(cli): lint ADR-0044 approval revise-loop footguns at compile time

  `objectstack compile` now warns on two send-back-for-revision shapes an AI (or human) authoring an approval flow commonly gets wrong:

  - **Dead-end revise** — an approval node with a `revise` out-edge but no path looping back to it. This is a valid DAG, so `registerFlow` accepts it, yet the submitter reworks the record with nowhere to resubmit. The linter is the only place that catches the dead end.
  - **Un-declared revise loop** — the loop returns to the approval but the closing edge isn't `type: 'back'`, so `registerFlow` rejects it as an un-declared cycle. The lint fires at compile time with the specific fix (mark the resubmit edge `type: 'back'`).

  Also flags `maxRevisions: 0` alongside a `revise` edge (send-back disabled, so the branch always auto-rejects and never runs). Advisory only — never fails the build. Part of #2274 / ADR-0044.

- d980f0d: feat: add a first-class `user` field type (person picker)

  A new `user` field type — the equivalent of Airtable's Collaborator / Notion's
  Person / Salesforce's `Lookup(User)`. Authored as `Field.user({ ... })`; use
  `{ multiple: true }` for collaborators/watchers and `{ defaultValue: 'current_user' }`
  to auto-fill the acting user on create.

  **Why a distinct type rather than telling authors to `Field.lookup('sys_user')`:**
  selecting a person is table-stakes, but the value is in _modelling
  discoverability_ — a "User" entry in the Studio/AI field palette instead of
  requiring authors (and AI) to know to reference the internal `sys_user` system
  object — plus `current_user` defaults and a user-search picker. Storage and
  runtime are unchanged.

  **Deliberately NOT a new storage primitive.** `user` is a _semantic
  specialization of `lookup`_ with the target fixed to `sys_user`: it shares the
  exact lookup code path — same FK string column (`multiple` ⇒ JSON), same
  `$expand` resolution, same indexing — so referential integrity and fresh display
  names come for free, and nothing is re-implemented. An existing
  `Field.lookup('sys_user')` is therefore equivalent at the storage layer (zero
  data migration to adopt `Field.user`).

  Ownership semantics are **unchanged**: the existing `owner_id` convention +
  `plugin-security` auto-stamp/RLS still apply. A declarative `owner` flag is a
  possible future follow-up; intentionally not added here to avoid a second
  field type for what is a system role (rationale: keep the `FieldType` surface
  lean — see related ADR-0059 freeze discipline).

  Changes: `FieldType` gains `'user'` + `Field.user()` builder; the SQL/Mongo
  drivers treat `user` exactly like `lookup`; the engine resolves `$expand` for
  `user` fields and honours a new `defaultValue: 'current_user'` token (resolved
  app-side from the execution context, mirroring the `NOW()` convention); kanban
  group-by and symbolic seed references accept `user`; approvals enrich `user`
  references. The public API surface is unchanged (additive enum member).

- Updated dependencies [caa3ef4]
- Updated dependencies [22b32c1]
- Updated dependencies [4d99a5c]
- Updated dependencies [21b3208]
- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [d616e1d]
- Updated dependencies [910a8f0]
- Updated dependencies [1e8a813]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [1b00ba2]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [4b5ec6e]
- Updated dependencies [b6a4972]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [359c0aa]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [9a810f8]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [98a1535]
- Updated dependencies [bc22a89]
- Updated dependencies [8a7e9f1]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/plugin-auth@11.0.0
  - @objectstack/objectql@11.0.0
  - @objectstack/runtime@11.0.0
  - @objectstack/service-settings@11.0.0
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/service-analytics@11.0.0
  - @objectstack/client@11.0.0
  - @objectstack/service-automation@11.0.0
  - @objectstack/trigger-record-change@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/rest@11.0.0
  - @objectstack/trigger-schedule@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/driver-sql@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/driver-mongodb@11.0.0
  - @objectstack/plugin-approvals@11.0.0
  - @objectstack/verify@11.0.0
  - @objectstack/plugin-sharing@11.0.0
  - @objectstack/cloud-connection@11.0.0
  - @objectstack/account@11.0.0
  - @objectstack/setup@11.0.0
  - @objectstack/studio@11.0.0
  - @objectstack/plugin-audit@11.0.0
  - @objectstack/plugin-email@11.0.0
  - @objectstack/plugin-org-scoping@11.0.0
  - @objectstack/plugin-reports@11.0.0
  - @objectstack/plugin-security@11.0.0
  - @objectstack/service-job@11.0.0
  - @objectstack/service-queue@11.0.0
  - @objectstack/service-realtime@11.0.0
  - @objectstack/service-storage@11.0.0
  - @objectstack/lint@11.0.0
  - @objectstack/mcp@11.0.0
  - @objectstack/observability@11.0.0
  - @objectstack/driver-memory@11.0.0
  - @objectstack/driver-sqlite-wasm@11.0.0
  - @objectstack/plugin-hono-server@11.0.0
  - @objectstack/plugin-webhooks@11.0.0
  - @objectstack/service-cache@11.0.0
  - @objectstack/service-datasource@11.0.0
  - @objectstack/service-messaging@11.0.0
  - @objectstack/service-package@11.0.0
  - @objectstack/trigger-api@11.0.0
  - @objectstack/console@11.0.0

## 10.3.0

### Minor Changes

- 2b355d5: feat(cluster): multi-node authorization gate (open mechanism)

  `@objectstack/service-cluster` now exports `registerMultiNodeGate` /
  `checkMultiNodeAllowed`: a distribution (e.g. the Enterprise Edition) can
  register a gate that authorizes whether the runtime may enable a multi-node
  (remote-driver) topology. The open framework ships no gate — multi-node is
  always allowed.

  `os serve` consults the gate before activating a remote cluster driver; on
  denial it **downgrades to single-node (in-memory) rather than failing** —
  multi-node is an add-on, never bricks the runtime. The framework holds zero
  license logic; this is the open seam an EE license plugs into (cloud ADR-0022).

### Patch Changes

- f75943a: feat(lint): SDUI styling validator (ADR-0065)

  `validateResponsiveStyles` — a pure `(stack) => Finding[]` rule wired into
  `os validate` and `os compile`, so hand-authored and AI-generated pages are
  held to the same bar (ADR-0019). Catches the deterministic ways a
  `responsiveStyles` block silently fails: a styled node with no `id` (CSS can't
  be scoped → dropped) is an **error**; warnings cover Tailwind-in-`className`
  (silently dead in metadata), a smaller breakpoint with no `large` base, unknown
  CSS properties, and unknown/typo'd design tokens. Quality/visual judgement
  (is it ugly) is out of scope — that needs render + a VLM gate.

- c121d73: fix(cli): let single-node `os start` auto-mint a crypto key

  `os start` forces `NODE_ENV=production`, which made `LocalCryptoProvider` refuse
  to boot without `OS_SECRET_KEY` — breaking the documented zero-config quickstart
  (`npm i -g @objectstack/cli && os start`) on a clean machine.

  `LocalCryptoProvider` now honours an `OS_CRYPTO_AUTOKEY` opt-in in production: it
  mints AND persists a key to `~/.objectstack/dev-crypto-key`. The ephemeral
  fallback stays forbidden, so a non-writable / ephemeral filesystem still fails
  loud rather than running under a key that won't survive a restart. `os start`
  sets the flag only for single-node deployments (no `OS_CLUSTER_DRIVER`, no
  `OS_SECRET_KEY`); multi-node still fails loud until `OS_SECRET_KEY` is provided.

- f2063f3: fix(cli): extend native better-sqlite3 → wasm SQLite auto-fallback to the persistent-file / `--artifact` dev path (#2229)

  The native-`better-sqlite3` → wasm SQLite → in-memory step-down previously only
  guarded the zero-config `:memory:` dev branch of `serve`. A normal
  `objectstack dev` run never reaches it — `dev` injects a persistent `file:` DB
  (so AI-authored data survives restarts) and `--artifact` boots resolve sqlite
  through the datasource factory — both of which constructed
  `better-sqlite3` directly with no probe and no fallback. An ABI mismatch (e.g.
  a cached prebuilt binary built for a different Node version) was therefore not
  caught at boot and surfaced later as a runtime `Find operation failed` on the
  first query.

  The probe-by-connect + step-down is now hoisted into a shared
  `resolveSqliteDriver` helper (`@objectstack/service-datasource`) and applied to
  both previously-unguarded sqlite construction sites: the explicit `sqlite` /
  `file:` branch in `serve.ts` and the sqlite branch of the default datasource
  driver factory. better-sqlite3 loads its native addon lazily (first query), so
  the helper forces the load with a `SELECT 1` and, **in dev only**, steps down to
  wasm SQLite (real SQL + on-disk persistence — the same `file:` keeps working)
  then to the in-memory driver as a last resort, emitting the existing
  `⚠ native better-sqlite3 unavailable …` warning. In production the native driver
  is returned unprobed so a load failure surfaces loudly (fail-closed) rather than
  silently degrading to a different engine.

- Updated dependencies [f73d40a]
- Updated dependencies [5ba52b0]
- Updated dependencies [211425e]
- Updated dependencies [f75943a]
- Updated dependencies [6d3bf54]
- Updated dependencies [c121d73]
- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/service-analytics@10.3.0
  - @objectstack/driver-sql@10.3.0
  - @objectstack/objectql@10.3.0
  - @objectstack/lint@10.3.0
  - @objectstack/service-messaging@10.3.0
  - @objectstack/service-settings@10.3.0
  - @objectstack/runtime@10.3.0
  - @objectstack/service-datasource@10.3.0
  - @objectstack/verify@10.3.0
  - @objectstack/driver-sqlite-wasm@10.3.0
  - @objectstack/client@10.3.0
  - @objectstack/plugin-sharing@10.3.0
  - @objectstack/trigger-record-change@10.3.0
  - @objectstack/plugin-webhooks@10.3.0
  - @objectstack/cloud-connection@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/console@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/observability@10.3.0
  - @objectstack/formula@10.3.0
  - @objectstack/platform-objects@10.3.0
  - @objectstack/studio@10.3.0
  - @objectstack/setup@10.3.0
  - @objectstack/rest@10.3.0
  - @objectstack/driver-memory@10.3.0
  - @objectstack/driver-mongodb@10.3.0
  - @objectstack/plugin-approvals@10.3.0
  - @objectstack/plugin-audit@10.3.0
  - @objectstack/plugin-auth@10.3.0
  - @objectstack/plugin-email@10.3.0
  - @objectstack/plugin-hono-server@10.3.0
  - @objectstack/mcp@10.3.0
  - @objectstack/plugin-org-scoping@10.3.0
  - @objectstack/plugin-reports@10.3.0
  - @objectstack/plugin-security@10.3.0
  - @objectstack/trigger-api@10.3.0
  - @objectstack/trigger-schedule@10.3.0
  - @objectstack/service-ai@10.3.0
  - @objectstack/service-automation@10.3.0
  - @objectstack/service-cache@10.3.0
  - @objectstack/service-job@10.3.0
  - @objectstack/service-package@10.3.0
  - @objectstack/service-queue@10.3.0
  - @objectstack/service-realtime@10.3.0
  - @objectstack/service-storage@10.3.0
  - @objectstack/account@10.3.0

## 10.2.0

### Patch Changes

- 63f3219: feat(lint): extract static metadata validators into @objectstack/lint (ADR-0019 P3)

  New public package `@objectstack/lint` holds the pure, build-time metadata
  validators as `(stack) => Finding[]` functions, so the same rules run wherever a
  stack can be assembled — the CLI's `os validate`/`compile` and any other
  consumer (notably AI-driven authoring), instead of being trapped in CLI
  internals where only the CLI could reach them.

  First release moves the two validators the AI build needs:

  - `validateWidgetBindings` — dashboard widget → dataset → measure/dimension
    reference integrity + measure-aggregation coherence (ADR-0021).
  - `validateStackExpressions` — CEL/predicate validity for field conditionals,
    sharing rules, action visible/disabled, lifecycle hooks (ADR-0032).

  `@objectstack/cli` now imports both from `@objectstack/lint` (was `./utils/*`);
  pure move, no behavior change. Dependency direction is one-way `lint → spec`;
  the package never depends on a runtime and is never bundled into a frontend
  (that is why the validators do NOT live in the frontend-facing `@objectstack/spec`).

  Filesystem-coupled checks (`lint-liveness-properties`) and CLI-command-coupled
  ones (`score` → `lintConfig`) deliberately stay in the CLI for now; they can
  move in a later increment.

- Updated dependencies [63f3219]
- Updated dependencies [b496498]
  - @objectstack/lint@10.2.0
  - @objectstack/spec@10.2.0
  - @objectstack/account@10.2.0
  - @objectstack/setup@10.2.0
  - @objectstack/studio@10.2.0
  - @objectstack/client@10.2.0
  - @objectstack/cloud-connection@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0
  - @objectstack/mcp@10.2.0
  - @objectstack/objectql@10.2.0
  - @objectstack/observability@10.2.0
  - @objectstack/platform-objects@10.2.0
  - @objectstack/driver-memory@10.2.0
  - @objectstack/driver-mongodb@10.2.0
  - @objectstack/driver-sql@10.2.0
  - @objectstack/driver-sqlite-wasm@10.2.0
  - @objectstack/plugin-approvals@10.2.0
  - @objectstack/plugin-audit@10.2.0
  - @objectstack/plugin-auth@10.2.0
  - @objectstack/plugin-email@10.2.0
  - @objectstack/plugin-hono-server@10.2.0
  - @objectstack/plugin-org-scoping@10.2.0
  - @objectstack/plugin-reports@10.2.0
  - @objectstack/plugin-security@10.2.0
  - @objectstack/plugin-sharing@10.2.0
  - @objectstack/plugin-webhooks@10.2.0
  - @objectstack/rest@10.2.0
  - @objectstack/runtime@10.2.0
  - @objectstack/service-ai@10.2.0
  - @objectstack/service-analytics@10.2.0
  - @objectstack/service-automation@10.2.0
  - @objectstack/service-cache@10.2.0
  - @objectstack/service-datasource@10.2.0
  - @objectstack/service-job@10.2.0
  - @objectstack/service-messaging@10.2.0
  - @objectstack/service-package@10.2.0
  - @objectstack/service-queue@10.2.0
  - @objectstack/service-realtime@10.2.0
  - @objectstack/service-settings@10.2.0
  - @objectstack/service-storage@10.2.0
  - @objectstack/trigger-api@10.2.0
  - @objectstack/trigger-record-change@10.2.0
  - @objectstack/trigger-schedule@10.2.0
  - @objectstack/types@10.2.0
  - @objectstack/verify@10.2.0
  - @objectstack/console@10.2.0

## 10.1.0

### Minor Changes

- 49da36e: feat(datasource): reject field.columnName on external objects + drop showcase onEnable bridge (ADR-0062 Phase 4, D7/D8)

  **D7 — reconcile column mapping.** `os compile`/`build` (`validateStackExpressions`)
  now rejects `field.columnName` on a federated (external) object with a corrective
  message: the driver's query pipeline ignores `field.columnName` for external
  objects, so `external.columnMap` is the single authoritative mechanism. Managed
  objects are untouched.

  **D8 — drop the canonical example's driver bridge.** `examples/app-showcase`
  declares its external datasource with **no** `onEnable` driver registration — the
  declared datasource auto-connects at boot (ADR-0062 D1). `onEnable` now only
  provisions the "remote" fixture tables. To cover this end-to-end, the
  `@objectstack/verify` harness wires the datasource-admin plugin (registering the
  `'datasource-connection'` service) when an app declares datasources, so it mirrors
  `objectstack dev`/serve; a new dogfood test reads the federated objects through the
  real REST stack (incl. the `remoteName` remap). `onEnable` + `ctx.drivers.register`
  remains supported as an escape hatch for drivers built dynamically at runtime.

- 7cf283a: Make `os validate` the author-time verification gate and steer scaffolds toward it.

  - **`os validate`** now runs the same CEL/predicate gate as `os build`/`os compile`
    (ADR-0032): every `visible`/`disabled`/`requiredWhen`/validation/flow/sharing
    predicate is checked for CEL syntax and `record.<field>` existence on the target
    object. It already ran the protocol schema and widget-binding checks; the
    expression gate closes the gap so a bare field ref (`done` instead of
    `record.done`) — which silently hides an action on every record at runtime
    (#2183/#2185) — fails validation instead of shipping. `os validate` is now a
    read-only superset of the build's checks (no artifact emitted).
  - **`create-objectstack`** now emits an `AGENTS.md` (and `.github/copilot-instructions.md`)
    into every generated project instructing coding agents to run `npm run validate`
    after editing metadata, aligns the blank template's `dev`/`start` scripts with the
    example apps (`objectstack dev`/`objectstack start`), and sharpens the post-create
    "Next steps" output.

- 517dad9: Schema drift detection + `os migrate` for non-additive metadata changes (#2186).

  The metadata→DB schema sync was additive-only: it created tables and added
  columns but never altered/dropped existing ones, so relaxing `required`,
  changing a type/length, or dropping a field silently diverged from an existing
  database. The physical column won at write time, surfacing a misleading
  `organization_id is required` 400 even though `/meta` reported the field
  optional.

  - **driver-sql** — the SQL driver now detects managed-schema drift (metadata is
    the source of truth) and categorises each divergence `safe` / `needs_confirm`
    / `destructive`. `initObjects` warns once per divergence with an actionable
    hint. A new opt-in `SqlDriverConfig.autoMigrate: 'safe'` auto-applies the
    _loosening_ subset (relax `NOT NULL`, widen varchar) so an existing dev DB
    self-heals on restart — never destructive, force-disabled under
    `NODE_ENV=production`. New public methods `detectManagedDrift()` /
    `applyMigrationEntries()`. SQLite reconciles via the official table-rebuild
    (copy → swap), preserving data; Postgres/MySQL alter in place.
  - **cli** — new `os migrate plan` (dry-run, categorised diff) and
    `os migrate apply` (`--allow-destructive` for drops/tightenings, confirm gate,
    `--json`). `os dev`/`serve` now pass `autoMigrate: 'safe'` in dev only.
  - **rest** — a `NOT NULL` violation that reaches the driver (metadata validation
    already passed) now carries a drift-aware `hint` pointing at `os migrate`,
    instead of only the misleading "field is required" message. The
    `VALIDATION_FAILED` / `fields` envelope is unchanged for back-compat.

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
- Updated dependencies [49da36e]
- Updated dependencies [517dad9]
  - @objectstack/spec@10.1.0
  - @objectstack/service-analytics@10.1.0
  - @objectstack/service-datasource@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/verify@10.1.0
  - @objectstack/driver-sql@10.1.0
  - @objectstack/rest@10.1.0
  - @objectstack/account@10.1.0
  - @objectstack/setup@10.1.0
  - @objectstack/studio@10.1.0
  - @objectstack/client@10.1.0
  - @objectstack/cloud-connection@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/mcp@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/observability@10.1.0
  - @objectstack/platform-objects@10.1.0
  - @objectstack/driver-memory@10.1.0
  - @objectstack/driver-mongodb@10.1.0
  - @objectstack/driver-sqlite-wasm@10.1.0
  - @objectstack/plugin-approvals@10.1.0
  - @objectstack/plugin-audit@10.1.0
  - @objectstack/plugin-auth@10.1.0
  - @objectstack/plugin-email@10.1.0
  - @objectstack/plugin-hono-server@10.1.0
  - @objectstack/plugin-org-scoping@10.1.0
  - @objectstack/plugin-reports@10.1.0
  - @objectstack/plugin-security@10.1.0
  - @objectstack/plugin-sharing@10.1.0
  - @objectstack/plugin-webhooks@10.1.0
  - @objectstack/service-ai@10.1.0
  - @objectstack/service-automation@10.1.0
  - @objectstack/service-cache@10.1.0
  - @objectstack/service-job@10.1.0
  - @objectstack/service-messaging@10.1.0
  - @objectstack/service-package@10.1.0
  - @objectstack/service-queue@10.1.0
  - @objectstack/service-realtime@10.1.0
  - @objectstack/service-settings@10.1.0
  - @objectstack/service-storage@10.1.0
  - @objectstack/trigger-api@10.1.0
  - @objectstack/trigger-record-change@10.1.0
  - @objectstack/trigger-schedule@10.1.0
  - @objectstack/types@10.1.0
  - @objectstack/console@10.1.0

## 10.0.0

### Minor Changes

- 48a307a: build: validate UI action `visible` / `disabled` predicates at compile time

  Extends the ADR-0032 build-time expression check to cover action `visible` and
  `disabled` predicates (stack-level and object-attached), evaluated record-scoped
  like validation rules. A record-header / row action's `visible` is evaluated by
  `ActionEngine` against `{ record, recordId, objectName, user, … }` with
  fail-closed semantics, so a **bare** field reference (`!done` instead of
  `!record.done`) throws at runtime and the action is **silently hidden on every
  record** — the trap behind the #2183 "Mark Done never hides" debugging hunt.
  `os build` now reports it as an error with the corrective `record.<field>`
  message instead of letting it ship.

  `@objectstack/formula`: `ctx` and `features` are added to the record-scope
  namespace roots (alongside the existing `user`, `data`, `context`, …) so the
  ambient globals real action predicates use (`record.id == ctx.user.id`,
  `features.multiOrgEnabled`) are not false-positives. Verified against the full
  monorepo build (every example + platform bundle still compiles clean).

- 25fc0e4: build: extend ADR-0032 predicate validation to all flat record-scoped sites

  Builds on the action-predicate guard. `os build` now also validates these
  record-scoped predicates for bare field references (`status` instead of
  `record.status`), which otherwise evaluate to nothing at runtime and silently
  mis-behave:

  - **field conditional rules** — `requiredWhen`, `readonlyWhen`,
    `conditionalRequired`, `visibleWhen` (server-enforced; a broken one is
    fail-open — the required/readonly rule just never fires);
  - **sharing-rule `condition`** (security-critical — decides which rows a
    principal sees);
  - **lifecycle hook `condition`** (skips the handler when false);
  - **nested `when`** on `conditional` validation rules (previously only the
    top-level rule predicate was checked).

  `@objectstack/formula`: adds `parent` to the record-scope namespace roots —
  master-detail inline grids inject the header record as `parent` for a child
  field's `readonlyWhen`/`requiredWhen` (ADR-0036, #1581), so `parent.status` is
  legitimate, not a bare ref. Verified against the full monorepo build (76 tasks
  clean).

  Not yet covered (separate follow-up — needs a recursive view/page tree walker
  and per-node scope classification): deeply-nested UI visibility predicates
  (`view` element/section `visibleOn`/`condition`, `page` component `visibility`),
  object field-group `visibleOn`, and app-nav `visible` (user/feature-scoped, not
  record-scoped).

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [92db3e5]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [70609af]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [ee86099]
- Updated dependencies [3187952]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [3754f80]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [00c32f2]
- Updated dependencies [be07ce7]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
- Updated dependencies [0feea92]
  - @objectstack/spec@10.0.0
  - @objectstack/driver-sql@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/rest@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/plugin-sharing@10.0.0
  - @objectstack/plugin-security@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/plugin-approvals@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/service-ai@10.0.0
  - @objectstack/service-analytics@10.0.0
  - @objectstack/verify@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/plugin-hono-server@10.0.0
  - @objectstack/account@10.0.0
  - @objectstack/setup@10.0.0
  - @objectstack/studio@10.0.0
  - @objectstack/client@10.0.0
  - @objectstack/cloud-connection@10.0.0
  - @objectstack/mcp@10.0.0
  - @objectstack/observability@10.0.0
  - @objectstack/driver-memory@10.0.0
  - @objectstack/driver-mongodb@10.0.0
  - @objectstack/driver-sqlite-wasm@10.0.0
  - @objectstack/plugin-audit@10.0.0
  - @objectstack/plugin-auth@10.0.0
  - @objectstack/plugin-email@10.0.0
  - @objectstack/plugin-org-scoping@10.0.0
  - @objectstack/plugin-reports@10.0.0
  - @objectstack/plugin-webhooks@10.0.0
  - @objectstack/service-automation@10.0.0
  - @objectstack/service-cache@10.0.0
  - @objectstack/service-datasource@10.0.0
  - @objectstack/service-job@10.0.0
  - @objectstack/service-messaging@10.0.0
  - @objectstack/service-package@10.0.0
  - @objectstack/service-queue@10.0.0
  - @objectstack/service-realtime@10.0.0
  - @objectstack/service-settings@10.0.0
  - @objectstack/service-storage@10.0.0
  - @objectstack/trigger-api@10.0.0
  - @objectstack/trigger-record-change@10.0.0
  - @objectstack/trigger-schedule@10.0.0
  - @objectstack/types@10.0.0
  - @objectstack/console@10.0.0

## 9.11.0

### Minor Changes

- c651f38: feat(cli): warn on unrecognized autonumber format tokens

  `objectstack compile` now flags `autonumber` formats whose `{...}` token is not a
  counter (`{0000}`), date (`{YYYY}`/`{MM}`/…) or `{field}` token — an unrecognized
  group (wrong case, spaces, punctuation, or a second sequence slot) renders
  LITERALLY into the record number, which is a silent footgun for AI-authored
  templates. Emitted as an advisory warning (`autonumber-unrecognized-token`),
  alongside the existing `{field}`-reference checks. The `objectstack-data` skill's
  `field-types` rules were also expanded to document the date/`{field}`/per-scope
  tokens and the authoring rules (required interpolated fields, delimited adjacent
  tokens, pad width is a minimum, date tokens are exact).

- 36138c7: feat(autonumber): date, {field} and per-scope counter reset for autonumber formats

  `autonumberFormat` previously only understood a single `{0000}` sequence slot —
  everything else was a fixed literal prefix on one global counter. Real MES/eHR
  record numbers need three more token classes, so the format is now tokenized by a
  shared pure renderer in `@objectstack/spec` (`parseAutonumberFormat` /
  `renderAutonumber`) that the engine fallback and the SQL driver both call, so they
  emit byte-identical numbers (#1603 parity):

  - **Date tokens** — `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` resolve the calendar
    day in the request's **business timezone** (`ExecutionContext.timezone`, ADR-0053;
    UTC fallback), threaded through the new `DriverOptions.timezone`.
  - **`{field}` interpolation** — `{section}{island_zone}{000}` substitutes record
    field values into the prefix.
  - **Per-scope counter reset** — the counter's scope is the rendered prefix _before_
    the sequence slot, so `AD{YYYYMMDD}{0000}` resets daily, `{section}{island_zone}{000}`
    numbers per group, and `{plan_no}{000}` numbers per parent — all from one
    mechanism, no separate reset config.

  Fixed-prefix formats like `CASE-{0000}` render an empty scope and keep their single
  global counter, so existing sequences are unchanged. The persistent
  `_objectstack_sequences` table is keyed by a `key_hash` (SHA-256 of
  `object, tenant_id, field, scope`) — a single 64-char primary key that keys every
  dialect uniformly, stays within MySQL's utf8mb4 index-length limit (four raw
  columns would not), and lets `scope` be a generous non-indexed column. Deployments
  with an older table (3-column, or an interim `scope` column) are migrated in place
  on first use, carrying existing counters to `scope=''`.

  Guardrails:

  - **Empty interpolated field is a hard error, not a silent mis-number.** A
    `{field}` token whose value is missing at create time would render to an empty
    prefix and collapse the record into the wrong counter scope. Both the SQL driver
    and the engine fallback now refuse to generate and throw a clear error naming the
    empty field (shared `missingFieldValues` helper).
  - **Build-time lint (`@objectstack/cli compile`).** `autonumber` formats are
    checked against the object's fields: a `{field}` token naming a non-existent
    field (or the autonumber field itself) **fails the build**; a token naming an
    _optional_ field emits an advisory warning to mark it `required: true`.
  - **Migration fails safe.** If a legacy table cannot be migrated to the `key_hash`
    shape, fixed-prefix sequences keep working via the legacy key and a per-scope
    write raises an actionable error instead of corrupting counters.
  - **Long `{field}` scopes are supported** (e.g. a long `{plan_no}`): the non-indexed
    `scope` column and hashed key remove the old varchar/PK length ceiling.

  Notes on inherent semantics (documented, not bugs):

  - The counter scope IS the rendered prefix. When two records' tokens render to the
    same prefix string (e.g. `{a}{b}` for `('AB','C')` and `('A','BC')`) they also
    render the same visible number, so they share one counter to stay unique — the
    remedy for genuinely-distinct groups is an unambiguous format (a delimiter
    literal between variable tokens).
  - The sequence pad width is a MINIMUM; past it the number grows (`{000}` →
    `1000`), it never wraps — matching mainstream autonumber semantics.

- fd2e1a2: Add `@objectstack/verify` — boot any ObjectStack app in-process and verify it through the real HTTP stack: auto-derived CRUD round-trip fidelity (`runCrudVerification`) plus the cross-owner RLS invariant (`runRlsProofs`, "you can't write what you can't read"). Also adds an `objectstack verify` CLI command that runs these proofs against an app config and exits non-zero on real failures.

  Extracted from the internal dogfood regression gate so third-party and template authors can run the same runtime proofs against their own apps. The private `@objectstack/dogfood` package now consumes this library for its golden regression tests.

### Patch Changes

- 5a5a9fe: feat(security): public-form demo (Option A) + app-declared default profile wiring (ADR-0056 D7)

  Wires ADR-0056's app-declarable default profile through the CLI so it actually
  takes effect under `pnpm dev`. `@objectstack/plugin-security` exports a new
  `appDefaultProfileName(permissions)` helper that extracts the first
  `isProfile && isDefault` profile name from a stack; `@objectstack/cli` (`serve.ts`)
  passes it as the SecurityPlugin `fallbackPermissionSet` (undefined → built-in
  `member_default` preserved, so apps that declare no default are unaffected).

  The showcase gains a working web-to-lead **public form** (`showcase_inquiry` +
  an `allowAnonymous` FormView authorized by the declaration-derived
  `publicFormGrant`, no `guest_portal` profile) and an app-declared default
  profile (`showcase_member_default`), each covered by a dogfood proof over the
  real HTTP stack.

- Updated dependencies [e7f6539]
- Updated dependencies [e7f6539]
- Updated dependencies [fa8964d]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [751f5cf]
- Updated dependencies [5a5a9fe]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
- Updated dependencies [a8e4f3b]
- Updated dependencies [fd2e1a2]
  - @objectstack/spec@9.11.0
  - @objectstack/plugin-sharing@9.11.0
  - @objectstack/rest@9.11.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/driver-sql@9.11.0
  - @objectstack/verify@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/account@9.11.0
  - @objectstack/setup@9.11.0
  - @objectstack/studio@9.11.0
  - @objectstack/client@9.11.0
  - @objectstack/cloud-connection@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/formula@9.11.0
  - @objectstack/mcp@9.11.0
  - @objectstack/observability@9.11.0
  - @objectstack/platform-objects@9.11.0
  - @objectstack/driver-memory@9.11.0
  - @objectstack/driver-mongodb@9.11.0
  - @objectstack/driver-sqlite-wasm@9.11.0
  - @objectstack/plugin-approvals@9.11.0
  - @objectstack/plugin-audit@9.11.0
  - @objectstack/plugin-auth@9.11.0
  - @objectstack/plugin-email@9.11.0
  - @objectstack/plugin-hono-server@9.11.0
  - @objectstack/plugin-org-scoping@9.11.0
  - @objectstack/plugin-reports@9.11.0
  - @objectstack/plugin-webhooks@9.11.0
  - @objectstack/service-ai@9.11.0
  - @objectstack/service-analytics@9.11.0
  - @objectstack/service-automation@9.11.0
  - @objectstack/service-cache@9.11.0
  - @objectstack/service-datasource@9.11.0
  - @objectstack/service-job@9.11.0
  - @objectstack/service-messaging@9.11.0
  - @objectstack/service-package@9.11.0
  - @objectstack/service-queue@9.11.0
  - @objectstack/service-realtime@9.11.0
  - @objectstack/service-settings@9.11.0
  - @objectstack/service-storage@9.11.0
  - @objectstack/trigger-api@9.11.0
  - @objectstack/trigger-record-change@9.11.0
  - @objectstack/trigger-schedule@9.11.0
  - @objectstack/types@9.11.0
  - @objectstack/console@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [d9508d1]
- Updated dependencies [1d352d3]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [f169558]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/service-analytics@9.10.0
  - @objectstack/driver-sql@9.10.0
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/plugin-org-scoping@9.10.0
  - @objectstack/plugin-security@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/rest@9.10.0
  - @objectstack/driver-sqlite-wasm@9.10.0
  - @objectstack/service-datasource@9.10.0
  - @objectstack/account@9.10.0
  - @objectstack/setup@9.10.0
  - @objectstack/studio@9.10.0
  - @objectstack/client@9.10.0
  - @objectstack/cloud-connection@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/mcp@9.10.0
  - @objectstack/observability@9.10.0
  - @objectstack/driver-memory@9.10.0
  - @objectstack/driver-mongodb@9.10.0
  - @objectstack/plugin-approvals@9.10.0
  - @objectstack/plugin-audit@9.10.0
  - @objectstack/plugin-auth@9.10.0
  - @objectstack/plugin-email@9.10.0
  - @objectstack/plugin-hono-server@9.10.0
  - @objectstack/plugin-reports@9.10.0
  - @objectstack/plugin-sharing@9.10.0
  - @objectstack/plugin-webhooks@9.10.0
  - @objectstack/service-ai@9.10.0
  - @objectstack/service-automation@9.10.0
  - @objectstack/service-cache@9.10.0
  - @objectstack/service-job@9.10.0
  - @objectstack/service-messaging@9.10.0
  - @objectstack/service-package@9.10.0
  - @objectstack/service-queue@9.10.0
  - @objectstack/service-realtime@9.10.0
  - @objectstack/service-settings@9.10.0
  - @objectstack/service-storage@9.10.0
  - @objectstack/trigger-api@9.10.0
  - @objectstack/trigger-record-change@9.10.0
  - @objectstack/trigger-schedule@9.10.0
  - @objectstack/types@9.10.0
  - @objectstack/console@9.10.0

## 9.9.1

### Patch Changes

- Updated dependencies [4f5c9c3]
  - @objectstack/console@9.9.1
  - @objectstack/spec@9.9.1
  - @objectstack/cloud-connection@9.9.1
  - @objectstack/core@9.9.1
  - @objectstack/client@9.9.1
  - @objectstack/types@9.9.1
  - @objectstack/objectql@9.9.1
  - @objectstack/observability@9.9.1
  - @objectstack/formula@9.9.1
  - @objectstack/platform-objects@9.9.1
  - @objectstack/studio@9.9.1
  - @objectstack/setup@9.9.1
  - @objectstack/runtime@9.9.1
  - @objectstack/rest@9.9.1
  - @objectstack/driver-memory@9.9.1
  - @objectstack/driver-sql@9.9.1
  - @objectstack/driver-mongodb@9.9.1
  - @objectstack/driver-sqlite-wasm@9.9.1
  - @objectstack/plugin-approvals@9.9.1
  - @objectstack/plugin-audit@9.9.1
  - @objectstack/plugin-auth@9.9.1
  - @objectstack/plugin-email@9.9.1
  - @objectstack/plugin-hono-server@9.9.1
  - @objectstack/mcp@9.9.1
  - @objectstack/plugin-org-scoping@9.9.1
  - @objectstack/plugin-reports@9.9.1
  - @objectstack/plugin-security@9.9.1
  - @objectstack/plugin-sharing@9.9.1
  - @objectstack/plugin-webhooks@9.9.1
  - @objectstack/trigger-record-change@9.9.1
  - @objectstack/trigger-api@9.9.1
  - @objectstack/trigger-schedule@9.9.1
  - @objectstack/service-ai@9.9.1
  - @objectstack/service-analytics@9.9.1
  - @objectstack/service-automation@9.9.1
  - @objectstack/service-cache@9.9.1
  - @objectstack/service-datasource@9.9.1
  - @objectstack/service-job@9.9.1
  - @objectstack/service-messaging@9.9.1
  - @objectstack/service-package@9.9.1
  - @objectstack/service-queue@9.9.1
  - @objectstack/service-realtime@9.9.1
  - @objectstack/service-settings@9.9.1
  - @objectstack/service-storage@9.9.1
  - @objectstack/account@9.9.1

## 9.9.0

### Minor Changes

- 97ecfdd: feat(cli): lint `metadata` doc embeds (ADR-0051 P1) — validate every `metadata` fence body shape (type ∈ state_machine | flow | permission with did-you-mean, required name, object required for state_machine) and its same-package reference liveness (the referenced object + state_machine rule / flow / permission set must exist in the stack). A dead same-package reference is a build error, matching `docs/broken-link`.
- c102de2: feat(cli): auto-wire marketplace from `@objectstack/cloud-connection` when a cloud URL resolves

  ADR-0006 Phase 4 removed the framework CLI's duplicate marketplace plugins (they lived in `@objectstack/runtime`, duplicating the cloud distribution's copies). ADR-0008 then open-sourced the canonical client into the Apache-2.0 `@objectstack/cloud-connection` package, so the CLI can wire it again without crossing the open-core boundary — there is no longer a cloud-only copy to duplicate.

  `objectstack serve`/`dev`/`start` now mount `MarketplaceProxyPlugin` + `MarketplaceInstallLocalPlugin` + the same-origin cloud-connection surface + `RuntimeConfigPlugin` (single-env, `installLocal: true`) whenever `resolveCloudUrl()` is truthy. `OS_CLOUD_URL=off` (or unset) mounts nothing, preserving the vanilla marketplace-less `objectstack dev`. Skipped in runtime/host-kernel mode (the cloud `objectos-stack` wires its own proxy on the host kernel — detected via `ObjectOSEnvironmentPlugin`, mirroring the existing AuthPlugin guard).

  Fixes `objectstack start` empty-boot, which advertised "boot an empty kernel against your marketplace" but — having no config or artifact to carry the wiring — actually mounted no marketplace at all. The plugins self-register their Setup nav bundles, so Browse Marketplace + Installed Apps reappear automatically.

- 90108e0: feat(cli): liveness author-warning lint — close the spec-liveness loop on the author side.

  The liveness ledgers already classify every authorable property live/experimental/dead with evidence, and the CI gate enforces classification _completeness_ — but that knowledge never reached the person (very often an AI) writing the metadata. The new `compile` lint (`lint-liveness-properties.ts`) reads the ledgers and emits an advisory **warning** when an authored object/field sets a property that is misleading at runtime — e.g. `object.enable.feeds` (no feed runtime; comments live on sys_comment), `object.versioning` (no versioning engine), `field.columnName` (driver ignores it; column == field key), `field.maxRating`/`vectorConfig` (renderer reads a different key) — each with a corrective hint toward the supported alternative. Never fails the build (advisory only), consistent with the existing flow anti-pattern lint.

  Signal-over-noise by design: warnings are **opt-in per ledger entry** via a new `authorWarn`/`authorHint` annotation (plus `experimental` entries warn by default). Booleans warn only when set truthy, and only `default(false)` flags are marked, so schema defaults (`enable.trash`, `enable.searchable`) never trip it. Coverage grows by annotating more ledger entries, not by changing lint code; today it covers `object` (incl. `enable.*`) and `field`.

  - `@objectstack/spec`: ledger entries gain optional `authorWarn`/`authorHint`; `liveness/` is now shipped in the package `files` so the CLI can read it. Seeded annotations on the misleading object capability flags + aspirational blocks and the misleading dead field props. No schema/runtime change.

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [0d4e3f3]
- Updated dependencies [8e5a3b5]
- Updated dependencies [44c5348]
- Updated dependencies [796f0d6]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [b112416]
- Updated dependencies [d42004b]
- Updated dependencies [92d75ca]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/service-settings@9.9.0
  - @objectstack/plugin-auth@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/rest@9.9.0
  - @objectstack/driver-sql@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/service-automation@9.9.0
  - @objectstack/service-analytics@9.9.0
  - @objectstack/console@9.9.0
  - @objectstack/plugin-reports@9.9.0
  - @objectstack/plugin-security@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/formula@9.9.0
  - @objectstack/plugin-email@9.9.0
  - @objectstack/account@9.9.0
  - @objectstack/setup@9.9.0
  - @objectstack/studio@9.9.0
  - @objectstack/client@9.9.0
  - @objectstack/cloud-connection@9.9.0
  - @objectstack/mcp@9.9.0
  - @objectstack/observability@9.9.0
  - @objectstack/platform-objects@9.9.0
  - @objectstack/driver-memory@9.9.0
  - @objectstack/driver-mongodb@9.9.0
  - @objectstack/driver-sqlite-wasm@9.9.0
  - @objectstack/plugin-approvals@9.9.0
  - @objectstack/plugin-audit@9.9.0
  - @objectstack/plugin-hono-server@9.9.0
  - @objectstack/plugin-org-scoping@9.9.0
  - @objectstack/plugin-sharing@9.9.0
  - @objectstack/plugin-webhooks@9.9.0
  - @objectstack/service-ai@9.9.0
  - @objectstack/service-cache@9.9.0
  - @objectstack/service-datasource@9.9.0
  - @objectstack/service-job@9.9.0
  - @objectstack/service-messaging@9.9.0
  - @objectstack/service-package@9.9.0
  - @objectstack/service-queue@9.9.0
  - @objectstack/service-realtime@9.9.0
  - @objectstack/service-storage@9.9.0
  - @objectstack/trigger-api@9.9.0
  - @objectstack/trigger-record-change@9.9.0
  - @objectstack/trigger-schedule@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Minor Changes

- 37f6bd8: feat(cli): two new flow authoring anti-pattern lints — date-equality filters (#1874) and phantom aggregation (#1870)

  Extends the build-time flow anti-pattern lint (advisory warnings, never fail the build):

  - **flow-date-equality-filter (#1874)**: a get_record/query filter that binds a
    field directly, or via `$eq`/`$in`, to a time-function value
    (`daysFromNow`/`today`/`now`/…). A `Field.date` stores a time component, so an
    exact match against a re-computed timestamp silently returns nothing. Range
    operators (`$gte`/`$lt` day windows) are the correct shape and are exempt.
  - **flow-phantom-aggregation (#1870)**: a node config key naming a capability the
    automation engine does not have (`aggregations`/`aggregate`/`groupBy`/`rollup`/
    `having`). There is no aggregate node, so the key is silently ignored and the
    node computes nothing. Points the author to `Field.summary` / `Field.formula`.

### Patch Changes

- fcd3471: fix(build): collect per-doc `order:` and `group:` frontmatter so book sorting/placement works

  The doc collector (`collectDocsFromSrc`) parsed only `title:`/`description:` from
  each `src/docs/*.md` frontmatter, so the `order` and `group` fields defined on the
  `Doc` schema (ADR-0046 §6) were never populated on the compiled `doc` item. The
  book resolver (`resolveBookTree`) already sorts group members by `doc.order` then
  label and honors explicit `doc.group` placement — but with the collection half
  silently dropping both fields, frontmatter-driven sorting/placement never reached
  the artifact.

  `parseFrontmatter` now also reads `order:` (parsed to a number; ignored when
  non-numeric) and `group:` (string), threading them onto the collected doc when
  present. Absent leaves both undefined so the schema/resolver defaults apply. Also
  corrects the `order` JSDoc in `doc.zod.ts` to match the resolver, which treats an
  absent `order` as `0` (not "after ordered siblings").

- Updated dependencies [c17d2c8]
- Updated dependencies [7fe0b91]
- Updated dependencies [76ac582]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
- Updated dependencies [884bf2f]
  - @objectstack/formula@9.8.0
  - @objectstack/rest@9.8.0
  - @objectstack/objectql@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/plugin-approvals@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/service-ai@9.8.0
  - @objectstack/service-automation@9.8.0
  - @objectstack/client@9.8.0
  - @objectstack/plugin-sharing@9.8.0
  - @objectstack/trigger-record-change@9.8.0
  - @objectstack/account@9.8.0
  - @objectstack/setup@9.8.0
  - @objectstack/studio@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/mcp@9.8.0
  - @objectstack/observability@9.8.0
  - @objectstack/platform-objects@9.8.0
  - @objectstack/driver-memory@9.8.0
  - @objectstack/driver-mongodb@9.8.0
  - @objectstack/driver-sql@9.8.0
  - @objectstack/driver-sqlite-wasm@9.8.0
  - @objectstack/plugin-audit@9.8.0
  - @objectstack/plugin-auth@9.8.0
  - @objectstack/plugin-email@9.8.0
  - @objectstack/plugin-hono-server@9.8.0
  - @objectstack/plugin-org-scoping@9.8.0
  - @objectstack/plugin-reports@9.8.0
  - @objectstack/plugin-security@9.8.0
  - @objectstack/plugin-webhooks@9.8.0
  - @objectstack/service-analytics@9.8.0
  - @objectstack/service-cache@9.8.0
  - @objectstack/service-datasource@9.8.0
  - @objectstack/service-job@9.8.0
  - @objectstack/service-messaging@9.8.0
  - @objectstack/service-package@9.8.0
  - @objectstack/service-queue@9.8.0
  - @objectstack/service-realtime@9.8.0
  - @objectstack/service-settings@9.8.0
  - @objectstack/service-storage@9.8.0
  - @objectstack/trigger-api@9.8.0
  - @objectstack/trigger-schedule@9.8.0
  - @objectstack/types@9.8.0
  - @objectstack/console@9.8.0

## 9.7.0

### Minor Changes

- ff0a87a: feat(validate): flag bare field references in record-scoped CEL sites at build time

  > **Heads-up for downstream:** this adds a NEW build-time error. A `Field.formula`
  > or validation predicate that references a field bare (`amount` instead of
  > `record.amount`) now fails `objectstack compile`. These expressions were already
  > silently broken at runtime (they evaluated to `null` / never fired), so this is a
  > fix that surfaces a latent bug — but a stack carrying one will go from
  > "builds, silently wrong" to "fails the build" on upgrade. The error message
  > states the exact correction (`write record.<field>`).

  A `Field.formula` and an object validation predicate evaluate against the
  `record` namespace only — there is no field flattening — so a bare top-level
  identifier (`amount`, `status`) resolves to nothing and the expression silently
  evaluates to `null` / never fires. This is the silent-at-runtime class behind
  the broken example-crm formulas (#1927) and is exactly what AI authors get wrong.

  `validateExpression` now takes an evaluation `scope` and, for `scope: 'record'`,
  reports a bare reference with the corrective form (`write record.<field>`). The
  check is schema-free and acts only on cel-js's `Unknown variable` fault, so it
  cannot false-positive on arithmetic/comparison/null-guard type overloads. Flow
  and automation conditions keep the default `scope: 'flattened'` — the record's
  fields ARE spread to top-level there (alongside flow variables), so bare refs
  are correct and are NOT flagged. `objectstack compile` wires `record` scope for
  field formulas and validation predicates; flow conditions stay flattened.

### Patch Changes

- 417b6ac: feat(validate): advisory did-you-mean warnings for likely field typos in flow conditions

  Adds a non-blocking warning channel to build-time expression validation (#1928
  tier 3). Flow / automation conditions flatten the record's fields to top-level,
  so a bare `status` is correct — but a bare NON-field identifier is either a flow
  variable or a typo. When it is a near-miss of a known field (edit distance), the
  build now emits a `did you mean \`status\`?`warning instead of staying silent,
WITHOUT failing the build (a genuine flow variable won't be close to a field
name, so it stays quiet).`ExprValidationResult`gains a`warnings`array and`ExprIssue`a`severity`; `objectstack compile` prints warnings and only fails on
  errors. This closes the silent-skip gap for misspelled trigger-condition fields
  (the #1877 family) without the false-positive risk of a hard gate.

- Updated dependencies [82c7438]
- Updated dependencies [417b6ac]
- Updated dependencies [ff0a87a]
  - @objectstack/formula@9.7.0
  - @objectstack/objectql@9.7.0
  - @objectstack/plugin-approvals@9.7.0
  - @objectstack/runtime@9.7.0
  - @objectstack/service-ai@9.7.0
  - @objectstack/service-automation@9.7.0
  - @objectstack/client@9.7.0
  - @objectstack/plugin-sharing@9.7.0
  - @objectstack/trigger-record-change@9.7.0
  - @objectstack/spec@9.7.0
  - @objectstack/console@9.7.0
  - @objectstack/core@9.7.0
  - @objectstack/types@9.7.0
  - @objectstack/observability@9.7.0
  - @objectstack/platform-objects@9.7.0
  - @objectstack/studio@9.7.0
  - @objectstack/setup@9.7.0
  - @objectstack/rest@9.7.0
  - @objectstack/driver-memory@9.7.0
  - @objectstack/driver-sql@9.7.0
  - @objectstack/driver-mongodb@9.7.0
  - @objectstack/driver-sqlite-wasm@9.7.0
  - @objectstack/plugin-audit@9.7.0
  - @objectstack/plugin-auth@9.7.0
  - @objectstack/plugin-email@9.7.0
  - @objectstack/plugin-hono-server@9.7.0
  - @objectstack/mcp@9.7.0
  - @objectstack/plugin-org-scoping@9.7.0
  - @objectstack/plugin-reports@9.7.0
  - @objectstack/plugin-security@9.7.0
  - @objectstack/plugin-webhooks@9.7.0
  - @objectstack/trigger-api@9.7.0
  - @objectstack/trigger-schedule@9.7.0
  - @objectstack/service-analytics@9.7.0
  - @objectstack/service-cache@9.7.0
  - @objectstack/service-datasource@9.7.0
  - @objectstack/service-feed@9.7.0
  - @objectstack/service-job@9.7.0
  - @objectstack/service-messaging@9.7.0
  - @objectstack/service-package@9.7.0
  - @objectstack/service-queue@9.7.0
  - @objectstack/service-realtime@9.7.0
  - @objectstack/service-settings@9.7.0
  - @objectstack/service-storage@9.7.0
  - @objectstack/account@9.7.0

## 9.6.0

### Patch Changes

- 8c7e7e4: fix(cli): keep non-self-contained hook/action handlers out of body-only lowering (#1876)

  A hook/action handler that references a **module-scope identifier** (a helper,
  an import, a top-level const) was lowered to a metadata-only `body` by
  `objectstack build` — but that body ships without the referenced definition, so
  it throws `ReferenceError` at runtime. Build was green; the app didn't boot —
  exactly the build↔runtime parity gap #1876 describes.

  `extractHookBody` now runs a conservative free-identifier analysis (via the
  `ts` AST already available through `ts-morph`): it computes the handler's free
  variables — names referenced but bound neither by the function (params/locals)
  nor by the JS runtime (a generous global allow-list). When any are found,
  extraction is refused, so `lowerCallables` falls back to **bundling** the real
  function (esbuild carries the closure along) — no `ReferenceError`, no build
  break. The analysis is biased to never over-report: a missed case preserves
  today's behavior, and a false positive only causes a self-contained handler to
  be bundled instead of inlined (a size cost, never a correctness or build
  failure).

  Note: the other #1876 repro — legacy `object`/`aggregate` dashboard widgets
  passing build but rejected by the runtime — is already closed on `main` by the
  ADR-0021 single-form cutover (`DashboardWidgetSchema` now requires
  `dataset`/`values`, enforced by the same schema build and runtime both use).

- 266c0f8: feat(cli): build lint warns on wrong flow-value interpolation syntax (double-brace / bare `$ref`) (#1315)

  Extends the flow authoring anti-pattern lint with two advisory WARNINGs for the
  interpolation-syntax mistakes AI/human authors carry over from other dialects:

  - **double-brace** `{{ai_reply}}` in a flow node value — flow node values use
    SINGLE braces (`{var}`); `{{ }}` is the formula/template-field dialect, never
    flow node values (verified: no flow node executor uses `{{ }}`).
  - **bare `$ref.field`** (e.g. `$source.id`) written as a plain value — it's not
    interpolated; the author meant `{source.id}` (or `{$User.Id}`).

  Precise: single-brace interpolation, braced `{$User.Id}`, currency literals
  (`$5.00`), and CEL condition fields are NOT flagged; never fails the build.

- dc8b2de: feat(automation): resolve & validate `script`-node callables; first-class function registration (#1870)

  A flow `script` node that pointed at an unregistered callable (or declared no
  `actionType`/`function` at all) built fine and silently did nothing at runtime.
  Two changes close that gap:

  - **Loud runtime resolution.** The built-in `script` executor now resolves its
    target in order — built-in side-effect (`email`/`slack`) → a registered
    function (`config.function`, or a bare `config.actionType` that matches no
    built-in) → otherwise **fail the step loudly**. The old `(no-op handler)`
    success path is gone, so an unwired callable can no longer quietly skip.
  - **First-class registration path.** `AutomationEngine.setFunctionResolver()` /
    `resolveFunction()` bridge flow nodes to the host function registry. The
    automation plugin wires it to ObjectQL's `resolveFunction` (populated from
    `bundle.functions` / `defineStack({ functions })`), so an authored package can
    register a function and call it from a `script` node:
    `{ type: 'script', config: { function: 'my_fn', inputs: { … } } }`.
  - **Build-time structural check.** `objectstack build` now flags a `script` node
    that declares neither `actionType` nor `function` (the `actionType: undefined`
    repro). Function _existence_ is verified at runtime — functions are code, not
    serialized into the artifact.

- c226e93: feat(cli): build-time lint warns on the record-change date-equality time anti-pattern (#1874)

  `objectstack build` now emits an advisory WARNING when a record-change flow's
  start condition compares a date field for EQUALITY against a time function
  (`end_date == daysFromNow(60)`, `today() != …`). That construct is valid CEL but
  a runtime footgun — it only fires if the record happens to be written on that
  exact day, so unattended "N days before" rules never run. The warning points the
  author to the robust pattern (a daily SCHEDULE trigger + a range query).

  Range comparisons (`>=`/`<=`) and non-time-field equality are NOT flagged, and it
  never fails the build — it guides authors (very often an AI generating templates)
  toward the correct shape without breaking technically-legal metadata.

- b9d0526: fix(cli): drop stale `ownership` key from the `os init` scaffold object template

  The `app` and `plugin` scaffold templates emitted `ownership: 'own'` on the starter object. `ownership` is no longer a valid `ObjectSchema` field (it's not in `ObjectSchemaBase`, and `ObjectSchema.create()` rejects unknown top-level keys per ADR-0032 / #1535), so a user migrating the scaffolded object into `ObjectSchema.create({...})` would hit a validation error. Removed the key from both templates; the rest of the scaffold output is unchanged.

- ab942f2: feat(automation): accept `functionName` alias + `invoke_function` marker on script nodes (#1870 DX)

  AI-authored templates commonly emit `config: { actionType: 'invoke_function', functionName: 'my_fn' }`,
  but the runtime only read `config.function`. Now:

  - `config.functionName` is accepted as an alias for `config.function` (runtime + build).
  - `actionType: 'invoke_function'` is treated as a MARKER ("call the named function") — the
    name comes from `function`/`functionName`, not from actionType itself; it no longer
    tries to resolve a function literally named `invoke_function`.
  - `objectstack build` errors on `actionType: 'invoke_function'` with no `function`/`functionName`
    (it names no callable) instead of letting it fail at runtime.

- Updated dependencies [d1e930a]
- Updated dependencies [1b82b64]
- Updated dependencies [71578f2]
- Updated dependencies [6c82aa0]
- Updated dependencies [dc8b2de]
- Updated dependencies [bb00a50]
- Updated dependencies [5e3a301]
- Updated dependencies [b0df09c]
- Updated dependencies [5db2742]
- Updated dependencies [ab942f2]
- Updated dependencies [1402be0]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/plugin-auth@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/rest@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/service-automation@9.6.0
  - @objectstack/formula@9.6.0
  - @objectstack/trigger-record-change@9.6.0
  - @objectstack/account@9.6.0
  - @objectstack/setup@9.6.0
  - @objectstack/studio@9.6.0
  - @objectstack/client@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/mcp@9.6.0
  - @objectstack/observability@9.6.0
  - @objectstack/platform-objects@9.6.0
  - @objectstack/driver-memory@9.6.0
  - @objectstack/driver-mongodb@9.6.0
  - @objectstack/driver-sql@9.6.0
  - @objectstack/driver-sqlite-wasm@9.6.0
  - @objectstack/plugin-approvals@9.6.0
  - @objectstack/plugin-audit@9.6.0
  - @objectstack/plugin-email@9.6.0
  - @objectstack/plugin-hono-server@9.6.0
  - @objectstack/plugin-org-scoping@9.6.0
  - @objectstack/plugin-reports@9.6.0
  - @objectstack/plugin-security@9.6.0
  - @objectstack/plugin-sharing@9.6.0
  - @objectstack/plugin-webhooks@9.6.0
  - @objectstack/service-ai@9.6.0
  - @objectstack/service-analytics@9.6.0
  - @objectstack/service-cache@9.6.0
  - @objectstack/service-datasource@9.6.0
  - @objectstack/service-feed@9.6.0
  - @objectstack/service-job@9.6.0
  - @objectstack/service-messaging@9.6.0
  - @objectstack/service-package@9.6.0
  - @objectstack/service-queue@9.6.0
  - @objectstack/service-realtime@9.6.0
  - @objectstack/service-settings@9.6.0
  - @objectstack/service-storage@9.6.0
  - @objectstack/trigger-api@9.6.0
  - @objectstack/trigger-schedule@9.6.0
  - @objectstack/types@9.6.0
  - @objectstack/console@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/account@9.5.1
  - @objectstack/setup@9.5.1
  - @objectstack/studio@9.5.1
  - @objectstack/client@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/formula@9.5.1
  - @objectstack/mcp@9.5.1
  - @objectstack/objectql@9.5.1
  - @objectstack/observability@9.5.1
  - @objectstack/platform-objects@9.5.1
  - @objectstack/driver-memory@9.5.1
  - @objectstack/driver-mongodb@9.5.1
  - @objectstack/driver-sql@9.5.1
  - @objectstack/driver-sqlite-wasm@9.5.1
  - @objectstack/plugin-approvals@9.5.1
  - @objectstack/plugin-audit@9.5.1
  - @objectstack/plugin-auth@9.5.1
  - @objectstack/plugin-email@9.5.1
  - @objectstack/plugin-hono-server@9.5.1
  - @objectstack/plugin-org-scoping@9.5.1
  - @objectstack/plugin-reports@9.5.1
  - @objectstack/plugin-security@9.5.1
  - @objectstack/plugin-sharing@9.5.1
  - @objectstack/plugin-webhooks@9.5.1
  - @objectstack/rest@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/service-ai@9.5.1
  - @objectstack/service-analytics@9.5.1
  - @objectstack/service-automation@9.5.1
  - @objectstack/service-cache@9.5.1
  - @objectstack/service-datasource@9.5.1
  - @objectstack/service-feed@9.5.1
  - @objectstack/service-job@9.5.1
  - @objectstack/service-messaging@9.5.1
  - @objectstack/service-package@9.5.1
  - @objectstack/service-queue@9.5.1
  - @objectstack/service-realtime@9.5.1
  - @objectstack/service-settings@9.5.1
  - @objectstack/service-storage@9.5.1
  - @objectstack/trigger-api@9.5.1
  - @objectstack/trigger-record-change@9.5.1
  - @objectstack/trigger-schedule@9.5.1
  - @objectstack/types@9.5.1
  - @objectstack/console@9.5.1

## 9.5.0

### Minor Changes

- d08551c: feat(ADR-0046): per-locale documentation content (doc i18n)

  Docs can now ship localized bodies. Authors add sibling locale-variant files
  `src/docs/<name>.<locale>.md` (e.g. `crm_lead_guide.zh.md`, `..pt-BR.md`) next
  to the base `<name>.md`; the base stays the default and the fallback. Flatness is
  preserved — variants are flat siblings, not subdirectories.

  - **spec**: `DocSchema` gains an optional `translations` map
    (`locale → {label?, description?, content}`) plus `resolveDocLocale(doc, locale)`,
    which collapses a doc to the best-matching locale (exact → primary subtag
    `zh-CN`→`zh` → base) with per-field fallback and strips the `translations` map.
  - **cli (collect-docs)**: variant files are folded into the base doc's
    `translations`; orphan/duplicate variants and the v1 MDX/image bans are linted
    on variant content too.
  - **rest**: `/meta/doc` (list + single) resolves the request locale from the
    existing `Accept-Language` / `?locale` negotiation, returns one localized body,
    and never ships the `translations` map. Doc detail bypasses the response cache
    so a language switch can't return a stale-locale body.
  - **setup / studio**: the built-in overview docs now ship `zh` translations
    (TS-first inline `translations`), so a Chinese console renders Chinese docs.

  The console already sends the active UI language as `Accept-Language`, so doc
  content localizes on a language switch with no client change.

### Patch Changes

- f19caef: fix(ADR-0048): rescope the `os lint` `naming/namespace-prefix` rule to intra-package duplicates

  ADR-0048 §3.4 retired the per-item cross-package collision throw — two
  installed packages may legitimately ship the same bare name (e.g. `page/home`),
  stored under distinct composite keys and disambiguated by package-scoped
  resolution. The `naming/namespace-prefix` lint rule was never updated to match,
  so it still:

  - **fired on every bare-named UI/automation item** (apps/pages/dashboards/flows/
    actions/reports/datasets) regardless of whether a duplicate existed — a normal
    single-package app got dozens of false positives (hotcrm: 63), and
  - **claimed the package would "collide on the registry key and fail at install"**,
    which is no longer true.

  The rule now warns **only on a genuine intra-package duplicate `(type, name)`
  pair** within the linted config — the narrow authoring-time hygiene case ADR-0048
  §3.4 explicitly leaves to `os lint` ("an author shipping two `page/home` in one
  package"). A unique bare name produces zero warnings. The message no longer
  claims an install failure; it explains the items shadow each other on the
  registry key and that distinct packages may reuse the same name freely (the
  namespace prefix is an optional convention). Runtime/registry behavior is
  unchanged.

- Updated dependencies [d08551c]
- Updated dependencies [f19caef]
- Updated dependencies [f19caef]
- Updated dependencies [f19caef]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
- Updated dependencies [1a4f079]
- Updated dependencies [110a333]
  - @objectstack/spec@9.5.0
  - @objectstack/rest@9.5.0
  - @objectstack/setup@9.5.0
  - @objectstack/studio@9.5.0
  - @objectstack/service-feed@9.5.0
  - @objectstack/service-realtime@9.5.0
  - @objectstack/service-job@9.5.0
  - @objectstack/service-messaging@9.5.0
  - @objectstack/service-automation@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/account@9.5.0
  - @objectstack/client@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/formula@9.5.0
  - @objectstack/mcp@9.5.0
  - @objectstack/objectql@9.5.0
  - @objectstack/observability@9.5.0
  - @objectstack/driver-memory@9.5.0
  - @objectstack/driver-mongodb@9.5.0
  - @objectstack/driver-sql@9.5.0
  - @objectstack/driver-sqlite-wasm@9.5.0
  - @objectstack/plugin-approvals@9.5.0
  - @objectstack/plugin-audit@9.5.0
  - @objectstack/plugin-auth@9.5.0
  - @objectstack/plugin-email@9.5.0
  - @objectstack/plugin-hono-server@9.5.0
  - @objectstack/plugin-org-scoping@9.5.0
  - @objectstack/plugin-reports@9.5.0
  - @objectstack/plugin-security@9.5.0
  - @objectstack/plugin-sharing@9.5.0
  - @objectstack/plugin-webhooks@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/service-ai@9.5.0
  - @objectstack/service-analytics@9.5.0
  - @objectstack/service-cache@9.5.0
  - @objectstack/service-datasource@9.5.0
  - @objectstack/service-package@9.5.0
  - @objectstack/service-queue@9.5.0
  - @objectstack/service-settings@9.5.0
  - @objectstack/service-storage@9.5.0
  - @objectstack/trigger-api@9.5.0
  - @objectstack/trigger-record-change@9.5.0
  - @objectstack/trigger-schedule@9.5.0
  - @objectstack/types@9.5.0
  - @objectstack/console@9.5.0

## 9.4.0

### Minor Changes

- 060467a: feat(ADR-0046): add optional `description` to package docs

  A doc can now carry a one-line `description` (frontmatter `description:`),
  giving the natural minimal model: title / summary / body. `DocSchema` gains an
  optional `description`; `os build` reads it from frontmatter. It travels in the
  `GET /meta/doc` list response (unlike `content`, which the list omits), so a
  docs portal can show summaries without fetching each body. Example docs
  (app-showcase, app-todo) updated.

  Also records the deferred-to-P3 design for doc **tags** in ADR-0046: tags are
  keys (i18n-resolved, never display strings), with a small protocol core
  vocabulary plus namespace-prefixed package tags — not a field to bolt on early.

- 2511a98: ADR-0048 follow-up: `os lint` now emits a `naming/namespace-prefix` **warning** when a bare-named UI/automation item is not namespace-prefixed. This shifts the cross-package collision detection (ADR-0048, runtime `MetadataCollisionError`) left to authoring time — a soft nudge to prefix `app`/`page`/`dashboard`/`flow`/`action`/`report`/`dataset` names with the package namespace, so a clash with another package is unlikely to ever reach install.

  Warning-only and never fatal (only errors fail the lint). An app named after the namespace (ADR-0019 single-app convention, e.g. `crm`) and `sys_`-reserved names are exempt; objects (already prefix-enforced as an error) and object-derived views are untouched.

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
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/rest@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/account@9.4.0
  - @objectstack/setup@9.4.0
  - @objectstack/studio@9.4.0
  - @objectstack/driver-sql@9.4.0
  - @objectstack/service-ai@9.4.0
  - @objectstack/client@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0
  - @objectstack/mcp@9.4.0
  - @objectstack/observability@9.4.0
  - @objectstack/platform-objects@9.4.0
  - @objectstack/driver-memory@9.4.0
  - @objectstack/driver-mongodb@9.4.0
  - @objectstack/driver-sqlite-wasm@9.4.0
  - @objectstack/plugin-approvals@9.4.0
  - @objectstack/plugin-audit@9.4.0
  - @objectstack/plugin-auth@9.4.0
  - @objectstack/plugin-email@9.4.0
  - @objectstack/plugin-hono-server@9.4.0
  - @objectstack/plugin-org-scoping@9.4.0
  - @objectstack/plugin-reports@9.4.0
  - @objectstack/plugin-security@9.4.0
  - @objectstack/plugin-sharing@9.4.0
  - @objectstack/plugin-webhooks@9.4.0
  - @objectstack/service-analytics@9.4.0
  - @objectstack/service-automation@9.4.0
  - @objectstack/service-cache@9.4.0
  - @objectstack/service-datasource@9.4.0
  - @objectstack/service-feed@9.4.0
  - @objectstack/service-job@9.4.0
  - @objectstack/service-messaging@9.4.0
  - @objectstack/service-package@9.4.0
  - @objectstack/service-queue@9.4.0
  - @objectstack/service-realtime@9.4.0
  - @objectstack/service-settings@9.4.0
  - @objectstack/service-storage@9.4.0
  - @objectstack/trigger-api@9.4.0
  - @objectstack/trigger-record-change@9.4.0
  - @objectstack/trigger-schedule@9.4.0
  - @objectstack/types@9.4.0
  - @objectstack/console@9.4.0

## 9.3.0

### Minor Changes

- 1ada658: ADR-0046 P1: package documentation as metadata. New `doc` metadata element — flat Markdown files under `src/docs/*.md` compile into `docs: DocSchema[]` on the stack and register like any other metadata.

  - spec: `DocSchema` ({ name, label?, content }) in `system/`, `StackDefinition.docs`, `doc` in `MetadataTypeSchema` + type registry (inert data, runtime-creatable) + canonical schema map, `docs → doc` plural mapping.
  - cli: `os build` collects flat `src/docs/*.md` (frontmatter `title:`/first `#` heading → label) and enforces the ADR lint — flat directory, namespace-prefixed snake_case names, namespace required when docs ship, MDX/image ban, same-package relative-link resolution. Same rules surface in `os lint`.
  - objectql: `docs` joins the generic metadata registration loop (manifest + nested plugins).
  - runtime: docs count as app payload; `GET /metadata/doc` list responses omit `content` by default (`?include=content` opts in) so unbounded manuals stay off hot paths.

- 59c2d32: New `os package install <id|artifact.json>` command — install a package into a RUNNING runtime via its install-local endpoint. Catalog mode resolves from the runtime's configured catalog; passing a compiled artifact file installs inline (air-gapped, no catalog round-trip). Authenticates against the target runtime with --email/--password (better-auth session; Origin header included for the CSRF check).

### Patch Changes

- f15d6f6: ADR-0042 SLA auto-escalation + ADR-0041 mechanical landing. plugin-approvals now owns a jobs-backed escalation scanner (`runEscalations`, interval job `approvals-sla-escalation` + boot catch-up): overdue pending requests escalate **at most once** (the `escalate` audit row is the idempotency marker, written audit-first) executing the node's `escalation.action` — notify / reassign-to-`escalateTo` / auto_approve / auto_reject as the reserved actor `system:sla`. The trigger packages drop their `plugin-` prefix (`@objectstack/trigger-record-change`, `@objectstack/trigger-schedule`) per ADR-0041, and `ActionDescriptor` gains an optional `maturity: 'ga' | 'beta' | 'reserved'` field so designers can grey out contract-ahead-of-runtime surfaces.
- ad4e97f: ADR-0041 Tier 1 complete: `@objectstack/trigger-api` — inbound webhook/HTTP flow trigger. The engine now derives an `api` trigger binding for `type: 'api'` flows (activating the long-reserved enum value); the trigger mounts `POST /api/v1/automation/hooks/:flowName/:hookId` with GitHub/Stripe-style HMAC verification (`x-objectstack-signature`, constant-time compare, identical 404s for unknown flows and wrong hookIds) and queue-backed ingestion — the handler enqueues and ACKs 202, a queue consumer executes the flow with the JSON payload as the trigger record (`$record` / `record.*` / bare references), and `x-idempotency-key` passes through to the queue's dedup window. The CLI's serve preset auto-loads the trigger alongside record-change and schedule.
- Updated dependencies [1ada658]
- Updated dependencies [b08d08d]
- Updated dependencies [6259882]
- Updated dependencies [d100707]
- Updated dependencies [3219191]
- Updated dependencies [f3c1735]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
- Updated dependencies [ad4e97f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/rest@9.3.0
  - @objectstack/service-ai@9.3.0
  - @objectstack/service-settings@9.3.0
  - @objectstack/plugin-approvals@9.3.0
  - @objectstack/service-automation@9.3.0
  - @objectstack/trigger-record-change@9.3.0
  - @objectstack/trigger-schedule@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/service-analytics@9.3.0
  - @objectstack/trigger-api@9.3.0
  - @objectstack/account@9.3.0
  - @objectstack/client@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/formula@9.3.0
  - @objectstack/mcp@9.3.0
  - @objectstack/observability@9.3.0
  - @objectstack/driver-memory@9.3.0
  - @objectstack/driver-mongodb@9.3.0
  - @objectstack/driver-sql@9.3.0
  - @objectstack/driver-sqlite-wasm@9.3.0
  - @objectstack/plugin-audit@9.3.0
  - @objectstack/plugin-auth@9.3.0
  - @objectstack/plugin-email@9.3.0
  - @objectstack/plugin-hono-server@9.3.0
  - @objectstack/plugin-org-scoping@9.3.0
  - @objectstack/plugin-reports@9.3.0
  - @objectstack/plugin-security@9.3.0
  - @objectstack/plugin-sharing@9.3.0
  - @objectstack/plugin-webhooks@9.3.0
  - @objectstack/service-cache@9.3.0
  - @objectstack/service-datasource@9.3.0
  - @objectstack/service-feed@9.3.0
  - @objectstack/service-job@9.3.0
  - @objectstack/service-messaging@9.3.0
  - @objectstack/service-package@9.3.0
  - @objectstack/service-queue@9.3.0
  - @objectstack/service-realtime@9.3.0
  - @objectstack/service-storage@9.3.0
  - @objectstack/types@9.3.0
  - @objectstack/console@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/account@9.2.0
  - @objectstack/client@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0
  - @objectstack/mcp@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/observability@9.2.0
  - @objectstack/platform-objects@9.2.0
  - @objectstack/driver-memory@9.2.0
  - @objectstack/driver-mongodb@9.2.0
  - @objectstack/driver-sql@9.2.0
  - @objectstack/driver-sqlite-wasm@9.2.0
  - @objectstack/plugin-approvals@9.2.0
  - @objectstack/plugin-audit@9.2.0
  - @objectstack/plugin-auth@9.2.0
  - @objectstack/plugin-email@9.2.0
  - @objectstack/plugin-hono-server@9.2.0
  - @objectstack/plugin-org-scoping@9.2.0
  - @objectstack/plugin-reports@9.2.0
  - @objectstack/plugin-security@9.2.0
  - @objectstack/plugin-sharing@9.2.0
  - @objectstack/plugin-trigger-record-change@9.2.0
  - @objectstack/plugin-trigger-schedule@9.2.0
  - @objectstack/plugin-webhooks@9.2.0
  - @objectstack/rest@9.2.0
  - @objectstack/runtime@9.2.0
  - @objectstack/service-ai@9.2.0
  - @objectstack/service-analytics@9.2.0
  - @objectstack/service-automation@9.2.0
  - @objectstack/service-cache@9.2.0
  - @objectstack/service-datasource@9.2.0
  - @objectstack/service-feed@9.2.0
  - @objectstack/service-job@9.2.0
  - @objectstack/service-messaging@9.2.0
  - @objectstack/service-package@9.2.0
  - @objectstack/service-queue@9.2.0
  - @objectstack/service-realtime@9.2.0
  - @objectstack/service-settings@9.2.0
  - @objectstack/service-storage@9.2.0
  - @objectstack/types@9.2.0
  - @objectstack/console@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/account@9.1.0
  - @objectstack/client@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0
  - @objectstack/mcp@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/observability@9.1.0
  - @objectstack/platform-objects@9.1.0
  - @objectstack/driver-memory@9.1.0
  - @objectstack/driver-mongodb@9.1.0
  - @objectstack/driver-sql@9.1.0
  - @objectstack/driver-sqlite-wasm@9.1.0
  - @objectstack/plugin-approvals@9.1.0
  - @objectstack/plugin-audit@9.1.0
  - @objectstack/plugin-auth@9.1.0
  - @objectstack/plugin-email@9.1.0
  - @objectstack/plugin-hono-server@9.1.0
  - @objectstack/plugin-org-scoping@9.1.0
  - @objectstack/plugin-reports@9.1.0
  - @objectstack/plugin-security@9.1.0
  - @objectstack/plugin-sharing@9.1.0
  - @objectstack/plugin-trigger-record-change@9.1.0
  - @objectstack/plugin-trigger-schedule@9.1.0
  - @objectstack/plugin-webhooks@9.1.0
  - @objectstack/rest@9.1.0
  - @objectstack/runtime@9.1.0
  - @objectstack/service-ai@9.1.0
  - @objectstack/service-analytics@9.1.0
  - @objectstack/service-automation@9.1.0
  - @objectstack/service-cache@9.1.0
  - @objectstack/service-datasource@9.1.0
  - @objectstack/service-feed@9.1.0
  - @objectstack/service-job@9.1.0
  - @objectstack/service-messaging@9.1.0
  - @objectstack/service-package@9.1.0
  - @objectstack/service-queue@9.1.0
  - @objectstack/service-realtime@9.1.0
  - @objectstack/service-settings@9.1.0
  - @objectstack/service-storage@9.1.0
  - @objectstack/types@9.1.0
  - @objectstack/console@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/account@9.0.1
  - @objectstack/client@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1
  - @objectstack/mcp@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/observability@9.0.1
  - @objectstack/platform-objects@9.0.1
  - @objectstack/driver-memory@9.0.1
  - @objectstack/driver-mongodb@9.0.1
  - @objectstack/driver-sql@9.0.1
  - @objectstack/driver-sqlite-wasm@9.0.1
  - @objectstack/plugin-approvals@9.0.1
  - @objectstack/plugin-audit@9.0.1
  - @objectstack/plugin-auth@9.0.1
  - @objectstack/plugin-email@9.0.1
  - @objectstack/plugin-hono-server@9.0.1
  - @objectstack/plugin-org-scoping@9.0.1
  - @objectstack/plugin-reports@9.0.1
  - @objectstack/plugin-security@9.0.1
  - @objectstack/plugin-sharing@9.0.1
  - @objectstack/plugin-trigger-record-change@9.0.1
  - @objectstack/plugin-trigger-schedule@9.0.1
  - @objectstack/plugin-webhooks@9.0.1
  - @objectstack/rest@9.0.1
  - @objectstack/runtime@9.0.1
  - @objectstack/service-ai@9.0.1
  - @objectstack/service-analytics@9.0.1
  - @objectstack/service-automation@9.0.1
  - @objectstack/service-cache@9.0.1
  - @objectstack/service-datasource@9.0.1
  - @objectstack/service-feed@9.0.1
  - @objectstack/service-job@9.0.1
  - @objectstack/service-messaging@9.0.1
  - @objectstack/service-package@9.0.1
  - @objectstack/service-queue@9.0.1
  - @objectstack/service-realtime@9.0.1
  - @objectstack/service-settings@9.0.1
  - @objectstack/service-storage@9.0.1
  - @objectstack/types@9.0.1
  - @objectstack/console@9.0.1

## 9.0.0

### Patch Changes

- c66f770: Bundle the `@ai-sdk/openai`, `@ai-sdk/anthropic`, and `@ai-sdk/google` provider
  SDKs as direct CLI dependencies. These were previously only declared as optional
  peer dependencies on `@objectstack/service-ai`, so a globally-installed CLI could
  not resolve them at runtime. Configuring an OpenAI-compatible provider (DeepSeek,
  DashScope, SiliconFlow, OpenRouter, Cloudflare) — all of which normalise to
  `provider=openai` and dynamically import `@ai-sdk/openai` — failed with
  "Could not build adapter for provider=…". The CLI now ships these providers so
  they work out of the box.
- Updated dependencies [4c3f693]
- Updated dependencies [4a0736b]
- Updated dependencies [2c6864f]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/service-analytics@9.0.0
  - @objectstack/service-settings@9.0.0
  - @objectstack/plugin-auth@9.0.0
  - @objectstack/service-ai@9.0.0
  - @objectstack/account@9.0.0
  - @objectstack/client@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0
  - @objectstack/mcp@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/observability@9.0.0
  - @objectstack/platform-objects@9.0.0
  - @objectstack/driver-memory@9.0.0
  - @objectstack/driver-mongodb@9.0.0
  - @objectstack/driver-sql@9.0.0
  - @objectstack/driver-sqlite-wasm@9.0.0
  - @objectstack/plugin-approvals@9.0.0
  - @objectstack/plugin-audit@9.0.0
  - @objectstack/plugin-email@9.0.0
  - @objectstack/plugin-hono-server@9.0.0
  - @objectstack/plugin-org-scoping@9.0.0
  - @objectstack/plugin-reports@9.0.0
  - @objectstack/plugin-security@9.0.0
  - @objectstack/plugin-sharing@9.0.0
  - @objectstack/plugin-trigger-record-change@9.0.0
  - @objectstack/plugin-trigger-schedule@9.0.0
  - @objectstack/plugin-webhooks@9.0.0
  - @objectstack/rest@9.0.0
  - @objectstack/runtime@9.0.0
  - @objectstack/service-automation@9.0.0
  - @objectstack/service-cache@9.0.0
  - @objectstack/service-datasource@9.0.0
  - @objectstack/service-feed@9.0.0
  - @objectstack/service-job@9.0.0
  - @objectstack/service-messaging@9.0.0
  - @objectstack/service-package@9.0.0
  - @objectstack/service-queue@9.0.0
  - @objectstack/service-realtime@9.0.0
  - @objectstack/service-storage@9.0.0
  - @objectstack/types@9.0.0
  - @objectstack/console@9.0.0

## 8.0.1

### Patch Changes

- Updated dependencies [d8c5374]
  - @objectstack/mcp@8.0.1
  - @objectstack/spec@8.0.1
  - @objectstack/console@8.0.1
  - @objectstack/core@8.0.1
  - @objectstack/client@8.0.1
  - @objectstack/types@8.0.1
  - @objectstack/objectql@8.0.1
  - @objectstack/observability@8.0.1
  - @objectstack/formula@8.0.1
  - @objectstack/platform-objects@8.0.1
  - @objectstack/runtime@8.0.1
  - @objectstack/rest@8.0.1
  - @objectstack/driver-memory@8.0.1
  - @objectstack/driver-sql@8.0.1
  - @objectstack/driver-mongodb@8.0.1
  - @objectstack/driver-sqlite-wasm@8.0.1
  - @objectstack/plugin-approvals@8.0.1
  - @objectstack/plugin-audit@8.0.1
  - @objectstack/plugin-auth@8.0.1
  - @objectstack/plugin-email@8.0.1
  - @objectstack/plugin-hono-server@8.0.1
  - @objectstack/plugin-org-scoping@8.0.1
  - @objectstack/plugin-reports@8.0.1
  - @objectstack/plugin-security@8.0.1
  - @objectstack/plugin-sharing@8.0.1
  - @objectstack/plugin-webhooks@8.0.1
  - @objectstack/plugin-trigger-record-change@8.0.1
  - @objectstack/plugin-trigger-schedule@8.0.1
  - @objectstack/service-ai@8.0.1
  - @objectstack/service-analytics@8.0.1
  - @objectstack/service-automation@8.0.1
  - @objectstack/service-cache@8.0.1
  - @objectstack/service-datasource@8.0.1
  - @objectstack/service-feed@8.0.1
  - @objectstack/service-job@8.0.1
  - @objectstack/service-messaging@8.0.1
  - @objectstack/service-package@8.0.1
  - @objectstack/service-queue@8.0.1
  - @objectstack/service-realtime@8.0.1
  - @objectstack/service-settings@8.0.1
  - @objectstack/service-storage@8.0.1
  - @objectstack/account@8.0.1

## 8.0.0

### Patch Changes

- d9f72fe: refactor(mcp)!: rename `@objectstack/plugin-mcp-server` → `@objectstack/mcp` (ADR-0036)

  The outbound MCP-server package drops the legacy `plugin-` prefix and moves to
  the top level (`packages/mcp`), parallel to `@objectstack/rest` — both are "your
  app exposed over a protocol". Inbound MCP (consuming external servers) stays
  `@objectstack/connector-mcp`.

  **Breaking:** the package name changed. Update imports
  `@objectstack/plugin-mcp-server` → `@objectstack/mcp`. The exported API
  (`MCPServerPlugin`, `MCPServerRuntime`, `registerObjectTools`, `McpDataBridge`,
  …) is unchanged. The internal plugin id is now `com.objectstack.mcp`. Pre-launch
  clean break — no compatibility shim (only `@objectstack/cli` depended on it
  internally).

- Updated dependencies [a46c017]
- Updated dependencies [f68be58]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [93f97b2]
- Updated dependencies [87cb13c]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [9f311f8]
- Updated dependencies [c70eec1]
- Updated dependencies [e6374b5]
- Updated dependencies [1e8b680]
- Updated dependencies [0a6438e]
- Updated dependencies [3306d2f]
- Updated dependencies [d9f72fe]
- Updated dependencies [ae7fb3f]
- Updated dependencies [c262301]
- Updated dependencies [e1478fe]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/service-ai@8.0.0
  - @objectstack/runtime@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/driver-sql@8.0.0
  - @objectstack/plugin-hono-server@8.0.0
  - @objectstack/mcp@8.0.0
  - @objectstack/service-messaging@8.0.0
  - @objectstack/plugin-auth@8.0.0
  - @objectstack/plugin-security@8.0.0
  - @objectstack/driver-mongodb@8.0.0
  - @objectstack/rest@8.0.0
  - @objectstack/service-automation@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/account@8.0.0
  - @objectstack/client@8.0.0
  - @objectstack/formula@8.0.0
  - @objectstack/observability@8.0.0
  - @objectstack/platform-objects@8.0.0
  - @objectstack/driver-memory@8.0.0
  - @objectstack/driver-sqlite-wasm@8.0.0
  - @objectstack/plugin-approvals@8.0.0
  - @objectstack/plugin-audit@8.0.0
  - @objectstack/plugin-email@8.0.0
  - @objectstack/plugin-org-scoping@8.0.0
  - @objectstack/plugin-reports@8.0.0
  - @objectstack/plugin-sharing@8.0.0
  - @objectstack/plugin-trigger-record-change@8.0.0
  - @objectstack/plugin-trigger-schedule@8.0.0
  - @objectstack/plugin-webhooks@8.0.0
  - @objectstack/service-analytics@8.0.0
  - @objectstack/service-cache@8.0.0
  - @objectstack/service-datasource@8.0.0
  - @objectstack/service-feed@8.0.0
  - @objectstack/service-job@8.0.0
  - @objectstack/service-package@8.0.0
  - @objectstack/service-queue@8.0.0
  - @objectstack/service-realtime@8.0.0
  - @objectstack/service-settings@8.0.0
  - @objectstack/service-storage@8.0.0
  - @objectstack/types@8.0.0
  - @objectstack/console@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [4705fb8]
  - @objectstack/service-ai@7.9.0
  - @objectstack/objectql@7.9.0
  - @objectstack/rest@7.9.0
  - @objectstack/runtime@7.9.0
  - @objectstack/client@7.9.0
  - @objectstack/plugin-sharing@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/console@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/types@7.9.0
  - @objectstack/observability@7.9.0
  - @objectstack/formula@7.9.0
  - @objectstack/platform-objects@7.9.0
  - @objectstack/driver-memory@7.9.0
  - @objectstack/driver-sql@7.9.0
  - @objectstack/driver-mongodb@7.9.0
  - @objectstack/driver-sqlite-wasm@7.9.0
  - @objectstack/plugin-approvals@7.9.0
  - @objectstack/plugin-audit@7.9.0
  - @objectstack/plugin-auth@7.9.0
  - @objectstack/plugin-email@7.9.0
  - @objectstack/plugin-hono-server@7.9.0
  - @objectstack/plugin-mcp-server@7.9.0
  - @objectstack/plugin-org-scoping@7.9.0
  - @objectstack/plugin-reports@7.9.0
  - @objectstack/plugin-security@7.9.0
  - @objectstack/plugin-webhooks@7.9.0
  - @objectstack/plugin-trigger-record-change@7.9.0
  - @objectstack/plugin-trigger-schedule@7.9.0
  - @objectstack/service-analytics@7.9.0
  - @objectstack/service-automation@7.9.0
  - @objectstack/service-cache@7.9.0
  - @objectstack/service-datasource@7.9.0
  - @objectstack/service-feed@7.9.0
  - @objectstack/service-job@7.9.0
  - @objectstack/service-messaging@7.9.0
  - @objectstack/service-package@7.9.0
  - @objectstack/service-queue@7.9.0
  - @objectstack/service-realtime@7.9.0
  - @objectstack/service-settings@7.9.0
  - @objectstack/service-storage@7.9.0
  - @objectstack/account@7.9.0

## 7.8.0

### Minor Changes

- 6b60068: fix(cli): `objectstack dev` persists data by default (no more `:memory:` wipe on restart)

  `objectstack dev` historically fell back to a `:memory:` SQLite database when no `--database` / `OS_DATABASE_URL` was given, so **every restart silently wiped all data and AI-authored metadata** — you'd build an app, restart, and it would be gone, which makes local app-building unusable.

  `dev` now defaults to a persistent, project-anchored SQLite file at `<cwd>/.objectstack/data/dev.db` (gitignored, per-project). Existing opt-outs are unchanged and take precedence: `--fresh` (ephemeral temp DB), `--database <url>`, `OS_DATABASE_URL`/`DATABASE_URL`, or an explicit in-memory driver (`--database-driver memory` / `OS_DATABASE_DRIVER=memory`). Resolution is extracted into the testable `resolveDefaultDevDbUrl()` helper.

  The **app-showcase** example drops its explicit `:memory:` datasource override (which would otherwise route data back to memory and defeat the new default), so it persists across restarts out of the box.

### Patch Changes

- Updated dependencies [6b82e68]
- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [328a7c4]
- Updated dependencies [f01f9fa]
- Updated dependencies [4888ea2]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/service-ai@7.8.0
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
  - @objectstack/rest@7.8.0
  - @objectstack/runtime@7.8.0
  - @objectstack/service-package@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/account@7.8.0
  - @objectstack/client@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/observability@7.8.0
  - @objectstack/platform-objects@7.8.0
  - @objectstack/driver-memory@7.8.0
  - @objectstack/driver-mongodb@7.8.0
  - @objectstack/driver-sql@7.8.0
  - @objectstack/driver-sqlite-wasm@7.8.0
  - @objectstack/plugin-approvals@7.8.0
  - @objectstack/plugin-audit@7.8.0
  - @objectstack/plugin-auth@7.8.0
  - @objectstack/plugin-email@7.8.0
  - @objectstack/plugin-hono-server@7.8.0
  - @objectstack/plugin-mcp-server@7.8.0
  - @objectstack/plugin-org-scoping@7.8.0
  - @objectstack/plugin-reports@7.8.0
  - @objectstack/plugin-security@7.8.0
  - @objectstack/plugin-sharing@7.8.0
  - @objectstack/plugin-trigger-record-change@7.8.0
  - @objectstack/plugin-trigger-schedule@7.8.0
  - @objectstack/plugin-webhooks@7.8.0
  - @objectstack/service-analytics@7.8.0
  - @objectstack/service-automation@7.8.0
  - @objectstack/service-cache@7.8.0
  - @objectstack/service-datasource@7.8.0
  - @objectstack/service-feed@7.8.0
  - @objectstack/service-job@7.8.0
  - @objectstack/service-messaging@7.8.0
  - @objectstack/service-queue@7.8.0
  - @objectstack/service-realtime@7.8.0
  - @objectstack/service-settings@7.8.0
  - @objectstack/service-storage@7.8.0
  - @objectstack/types@7.8.0
  - @objectstack/console@7.8.0

## 7.7.0

### Patch Changes

- 1e0b6d7: fix(cli): honor OS_LOG_LEVEL / --log-level instead of hardcoding the kernel logger to `silent` (#1533)

  `os serve` / `os start` built the runtime kernel with a hardcoded `{ level: 'silent' }` logger, suppressing every plugin `logger.warn` / `logger.error`. A record-change flow whose condition or node faulted (surfaced via `logger.warn` in `plugin-trigger-record-change`) produced zero operator-visible output — the flow simply had no effect — undercutting ADR-0032's "fail loudly" promise when run via the CLI.

  The kernel logger level is now resolved from `--verbose` (→ `debug`) → `--log-level <level>` → `$OS_LOG_LEVEL` / `$LOG_LEVEL` → default `warn`. Defaulting to `warn` surfaces flow/hook execution-failure warnings and automation-engine errors out of the box, while the existing boot-quiet window still suppresses info-level startup chatter. Pass `--log-level silent` (or `OS_LOG_LEVEL=silent`) to restore the previous fully-quiet behavior. `start` and `dev` gain a matching `--log-level` flag and forward it (plus the existing `--verbose`) to the spawned `serve`.

- Updated dependencies [b391955]
- Updated dependencies [984ddff]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/service-ai@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/objectql@7.7.0
  - @objectstack/driver-sql@7.7.0
  - @objectstack/account@7.7.0
  - @objectstack/client@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/observability@7.7.0
  - @objectstack/driver-memory@7.7.0
  - @objectstack/driver-mongodb@7.7.0
  - @objectstack/driver-sqlite-wasm@7.7.0
  - @objectstack/plugin-approvals@7.7.0
  - @objectstack/plugin-audit@7.7.0
  - @objectstack/plugin-auth@7.7.0
  - @objectstack/plugin-email@7.7.0
  - @objectstack/plugin-hono-server@7.7.0
  - @objectstack/plugin-mcp-server@7.7.0
  - @objectstack/plugin-org-scoping@7.7.0
  - @objectstack/plugin-reports@7.7.0
  - @objectstack/plugin-security@7.7.0
  - @objectstack/plugin-sharing@7.7.0
  - @objectstack/plugin-trigger-record-change@7.7.0
  - @objectstack/plugin-trigger-schedule@7.7.0
  - @objectstack/plugin-webhooks@7.7.0
  - @objectstack/rest@7.7.0
  - @objectstack/runtime@7.7.0
  - @objectstack/service-analytics@7.7.0
  - @objectstack/service-automation@7.7.0
  - @objectstack/service-cache@7.7.0
  - @objectstack/service-datasource@7.7.0
  - @objectstack/service-feed@7.7.0
  - @objectstack/service-job@7.7.0
  - @objectstack/service-messaging@7.7.0
  - @objectstack/service-package@7.7.0
  - @objectstack/service-queue@7.7.0
  - @objectstack/service-realtime@7.7.0
  - @objectstack/service-settings@7.7.0
  - @objectstack/service-storage@7.7.0
  - @objectstack/types@7.7.0
  - @objectstack/console@7.7.0

## 7.6.0

### Minor Changes

- c4a4cbd: ADR-0032 (phase 1): validate-by-default expression layer — no silent failure.

  Kills the #1491 class where a malformed predicate (e.g. the `{record.x}`
  template-brace-in-CEL mistake) silently evaluated to `false` and made a flow
  "fire" with no effect:

  - **service-automation**: flow `evaluateCondition` no longer swallows CEL
    failures to `false` — it throws an attributed, corrective error; and
    `registerFlow` now parse-validates every predicate (start/decision/edge
    condition) at registration, failing loudly with the offending location +
    source + the fix.
  - **formula**: new shared validator — `validateExpression(role, src, schema?)`,
    `introspectScope`, `CEL_STDLIB_FUNCTIONS` — with schema-aware field-existence
    - did-you-mean. The `{{ }}` template engine gains a formatter whitelist
      (`currency`/`number`/`percent`/`date`/`datetime`/`truncate`/`upper`/`lower`/
      `default`/…) with defined value→string semantics; arbitrary logic in holes is
      rejected. Plain `{{ path }}` stays back-compatible.
  - **cli**: `objectstack compile` validates every flow / validation-rule /
    field-formula predicate against the resolved object schema and fails the
    build with located, corrective messages.
  - **service-ai**: new agent-callable `validate_expression` tool so authoring
    agents self-correct before committing.
  - **spec**: fix the `FlowSchema` JSDoc example that taught the bad
    `condition: "{amount} < 500"` single-brace form.

### Patch Changes

- 8c01eea: fix(dev): seed the dev admin in-process and fix the port-drift seed failure.

  `os dev` (and `pnpm dev:showcase`) seeded the admin over HTTP against a
  hard-coded `localhost:3000`. In dev, `serve` auto-shifts off a busy port, so
  the seed POST hit the wrong server (or nothing) and the running instance never
  got an admin. A second, divergent seed in `plugin-dev` inserted a
  credential-less `sys_user` row that could not log in.

  Consolidate to a single in-process seed:

  - **`@objectstack/plugin-auth`** — `maybeSeedDevAdmin()` runs on `kernel:ready`
    and creates `admin@objectos.ai` / `admin123` through better-auth's real
    `signUpEmail` pipeline (hashed credential), so the account is loginable;
    `plugin-security` then promotes it to platform admin. Empty-DB only
    (excludes the system service account), idempotent, never overwrites an
    existing account. Hard-gated to `NODE_ENV=development`; opt out with
    `OS_SEED_ADMIN=0`.
  - **`@objectstack/cli`** — removed the HTTP seed; `--seed-admin` now passes
    `OS_SEED_ADMIN[_EMAIL|_PASSWORD]` to the serve child. `serve` publishes its
    actually-bound port over IPC and to a `runtime.<env>.json` state file under
    `OS_HOME`.
  - **`@objectstack/plugin-dev`** — removed the credential-less raw insert;
    `seedAdminUser` maps to the unified `OS_SEED_ADMIN` toggle.

- 3377e38: fix(release): stop the fixed-group major cascade caused by internal `@objectstack/*` peerDependencies.

  These packages declared workspace peerDependencies on other framework packages
  in the changesets `fixed` group. Inside a fixed group, changesets rewrites those
  peer ranges on every release and treats a peer-range change as breaking → major,
  which cascaded to **all 69 packages → 8.0.0** on _any_ minor changeset. Required
  internal peers are now regular `dependencies`; optional ones move to
  `devDependencies` (kept for in-workspace tests, no longer a published peer edge).
  Releases now bump correctly (patch/minor) instead of a spurious major.

- 55866f5: Fail loud instead of silently minting an ephemeral encryption key; ship a persistent env-master-key provider as the default (#1507).

  The default `ICryptoProvider` backs every secret-at-rest in the platform —
  encrypted settings (`sys_setting.value_enc`), ObjectQL `secret` fields, and
  runtime datasource credentials. Its key resolution previously fell back,
  **silently**, to a fresh per-process `randomBytes(32)` key (or auto-minted a
  new on-disk key on every boot) when no stable key was available. In an
  ephemeral-FS container or a multi-node cluster, each restart / each node then
  encrypts under a different key, and every previously-written `sys_secret` value
  becomes undecryptable. The failure was invisible at encrypt and boot time and
  only surfaced later as "all my saved passwords / API keys / DB credentials
  fail to decrypt".

  - **Renamed `InMemoryCryptoProvider` → `LocalCryptoProvider`.** The old name
    implied an ephemeral key when the provider in fact persists one.
    `InMemoryCryptoProvider` stays as a deprecated alias for backward
    compatibility.
  - **Added `OS_SECRET_KEY`** as the canonical production master key (32-byte
    hex or base64), the documented production default. `OS_DEV_CRYPTO_KEY`
    remains the dev convenience key.
  - **Fail-loud in production.** When `NODE_ENV=production` and no stable key
    source (env var or a pre-existing persisted file) is available, the provider
    now throws an actionable error at construction instead of generating a key —
    turning silent data-loss into a config error at boot. It never auto-mints a
    key in production. Development and test keep the ergonomic fallback
    (persisted dev key / ephemeral test key).
  - `serve` surfaces the production-key error verbatim and refuses to wire an
    unstable provider for `secret` fields.

  KMS / Vault providers (managed custody, per-tenant keys, automatic rotation)
  remain future/enterprise plug-ins behind the same `ICryptoProvider` seam;
  "your stored secret is still there after a reboot" stays open-source.

- b7a4f14: fix(dev): surface the seeded dev-admin credentials in the `serve` startup banner.

  When the runtime seeds the dev admin on an empty DB, the confirmation was
  emitted via `ctx.logger` during `runtime.start()` — inside serve's boot-quiet
  window — so it was swallowed and never reached the console. plugin-auth now
  records the seed result on the `auth` service and `serve` prints it in the
  ready banner (after stdout is restored), e.g.:

  ```
    🔑  Dev admin: admin@objectos.ai / admin123
        seeded on empty DB · dev only — do not use in production
  ```

  Shown only when an admin was actually seeded this boot (empty DB) — never on a
  DB that already had a user, so stale credentials are never displayed. Visible
  in both `serve --dev` and `os dev` (the child's stdout is inherited).

- Updated dependencies [955d4c8]
- Updated dependencies [11905fa]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [cf03ef2]
- Updated dependencies [7648242]
- Updated dependencies [bb04824]
- Updated dependencies [8c01eea]
- Updated dependencies [8fa1e7f]
- Updated dependencies [d8aa11d]
- Updated dependencies [3377e38]
- Updated dependencies [be20aa4]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [b7a4f14]
- Updated dependencies [60f9c45]
- Updated dependencies [f06a6a5]
- Updated dependencies [4ee139d]
  - @objectstack/service-messaging@7.6.0
  - @objectstack/service-automation@7.6.0
  - @objectstack/spec@7.6.0
  - @objectstack/plugin-webhooks@7.6.0
  - @objectstack/formula@7.6.0
  - @objectstack/service-ai@7.6.0
  - @objectstack/client@7.6.0
  - @objectstack/objectql@7.6.0
  - @objectstack/service-datasource@7.6.0
  - @objectstack/plugin-auth@7.6.0
  - @objectstack/plugin-email@7.6.0
  - @objectstack/driver-sqlite-wasm@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/service-settings@7.6.0
  - @objectstack/runtime@7.6.0
  - @objectstack/plugin-approvals@7.6.0
  - @objectstack/account@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/observability@7.6.0
  - @objectstack/driver-memory@7.6.0
  - @objectstack/driver-mongodb@7.6.0
  - @objectstack/driver-sql@7.6.0
  - @objectstack/plugin-audit@7.6.0
  - @objectstack/plugin-hono-server@7.6.0
  - @objectstack/plugin-mcp-server@7.6.0
  - @objectstack/plugin-org-scoping@7.6.0
  - @objectstack/plugin-reports@7.6.0
  - @objectstack/plugin-security@7.6.0
  - @objectstack/plugin-sharing@7.6.0
  - @objectstack/plugin-trigger-record-change@7.6.0
  - @objectstack/plugin-trigger-schedule@7.6.0
  - @objectstack/rest@7.6.0
  - @objectstack/service-analytics@7.6.0
  - @objectstack/service-cache@7.6.0
  - @objectstack/service-feed@7.6.0
  - @objectstack/service-job@7.6.0
  - @objectstack/service-package@7.6.0
  - @objectstack/service-queue@7.6.0
  - @objectstack/service-realtime@7.6.0
  - @objectstack/service-storage@7.6.0
  - @objectstack/types@7.6.0
  - @objectstack/console@7.6.0

## 7.5.0

### Patch Changes

- Updated dependencies [1560880]
- Updated dependencies [a2263e6]
  - @objectstack/service-automation@7.5.0
  - @objectstack/plugin-approvals@7.5.0
  - @objectstack/spec@7.5.0
  - @objectstack/console@7.5.0
  - @objectstack/core@7.5.0
  - @objectstack/client@7.5.0
  - @objectstack/types@7.5.0
  - @objectstack/objectql@7.5.0
  - @objectstack/observability@7.5.0
  - @objectstack/platform-objects@7.5.0
  - @objectstack/runtime@7.5.0
  - @objectstack/rest@7.5.0
  - @objectstack/driver-memory@7.5.0
  - @objectstack/driver-sql@7.5.0
  - @objectstack/driver-mongodb@7.5.0
  - @objectstack/driver-sqlite-wasm@7.5.0
  - @objectstack/plugin-audit@7.5.0
  - @objectstack/plugin-auth@7.5.0
  - @objectstack/plugin-email@7.5.0
  - @objectstack/plugin-hono-server@7.5.0
  - @objectstack/plugin-mcp-server@7.5.0
  - @objectstack/plugin-org-scoping@7.5.0
  - @objectstack/plugin-reports@7.5.0
  - @objectstack/plugin-security@7.5.0
  - @objectstack/plugin-sharing@7.5.0
  - @objectstack/plugin-webhooks@7.5.0
  - @objectstack/plugin-trigger-record-change@7.5.0
  - @objectstack/plugin-trigger-schedule@7.5.0
  - @objectstack/service-ai@7.5.0
  - @objectstack/service-analytics@7.5.0
  - @objectstack/service-cache@7.5.0
  - @objectstack/service-external-datasource@7.5.0
  - @objectstack/service-feed@7.5.0
  - @objectstack/service-job@7.5.0
  - @objectstack/service-messaging@7.5.0
  - @objectstack/service-package@7.5.0
  - @objectstack/service-queue@7.5.0
  - @objectstack/service-realtime@7.5.0
  - @objectstack/service-settings@7.5.0
  - @objectstack/service-storage@7.5.0
  - @objectstack/account@7.5.0

## 7.4.1

### Patch Changes

- Updated dependencies [d7f86db]
  - @objectstack/console@7.4.1
  - @objectstack/spec@7.4.1
  - @objectstack/core@7.4.1
  - @objectstack/client@7.4.1
  - @objectstack/types@7.4.1
  - @objectstack/objectql@7.4.1
  - @objectstack/observability@7.4.1
  - @objectstack/platform-objects@7.4.1
  - @objectstack/runtime@7.4.1
  - @objectstack/rest@7.4.1
  - @objectstack/driver-memory@7.4.1
  - @objectstack/driver-sql@7.4.1
  - @objectstack/driver-mongodb@7.4.1
  - @objectstack/driver-sqlite-wasm@7.4.1
  - @objectstack/plugin-approvals@7.4.1
  - @objectstack/plugin-audit@7.4.1
  - @objectstack/plugin-auth@7.4.1
  - @objectstack/plugin-email@7.4.1
  - @objectstack/plugin-hono-server@7.4.1
  - @objectstack/plugin-mcp-server@7.4.1
  - @objectstack/plugin-org-scoping@7.4.1
  - @objectstack/plugin-reports@7.4.1
  - @objectstack/plugin-security@7.4.1
  - @objectstack/plugin-sharing@7.4.1
  - @objectstack/plugin-webhooks@7.4.1
  - @objectstack/plugin-trigger-record-change@7.4.1
  - @objectstack/plugin-trigger-schedule@7.4.1
  - @objectstack/service-ai@7.4.1
  - @objectstack/service-analytics@7.4.1
  - @objectstack/service-automation@7.4.1
  - @objectstack/service-cache@7.4.1
  - @objectstack/service-external-datasource@7.4.1
  - @objectstack/service-feed@7.4.1
  - @objectstack/service-job@7.4.1
  - @objectstack/service-messaging@7.4.1
  - @objectstack/service-package@7.4.1
  - @objectstack/service-queue@7.4.1
  - @objectstack/service-realtime@7.4.1
  - @objectstack/service-settings@7.4.1
  - @objectstack/service-storage@7.4.1
  - @objectstack/account@7.4.1

## 7.4.0

### Minor Changes

- 70b63f2: `objectstack dev` now defaults to SQLite and auto-seeds an admin.

  - **Default driver → SQLite.** With no `OS_DATABASE_URL`/`OS_DATABASE_DRIVER`,
    dev now prefers `SqlDriver(sqlite, :memory:)` over the pure-JS `InMemoryDriver`
    for production-like SQL semantics. It probes by opening a connection (knex
    loads `better-sqlite3` lazily at first query) and falls back to
    `InMemoryDriver` **with a warning** if the native binary is unavailable —
    closing a hole where the surrounding silent catch could leave the kernel with
    no driver.
  - **`--seed-admin` defaults ON in dev.** Idempotent and non-destructive: POSTs
    the public sign-up endpoint, creating `admin@objectos.ai` only on an empty DB
    (then promoted to platform admin) and skipping when the email already exists
    (422/400), so a custom password is never overwritten. Disable with
    `--no-seed-admin`.

- 2faf9f2: External Datasource Federation (ADR-0015) — CLI surface.

  New `os datasource` command group: `list-tables` (list remote tables),
  `introspect` (generate a reviewable `*.object.ts` draft from a remote table),
  and `validate` (validate federated objects against the remote schema; exits
  non-zero on mismatch). Backed by the `/api/v1/datasources/:name/external/*`
  REST routes.

- 394d34f: Messaging + triggers capability tokens, and notify-by-email recipient resolution.

  Make the `notify` flow node and auto-firing flows usable from a plain
  `defineStack({ requires: [...] })` — no hand-wired plugin instances.

  - **CLI / runtime — new capability tokens.** `messaging` →
    `MessagingServicePlugin` (the `notify` node delivers to the inbox channel
    instead of degrading to a logged no-op); `triggers` →
    `RecordChangeTriggerPlugin` + `ScheduleTriggerPlugin` (autolaunched / schedule
    flows actually fire — pair `triggers` with `job` for cron/interval). Wired
    identically in the CLI `CAPABILITY_PROVIDERS` table and the runtime
    `capability-loader`.
  - **Inbox channel — notify-by-email.** Flows commonly address recipients by
    email (e.g. `{record.assignee}`), but `sys_inbox_message` is keyed by user id.
    The inbox channel now resolves an email-shaped recipient to its `sys_user.id`
    (configurable via `InboxChannelOptions.userObject`), with a verbatim fallback
    when the recipient is not email-shaped, no user matches, or the lookup fails —
    so a failed resolution can never drop the row.

### Patch Changes

- 23c7107: ADR-0020 — converge the three "state machine" declaration shapes to one
  **enforced** `state_machine` validation rule.

  Before this change a record state machine could be declared three ways (a
  `workflow` metadata type, an `object.stateMachines` map, or a `state_machine`
  validation rule) and **none of them were enforced at runtime** — a declarative
  guardrail that was pure decoration, and a hallucination trap for AI authors.

  **Enforcement (`@objectstack/objectql`)**

  - New `validation/rule-validator.ts` evaluates the object's `validations` union
    on the write path: `evaluateValidationRules`, `needsPriorRecord`, and the
    `legalNextStates` introspection helper (all exported from the package root).
  - `state_machine` rules reject illegal `field` transitions on update (with the
    rule's `message`); `script` / `cross_field` predicate rules now also fire
    (they were silently broken on PATCH updates because only the patch, not the
    prior record, was available). The engine plumbs the prior record into
    rule evaluation on single-row update; multi-row (`updateMany`) updates log a
    warning and skip rule evaluation rather than enforce on incomplete data.

  **Convergence / retirement (`@objectstack/spec`) — breaking**

  - Retires the `workflow` metadata type (removed from the metadata-type enum,
    the registry, the schema map, the `workflows` collection key, and the
    plural→singular mapping).
  - Removes the `object.stateMachines` map and the `stack.workflows` array. The
    `state_machine` validation rule is the single canonical home.
  - The XState-style `StateMachineSchema` file is **kept** (still used by the
    agent conversation lifecycle and the discovery protocol); only its role as
    the `workflow` metadata-type backing schema was removed. The optional
    `workflow` **RPC service** surface (`CoreServiceName.workflow`,
    `/api/v1/workflow`, `IWorkflowService`) is kept as a documented follow-up.

  **Introspection (`@objectstack/runtime`)**

  - Adds `GET /metadata/objects/:name/state/:field?from=:state`, returning the
    legal next states for a field (`next: null` when no FSM governs the field,
    `[]` for a declared dead-end) so UIs/agents read the transition table instead
    of re-deriving it.

  **Surfaces (`@objectstack/platform-objects`, `@objectstack/cli`)**

  - Studio drops the standalone "Workflow Rules" nav (state machines are edited
    alongside the object's other validation rules).
  - `explain` no longer lists `workflow` as a related metadata type.

  Migration: replace a `workflow` / `StateMachineConfig` declaration with a
  `state_machine` validation rule on the object (`field` + `{ from: [allowedTo] }`
  transition table), and move any side-effecting actions (emails, task creation)
  into a record-triggered or scheduled Flow (ADR-0019). See the migrated
  `examples/app-crm` flows for the pattern.

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

- 08fbbb4: Fix: the first-boot platform-admin promotion no longer gets stolen by the
  `usr_system` seed identity, and the dev seed admin uses fixed, well-known
  credentials.

  **`@objectstack/plugin-security` — `bootstrapPlatformAdmin` skips the system user**

  `5e831dea3` (#1392) added `ensureSeedIdentity` to the runtime SeedLoader,
  which upserts a non-loginable system identity (`usr_system`, role `system`,
  `system@objectstack.local`) to own seeded records — created _before_ the first
  human sign-up. Because `bootstrapPlatformAdmin` promoted the **earliest-created**
  `sys_user`, on any app that ships seed data `usr_system` won the promotion and
  the real admin login stayed at `role: user`. Login succeeded but Setup and
  Studio (gated by `setup.access` / `studio.access` on `admin_full_access`) were
  invisible — a silent, confusing regression.

  `bootstrap-platform-admin.ts` now filters out the system account
  (`id === SystemUserId.SYSTEM || role === 'system'`) when picking the first user
  to promote, and the "an admin already exists" short-circuit ignores any
  `admin_full_access` grant held by `usr_system` — so a database where it was
  wrongly promoted self-heals on the next boot.

  **`@objectstack/cli` — `os dev` seeds `admin@objectos.ai` / `admin123`**

  The `--admin-email` / `--admin-password` defaults changed from
  `admin@dev.local` / `admin12345` to the fixed, well-known
  `admin@objectos.ai` / `admin123`, so tooling and docs never have to guess the
  seeded credentials. Override with `--admin-email` / `--admin-password`.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [a40d010]
- Updated dependencies [f3424fc]
- Updated dependencies [c8753ef]
- Updated dependencies [406fda5]
- Updated dependencies [f115182]
- Updated dependencies [24c9013]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [a6d4cbb]
- Updated dependencies [08fbbb4]
- Updated dependencies [58b450b]
- Updated dependencies [394d34f]
- Updated dependencies [82eb6cf]
- Updated dependencies [3a45780]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [03fd7f0]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/objectql@7.4.0
  - @objectstack/runtime@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/plugin-auth@7.4.0
  - @objectstack/plugin-webhooks@7.4.0
  - @objectstack/plugin-approvals@7.4.0
  - @objectstack/plugin-security@7.4.0
  - @objectstack/plugin-sharing@7.4.0
  - @objectstack/service-messaging@7.4.0
  - @objectstack/plugin-audit@7.4.0
  - @objectstack/service-automation@7.4.0
  - @objectstack/driver-sql@7.4.0
  - @objectstack/rest@7.4.0
  - @objectstack/service-external-datasource@7.4.0
  - @objectstack/service-ai@7.4.0
  - @objectstack/client@7.4.0
  - @objectstack/service-settings@7.4.0
  - @objectstack/plugin-trigger-record-change@7.4.0
  - @objectstack/plugin-trigger-schedule@7.4.0
  - @objectstack/account@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/observability@7.4.0
  - @objectstack/driver-memory@7.4.0
  - @objectstack/driver-mongodb@7.4.0
  - @objectstack/driver-sqlite-wasm@7.4.0
  - @objectstack/plugin-email@7.4.0
  - @objectstack/plugin-hono-server@7.4.0
  - @objectstack/plugin-mcp-server@7.4.0
  - @objectstack/plugin-org-scoping@7.4.0
  - @objectstack/plugin-reports@7.4.0
  - @objectstack/service-analytics@7.4.0
  - @objectstack/service-cache@7.4.0
  - @objectstack/service-feed@7.4.0
  - @objectstack/service-job@7.4.0
  - @objectstack/service-package@7.4.0
  - @objectstack/service-queue@7.4.0
  - @objectstack/service-realtime@7.4.0
  - @objectstack/service-storage@7.4.0
  - @objectstack/types@7.4.0
  - @objectstack/console@7.4.0

## 7.3.0

### Patch Changes

- 45259d6: **`os start` no longer silently shifts ports on a conflict.**

  Port resolution is unchanged (`--port` › `$OS_PORT` › `$PORT` › `3000`), but the
  conflict behaviour is now mode-dependent:

  - **Dev** (`os dev`, or `NODE_ENV=development`): still auto-hops to the next free
    port (up to +100) so multiple example apps can run side-by-side. The startup
    banner shows the actual bound port.
  - **Production** (`os start`): if the resolved port is busy, the CLI now fails
    loudly and exits `1` instead of binding a different port. A silently drifted
    port breaks reverse-proxy upstreams, better-auth callback URLs (`OS_AUTH_URL`),
    and CORS trusted-origins (`OS_TRUSTED_ORIGINS`) as opaque 403/502s.

  Also fixed: the `os start` startup banner now prints the real Console URL when
  the port comes from `$PORT`/`$OS_PORT` (previously it always showed the
  `--port`/`3000` value, which could be wrong).

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/account@7.3.0
  - @objectstack/client@7.3.0
  - @objectstack/objectql@7.3.0
  - @objectstack/observability@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/driver-memory@7.3.0
  - @objectstack/driver-mongodb@7.3.0
  - @objectstack/driver-sql@7.3.0
  - @objectstack/driver-sqlite-wasm@7.3.0
  - @objectstack/plugin-approvals@7.3.0
  - @objectstack/plugin-audit@7.3.0
  - @objectstack/plugin-auth@7.3.0
  - @objectstack/plugin-email@7.3.0
  - @objectstack/plugin-hono-server@7.3.0
  - @objectstack/plugin-mcp-server@7.3.0
  - @objectstack/plugin-org-scoping@7.3.0
  - @objectstack/plugin-reports@7.3.0
  - @objectstack/plugin-security@7.3.0
  - @objectstack/plugin-sharing@7.3.0
  - @objectstack/plugin-webhooks@7.3.0
  - @objectstack/rest@7.3.0
  - @objectstack/runtime@7.3.0
  - @objectstack/service-ai@7.3.0
  - @objectstack/service-analytics@7.3.0
  - @objectstack/service-automation@7.3.0
  - @objectstack/service-cache@7.3.0
  - @objectstack/service-feed@7.3.0
  - @objectstack/service-job@7.3.0
  - @objectstack/service-package@7.3.0
  - @objectstack/service-queue@7.3.0
  - @objectstack/service-realtime@7.3.0
  - @objectstack/service-settings@7.3.0
  - @objectstack/service-storage@7.3.0
  - @objectstack/types@7.3.0
  - @objectstack/console@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/runtime@7.2.1
  - @objectstack/objectql@7.2.1
  - @objectstack/plugin-auth@7.2.1
  - @objectstack/plugin-hono-server@7.2.1
  - @objectstack/plugin-mcp-server@7.2.1
  - @objectstack/plugin-webhooks@7.2.1
  - @objectstack/service-ai@7.2.1
  - @objectstack/service-settings@7.2.1
  - @objectstack/client@7.2.1
  - @objectstack/plugin-sharing@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/console@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/observability@7.2.1
  - @objectstack/platform-objects@7.2.1
  - @objectstack/rest@7.2.1
  - @objectstack/driver-memory@7.2.1
  - @objectstack/driver-sql@7.2.1
  - @objectstack/driver-mongodb@7.2.1
  - @objectstack/driver-sqlite-wasm@7.2.1
  - @objectstack/plugin-approvals@7.2.1
  - @objectstack/plugin-audit@7.2.1
  - @objectstack/plugin-email@7.2.1
  - @objectstack/plugin-org-scoping@7.2.1
  - @objectstack/plugin-reports@7.2.1
  - @objectstack/plugin-security@7.2.1
  - @objectstack/service-analytics@7.2.1
  - @objectstack/service-automation@7.2.1
  - @objectstack/service-cache@7.2.1
  - @objectstack/service-feed@7.2.1
  - @objectstack/service-job@7.2.1
  - @objectstack/service-package@7.2.1
  - @objectstack/service-queue@7.2.1
  - @objectstack/service-realtime@7.2.1
  - @objectstack/service-storage@7.2.1
  - @objectstack/account@7.2.1

## 7.2.0

### Patch Changes

- Updated dependencies [d662c01]
  - @objectstack/console@7.2.0
  - @objectstack/spec@7.2.0
  - @objectstack/core@7.2.0
  - @objectstack/client@7.2.0
  - @objectstack/objectql@7.2.0
  - @objectstack/observability@7.2.0
  - @objectstack/platform-objects@7.2.0
  - @objectstack/runtime@7.2.0
  - @objectstack/rest@7.2.0
  - @objectstack/driver-memory@7.2.0
  - @objectstack/driver-sql@7.2.0
  - @objectstack/driver-mongodb@7.2.0
  - @objectstack/driver-sqlite-wasm@7.2.0
  - @objectstack/plugin-approvals@7.2.0
  - @objectstack/plugin-audit@7.2.0
  - @objectstack/plugin-auth@7.2.0
  - @objectstack/plugin-email@7.2.0
  - @objectstack/plugin-hono-server@7.2.0
  - @objectstack/plugin-mcp-server@7.2.0
  - @objectstack/plugin-org-scoping@7.2.0
  - @objectstack/plugin-reports@7.2.0
  - @objectstack/plugin-security@7.2.0
  - @objectstack/plugin-sharing@7.2.0
  - @objectstack/plugin-webhooks@7.2.0
  - @objectstack/service-ai@7.2.0
  - @objectstack/service-analytics@7.2.0
  - @objectstack/service-automation@7.2.0
  - @objectstack/service-cache@7.2.0
  - @objectstack/service-feed@7.2.0
  - @objectstack/service-job@7.2.0
  - @objectstack/service-package@7.2.0
  - @objectstack/service-queue@7.2.0
  - @objectstack/service-realtime@7.2.0
  - @objectstack/service-settings@7.2.0
  - @objectstack/service-storage@7.2.0
  - @objectstack/account@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [89771d4]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/account@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/objectql@7.1.0
  - @objectstack/runtime@7.1.0
  - @objectstack/plugin-approvals@7.1.0
  - @objectstack/plugin-audit@7.1.0
  - @objectstack/plugin-auth@7.1.0
  - @objectstack/plugin-email@7.1.0
  - @objectstack/plugin-org-scoping@7.1.0
  - @objectstack/plugin-reports@7.1.0
  - @objectstack/plugin-security@7.1.0
  - @objectstack/plugin-sharing@7.1.0
  - @objectstack/plugin-webhooks@7.1.0
  - @objectstack/service-ai@7.1.0
  - @objectstack/service-job@7.1.0
  - @objectstack/service-queue@7.1.0
  - @objectstack/service-realtime@7.1.0
  - @objectstack/service-settings@7.1.0
  - @objectstack/client@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/observability@7.1.0
  - @objectstack/driver-memory@7.1.0
  - @objectstack/driver-mongodb@7.1.0
  - @objectstack/driver-sql@7.1.0
  - @objectstack/driver-sqlite-wasm@7.1.0
  - @objectstack/plugin-hono-server@7.1.0
  - @objectstack/plugin-mcp-server@7.1.0
  - @objectstack/rest@7.1.0
  - @objectstack/service-analytics@7.1.0
  - @objectstack/service-automation@7.1.0
  - @objectstack/service-cache@7.1.0
  - @objectstack/service-feed@7.1.0
  - @objectstack/service-package@7.1.0
  - @objectstack/service-storage@7.1.0
  - @objectstack/console@7.1.0

## 7.0.0

### Major Changes

- dc72172: **Breaking:** Removed `@objectstack/driver-turso` and `@objectstack/knowledge-turso` from the open-core framework.

  The Turso/libSQL driver and its native-vector knowledge adapter now ship exclusively with the **ObjectStack Cloud** distribution (`objectstack-ai/cloud`). Rationale: Turso is used only for cloud/edge multi-tenant deployments — local development uses better-sqlite3 (faster), and the Turso integration is part of ObjectStack's commercial offering.

  ### What moved out

  - `@objectstack/driver-turso` → `objectstack-ai/cloud/packages/driver-turso`
  - `@objectstack/knowledge-turso` → `objectstack-ai/cloud/packages/knowledge-turso`
  - `ITursoPlatformService` contract (spec/contracts/turso-platform.ts) — removed entirely
  - `TursoConfigSchema`, `TursoDriverSpec`, `TursoMultiTenantConfigSchema`, `TenantResolverStrategySchema`, etc. — moved into `@objectstack/driver-turso` (re-exported from cloud)

  ### Framework-side changes

  - `packages/runtime/src/standalone-stack.ts`: `databaseDriver` enum no longer accepts `'turso'`; `libsql://`/`https://` URL detection removed. Cloud builds register the Turso driver via their own stack composition.
  - `packages/runtime/src/cloud/artifact-environment-registry.ts`: dropped `case 'libsql'/'turso'`. Cloud has its own `ArtifactEnvironmentRegistry` that handles Turso.
  - `packages/cli/src/commands/serve.ts`: removed `driverType === 'turso' | 'libsql'` branch.
  - `packages/runtime/package.json`, `packages/cli/package.json`: removed optional peerDep on `@objectstack/driver-turso`.
  - `packages/runtime/tsup.config.ts`: removed `@objectstack/driver-turso` from `external`.
  - `packages/spec/src/contracts/index.ts`: stopped re-exporting `turso-platform.js`.
  - `packages/spec/src/data/index.ts`: stopped re-exporting `driver/turso-multi-tenant.zod`.

  ### Migration for open-source users

  If you used `libsql://` URLs or `@objectstack/driver-turso` directly, either:

  1. Switch to `file:` URLs (better-sqlite3 via `@objectstack/driver-sql`) for local/self-hosted deployments, **or**
  2. Use ObjectStack Cloud, which ships the Turso driver as part of the commercial distribution.

### Patch Changes

- 3a630b6: **Split organization-scoping from `@objectstack/plugin-security` into a new `@objectstack/plugin-org-scoping` package.**

  Per ADR-0002, "tenant" in ObjectStack means _physical_ isolation (one Environment = one database, handled by `@objectstack/driver-turso`'s multi-tenant router). The row-level `organization_id` scoping that previously lived inside SecurityPlugin is a different concept — _logical_ scoping inside a single DB — and now ships as its own plugin.

  ### Breaking changes — `@objectstack/plugin-security`

  - Removed the `multiTenant` constructor option. SecurityPlugin no longer touches `organization_id` on insert and no longer registers the `sys_organization` post-create seed pipeline.
  - Wildcard `current_user.organization_id` RLS policies in the default permission sets are now stripped UNLESS the new `org-scoping` service is registered (i.e. unless `OrgScopingPlugin` is also installed).
  - Removed export `cloneTenantSeedData` (now exposed as `cloneOrgSeedData` from `@objectstack/plugin-org-scoping`).
  - `bootstrapPlatformAdmin()` no longer accepts a `multiTenant` flag and no longer auto-creates a default organization — that behavior moved to `ensureDefaultOrganization()` in the new plugin.

  ### Migration

  Single-tenant deployments — no action required.

  Multi-tenant deployments (previously `new SecurityPlugin({ multiTenant: true })`):

  ```diff
  + import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
    import { SecurityPlugin } from '@objectstack/plugin-security';

  + await kernel.use(new OrgScopingPlugin());     // MUST be BEFORE SecurityPlugin
  - await kernel.use(new SecurityPlugin({ multiTenant: true }));
  + await kernel.use(new SecurityPlugin());
  ```

  The runtime's `OS_MULTI_TENANT` env switch — read by `@objectstack/runtime/cloud/ArtifactKernelFactory`, `@objectstack/plugin-dev`, and the `objectstack` CLI's `serve` / `dev` / `start` commands — automatically registers `OrgScopingPlugin` when set to `true`, so projects driven by the CLI need no code changes.

- 9496b5b: Vendor `@object-ui/console` as `@objectstack/console`, a new dist-only
  package shipped at the framework version. A single `pnpm add
@objectstack/framework` now installs a version-matched Console SPA — no
  second npm dep to keep in sync.

  The Console source-of-truth remains [`@object-ui/console`](https://github.com/objectstack-ai/objectui).
  The framework pins it by SHA in `.objectui-sha`; CI's release workflow
  clones objectui at that SHA, builds the SPA, and publishes the dist as
  `@objectstack/console`.

  The CLI's `resolveConsolePath()` now prefers `@objectstack/console` and
  falls back to `@object-ui/console`, so cloud's Docker overlay flow and
  advanced users who pin `@object-ui/console` directly still take
  precedence. `@object-ui/console` has been demoted from CLI runtime
  dependency to dev fallback.

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [39a23c5]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
- Updated dependencies [9496b5b]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/plugin-auth@7.0.0
  - @objectstack/account@7.0.0
  - @objectstack/runtime@7.0.0
  - @objectstack/plugin-security@7.0.0
  - @objectstack/plugin-org-scoping@7.0.0
  - @objectstack/console@7.0.0
  - @objectstack/client@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/objectql@7.0.0
  - @objectstack/observability@7.0.0
  - @objectstack/driver-memory@7.0.0
  - @objectstack/driver-mongodb@7.0.0
  - @objectstack/driver-sql@7.0.0
  - @objectstack/driver-sqlite-wasm@7.0.0
  - @objectstack/plugin-approvals@7.0.0
  - @objectstack/plugin-audit@7.0.0
  - @objectstack/plugin-email@7.0.0
  - @objectstack/plugin-hono-server@7.0.0
  - @objectstack/plugin-mcp-server@7.0.0
  - @objectstack/plugin-reports@7.0.0
  - @objectstack/plugin-sharing@7.0.0
  - @objectstack/plugin-webhooks@7.0.0
  - @objectstack/rest@7.0.0
  - @objectstack/service-ai@7.0.0
  - @objectstack/service-analytics@7.0.0
  - @objectstack/service-automation@7.0.0
  - @objectstack/service-cache@7.0.0
  - @objectstack/service-feed@7.0.0
  - @objectstack/service-job@7.0.0
  - @objectstack/service-package@7.0.0
  - @objectstack/service-queue@7.0.0
  - @objectstack/service-realtime@7.0.0
  - @objectstack/service-settings@7.0.0
  - @objectstack/service-storage@7.0.0

## 6.9.0

### Patch Changes

- Updated dependencies [bac7ae5]
- Updated dependencies [e9bacda]
  - @objectstack/runtime@6.9.0
  - @objectstack/service-ai@6.9.0
  - @objectstack/service-settings@6.9.0
  - @objectstack/client@6.9.0
  - @objectstack/spec@6.9.0
  - @objectstack/core@6.9.0
  - @objectstack/objectql@6.9.0
  - @objectstack/observability@6.9.0
  - @objectstack/rest@6.9.0
  - @objectstack/driver-memory@6.9.0
  - @objectstack/driver-sql@6.9.0
  - @objectstack/driver-mongodb@6.9.0
  - @objectstack/driver-sqlite-wasm@6.9.0
  - @objectstack/plugin-approvals@6.9.0
  - @objectstack/plugin-audit@6.9.0
  - @objectstack/plugin-auth@6.9.0
  - @objectstack/plugin-email@6.9.0
  - @objectstack/plugin-hono-server@6.9.0
  - @objectstack/plugin-mcp-server@6.9.0
  - @objectstack/plugin-reports@6.9.0
  - @objectstack/plugin-security@6.9.0
  - @objectstack/plugin-sharing@6.9.0
  - @objectstack/plugin-webhooks@6.9.0
  - @objectstack/service-analytics@6.9.0
  - @objectstack/service-automation@6.9.0
  - @objectstack/service-cache@6.9.0
  - @objectstack/service-feed@6.9.0
  - @objectstack/service-job@6.9.0
  - @objectstack/service-package@6.9.0
  - @objectstack/service-queue@6.9.0
  - @objectstack/service-realtime@6.9.0
  - @objectstack/service-storage@6.9.0
  - @objectstack/account@6.9.0

## 6.8.1

### Patch Changes

- bca0ee5: `os dev` and `os start` now load `.env` files via dotenv-flow, matching
  the existing `os serve` behavior. Previously only `serve` honored
  `.env` / `.env.development` / `.env.production` / `.env.local`, which
  made env-based configuration (e.g. `OS_DATABASE_URL`) silently inert
  for the two most commonly used commands and surprised users who set up
  the conventional `.env.*` layout.

  Loading order (later wins): `.env`, `.env.${NODE_ENV}`, `.env.local`,
  `.env.${NODE_ENV}.local`. `os dev` pins NODE_ENV to `development`; `os
start` defaults to `production`. Process env still wins over file
  values, so CLI flags and shell exports remain authoritative.

  - @objectstack/spec@6.8.1
  - @objectstack/core@6.8.1
  - @objectstack/client@6.8.1
  - @objectstack/objectql@6.8.1
  - @objectstack/observability@6.8.1
  - @objectstack/runtime@6.8.1
  - @objectstack/rest@6.8.1
  - @objectstack/driver-memory@6.8.1
  - @objectstack/driver-sql@6.8.1
  - @objectstack/driver-mongodb@6.8.1
  - @objectstack/driver-sqlite-wasm@6.8.1
  - @objectstack/plugin-approvals@6.8.1
  - @objectstack/plugin-audit@6.8.1
  - @objectstack/plugin-auth@6.8.1
  - @objectstack/plugin-email@6.8.1
  - @objectstack/plugin-hono-server@6.8.1
  - @objectstack/plugin-mcp-server@6.8.1
  - @objectstack/plugin-reports@6.8.1
  - @objectstack/plugin-security@6.8.1
  - @objectstack/plugin-sharing@6.8.1
  - @objectstack/plugin-webhooks@6.8.1
  - @objectstack/service-ai@6.8.1
  - @objectstack/service-analytics@6.8.1
  - @objectstack/service-automation@6.8.1
  - @objectstack/service-cache@6.8.1
  - @objectstack/service-feed@6.8.1
  - @objectstack/service-job@6.8.1
  - @objectstack/service-package@6.8.1
  - @objectstack/service-queue@6.8.1
  - @objectstack/service-realtime@6.8.1
  - @objectstack/service-settings@6.8.1
  - @objectstack/service-storage@6.8.1
  - @objectstack/account@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [99866d8]
- Updated dependencies [c8b9f57]
- Updated dependencies [50ccd9c]
- Updated dependencies [0a40bd1]
  - @objectstack/service-ai@6.8.0
  - @objectstack/spec@6.8.0
  - @objectstack/account@6.8.0
  - @objectstack/rest@6.8.0
  - @objectstack/objectql@6.8.0
  - @objectstack/runtime@6.8.0
  - @objectstack/service-settings@6.8.0
  - @objectstack/client@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/observability@6.8.0
  - @objectstack/driver-memory@6.8.0
  - @objectstack/driver-mongodb@6.8.0
  - @objectstack/driver-sql@6.8.0
  - @objectstack/driver-sqlite-wasm@6.8.0
  - @objectstack/plugin-approvals@6.8.0
  - @objectstack/plugin-audit@6.8.0
  - @objectstack/plugin-auth@6.8.0
  - @objectstack/plugin-email@6.8.0
  - @objectstack/plugin-hono-server@6.8.0
  - @objectstack/plugin-mcp-server@6.8.0
  - @objectstack/plugin-reports@6.8.0
  - @objectstack/plugin-security@6.8.0
  - @objectstack/plugin-sharing@6.8.0
  - @objectstack/plugin-webhooks@6.8.0
  - @objectstack/service-analytics@6.8.0
  - @objectstack/service-automation@6.8.0
  - @objectstack/service-cache@6.8.0
  - @objectstack/service-feed@6.8.0
  - @objectstack/service-job@6.8.0
  - @objectstack/service-package@6.8.0
  - @objectstack/service-queue@6.8.0
  - @objectstack/service-realtime@6.8.0
  - @objectstack/service-storage@6.8.0

## 6.7.1

### Patch Changes

- 3b2a1da: Add `@objectstack/account` as a direct dependency of `@objectstack/cli`.

  **Bug**: `npx @objectstack/cli start` started the server successfully but visiting `http://localhost:3000/` produced a raw `{"error":"Not found"}` JSON response. Root cause: the Console SPA redirects unauthenticated users to `/_account/login` (hardcoded in the published Console bundle), but the `@objectstack/account` package was never declared as a CLI dependency. The start log even printed `⚠ @objectstack/account not found — skipping Account UI`, yet the Console kept pointing browsers at the missing mount.

  **Fix**: declare `@objectstack/account` in `packages/cli/package.json` so `npm install @objectstack/cli` pulls the account portal automatically. Verified end-to-end in a clean `/tmp/test-670-patched` install:

  - `npm ls @objectstack/account` → installed
  - `/_account/login` → 200 (was 404)
  - Navigating to `/` correctly routes through Console → Account `/setup` (the first-run owner-account wizard) instead of dead-ending in the API catch-all.

  No change to `@libsql/client` posture — it remains absent from default installs.

- Updated dependencies [87c4d19]
  - @objectstack/account@6.7.1
  - @objectstack/spec@6.7.1
  - @objectstack/core@6.7.1
  - @objectstack/client@6.7.1
  - @objectstack/objectql@6.7.1
  - @objectstack/observability@6.7.1
  - @objectstack/runtime@6.7.1
  - @objectstack/rest@6.7.1
  - @objectstack/driver-memory@6.7.1
  - @objectstack/driver-sql@6.7.1
  - @objectstack/driver-mongodb@6.7.1
  - @objectstack/driver-sqlite-wasm@6.7.1
  - @objectstack/plugin-approvals@6.7.1
  - @objectstack/plugin-audit@6.7.1
  - @objectstack/plugin-auth@6.7.1
  - @objectstack/plugin-email@6.7.1
  - @objectstack/plugin-hono-server@6.7.1
  - @objectstack/plugin-mcp-server@6.7.1
  - @objectstack/plugin-reports@6.7.1
  - @objectstack/plugin-security@6.7.1
  - @objectstack/plugin-sharing@6.7.1
  - @objectstack/plugin-webhooks@6.7.1
  - @objectstack/service-ai@6.7.1
  - @objectstack/service-analytics@6.7.1
  - @objectstack/service-automation@6.7.1
  - @objectstack/service-cache@6.7.1
  - @objectstack/service-feed@6.7.1
  - @objectstack/service-job@6.7.1
  - @objectstack/service-package@6.7.1
  - @objectstack/service-queue@6.7.1
  - @objectstack/service-realtime@6.7.1
  - @objectstack/service-settings@6.7.1
  - @objectstack/service-storage@6.7.1

## 6.7.0

### Patch Changes

- c5efe15: Remove residual coupling to the (already-extracted) `@objectstack/service-cloud` package.

  The cloud distribution was migrated to a separate repo a while back, but the open-core CLI still carried:

  - A dynamic `import('@objectstack/service-cloud')` in the boot-mode dispatch for `cloud` / `runtime` modes.
  - A dev-mode auto-mount that tried to load `createSingleEnvironmentPlugin` from the cloud package (now fully covered by the built-in `RuntimeConfigPlugin`).
  - An ambient `.d.ts` stub for `@objectstack/service-cloud`.
  - A leftover empty `packages/services/service-cloud/` directory (only stale `dist/` + `node_modules/`).
  - Several doc-comment references.

  All gone. The open-core CLI now supports `bootMode: 'standalone'` only — non-standalone modes throw a clear error pointing users to the cloud distribution. No runtime behavior change for standalone users.

- 4944f3a: Fix `npx @objectstack/cli start` crashing with `Cannot find package
'@objectstack/metadata'` (and friends).

  `@objectstack/runtime` dynamically `import()`s `@objectstack/metadata`,
  `@objectstack/objectql`, and the storage drivers (`driver-memory`,
  `driver-sql`, `driver-sqlite-wasm`, `driver-turso`) from
  `createStandaloneStack` / `createDefaultHostConfig`, but they were only
  listed in `devDependencies` — so when the package was installed from npm
  (rather than the workspace) these imports failed at boot.

  They are now declared as real `dependencies`. `@objectstack/driver-mongodb`
  remains an `optionalDependency` because the standalone stack only loads
  it when the user passes a `mongodb://` URL (the failure path already has
  a friendly error message).

  Also adds a small quick-start CLI command (`objectstack start`) that
  auto-creates `~/.objectstack/{data,dist,auth-secret}`, boots an empty
  kernel with Studio + marketplace mounted, and lets users install apps at
  runtime — no `objectstack.config.ts` required.

- e0c593f: Make `@objectstack/driver-turso` an **optional peer dependency** so default `npx @objectstack/cli start` no longer installs `@libsql/client` (~5MB + native binaries) nor `libsql` native modules.

  Rationale: `objectstack start` defaults to `file:` URLs which route to `better-sqlite3` via `driver-sql` (10–15× faster than libsql for OLTP, see benchmarks). For RAG / vector workloads, `sqlite-vec` (~600KB) is the recommended local backend. Turso / libsql is only useful when the user explicitly opts in via `libsql://` / `https://` / `--database-driver turso`.

  Changes:

  - `packages/cli/package.json`: moved `@objectstack/driver-turso` from `dependencies` to optional `peerDependencies` (`peerDependenciesMeta.optional = true`). npm 7+ does **not** auto-install optional peers; `optionalDependencies` would have still installed it.
  - `packages/runtime/package.json`: same.
  - All three dynamic-import sites for `driver-turso` (`runtime/src/standalone-stack.ts`, `runtime/src/cloud/artifact-environment-registry.ts`, `cli/src/commands/serve.ts`) now wrap the `import()` in try/catch with an actionable error message pointing users to `npm install @objectstack/driver-turso`.

  Verified in `/tmp/os-sim`: fresh `npm install @objectstack/cli` no longer contains `node_modules/@libsql`, `node_modules/libsql`, or `node_modules/@objectstack/driver-turso`. `objectstack start` boots cleanly with better-sqlite3; `--database libsql://…` produces the friendly error.

- Updated dependencies [4944f3a]
- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [c5efe15]
- Updated dependencies [4944f3a]
- Updated dependencies [4f9e9d4]
- Updated dependencies [e0c593f]
  - @objectstack/driver-sql@6.7.0
  - @objectstack/spec@6.7.0
  - @objectstack/service-ai@6.7.0
  - @objectstack/runtime@6.7.0
  - @objectstack/service-settings@6.7.0
  - @objectstack/driver-sqlite-wasm@6.7.0
  - @objectstack/client@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/objectql@6.7.0
  - @objectstack/observability@6.7.0
  - @objectstack/driver-memory@6.7.0
  - @objectstack/driver-mongodb@6.7.0
  - @objectstack/plugin-approvals@6.7.0
  - @objectstack/plugin-audit@6.7.0
  - @objectstack/plugin-auth@6.7.0
  - @objectstack/plugin-email@6.7.0
  - @objectstack/plugin-hono-server@6.7.0
  - @objectstack/plugin-mcp-server@6.7.0
  - @objectstack/plugin-reports@6.7.0
  - @objectstack/plugin-security@6.7.0
  - @objectstack/plugin-sharing@6.7.0
  - @objectstack/plugin-webhooks@6.7.0
  - @objectstack/rest@6.7.0
  - @objectstack/service-analytics@6.7.0
  - @objectstack/service-automation@6.7.0
  - @objectstack/service-cache@6.7.0
  - @objectstack/service-feed@6.7.0
  - @objectstack/service-job@6.7.0
  - @objectstack/service-package@6.7.0
  - @objectstack/service-queue@6.7.0
  - @objectstack/service-realtime@6.7.0
  - @objectstack/service-storage@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/client@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/objectql@6.6.0
  - @objectstack/observability@6.6.0
  - @objectstack/driver-memory@6.6.0
  - @objectstack/driver-mongodb@6.6.0
  - @objectstack/driver-sql@6.6.0
  - @objectstack/driver-sqlite-wasm@6.6.0
  - @objectstack/driver-turso@6.6.0
  - @objectstack/plugin-approvals@6.6.0
  - @objectstack/plugin-audit@6.6.0
  - @objectstack/plugin-auth@6.6.0
  - @objectstack/plugin-email@6.6.0
  - @objectstack/plugin-hono-server@6.6.0
  - @objectstack/plugin-mcp-server@6.6.0
  - @objectstack/plugin-reports@6.6.0
  - @objectstack/plugin-security@6.6.0
  - @objectstack/plugin-sharing@6.6.0
  - @objectstack/plugin-webhooks@6.6.0
  - @objectstack/rest@6.6.0
  - @objectstack/runtime@6.6.0
  - @objectstack/service-ai@6.6.0
  - @objectstack/service-analytics@6.6.0
  - @objectstack/service-automation@6.6.0
  - @objectstack/service-cache@6.6.0
  - @objectstack/service-feed@6.6.0
  - @objectstack/service-job@6.6.0
  - @objectstack/service-package@6.6.0
  - @objectstack/service-queue@6.6.0
  - @objectstack/service-realtime@6.6.0
  - @objectstack/service-settings@6.6.0
  - @objectstack/service-storage@6.6.0

## 6.5.1

### Patch Changes

- Updated dependencies [de239ef]
  - @objectstack/plugin-auth@6.5.1
  - @objectstack/runtime@6.5.1
  - @objectstack/client@6.5.1
  - @objectstack/spec@6.5.1
  - @objectstack/core@6.5.1
  - @objectstack/objectql@6.5.1
  - @objectstack/observability@6.5.1
  - @objectstack/rest@6.5.1
  - @objectstack/driver-memory@6.5.1
  - @objectstack/driver-sql@6.5.1
  - @objectstack/driver-turso@6.5.1
  - @objectstack/driver-mongodb@6.5.1
  - @objectstack/driver-sqlite-wasm@6.5.1
  - @objectstack/plugin-approvals@6.5.1
  - @objectstack/plugin-audit@6.5.1
  - @objectstack/plugin-email@6.5.1
  - @objectstack/plugin-hono-server@6.5.1
  - @objectstack/plugin-mcp-server@6.5.1
  - @objectstack/plugin-reports@6.5.1
  - @objectstack/plugin-security@6.5.1
  - @objectstack/plugin-sharing@6.5.1
  - @objectstack/plugin-webhooks@6.5.1
  - @objectstack/service-ai@6.5.1
  - @objectstack/service-analytics@6.5.1
  - @objectstack/service-automation@6.5.1
  - @objectstack/service-cache@6.5.1
  - @objectstack/service-feed@6.5.1
  - @objectstack/service-job@6.5.1
  - @objectstack/service-package@6.5.1
  - @objectstack/service-queue@6.5.1
  - @objectstack/service-realtime@6.5.1
  - @objectstack/service-settings@6.5.1
  - @objectstack/service-storage@6.5.1

## 6.5.0

### Minor Changes

- 777afbf: Include `ai` in the `default` tier preset so `AIServicePlugin` is auto-registered for every stack that opts into the default tier (i.e. any `defineStack` that doesn't override `requires`). Previously AI routes (`/api/v1/ai/*`) only mounted when a stack explicitly listed `'ai'` in `requires` or ran the `full` preset; now they're on by default, matching `i18n`/`ui`/`auth`. The auto-registration block already fails silently if `@objectstack/service-ai` isn't installed, so apps without the package are unaffected.

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/client@6.5.0
- @objectstack/objectql@6.5.0
- @objectstack/observability@6.5.0
- @objectstack/runtime@6.5.0
- @objectstack/rest@6.5.0
- @objectstack/driver-memory@6.5.0
- @objectstack/driver-sql@6.5.0
- @objectstack/driver-turso@6.5.0
- @objectstack/driver-mongodb@6.5.0
- @objectstack/driver-sqlite-wasm@6.5.0
- @objectstack/plugin-approvals@6.5.0
- @objectstack/plugin-audit@6.5.0
- @objectstack/plugin-auth@6.5.0
- @objectstack/plugin-email@6.5.0
- @objectstack/plugin-hono-server@6.5.0
- @objectstack/plugin-mcp-server@6.5.0
- @objectstack/plugin-reports@6.5.0
- @objectstack/plugin-security@6.5.0
- @objectstack/plugin-sharing@6.5.0
- @objectstack/plugin-webhooks@6.5.0
- @objectstack/service-ai@6.5.0
- @objectstack/service-analytics@6.5.0
- @objectstack/service-automation@6.5.0
- @objectstack/service-cache@6.5.0
- @objectstack/service-feed@6.5.0
- @objectstack/service-job@6.5.0
- @objectstack/service-package@6.5.0
- @objectstack/service-queue@6.5.0
- @objectstack/service-realtime@6.5.0
- @objectstack/service-settings@6.5.0
- @objectstack/service-storage@6.5.0

## 6.4.0

### Minor Changes

- 15fc484: Upgrade `@object-ui/*` packages to **v6.0**.

  - `@objectstack/cli`: `@object-ui/console` and `@object-ui/studio` from `^5.4.2` → `^6.0.0` — bundled Studio + Console assets now ship the v6 UI shell (new design language, refreshed sidebar, redesigned record header).
  - `@objectstack/account`: `@object-ui/i18n` from `^5.4.2` → `^6.0.0` — i18n runtime now matches the v6 console/studio API.
  - Root devDependency `@object-ui/console` from `^5.4.2` → `^6.0.0` so workspace scripts and the docs build pick up v6.
  - `create-objectstack`: `tar` from `^7.4.3` → `^7.5.15` (security + perf fixes when unpacking remote templates).

  **Heads-up for consumers:** `@object-ui/*` v6 is a major release of the bundled UI; pages rendered through the CLI's `studio` / `console` mounts may look different from v5. The protocol surface is unchanged.

### Patch Changes

- Updated dependencies [a981d57]
- Updated dependencies [b486666]
- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
- Updated dependencies [0bf6f9a]
  - @objectstack/service-ai@6.4.0
  - @objectstack/spec@6.4.0
  - @objectstack/plugin-auth@6.4.0
  - @objectstack/client@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/objectql@6.4.0
  - @objectstack/observability@6.4.0
  - @objectstack/driver-memory@6.4.0
  - @objectstack/driver-mongodb@6.4.0
  - @objectstack/driver-sql@6.4.0
  - @objectstack/driver-sqlite-wasm@6.4.0
  - @objectstack/driver-turso@6.4.0
  - @objectstack/plugin-approvals@6.4.0
  - @objectstack/plugin-audit@6.4.0
  - @objectstack/plugin-email@6.4.0
  - @objectstack/plugin-hono-server@6.4.0
  - @objectstack/plugin-mcp-server@6.4.0
  - @objectstack/plugin-reports@6.4.0
  - @objectstack/plugin-security@6.4.0
  - @objectstack/plugin-sharing@6.4.0
  - @objectstack/plugin-webhooks@6.4.0
  - @objectstack/rest@6.4.0
  - @objectstack/runtime@6.4.0
  - @objectstack/service-analytics@6.4.0
  - @objectstack/service-automation@6.4.0
  - @objectstack/service-cache@6.4.0
  - @objectstack/service-feed@6.4.0
  - @objectstack/service-job@6.4.0
  - @objectstack/service-package@6.4.0
  - @objectstack/service-queue@6.4.0
  - @objectstack/service-realtime@6.4.0
  - @objectstack/service-settings@6.4.0
  - @objectstack/service-storage@6.4.0

## 6.3.0

### Patch Changes

- Updated dependencies [97efe3b]
  - @objectstack/service-settings@6.3.0
  - @objectstack/spec@6.3.0
  - @objectstack/core@6.3.0
  - @objectstack/client@6.3.0
  - @objectstack/objectql@6.3.0
  - @objectstack/observability@6.3.0
  - @objectstack/runtime@6.3.0
  - @objectstack/rest@6.3.0
  - @objectstack/driver-memory@6.3.0
  - @objectstack/driver-sql@6.3.0
  - @objectstack/driver-turso@6.3.0
  - @objectstack/driver-mongodb@6.3.0
  - @objectstack/driver-sqlite-wasm@6.3.0
  - @objectstack/plugin-approvals@6.3.0
  - @objectstack/plugin-audit@6.3.0
  - @objectstack/plugin-auth@6.3.0
  - @objectstack/plugin-email@6.3.0
  - @objectstack/plugin-hono-server@6.3.0
  - @objectstack/plugin-mcp-server@6.3.0
  - @objectstack/plugin-reports@6.3.0
  - @objectstack/plugin-security@6.3.0
  - @objectstack/plugin-sharing@6.3.0
  - @objectstack/plugin-webhooks@6.3.0
  - @objectstack/service-ai@6.3.0
  - @objectstack/service-analytics@6.3.0
  - @objectstack/service-automation@6.3.0
  - @objectstack/service-cache@6.3.0
  - @objectstack/service-feed@6.3.0
  - @objectstack/service-job@6.3.0
  - @objectstack/service-package@6.3.0
  - @objectstack/service-queue@6.3.0
  - @objectstack/service-realtime@6.3.0
  - @objectstack/service-storage@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
- Updated dependencies [13a4f38]
- Updated dependencies [b4c74a9]
- Updated dependencies [bce47a0]
- Updated dependencies [bce47a0]
- Updated dependencies [449e35d]
- Updated dependencies [dbb54e1]
  - @objectstack/plugin-auth@6.2.0
  - @objectstack/service-ai@6.2.0
  - @objectstack/spec@6.2.0
  - @objectstack/runtime@6.2.0
  - @objectstack/client@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/objectql@6.2.0
  - @objectstack/observability@6.2.0
  - @objectstack/driver-memory@6.2.0
  - @objectstack/driver-mongodb@6.2.0
  - @objectstack/driver-sql@6.2.0
  - @objectstack/driver-sqlite-wasm@6.2.0
  - @objectstack/driver-turso@6.2.0
  - @objectstack/plugin-approvals@6.2.0
  - @objectstack/plugin-audit@6.2.0
  - @objectstack/plugin-email@6.2.0
  - @objectstack/plugin-hono-server@6.2.0
  - @objectstack/plugin-mcp-server@6.2.0
  - @objectstack/plugin-reports@6.2.0
  - @objectstack/plugin-security@6.2.0
  - @objectstack/plugin-sharing@6.2.0
  - @objectstack/plugin-webhooks@6.2.0
  - @objectstack/rest@6.2.0
  - @objectstack/service-analytics@6.2.0
  - @objectstack/service-automation@6.2.0
  - @objectstack/service-cache@6.2.0
  - @objectstack/service-feed@6.2.0
  - @objectstack/service-job@6.2.0
  - @objectstack/service-package@6.2.0
  - @objectstack/service-queue@6.2.0
  - @objectstack/service-realtime@6.2.0
  - @objectstack/service-settings@6.2.0
  - @objectstack/service-storage@6.2.0

## 6.1.1

### Patch Changes

- Updated dependencies [084ee2f]
  - @objectstack/driver-sqlite-wasm@6.1.1
  - @objectstack/runtime@6.1.1
  - @objectstack/spec@6.1.1
  - @objectstack/core@6.1.1
  - @objectstack/client@6.1.1
  - @objectstack/objectql@6.1.1
  - @objectstack/observability@6.1.1
  - @objectstack/rest@6.1.1
  - @objectstack/driver-memory@6.1.1
  - @objectstack/driver-sql@6.1.1
  - @objectstack/driver-turso@6.1.1
  - @objectstack/driver-mongodb@6.1.1
  - @objectstack/plugin-approvals@6.1.1
  - @objectstack/plugin-audit@6.1.1
  - @objectstack/plugin-auth@6.1.1
  - @objectstack/plugin-email@6.1.1
  - @objectstack/plugin-hono-server@6.1.1
  - @objectstack/plugin-mcp-server@6.1.1
  - @objectstack/plugin-reports@6.1.1
  - @objectstack/plugin-security@6.1.1
  - @objectstack/plugin-sharing@6.1.1
  - @objectstack/plugin-webhooks@6.1.1
  - @objectstack/service-ai@6.1.1
  - @objectstack/service-analytics@6.1.1
  - @objectstack/service-automation@6.1.1
  - @objectstack/service-cache@6.1.1
  - @objectstack/service-feed@6.1.1
  - @objectstack/service-job@6.1.1
  - @objectstack/service-package@6.1.1
  - @objectstack/service-queue@6.1.1
  - @objectstack/service-realtime@6.1.1
  - @objectstack/service-settings@6.1.1
  - @objectstack/service-storage@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/service-ai@6.1.0
  - @objectstack/spec@6.1.0
  - @objectstack/client@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/objectql@6.1.0
  - @objectstack/observability@6.1.0
  - @objectstack/driver-memory@6.1.0
  - @objectstack/driver-mongodb@6.1.0
  - @objectstack/driver-sql@6.1.0
  - @objectstack/driver-sqlite-wasm@5.2.2
  - @objectstack/driver-turso@6.1.0
  - @objectstack/plugin-approvals@6.1.0
  - @objectstack/plugin-audit@6.1.0
  - @objectstack/plugin-auth@6.1.0
  - @objectstack/plugin-email@6.1.0
  - @objectstack/plugin-hono-server@6.1.0
  - @objectstack/plugin-mcp-server@6.1.0
  - @objectstack/plugin-reports@6.1.0
  - @objectstack/plugin-security@6.1.0
  - @objectstack/plugin-sharing@6.1.0
  - @objectstack/plugin-webhooks@6.1.0
  - @objectstack/rest@6.1.0
  - @objectstack/runtime@6.1.0
  - @objectstack/service-analytics@6.1.0
  - @objectstack/service-automation@6.1.0
  - @objectstack/service-cache@6.1.0
  - @objectstack/service-feed@6.1.0
  - @objectstack/service-job@6.1.0
  - @objectstack/service-package@6.1.0
  - @objectstack/service-queue@6.1.0
  - @objectstack/service-realtime@6.1.0
  - @objectstack/service-settings@6.1.0
  - @objectstack/service-storage@6.1.0

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
  - @objectstack/service-ai@6.0.0
  - @objectstack/runtime@6.0.0
  - @objectstack/rest@6.0.0
  - @objectstack/client@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0
  - @objectstack/observability@6.0.0
  - @objectstack/driver-memory@6.0.0
  - @objectstack/driver-mongodb@6.0.0
  - @objectstack/driver-sql@6.0.0
  - @objectstack/driver-sqlite-wasm@5.2.1
  - @objectstack/driver-turso@6.0.0
  - @objectstack/plugin-approvals@6.0.0
  - @objectstack/plugin-audit@6.0.0
  - @objectstack/plugin-auth@6.0.0
  - @objectstack/plugin-email@6.0.0
  - @objectstack/plugin-hono-server@6.0.0
  - @objectstack/plugin-mcp-server@6.0.0
  - @objectstack/plugin-reports@6.0.0
  - @objectstack/plugin-security@6.0.0
  - @objectstack/plugin-sharing@6.0.0
  - @objectstack/plugin-webhooks@6.0.0
  - @objectstack/service-analytics@6.0.0
  - @objectstack/service-automation@6.0.0
  - @objectstack/service-cache@6.0.0
  - @objectstack/service-feed@6.0.0
  - @objectstack/service-job@6.0.0
  - @objectstack/service-package@6.0.0
  - @objectstack/service-queue@6.0.0
  - @objectstack/service-realtime@6.0.0
  - @objectstack/service-settings@6.0.0
  - @objectstack/service-storage@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/plugin-approvals@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/runtime@5.2.0
  - @objectstack/plugin-security@5.2.0
  - @objectstack/plugin-hono-server@5.2.0
  - @objectstack/rest@5.2.0
  - @objectstack/plugin-audit@5.2.0
  - @objectstack/plugin-auth@5.2.0
  - @objectstack/plugin-email@5.2.0
  - @objectstack/plugin-reports@5.2.0
  - @objectstack/plugin-sharing@5.2.0
  - @objectstack/plugin-webhooks@5.2.0
  - @objectstack/service-ai@5.2.0
  - @objectstack/service-job@5.2.0
  - @objectstack/service-queue@5.2.0
  - @objectstack/service-realtime@5.2.0
  - @objectstack/service-settings@5.2.0
  - @objectstack/client@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/objectql@5.2.0
  - @objectstack/observability@5.2.0
  - @objectstack/driver-memory@5.2.0
  - @objectstack/driver-mongodb@5.2.0
  - @objectstack/driver-sql@5.2.0
  - @objectstack/driver-turso@5.2.0
  - @objectstack/plugin-mcp-server@5.2.0
  - @objectstack/service-analytics@5.2.0
  - @objectstack/service-automation@5.2.0
  - @objectstack/service-cache@5.2.0
  - @objectstack/service-feed@5.2.0
  - @objectstack/service-package@5.2.0
  - @objectstack/service-storage@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/objectql@5.1.0
  - @objectstack/client@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/driver-memory@5.1.0
  - @objectstack/driver-mongodb@5.1.0
  - @objectstack/driver-sql@5.1.0
  - @objectstack/driver-turso@5.1.0
  - @objectstack/plugin-approvals@5.1.0
  - @objectstack/plugin-audit@5.1.0
  - @objectstack/plugin-auth@5.1.0
  - @objectstack/plugin-email@5.1.0
  - @objectstack/plugin-hono-server@5.1.0
  - @objectstack/plugin-mcp-server@5.1.0
  - @objectstack/plugin-reports@5.1.0
  - @objectstack/plugin-security@5.1.0
  - @objectstack/plugin-sharing@5.1.0
  - @objectstack/rest@5.1.0
  - @objectstack/runtime@5.1.0
  - @objectstack/service-ai@5.1.0
  - @objectstack/service-analytics@5.1.0
  - @objectstack/service-automation@5.1.0
  - @objectstack/service-cache@5.1.0
  - @objectstack/service-feed@5.1.0
  - @objectstack/service-job@5.1.0
  - @objectstack/service-package@5.1.0
  - @objectstack/service-queue@5.1.0
  - @objectstack/service-realtime@5.1.0
  - @objectstack/service-settings@5.1.0
  - @objectstack/service-storage@5.1.0

## 5.0.0

### Patch Changes

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

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/client@5.0.0
  - @objectstack/plugin-sharing@5.0.0
  - @objectstack/plugin-approvals@5.0.0
  - @objectstack/plugin-audit@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-email@5.0.0
  - @objectstack/plugin-reports@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/service-ai@5.0.0
  - @objectstack/service-job@5.0.0
  - @objectstack/service-queue@5.0.0
  - @objectstack/service-realtime@5.0.0
  - @objectstack/service-settings@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-memory@5.0.0
  - @objectstack/driver-mongodb@5.0.0
  - @objectstack/driver-sql@5.0.0
  - @objectstack/driver-turso@5.0.0
  - @objectstack/plugin-hono-server@5.0.0
  - @objectstack/plugin-mcp-server@5.0.0
  - @objectstack/service-analytics@5.0.0
  - @objectstack/service-automation@5.0.0
  - @objectstack/service-cache@5.0.0
  - @objectstack/service-feed@5.0.0
  - @objectstack/service-package@5.0.0
  - @objectstack/service-storage@5.0.0

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
  - @objectstack/objectql@4.2.0
  - @objectstack/rest@4.2.0
  - @objectstack/client@4.2.0
  - @objectstack/runtime@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/driver-memory@4.2.0
  - @objectstack/driver-mongodb@4.2.0
  - @objectstack/driver-sql@4.2.0
  - @objectstack/driver-turso@4.2.0
  - @objectstack/plugin-approvals@4.2.0
  - @objectstack/plugin-audit@4.2.0
  - @objectstack/plugin-auth@4.2.0
  - @objectstack/plugin-email@4.2.0
  - @objectstack/plugin-hono-server@4.2.0
  - @objectstack/plugin-mcp-server@4.2.0
  - @objectstack/plugin-reports@4.2.0
  - @objectstack/plugin-security@4.2.0
  - @objectstack/plugin-sharing@4.2.0
  - @objectstack/service-ai@4.2.0
  - @objectstack/service-analytics@4.2.0
  - @objectstack/service-automation@4.2.0
  - @objectstack/service-cache@4.2.0
  - @objectstack/service-feed@4.2.0
  - @objectstack/service-job@4.2.0
  - @objectstack/service-package@4.2.0
  - @objectstack/service-queue@4.2.0
  - @objectstack/service-realtime@4.2.0
  - @objectstack/service-settings@4.2.0
  - @objectstack/service-storage@4.2.0

## 4.1.1

### Patch Changes

- Updated dependencies [5326c6b]
  - @objectstack/client@4.1.1
  - @objectstack/spec@4.1.1
  - @objectstack/core@4.1.1
  - @objectstack/objectql@4.1.1
  - @objectstack/runtime@4.1.1
  - @objectstack/rest@4.1.1
  - @objectstack/driver-memory@4.1.1
  - @objectstack/driver-sql@4.1.1
  - @objectstack/driver-turso@4.1.1
  - @objectstack/driver-mongodb@4.1.1
  - @objectstack/plugin-approvals@4.1.1
  - @objectstack/plugin-audit@4.1.1
  - @objectstack/plugin-auth@4.1.1
  - @objectstack/plugin-email@4.1.1
  - @objectstack/plugin-hono-server@4.1.1
  - @objectstack/plugin-mcp-server@4.1.1
  - @objectstack/plugin-reports@4.1.1
  - @objectstack/plugin-security@4.1.1
  - @objectstack/plugin-sharing@4.1.1
  - @objectstack/service-ai@4.1.1
  - @objectstack/service-analytics@4.1.1
  - @objectstack/service-automation@4.1.1
  - @objectstack/service-cache@4.1.1
  - @objectstack/service-feed@4.1.1
  - @objectstack/service-job@4.1.1
  - @objectstack/service-package@4.1.1
  - @objectstack/service-queue@4.1.1
  - @objectstack/service-realtime@4.1.1
  - @objectstack/service-settings@4.1.1
  - @objectstack/service-storage@4.1.1

## 4.1.0

### Minor Changes

- 96fb108: Artifact-first boot: `objectstack start` (and `objectstack serve`) now boot directly from a compiled `dist/objectstack.json` when no `objectstack.config.ts` is present.

  - `@objectstack/runtime` exports `createDefaultHostConfig()` and `resolveDefaultArtifactPath()` — a standalone-only default host that wraps `createStandaloneStack()` and surfaces the artifact's `requires` / `objects` / `manifest`. No dependency on `@objectstack/service-cloud`.
  - `objectstack start` accepts `OS_ARTIFACT_PATH` as a file path **or** an `http(s)://` URL. New flags `--artifact`, `--database`, `--database-driver`, `--database-auth-token`, `--auth-secret`, `--project-id`, `--port` let you specify all runtime conditions on the command line (each overrides the matching env var).
  - `objectstack dev` accepts the same runtime-override flags. When `--artifact` is supplied, the auto-compile step is skipped and the dev server boots the supplied artifact directly — no `objectstack.config.ts` required in cwd.
  - `objectstack start` no longer mounts Studio / Account / Console by default — those are dev/admin surfaces. Pass `--ui` to opt back in.
  - `objectstack serve` falls back to the default host config when the config file is missing but an artifact is resolvable.
  - `apps/objectos` (cloud / multi-project) is unchanged.

- 8cbc768: CLI no longer hard-depends on `@objectstack/service-cloud`. The control plane
  (`apps/cloud` + `@objectstack/service-cloud`) and tenant runtime (`apps/objectos`)
  have been split into a private companion repo `objectstack-ai/cloud`. Framework
  remains pure open-core.

  User impact:

  - `os serve --mode=cloud` keeps working in cloud-aware distributions — the CLI
    loads `@objectstack/service-cloud` via dynamic `import()` with try/catch and
    surfaces a clear "install the cloud distribution" hint when absent.
  - Root `pnpm dev` / `pnpm start` / `pnpm doctor` scripts in this repo are
    removed (they were thin filters of `@objectstack/objectos`, which no longer
    lives here). For a runnable local stack, use one of the examples
    (`pnpm --filter @example/app-crm dev`).

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [96fb108]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [70db902]
- Updated dependencies [70db902]
- Updated dependencies [d3b455f]
- Updated dependencies [0cc0374]
- Updated dependencies [5b878d9]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/runtime@4.1.0
  - @objectstack/driver-sql@4.1.0
  - @objectstack/objectql@4.1.0
  - @objectstack/plugin-security@4.1.0
  - @objectstack/client@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/driver-memory@4.1.0
  - @objectstack/driver-mongodb@4.1.0
  - @objectstack/driver-turso@4.1.0
  - @objectstack/plugin-approvals@4.0.1
  - @objectstack/plugin-audit@4.1.0
  - @objectstack/plugin-auth@4.1.0
  - @objectstack/plugin-email@4.0.1
  - @objectstack/plugin-hono-server@4.1.0
  - @objectstack/plugin-mcp-server@4.1.0
  - @objectstack/plugin-reports@4.0.1
  - @objectstack/plugin-sharing@4.0.1
  - @objectstack/rest@4.1.0
  - @objectstack/service-ai@4.1.0
  - @objectstack/service-analytics@4.1.0
  - @objectstack/service-automation@4.1.0
  - @objectstack/service-cache@4.1.0
  - @objectstack/service-feed@4.1.0
  - @objectstack/service-job@4.1.0
  - @objectstack/service-package@4.1.0
  - @objectstack/service-queue@4.1.0
  - @objectstack/service-realtime@4.1.0
  - @objectstack/service-settings@0.1.1
  - @objectstack/service-storage@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/client@4.0.5
  - @objectstack/objectql@4.0.5
  - @objectstack/runtime@4.0.5
  - @objectstack/rest@4.0.5
  - @objectstack/driver-memory@4.0.5
  - @objectstack/driver-sql@4.0.5
  - @objectstack/driver-turso@4.0.5
  - @objectstack/driver-mongodb@4.0.5
  - @objectstack/plugin-audit@4.0.5
  - @objectstack/plugin-auth@4.0.5
  - @objectstack/plugin-hono-server@4.0.5
  - @objectstack/plugin-security@4.0.5
  - @objectstack/plugin-mcp-server@4.0.5
  - @objectstack/service-automation@4.0.5
  - @objectstack/service-analytics@4.0.5
  - @objectstack/service-cache@4.0.5
  - @objectstack/service-feed@4.0.5
  - @objectstack/service-job@4.0.5
  - @objectstack/service-queue@4.0.5
  - @objectstack/service-realtime@4.0.5
  - @objectstack/service-ai@4.0.5
  - @objectstack/service-storage@4.0.5
  - @objectstack/service-cloud@4.0.5
  - @objectstack/service-package@4.0.5

## Unreleased

### Patch Changes

- `createStudioStaticPlugin` simplified now that the Studio is always built with
  `base: '/_studio/'`: asset URLs in `index.html` are already absolute and
  correct, so the HTML is served verbatim (no `href="/..."` rewriting, no
  runtime basepath script injection). Single source of truth for the mount
  path: Vite `base`.

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/client@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/plugin-hono-server@4.0.4
  - @objectstack/plugin-setup@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/runtime@4.0.4
  - @objectstack/service-ai@4.0.4

## 4.0.3

### Patch Changes

- Updated dependencies [ee39bff]
  - @objectstack/service-ai@4.0.3
  - @objectstack/spec@4.0.3
  - @objectstack/core@4.0.3
  - @objectstack/client@4.0.3
  - @objectstack/objectql@4.0.3
  - @objectstack/runtime@4.0.3
  - @objectstack/rest@4.0.3
  - @objectstack/driver-memory@4.0.3
  - @objectstack/plugin-hono-server@4.0.3
  - @objectstack/plugin-setup@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/plugin-hono-server@4.0.2
  - @objectstack/driver-memory@4.0.2
  - @objectstack/service-ai@4.0.2
  - @objectstack/client@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/plugin-setup@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/runtime@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/driver-memory@4.0.0
  - @objectstack/plugin-hono-server@4.0.0
  - @objectstack/rest@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/objectql@3.3.1
- @objectstack/runtime@3.3.1
- @objectstack/rest@3.3.1
- @objectstack/driver-memory@3.3.1
- @objectstack/plugin-hono-server@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/objectql@3.3.0
- @objectstack/runtime@3.3.0
- @objectstack/rest@3.3.0
- @objectstack/driver-memory@3.3.0
- @objectstack/plugin-hono-server@3.3.0

## 3.2.9

### Patch Changes

- Updated dependencies [0bc7b0c]
- Updated dependencies [c3065dd]
  - @objectstack/plugin-hono-server@3.2.9
  - @objectstack/objectql@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/rest@3.2.9
  - @objectstack/driver-memory@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/objectql@3.2.8
- @objectstack/runtime@3.2.8
- @objectstack/rest@3.2.8
- @objectstack/driver-memory@3.2.8
- @objectstack/plugin-hono-server@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/objectql@3.2.7
- @objectstack/runtime@3.2.7
- @objectstack/rest@3.2.7
- @objectstack/driver-memory@3.2.7
- @objectstack/plugin-hono-server@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/objectql@3.2.6
- @objectstack/runtime@3.2.6
- @objectstack/rest@3.2.6
- @objectstack/driver-memory@3.2.6
- @objectstack/plugin-hono-server@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/objectql@3.2.5
- @objectstack/runtime@3.2.5
- @objectstack/rest@3.2.5
- @objectstack/driver-memory@3.2.5
- @objectstack/plugin-hono-server@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/objectql@3.2.4
- @objectstack/runtime@3.2.4
- @objectstack/rest@3.2.4
- @objectstack/driver-memory@3.2.4
- @objectstack/plugin-hono-server@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/objectql@3.2.3
- @objectstack/runtime@3.2.3
- @objectstack/rest@3.2.3
- @objectstack/driver-memory@3.2.3
- @objectstack/plugin-hono-server@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/plugin-hono-server@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/plugin-hono-server@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/plugin-hono-server@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/plugin-hono-server@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/plugin-hono-server@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/plugin-hono-server@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/plugin-hono-server@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/plugin-hono-server@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/plugin-hono-server@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/plugin-hono-server@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/plugin-hono-server@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/plugin-hono-server@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/plugin-hono-server@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/rest@3.0.3
  - @objectstack/driver-memory@3.0.3
  - @objectstack/plugin-hono-server@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/plugin-hono-server@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/plugin-hono-server@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/rest@3.0.0
  - @objectstack/driver-memory@3.0.0
  - @objectstack/plugin-hono-server@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/plugin-hono-server@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/runtime@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/objectql@2.0.6
  - @objectstack/runtime@2.0.6
  - @objectstack/rest@2.0.6
  - @objectstack/driver-memory@2.0.6
  - @objectstack/plugin-hono-server@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/objectql@2.0.5
  - @objectstack/driver-memory@2.0.5
  - @objectstack/plugin-hono-server@2.0.5
  - @objectstack/rest@2.0.5
  - @objectstack/runtime@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/objectql@2.0.4
  - @objectstack/runtime@2.0.4
  - @objectstack/rest@2.0.4
  - @objectstack/driver-memory@2.0.4
  - @objectstack/plugin-hono-server@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/objectql@2.0.3
  - @objectstack/runtime@2.0.3
  - @objectstack/rest@2.0.3
  - @objectstack/driver-memory@2.0.3
  - @objectstack/plugin-hono-server@2.0.3

## 2.0.2

### Patch Changes

- 1db8559: chore: exclude generated json-schema from git tracking

  - Add `packages/spec/json-schema/` to `.gitignore` (1277 generated files, 5MB)
  - JSON schema files are still generated during `pnpm build` and included in npm publish via `files` field
  - Fix studio module resolution logic for better compatibility

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/objectql@2.0.2
  - @objectstack/driver-memory@2.0.2
  - @objectstack/plugin-hono-server@2.0.2
  - @objectstack/rest@2.0.2
  - @objectstack/runtime@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/objectql@2.0.1
  - @objectstack/runtime@2.0.1
  - @objectstack/rest@2.0.1
  - @objectstack/driver-memory@2.0.1
  - @objectstack/plugin-hono-server@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/objectql@2.0.0
  - @objectstack/driver-memory@2.0.0
  - @objectstack/plugin-hono-server@2.0.0
  - @objectstack/rest@2.0.0
  - @objectstack/runtime@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/runtime@1.0.12
  - @objectstack/objectql@1.0.12
  - @objectstack/driver-memory@1.0.12
  - @objectstack/plugin-hono-server@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/objectql@1.0.11
- @objectstack/runtime@1.0.11
- @objectstack/driver-memory@1.0.11
- @objectstack/plugin-hono-server@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/objectql@1.0.10
  - @objectstack/driver-memory@1.0.10
  - @objectstack/plugin-hono-server@1.0.10
  - @objectstack/runtime@1.0.10
  - @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [b9f8c68]
  - @objectstack/objectql@1.0.9
  - @objectstack/spec@1.0.9
  - @objectstack/core@1.0.9
  - @objectstack/runtime@1.0.9
  - @objectstack/driver-memory@1.0.9
  - @objectstack/plugin-hono-server@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [8f2a3a2]
  - @objectstack/plugin-hono-server@1.0.8
  - @objectstack/spec@1.0.8
  - @objectstack/core@1.0.8
  - @objectstack/objectql@1.0.8
  - @objectstack/runtime@1.0.8
  - @objectstack/driver-memory@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [ebdf787]
  - @objectstack/runtime@1.0.7
  - @objectstack/plugin-hono-server@1.0.7
  - @objectstack/spec@1.0.7
  - @objectstack/core@1.0.7
  - @objectstack/objectql@1.0.7
  - @objectstack/driver-memory@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/objectql@1.0.6
  - @objectstack/driver-memory@1.0.6
  - @objectstack/plugin-hono-server@1.0.6
  - @objectstack/runtime@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [b1d24bd]
- Updated dependencies [877b864]
  - @objectstack/core@1.0.5
  - @objectstack/objectql@1.0.5
  - @objectstack/runtime@1.0.5
  - @objectstack/plugin-hono-server@1.0.5
  - @objectstack/driver-memory@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- 5d13533: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
  - cli: fix race condition in `serve` command by awaiting plugin registration calls (`kernel.use`)
- Updated dependencies [5d13533]
  - @objectstack/plugin-hono-server@1.0.4
  - @objectstack/objectql@1.0.4
  - @objectstack/spec@1.0.4
  - @objectstack/core@1.0.4
  - @objectstack/runtime@1.0.4
  - @objectstack/driver-memory@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
- Updated dependencies [22a48f0]
  - @objectstack/core@1.0.3
  - @objectstack/runtime@1.0.3
  - @objectstack/plugin-hono-server@1.0.3
  - @objectstack/objectql@1.0.3
  - @objectstack/driver-memory@1.0.3
  - @objectstack/spec@1.0.3

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
  - @objectstack/objectql@1.0.2
  - @objectstack/runtime@1.0.2
  - @objectstack/driver-memory@1.0.2
  - @objectstack/plugin-hono-server@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.1
  - @objectstack/spec@1.0.1
  - @objectstack/core@1.0.1
  - @objectstack/objectql@1.0.1
  - @objectstack/driver-memory@1.0.1
  - @objectstack/plugin-hono-server@1.0.1

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
  - @objectstack/runtime@1.0.0
  - @objectstack/objectql@1.0.0
  - @objectstack/driver-memory@1.0.0
  - @objectstack/plugin-hono-server@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/objectql@0.9.2
  - @objectstack/driver-memory@0.9.2
  - @objectstack/plugin-hono-server@0.9.2
  - @objectstack/runtime@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/objectql@0.9.1
  - @objectstack/runtime@0.9.1
  - @objectstack/driver-memory@0.9.1
  - @objectstack/plugin-hono-server@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/plugin-hono-server@0.8.2

## 0.8.1

### Patch Changes

- 254f290: fix: serve command now detects available ports to avoid conflicts
  refactor: update to use Core v0.8.0 API (kernel.use/bootstrap)
  - @objectstack/spec@0.8.1
  - @objectstack/core@0.8.1
  - @objectstack/plugin-hono-server@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/plugin-hono-server@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/plugin-hono-server@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.1

## 0.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.0
