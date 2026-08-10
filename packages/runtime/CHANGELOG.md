# @objectstack/runtime

## 17.0.0-rc.6

### Major Changes

- e2798fa: fix(cli,runtime)!: `os start` and `os migrate` finally read the same driver vocabulary (#6345)

  One environment variable had two answers. Measured on `main` by driving the real
  entry points — `resolveDriverType` + `resolveStorageDefinition` for the `os start`
  side, `resolveStandaloneDatabase` for the `os migrate` side — **10 of 21
  spellings disagreed**:

  ```
  OS_DATABASE_DRIVER=pg OS_DATABASE_URL=postgres://…  os start        → boots
  OS_DATABASE_DRIVER=pg OS_DATABASE_URL=postgres://…  os migrate plan → refused by name
  ```

  `sql`, `wasm`, `wasm-sqlite`, `postgresql`, `pg`, `mysql2`, `mongo`, `mingo`,
  `in-memory` and `libsql` were accepted by the CLI and refused by the standalone
  stack. Both sides were separately correct and separately pinned; the missing test
  was the CROSS-host one, and it now exists
  (`packages/cli/src/utils/driver-vocabulary-parity.test.ts` — the only place that
  can import both).

  **Both hosts now resolve through `@objectstack/spec`'s one driver table.** The
  CLI's hand-written `driverType === 'pg' || driverType === 'postgresql'` chains
  and the standalone stack's canonical-only `z.enum` are both gone; a driver added
  to the spec table appears on both hosts at once, which is the only shape in which
  this fork cannot re-open. The standalone `databaseDriver` CONFIG key accepts the
  same aliases as `OS_DATABASE_DRIVER`, so the fork cannot relocate to inside one
  host either.

  **BREAKING ① — selecting a driver whose database lives elsewhere, without saying
  where, now refuses.** Four kinds have no local default (`postgres`, `mysql`,
  `mongodb`, `turso`), and before this change each side guessed, differently:

  | selection, no URL | `os start` before                                                | `os migrate` before                | now, both     |
  | :---------------- | :--------------------------------------------------------------- | :--------------------------------- | :------------ |
  | `postgres`        | `config.url === undefined` → `pg` connects to ITS localhost:5432 | `file:<state>/data/objectstack.db` | typed refusal |
  | `mysql`           | `config.url === undefined`                                       | `file:…objectstack.db`             | typed refusal |
  | `mongodb`         | invented `mongodb://localhost:27017/objectstack`                 | `file:…objectstack.db`             | typed refusal |
  | `turso`           | typed refusal (#5602)                                            | `file:…objectstack.db`             | typed refusal |

  Eight cells, seven of them wrong in one of two ways: connect the operator to a
  database they never named, or hand a server driver a `file:` DSN and let it fail
  two layers from the cause. `turso` already said the right sentence; this
  generalizes it rather than leaving one kind honest and three guessing. Only the
  FALLBACK rungs are refused — a URL from `--database`, `OS_DATABASE_URL`,
  `DATABASE_URL`, `TURSO_DATABASE_URL` or the project's declared default datasource
  is a statement about where the database is, and is honoured as before, `file:`
  DSN included.

  **BREAKING ② — an explicitly-named unknown driver refuses on the CLI side too.**
  `os dev --database-driver sqlite3` used to fall through to the dev SQLite default
  and boot in silence, while `os migrate` refused the same value by name (#6344
  killed the silent fallback on that side only). `''` (nobody chose) keeps its old
  answer — dev default, `null` in production; a non-empty value can only have come
  from an operator, since URL inference yields a canonical id or `''`. The refusal
  enumerates the spellings that actually work, from the shared table.

  **Widened, not narrowed:** every spelling either host accepted before is accepted
  by both now. `sqlite3` / `better-sqlite3` / `mariadb` / `inmemory` stay out of the
  selection face on both — neither host ever accepted them as a boot selection, and
  converging two hosts is not a licence to widen the flag. They keep resolving a
  config CONTRACT, so a stored `driver: 'sqlite3'` datasource is unaffected.

  **Why `major` on both.** ① and ② each turn a boot that started into a boot that
  refuses. A deployment that really did run postgres on localhost with trust auth,
  or that relied on `mongodb://localhost:27017/objectstack`, was working by
  accident and now gets a message telling it what to set — but it was working, and
  calling that a `patch` because the old behaviour was a bug would let the change
  arrive unannounced in a changelog. The alias widening on its own would be
  `minor`; the refusals are what price this at `major`.

  **Migration.** The stored half of this change is the `mongo` → `mongodb`
  canonical-id rename, which both hosts now resolve through the shared table; it is
  registered as the ADR-0087 D2 conversion `datasource-driver-mongo-to-mongodb`
  and needs no action from anyone — `migrate meta` converges the rows and `mongo`
  stays accepted meanwhile. The two refusals have no stored form and no codemod:
  they prescribe an operator action (set the database URL, or fix the driver
  value) whose correct answer is a fact only the operator has, which is why the
  messages name the variable, show the target shape, and say what booting anyway
  would have cost.

  <!-- adr-0087: registered datasource-driver-mongo-to-mongodb -->

### Minor Changes

- 97b0798: fix(spec,rest,runtime)!: the ADR-0045 publish gate gets its own machine-managed key — `app.hidden` goes back to meaning navigation, and the built-in Account app stops 404ing for every normal user (#4829)

  <!-- adr-0087: registered app-hidden-to-unpublished -->

  **FROM → TO:** nothing to rewrite by hand. `app.hidden` keeps its spelling and its
  authoring contract; the publish gate moves to a new machine-managed key,
  `app._unpublished`, which no author writes. Stored `sys_metadata` app rows carrying
  `hidden: true` are rewritten to `_unpublished: true` by the ADR-0087 conversion
  `app-hidden-to-unpublished` — automatically on every stored-row read, and in place via
  `os migrate meta --stored --apply`.

  ## The defect

  `filterAppForUser` (`@objectstack/rest`) treated `app.hidden` as an access gate:

  ```ts
  if (
    item.hidden === true &&
    !sysPerms.has("studio.access") &&
    !sysPerms.has("setup.access")
  )
    return null;
  ```

  `hidden` does not mean that. Its contract, written in `app.zod.ts` the day the key was
  born alongside the built-in Account app, is navigation presentation: _"Hidden apps stay
  fully routable and permission-checked"_ — keep it out of the App Switcher, surface it from
  the avatar menu, which is exactly how personal-settings apps behave in GitHub Settings,
  the Google account chip and Salesforce Personal Settings.

  So the platform's own `account` app — authored `hidden: true` on purpose — was erased from
  `GET /api/v1/meta/app` for every user without `studio.access` / `setup.access`. Clicking
  the avatar → Profile landed on _"App not available — it may still be publishing"_, and
  password changes, avatar, linked accounts, active sessions and the inbox were all
  unreachable. Any admin saw a completely healthy system, which is why it survived a release
  candidate and shipped a downstream workaround.

  The two contracts arrived from different places. ADR-0045 §3 did not introduce `hidden`; it
  **borrowed** it, citing an "ADR-0019 launcher contract (`hidden`, `active`)" as an existing
  read side. That contract does not exist — **ADR-0019 contains no `hidden`** and never
  discussed launchers, the avatar menu or the Account app. The reference was dangling from
  the day it was written, which is why nothing caught the collision it created: one boolean,
  two contracts, disagreeing on the only question that matters — _may a normal user reach
  this app?_

  ## What changed

  - **`AppSchema` declares `_unpublished`** — the ADR-0045 §3 publish gate. `true` means the
    app is unpublished: externally unobservable, not merely unlisted. It is written by the AI
    additive-materialization path and cleared by `POST /packages/:id/publish-drafts`, and its
    `_` prefix is this repo's existing marker for the channel tooling stamps onto artifacts
    (ADR-0010's `_lock` / `_provenance` envelope; the prefix `lintAuthoredRecordKeys` already
    skips). It is _declared_ rather than omitted because the write path validates against
    this very schema (`saveMetaItem` → 422; `Registry.validate('app', …)` → `AppSchema.parse`),
    so an undeclared key would make the platform's own flip unwritable. The strict door
    answers the author-shaped spellings — `unpublished`, `published`, `draft` — with a
    prescription that says _publish state is not authorable_, rather than routing them onto
    the key.
  - **`app.hidden` is navigation only**, and its docblock now says so with the incident
    attached. Authoring `hidden: true` affects the App Switcher and nothing else.
  - **The REST gate judges `_unpublished`.** A hidden app is served to everyone, with its
    `hidden` flag intact so the shell can place it; an unpublished app still 404s externally
    and still reaches builders for direct-URL preview, and `requiredPermissions` still applies
    to both.
  - **`publish-drafts` clears `_unpublished`** instead of un-hiding. It writes `false` rather
    than deleting the key, because ADR-0045 §3 makes publish/unpublish symmetric, and it
    copies `hidden` through untouched — publishing no longer rewrites a presentation choice
    as a side effect. The response fields keep their `unhiddenApps` / `unhideError` spelling:
    they are a wire contract read by the objectui Publish button, and renaming them from a
    repo that cannot update that consumer would be a silent break of exactly the kind this
    change is about.
  - **ADR-0045 is amended**, its dangling ADR-0019 reference corrected, and both
    implementation sites (`rest-server.ts`, `runtime/domains/packages.ts`) are now anchored in
    `scripts/adr-anchors.json` — neither carried an anchor before, which is why an author
    could change ADR-0045's §3 without knowing they were changing a decision.

  ## Why a new key rather than deleting the gate

  Taking `hidden` out of the access decision was proposed first and refused. The gate is §3 of
  an **Accepted** ADR with pin tests and a live implementation behind it, so removing it in a
  patch would reverse a recorded decision by side effect. It is also the worse failure
  direction: a gate that fails **open** exposes a half-built app to real users, silently.

  ## Migration reach

  The conversion is `retiredFromLoadPath: true`, and here that flag is load-bearing rather
  than bookkeeping — it confines the rewrite to **stored rows**. `hidden` is not retired as an
  authorable key, so a conversion running on the load path would rewrite
  `defineApp({ hidden: true })`, and the Account app itself, into unpublished apps and
  reproduce the defect through the conversion layer. Excluded from the load path, it replays
  only where the old meaning is the only meaning: the stored-row rehydration seams and
  `os migrate meta`. Stored `hidden: true` was unambiguous under the old regime — that value
  _was_ the gate, so nobody stored it to mean "keep me out of the switcher"; code-declared
  apps like `ACCOUNT_APP` never enter `sys_metadata`, and the Studio app form has no `hidden`
  control.

  ## Follow-ups (other repos, filed separately)

  - **cloud** — the AI materialization write point must stamp `_unpublished: true` where it
    stamps `hidden: true` today.
  - **objectui** — the Unpublished banner and the Publish button must read/clear
    `_unpublished`; the App Switcher keeps reading `hidden`, which now means only what it says.
  - **os-project-titanwind-ehr** — PLAT-DEF-040's startup `{hidden:false}` overlay can be
    deleted once this ships.

- 73648ba: feat(rest,runtime): 元数据写入的其余三扇门同样要求 `manage_metadata` 能力 (#7019)

  **这是一次访问面收紧,线上可见。** #6603 只给 `PUT /api/v1/meta/:type/:name`
  一条路由落了 `manage_metadata` 门,而同一个写操作还有另外三扇门没有门。本次
  把它们补齐,用的是**同一道门、同一套机制**(各自照抄所在文件的既有先例):

  - `PUT /api/v1/meta/:type/:section/:name` —— 复合名保存(`@objectstack/rest`);
  - `DELETE /api/v1/meta/:type/:name` —— 重置为构件默认值(`@objectstack/rest`);
  - 运行时 dispatcher 自己的 `/meta` PUT —— 同一操作的**第二条传输**(`@objectstack/runtime`)。

  ## 谁开始吃 403,需要什么

  **任何不持 `manage_metadata` 的已认证调用方**,对上述三条路径的写入一律 403
  (匿名调用方仍先吃 `/meta` 伞下的 401,能力门是第二层)。`isSystem`(引擎自调)
  照例放行。平台自带的 `admin_full_access` 权限集本就带 `manage_metadata`,所以
  Studio / Setup 里的管理员与 CLI 的 dev admin **不受影响**;受影响的是自建集成、
  自建权限集,以及只持 `setup.access` 的 `organization_admin`。

  **要恢复写入:给该调用方的权限集加上 `manage_metadata`**(Setup →
  Permission Sets → `systemPermissions`),而不是绕过这些路由。

  ## 为什么必须收紧

  两条**各自独立成立**的理由:

  1. **ADR-0106 的读写不对称。** D1 会把调用方不可读的字段**整个**从服务出的对象
     schema 里摘掉,而这些路由原样持久化收到的 body。#6603 落地后**实测**:同一次
     GET → 改个 label → PUT 的字段丢失,经复合名这扇门可原样复现 —— 缺陷没有被修复,
     只是换了一扇门。本次复测的前后对照:

     ```
     加门前: compound PUT status : 200 | saveMetaItem calls : 1 | STORE after PUT : id, name
     加门后: compound PUT status : 403 | saveMetaItem calls : 0 | STORE after PUT : bonus_formula, id, name, salary_grade
     ```

  2. **一个与掩码无关、更早就存在的洞:** 任何已认证会话都能覆写(或重置)任意
     元数据项。`DELETE` 这条尤其是这个理由而**不是**掩码理由 —— 它不往返、不掩码,
     只是把定制覆盖层整个丢掉,`?dropStorage=true` 还会连对象的物理表一起拆掉。

  三处门都落在解析 protocol **之前**,所以未授权调用方无法用 501-vs-200 指纹探测
  内核能力,且拒绝时**什么都没写、什么都没删**。

  ## 不在本次范围

  只收紧写入面;读路径的姿态(ADR-0106 掩码)不变。#7020 记录的「门要求的能力集
  与 D4 掩码豁免集不是同一个集合」仍然成立,本次不替维护者选对齐方向。

- a954634: feat(meta): object schemas served by `/meta` and `/metadata` are masked per caller (ADR-0106, #3682)

  The data plane has enforced field-level security everywhere it matters for
  several releases — list reads mask values, exports project columns, and the
  write path 403s forbidden fields. The **metadata** plane did not: any
  authenticated caller who asked `GET /meta/object/:name` received the full object
  schema, including fields they have no read access to at all.

  That is more than a list of names. A field carries its label, type, **picklist
  option values** (often a sensitive operational taxonomy), its **formula**
  expression (pricing and scoring IP), its `visibleWhen` predicate, its
  `defaultValue`, and — via ADR-0066 D3 — the `requiredPermissions` capability
  names guarding it. For a customer running a dealer, supplier or patient portal
  on ObjectStack, the only remediation available in their own tier was modelling
  discipline: keep sensitive fields off portal-visible objects, or split one
  business entity into an internal object and a portal object and synchronize
  them. This is a platform-side fix, so every deployment inherits it.

  **What changes.** Serving an object schema now projects `fields` onto the set
  the caller may read, and a field outside that set is removed **whole** — no
  name, no label, no options, no formula, no `requiredPermissions`. Partial
  redaction was rejected: keeping the name still leaks existence and invites
  clients to render ghost columns. Masking keys on the `readable` bit only; a
  readable-but-not-editable field stays in the schema, because the UI must render
  it and the `editable` affordance is already served per caller by
  `/auth/me/permissions`.

  Every outlet that serves an object schema goes through one shared projection,
  so coverage is not a per-route promise:

  - `GET /meta/object/:name` — the cached branch (the default) **and** the
    uncached branch, which is what `?state=draft`, `?preview=draft` and
    `?package=` take;
  - `GET /meta/object/:name?layers=true` — the layered diagnostic view, all three
    of `code` / `overlay` / `effective`;
  - `GET /meta/:type/:section/:name` — the compound-name read;
  - `GET /meta/object` — the list read, each item projected independently;
  - the runtime `/metadata` catch-all — the protocol-backed, registry-backed and
    last-ditch single reads, the `/metadata/objects` list (protocol and registry),
    and the legacy one-segment `/metadata/:objectName` spelling.

  **Caching is unchanged in cost and correct per cohort.** The shared metadata
  cache still stores one full schema per (type, name, locale, environment) — no
  caller dimension in the key — and the mask runs after retrieval. What varies
  per caller is the validator: a stable hash of the caller's _denied_ field set is
  folded into the ETag. A caller who can read everything denies nothing, so their
  fingerprint is empty and both their ETag and their response body are
  **byte-identical** to previous releases. Callers in one permission cohort share
  `304`s; a permission change moves the fingerprint and self-invalidates the stale
  `304`, so nothing needs purging after a permission-set edit.

  **Exemptions** are a property of the caller, not of the route: `isSystem` and
  platform-admin callers (holders of `studio.access` / `setup.access`, the same
  judgement the app filter uses) receive the full schema on any route, because
  Studio and Setup authoring cannot work against a projected schema.

  **Failure posture is explicit and three-tiered.** With no `security` service
  registered the schema is served unmasked — that deployment has no FLS posture at
  all and tightening only the metadata plane would be theater. When field
  visibility cannot be _determined_ (a registry-hydration window), the schema is
  served unmasked but loudly: a structured warning, a new
  `objectstack_meta_field_visibility_undetermined_total` counter, and a response
  downgraded to `Cache-Control: private, no-store` with no shared ETag. Failing
  closed there would brick every render of the object for every user and can
  deadlock console bootstrap, since permission sets are themselves metadata. When
  permission evaluation **throws**, the request fails with `503
FIELD_VISIBILITY_UNRESOLVED` — an unhealthy security service must not auto-open
  a disclosure hole, and an empty-fields `200` would be both a silently wrong UI
  and cacheable poison.

  **Guest and public deployments** get a deliberate posture rather than an
  accidental one: `@objectstack/plugin-security` gains
  `getMetadataReadableFields`, which resolves the configured fallback permission
  set (`security.fallbackPermissionSet`, default `member_default`) for a caller
  who resolves to zero sets, exactly as `/auth/me/permissions` does.
  `getReadableFields` is unchanged — on the data plane, mirroring the engine
  middleware's fall-open is what keeps it drift-free.

  **Escape hatch.** Masking is the platform default. A deployment that explicitly
  wants an unmasked metadata plane sets `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`, or
  `metadata.maskObjectFields: false` on the REST server. Toggling it changes
  disclosure only: the console reads every field affordance from
  `/auth/me/permissions`, so UI correctness is unaffected either way.

  Operators fronting the runtime with a CDN or reverse proxy should read the new
  "CDN / reverse-proxy caching of `/meta` object schemas" section in the
  production-readiness guide before tuning anything — in particular, do not
  configure a proxy to ignore `Cache-Control: private`, and do not strip or
  rewrite `ETag` on these routes.

- b295e4b: feat(runtime,rest): `/packages` 域补齐授权门 —— 写/破坏性路由要求 `manage_metadata`,读路由要求 D4 读集,全域匿名门 (#7033) (#7023)

  `/packages` 是最后一个零授权判据的路由域:普查实测一个连 `userId` 都没有(身份解析为
  `principalKind: 'guest'`)的调用方,对**破坏性**的 `POST /:id/discard-drafts`、整包
  `GET /:id/export`(27 种 metadata)、`GET /packages`(id 枚举面)与 `POST /:id/publish-drafts`
  一律得 **200** 并真的调进目标函数;而隔壁五个同族域(`/meta`、`/actions`、`/automation`、
  `/ai`、`/security`)都带 `shouldDenyAnonymous` 匿名门。本次按维护者 2026-08-09 裁定补齐:

  - **全域匿名门**:`shouldDenyAnonymous` 作为 `handlePackagesRequest` 的**第一条语句**,
    在 ObjectQL registry 探测之前,使匿名调用方拿不到 401-vs-503 的部署指纹。
  - **写 / 破坏性路由**(install / enable / disable / publish / publish-drafts /
    discard-drafts / commit-revert / rollback / revert / adopt-orphans / duplicate /
    manifest-PATCH / DELETE)要求 `manage_metadata` —— 与 #6603 / #7019 给 `/meta` 写面
    落的同一道门、同一判据(「能写 schema 的人就该是能管理 package 的人」)。
  - **读路由**(list / detail / commits / export)要求 ADR-0106 D4 读集
    `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES`(`studio.access` / `setup.access`)—— **引用
    该常量,不复制**,使 package 读取的能力集不会与 metadata 掩码豁免集漂移。
  - 门覆盖**两个 transport**:runtime dispatcher 域(`domains/packages.ts`)**与**
    `@objectstack/rest` 直挂注册器(`package-routes.ts` 的 `refusePackageRequest`,
    经 `RestServer.resolvePackageRouteExecutionContext` 解析与其余表面同一身份)。缺
    resolver 时 REST 侧**失败即关**(401),不留裸露回退。所有门都在协议/服务解析**之前**
    判,拒绝时不写不删(防「先删后拒」)。`isSystem`(不可从线上伪造)旁路,CORS `OPTIONS` 放行。

  **盲区(明说,勿当已核):** `cloud` 仓在本会话与前序普查会话中**均未挂载**(`add_repo`
  两次被拒),调用方普查**不覆盖该仓**。若 `cloud` 内存在直打 `/api/v1/packages/*` 或
  dispatcher `/packages` 且今天不持 `manage_metadata` / D4 读集的生产调用方,本门可能将其
  403 —— 落地后需在 `cloud` 补一次调用方普查复核。`#7020` 记录的「门能力集 ≠ D4 掩码豁免集」
  对齐方向仍归维护者,本次不动。

- 0996899: fix(runtime): a `/share-links` permission denial answers 403, not 500 (#6649)

  The dispatcher's `/share-links` domain ended in a hand-written catch that read
  one status channel:

  ```
  return sendErr(err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? '…');
  ```

  Every refusal `ShareLinkService` raises itself carries `status` (its `makeError`
  sets `status` + `code`), which is why the 403 `FORBIDDEN` and 422
  `SHARING_NOT_ENABLED` answers were always correct. But the refusals that come
  out of the **security middleware** do not come from that service. Creating a
  link performs a visibility read — `svc.createLink` calls
  `engine.find(object, { context })` — and when the caller's permission sets grant
  no `allowRead` on the object, the CRUD gate throws
  `PermissionDeniedError { code = 'PERMISSION_DENIED'; statusCode = 403 }`, a class
  with **no `status` field at all** (`plugin-security/src/errors.ts`; runtime's own
  mirror in `security/resolve-execution-context.ts` has the same shape).
  `ShareLinkService` does not catch it, so it reached the domain catch, `err?.status`
  was `undefined`, and a 403-class refusal left as **HTTP 500** while `error.code`
  faithfully read `PERMISSION_DENIED`.

  That envelope contradicted itself, and the contradiction is load-bearing on the
  client: 5xx is retryable to many SDKs and browser clients, so a permanent
  authorization answer was being retried, and a caller branching on the status saw
  "the server is broken" where the truth was "you may not read this record". It is
  reproducible on either tenancy posture, and — because `registerShareLinkRoutes:
false` makes this domain the ONLY share-link surface on cloud's per-environment
  kernels — it is the primary surface there, not a fallback one.

  The catch now exits through `deps.errorFromThrown`, the dispatcher's shared
  thrown-error mapper that `/meta`, `/actions` and `/mcp` already use. It reads
  `status` **or** `statusCode`, and it carries a thrown error's structured
  `issues` / `fields` details through instead of collapsing them to a message.
  Reaching for the shared mapper — rather than widening the hand-written chain to
  `err?.status ?? err?.statusCode ?? 500` — is the part that stops this exit
  re-diverging: a second hand-written copy is how the two drifted apart in the
  first place.

  Two wire-visible consequences, both corrections:

  - A permission denial on `POST` / `GET` / `DELETE /share-links` answers **403
    `PERMISSION_DENIED`** where it answered 500 `PERMISSION_DENIED`. Clients
    treating 5xx as retryable stop retrying a permanent refusal.
  - A throw carrying neither status channel nor a code answers **500
    `INTERNAL_ERROR`** where it answered 500 `INTERNAL`. `'INTERNAL'` was never
    registered for `@objectstack/runtime` in `ERROR_CODE_LEDGER` (only `rest`,
    `service-storage`, `service-i18n` and `plugin-sharing` register it, and the
    ledger's per-package rows are provenance) — so this domain was emitting a code
    it had not registered, and the required field is now filled by the catalogued
    derivation every other dispatcher exit uses (ADR-0112).

  Refusals that already carried `status` are untouched: the mapper reads that
  channel on the same first branch the old chain did.

- cca11e9: **`createStandaloneStack` now dispatches `libsql://` / Turso URLs** instead of refusing them as an unsupported scheme (#5820).

  `detectDriverFromUrl()` recognised `memory://`, `postgres://`, `mongodb://` and `file:`, and threw on everything else — while `resolveDatabaseUrl()` listed `TURSO_DATABASE_URL` as one of its URL sources. A host that set it got the URL read in and then rejected on the way out. Since the CLI wired `libsql://` for `os serve` / `os start` (#5602), the same `OS_DATABASE_URL=libsql://…` booted under `os start` and failed under `os migrate`, which comes through this stack.

  What changed:

  - `libsql://…` and `http(s)://*.turso.…` resolve to the `turso` driver kind — the same two spellings the CLI classifies, kept identical on purpose.
  - `databaseDriver: 'turso'` (and `OS_DATABASE_DRIVER=turso`) is accepted by the config schema.
  - The driver comes from `@objectstack/driver-turso`, an **optional** install: it drags `@libsql/client` and its native bindings, so it is not a dependency of `@objectstack/runtime`. It is loaded lazily, only for a selection that asks for libSQL, and injected through the driver-factory seam `DefaultDatasourcePlugin` already exposes — so the connect path, the `bootCritical` fail-fast verdict, `OS_ALLOW_DRIVER_CONNECT_FAILURE` and the retained Setup → Datasources status are identical to every other kind.
  - Package missing? The boot fails **loudly**, carrying the exact install command (`npm install @objectstack/driver-turso`) as data as well as prose. There is no SQLite fallback: a silent step-down would open an empty local database while your libSQL data stays untouched, and every write — including an `os migrate` DDL — would land in the wrong place (#3276).
  - `databaseAuthToken` is no longer declared-and-ignored: the `turso` kind reads it, falling back to `OS_DATABASE_AUTH_TOKEN` and then the vendor's own `TURSO_AUTH_TOKEN` — the same precedence `os serve` uses.

  Unknown schemes still throw, and the message now lists `libsql://` among the supported ones.

- cfb549d: **`createStandaloneStack` now dispatches `mysql://`, and an unknown `OS_DATABASE_DRIVER` value is refused instead of silently becoming SQLite** (#6265).

  Two halves of one defect family: a driver selection this stack could not dispatch.

  **`mysql://` — the #5820 split with a different scheme.** The CLI has classified `mysql://` / `mysql2://` as the `mysql` kind since forever (`inferDriverTypeFromUrl`), the shared datasource factory has always been able to build it (`SqlDriver` on the `mysql2` client), and `content/docs/data-modeling/drivers.mdx` lists it in the URL-inference table — only `detectDriverFromUrl()` in this package had no arm. So one `OS_DATABASE_URL=mysql://…` booted under `os start` and hard-failed under `os migrate` (which boots through this stack) with `Unsupported database URL scheme`.

  - `mysql://…` and `mysql2://…` resolve to the `mysql` kind, matched by character-for-character the same regex the CLI uses — the two functions answer the same question about the same URL, so a divergence between them _is_ the bug.
  - The stack declares `{ driver: 'mysql', config: { url } }` and the shared factory builds it, exactly like `postgres`. No optional package and no new dependency: `mysql2` is already an optional peer of `@objectstack/driver-sql`, the same posture `pg` has, so a missing client surfaces at connect like it always did.
  - `databaseDriver: 'mysql'` and `OS_DATABASE_DRIVER=mysql` are accepted; `sqliteFile` stays `null` for a MySQL target, so `os migrate`'s occupancy probe does not read a DSN as a file path.

  **`OS_DATABASE_DRIVER` is validated now.** `databaseDriver` in config was parsed by a zod enum (loud rejection) while the env var was a bare `as` cast — an assertion that checks nothing at runtime. An unrecognised value matched no dispatch arm and landed in the chain's trailing `else`: SQLite, in silence. `OS_DATABASE_DRIVER=mysql` with no URL therefore created a local `standalone.db` while the operator believed they were talking to MySQL, and a typo (`mysq1`, `postgress`) did the same; with a URL set it surfaced as the doubly-misleading "sqlite driver was selected but the URL does not look like a file path" for someone who never selected sqlite. This is the #3276 class.

  - Both paths now read **one** declaration (`StandaloneDatabaseDriverSchema`): the config key parses it, the env value parses it, the `ResolvedDriverKind` union is inferred from it, and the refusal enumerates its options rather than repeating them in a hand-written list.
  - An unknown value throws, naming the value and every legal driver: `sqlite, sqlite-wasm, memory, postgres, mysql, mongodb, turso`. The env value is lower-cased first, matching the CLI's reader of the same variable; the accepted vocabulary is the enum and nothing else.
  - The dispatch chain's trailing `else` is no longer "sqlite" — it is a `never` guard, so the _next_ kind added to the enum without a dispatch arm is a compile error rather than a wrong database.

  Unknown URL schemes still throw (the message now lists `mysql://`), and the "unknown driver" and "unknown URL scheme" refusals stay distinguishable.

- bd5fc38: fix(cli,runtime): one shared default-database resolution for `os dev` / `os start` / `os migrate` (#6469)

  Three commands used to resolve three different default databases in the same
  project directory — `os dev` → `.objectstack/data/dev.db`, `os start` →
  `.objectstack/data/objectstack.db`, `os migrate *` →
  `.objectstack/data/standalone.db` — and none consulted the project config.
  Measured harm (hotcrm 17.0.0-rc.5): after `os start` + seed, `os migrate plan`
  opened a fresh empty `standalone.db` it had just created and reported **22
  tables of drift against a healthy database** — the inverted failure direction,
  pointing an operator at rolling back a database that was fine.

  Per the maintainer ruling (2026-08-08, archived on #6469), all three commands
  now resolve through **one** shared function
  (`resolveProjectDatabaseUrl`, exported from `@objectstack/runtime`):

  1. explicit `--database` / `--database-url` / programmatic `databaseUrl`;
  2. `OS_DATABASE_URL` / legacy `DATABASE_URL` / vendor `TURSO_DATABASE_URL`;
  3. explicit in-memory driver selection (`--database-driver memory` /
     `OS_DATABASE_DRIVER=memory`) — no file default is imposed;
  4. the datasource the project config declares as its default home (a
     `datasourceMapping` rule `{ default: true, datasource: <name> }` naming a
     declared datasource whose connection is URL-derivable);
  5. the **unified default file `objectstack.db`** under the state dir
     (`OS_HOME` → `<projectRoot>/.objectstack` → `~/.objectstack`).

  **Compatibility — an existing environment never looks like data loss.** When
  the unified `objectstack.db` does not exist but a legacy `dev.db` or
  `standalone.db` does, the command **reads the legacy file** and prints one
  loud line naming exactly which file is being read and the `mv` command that
  converges it on the unified name. No interactive prompt (CI-safe), nothing is
  deleted or renamed automatically, and the probe order
  (`objectstack.db` → `dev.db` → `standalone.db`) is identical across all three
  commands — `dev.db` first among the legacies because it holds real dev data,
  while `standalone.db` is most likely an empty artifact of the very fork this
  fixes. An explicit `OS_DATABASE_URL` pins any file forever, unchanged.

  Also per the ruling: `sqlite://` is now accepted as an alias of `file:` in
  database-URL parsing (`sqlite://…` used to die under `os migrate` with
  `Unsupported database URL scheme`); genuinely unsupported schemes keep their
  precise refusal. Behavioural side effects of unification: `os dev` now honours
  `OS_HOME` / `TURSO_DATABASE_URL` for its default like the other two commands
  already did, `os dev --fresh`'s ephemeral file is named `objectstack.db`, and
  `os db clean` targets the same unified resolution. The #3917
  `sqlite-occupancy` guard's primary scenario (a dev server and `os migrate`
  contending for one file) is now real under default paths — previously the two
  never opened the same file, so the guard could not fire in the very scenario
  its comment described.

  The new cross-command pin (`unified-db-resolution.pin.test.ts`) asserts
  `dev` / `start` / `migrate` resolve the SAME URL for the same project root in
  every fallback state — the test whose absence let the fork live.

### Patch Changes

- 4c5df00: `GET /api/v1/automation/:name/runs` now refuses a malformed query parameter with a
  proper ADR-0112 refusal (`400`, `error.code: VALIDATION_FAILED`, `details.fields[]`
  naming the parameter with an ADR-0114 field code) instead of coercing it into a
  value nobody asked for — the same gate `GET /api/v1/notifications` grew in the
  previous release, now shared between the two routes rather than copied.

  Wire-visible for raw-HTTP callers only — the typed SDK's `limit` is a `number` and
  its `cursor` a `string`, so neither could produce these:

  - `?limit=abc` coerced to `NaN`, which nothing downstream catches: the automation
    engine's `options?.limit ?? 20` does not catch NaN (`??` tests for null/undefined
    only) and its final `.slice(0, NaN)` is `[]`. So a typo in the window answered
    **200 with an empty run list** — "this flow has never run", stated confidently
    about a flow with runs. Non-integers (`1.5`, `Infinity`, `10abc`, a repeated
    `?limit=1&limit=2`) are refused on the same rule.
  - `cursor` was forwarded raw into a slot the contract types `cursor?: string`
    (`IAutomationService.listRuns`), so a repeated `?cursor=a&cursor=b` handed an
    array to a service that had declared it would receive a string. The shipped
    engine ignores the option entirely today, which is why the boundary is the right
    place to close it: the first implementation that starts honouring cursors must
    not be the one that discovers the type was never enforced.

  Unchanged on purpose: every value that already had a defensible answer keeps it,
  byte for byte — out-of-range numbers (`?limit=1000`, `?limit=-5`) still reach the
  engine untouched, because range is its declared business (`ListRunsRequestSchema`
  bounds it and the engine slices by it), absent/empty parameters still mean "no
  limit", any string cursor still passes through verbatim, and unknown query keys are
  still ignored rather than refused.

- f7d80f4: fix(runtime): `callData` no longer has a `batch` arm that answers a silent, empty success (#5856)

  `callData`'s `action === 'batch'` arm returned `{ object, results: [] }` — an
  HTTP 200 whose body a consumer cannot tell apart from "the batch ran and matched
  nothing" — while opening no transaction and writing nothing. It was the only arm
  in that function answering an unimplemented action with **success**: every other
  unhandled action throws `400 Unknown data action: …`, and `aggregate` throws
  `503` when the engine cannot serve it. Retry, idempotency and audit logic all
  read a 200 + empty result set as one successful empty operation.

  Nothing could reach it, and that is the point: its safety lived **upstream**, in
  a route table that happens not to spell `batch`, not in any guard of its own —
  the ADR-0115 Evidence 5 / #4451 shape, where one route-table extension silently
  turns a dormant branch into a live "successfully did nothing". Every entry point
  was enumerated before removal (`/data` compares `parts[1]` against the literal
  `'query'` and otherwise reads it as a record id; the MCP bridge, the actions
  domain and `invokeBusinessAction` pass literals; the declarative endpoint
  executor is bounded by `ApiEndpointSchema.objectParams.operation`, a closed enum
  of find/get/create/update/delete; and `callData` is not part of this package's
  export surface), so the arm is removed under ADR-0049 enforce-or-remove rather
  than converted to a 501 nobody would ever receive.

  **Behaviour on every live path is unchanged** — no reachable request produced
  that response. What changed is the answer waiting for the first caller who ever
  does spell `batch`: a loud `400 Unknown data action: batch`, identical to any
  other unknown action, instead of a silent success. Batching itself is untouched
  and keeps its single owner: `@objectstack/rest`'s `registerBatchEndpoints`
  mounts both `POST /batch` (atomic, cross-object) and `POST /data/:object/batch`
  (per-object, ADR-0119) — which is exactly why a host serving only the
  dispatcher reports `capabilities.transactionalBatch: false` (#5672).

- 121852d: Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

  The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

  **Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.

- 2a2a9fb: fix(spec,metadata-protocol,runtime): one place decides what an unset `NODE_ENV` advertises (#5936)

  A deployment whose operator never exported `NODE_ENV` must not describe itself as
  `development` on `/discovery`: `environment` is a machine-readable field, a client
  reads it to answer "am I talking to production?", and it may skip production warnings
  or loosen a destructive action's confirmation on the answer. #5673 ruled that in and
  fixed it — but only for one of the two producers, because that dispatch put
  `packages/spec` out of scope. The other one, `MetadataProtocol.getDiscovery()` (served
  by `@objectstack/rest`), went on answering `development` for exactly that input.

  The default now lives in the shared mapper, `resolveDiscoveryEnvironment`: an absent —
  or blank — value resolves to `production`, and both producers pass the operator's value
  through as they read it, neither carrying a default of its own. That is what makes it
  one decision instead of two copies, and it means the next discovery producer inherits
  the right answer without anyone remembering to copy a line. Patching only
  metadata-protocol would have left a second copy of the default — precisely the drift the
  shared table was created to prevent (#4828).

  "Unset" includes a blank value: `NODE_ENV=` exports an empty string, the runtime's
  `getEnv` has always folded that into its default, and had the mapper treated blank as
  "anything else" the two producers would have drifted again on that one input.

  **#4828's rule is untouched, and it points the other way on purpose.** A value that IS
  set but is not a spelling this repo recognises (`qa`, `preview`) still degrades to
  `development`, so nothing ever claims `production` on a guess. Absence is not a guess —
  it is the host declining to say.

  Behaviour change to expect: a host that exports no `NODE_ENV` and serves `/discovery`
  through `@objectstack/rest` now advertises `environment: "production"` where it
  previously advertised `"development"`. A deployment that genuinely is development should
  say so — `NODE_ENV=development` — which is what the runtime dispatcher has already
  required since #5673.

  The mapping table above `NODE_ENV_TO_DISCOVERY_ENVIRONMENT` is corrected in the same
  pass: its `unset / anything else -> development` row had been false for the runtime
  caller since #5673 and is now two rows, one per rule.

- 86e6f6c: docs(runtime): `errorResponseBase` 文件头不再把 `details.code` 说成线上位置 (#6270)

  **纯注释改动，零行为变更。** 没有一行运行时代码被触碰，线上响应体与本次改动前逐字节相同。修的是
  `packages/runtime/src/dispatcher-plugin.ts` 文件头里一句会误导下一个改这个函数的人的话。

  原文说：`details.code`（#3842, below）carries `READ_SCOPE_COMPILE_FAILED` **to the
  client** untouched，so **what a machine reads** is unchanged。这两个断言讲的都是**线上位置**，
  而 #5811 之后线上位置不是 `details.code`：`errorResponseBase` 只是把 code **暂存**进一个本地
  `details` 对象，`buildApiError` 随即跑 `splitSemanticCode`，把它**提升**进 `ApiErrorSchema`
  声明的 `error.code` 字段，并把已经空掉的 `details` 返回为 `undefined` —— 于是 `details` 键整个
  从 body 中消失，`error.details.code` 根本不存在可读。实测 500 body 就是：

  `{"success":false,"error":{"code":"READ_SCOPE_COMPILE_FAILED","message":"Internal server error","httpStatus":500}}`

  这是同一句话漂移的**第四处**。#6123（PR #6264）修了前三处，并明文把 `dispatcher-plugin.ts` 划为
  ⛔ 只读参考面，所以第四处按 PD #10 单独立单。措辞刻意与 #6264 在另外三处落的保持一致 —— 这里的价值是
  四处同一句话，而不是第四种独立说法。

  危害方向比前三处更陡：前三处的受害者是读 CHANGELOG / 读 `service-analytics` 的人，这一处的受害者
  **就站在做暂存的那个函数里**，读到「details.code carries it to the client」会直接把**本地变量名**
  当成**线上契约**。注释里因此明写了一句 `Do not mistake the local variable name for the wire contract`。

  顺带把同一 doc block 里 `:452`-`:457` 那段 JSON 示例的时态钉明确：它展示的是 #5811 **修复之前**的
  泄漏形态（message 原文直接落在 body 里），与新补的当前 body 并排读极易混淆。现在 fence 顶部有一行
  `⚠️ PAST TENSE` 标注并指向 doc block 末尾的当前形态。示例本身**没有删** —— 它记录的是「我们曾经
  泄漏过什么」，是这条 `[#5811]` 条目在做的正经工作。

  新措辞的真实性由**既有**测试锚定，本次没有新写断言：
  `packages/runtime/src/analytics-query-read-scope-withhold.test.ts:218` 用真 `AnalyticsService`
  ＋真挂载路由断言 `expect(res.body.error.code).toBe('READ_SCOPE_COMPILE_FAILED')`。

- 82da264: feat: declare `ExecutionContext.authGate`, so the ADR-0069 gate sits inside the closed field set (#7280)

  The ADR-0069 authentication-policy gate (expired password, enforced MFA) rode
  the execution context **undeclared**: REST's `computeExecCtx` spread it onto the
  assembled envelope with `...(authGate ? { authGate } : {})` behind an `as any`,
  and its `enforceAuth` read it back ten lines later. Nothing was broken — but the
  closed entry field set shipped in #6216 is derived from `keyof ExecutionContext`,
  so a field that exists only inside an `as any` is **outside every closure gate by
  construction**: `ENTRY_EXECUTION_CONTEXT_FIELDS` could not list it,
  `ExecutionContextEntryFields` could not demand it, and the runtime pin that
  reconciles the closed set against `ExecutionContextSchema.shape` could not see
  it. It was the exact blind spot that gate exists to remove, sitting one `as any`
  outside it.

  **@objectstack/spec** declares the field:

  ```ts
  authGate: z.object({ code: z.string(), message: z.string() }).optional();
  ```

  Both inner keys are required, matching the sole producer
  (`AuthManager.computeAuthGate`, which sets both on every return branch) — `code`
  is the stable machine code a client branches on, `message` is what the blocked
  user reads, and the transport seam renders both as the `403` body.

  **@objectstack/core** picks it up as an ENTRY-decided field — it is resolved from
  the request's own session at the transport entry point, never written mid-request
  — so `ExecutionContextAssemblyInput` gains a **required** `authGate` input on the
  same footing as `accessToken`: every face states its decision instead of omitting
  it. A guest principal never carries one (no authenticated session for a policy
  gate to attach to). Also exported: `normalizeAuthGate`, which completes a session
  user's loose `authGate` into the declared shape at the one producer rather than
  tolerating a partial shape downstream — a gate naming a `code` but no `message`
  no longer renders a `403` body with `message: undefined`. `AuthGate` is now
  derived from the schema instead of being a second hand-written declaration.

  **@objectstack/rest** passes the resolved gate as an assembler input and drops the
  post-assembly spread; the remaining `as any` covers `__kernel` alone.
  **@objectstack/runtime** (the runtime / MCP dispatcher) passes `authGate:
undefined` on the record: it enforces the same gate at its own seam
  (`HttpDispatcher.enforceAuthGate` re-reads the session and calls
  `evaluateAuthGate`) and never reads `context.authGate`, so carrying it there
  would be a second copy no consumer reads.

  **No runtime behaviour change on either surface.** The shared assembler omits
  `undefined`-valued keys, so the key is present exactly when it was before. The one
  new behaviour is the normalization above, on a shape the sole producer never
  emits today.

- f586f1a: refactor: one shared `ExecutionContext` assembler, two named anonymous entries (#6216)

  `resolveAuthzContext` already made AUTHORIZATION resolution single-sourced; the
  step after it — turning the resolved envelope into the `ExecutionContext` that
  reaches enforcement — was still one hand-written copy per transport, and the
  copies drifted twice for real: **#6071** (the REST copy never set
  `principalKind`, so every enforcement judgment reading it was silently
  never-true on that face) and **#6206 / #6551** (a dropped `accessible_org_ids`
  produced real 403s on the share-link faces).

  **@objectstack/core** gains the single assembly, with the anonymous divergence
  as named API rather than drift (maintainer ruling 2026-08-08 on #6216, Option
  A):

  - `assembleExecutionContext(input)` — the **fail-closed default** entry. No
    resolved principal → `undefined`, and the surface answers 401.
  - `assembleExecutionContextOrGuest(input)` — the **explicit guest** entry. No
    resolved principal → a first-class guest envelope (`principalKind: 'guest'`,
    `positions: ['guest']`), whose consumers are live (`explain-engine`'s
    guest ⇒ `EXTERNAL` posture floor). Adopted only by a surface whose product
    semantics serve anonymous principals.
  - The field set is **closed by type**: `ExecutionContextEntryFields` requires a
    decision for every `ExecutionContext` field that is not explicitly declared
    non-entry-resolved, so a new field cannot reach one transport and miss
    another. Also exported: `ENTRY_EXECUTION_CONTEXT_FIELDS`,
    `EntryExecutionContextField`, `ExecutionContextAssemblyInput`,
    `OAuthTokenProvenance`, `EntryLocalization`.

  **@objectstack/runtime** (`resolveExecutionContext`, the runtime / MCP
  dispatcher) and **@objectstack/rest** (`computeExecCtx`) now assemble through
  that module — the dispatcher via the guest entry, REST via the fail-closed
  default.

  **No runtime behaviour change on either surface.** The remaining per-face
  divergences are required inputs rather than silent omissions: REST passes
  `accessToken: undefined` (it has never carried the session bearer on the
  envelope, and `session.accessToken` is a published hook surface) and
  `oauth: undefined` (OAuth bearers are honoured on the `/mcp` door alone). The
  one measurable difference is that a key whose value was `undefined` is now
  omitted rather than spelled — invisible to `ctx.x` reads, to `JSON.stringify`
  and to spreading the envelope.

- c8d6f6e: fix(spec,runtime): `functions: [{ name, handler }]` survives `objectstack build` (#6238)

  The array form of the top-level `functions` collection could not pass its own
  build. `lowerCallables` has lowered the array branch the whole time — it rewrites
  both `handler` and `name` to the emitted ref — but the array member of the
  `functions` union in `stack.zod.ts` still demanded `handler: z.function()`. So
  `objectstack build` produced
  `[{ name: 'syncBilling', handler: 'syncBilling', effect: 'writes' }]` and then
  rejected it, with `invalid_union: Invalid input` and a path stopping at
  `functions`: no entry named, no key named, no reason given.

  This is the third time the same seam has parted, and the first two fixes are why
  this one only looks small. #4343 taught the union the bare lowered ref; #4976
  taught it the lowered _declaration_. Both only ever touched the **map** member —
  the array member is a separate inline record (an array entry names itself, so it
  carries `name` and an optional `packageId` and cannot be `FlowFunctionEntrySchema`
  in a list), and widening one never widened the other.

  **The fix.** The array member's `handler` now accepts the lowered string ref
  beside the authored callable. One widening covers both array spellings at once,
  unlike the map form's two separate members: `effect` is already optional on an
  array entry, so the bare and the declared entry differ only in whether that key
  is present. All four cells of map/array × bare/declared now round-trip.

  **The load seam, which the fix made reachable.** `mergeRuntimeModule` re-attaches
  each callable from the sibling ESM module to the declaration the JSON carried.
  Its array branch fell through to a map rebuild — `existing` was `{}` whenever
  `bundle.functions` was an array — so the merged bundle came back as a bare
  `{ name: callable }` map with `effect: 'writes'` dropped on the floor. The
  function still registered and still ran, and its writes were counted as none:
  #4396's silent un-declaring arriving by the other door, and exactly the state
  that keeps #4354's broken-sweep alert quiet on the one run that needed it. Since
  the parse rejected the array form until now, no built artifact had ever reached
  that branch; it is fixed in the same change rather than shipped as a live trap.
  The array shape is preserved, callables are attached per entry `name`, and a
  module function the artifact declared no entry for still registers — the map
  branch keeps those, and the array branch must not ship fewer functions than the
  bundle was built with.

  Authoring is unchanged and nothing narrows: this widens what the artifact form
  accepts. The map form is still the preferred spelling.

- db59e9c: hooks: drop the last three `doc` / `previousDoc` alias reads on a hook context — read the engine's own keys only

  Behaviour is unchanged: every one of these limbs guarded against a producer that
  has never existed, so none of them could be reached.

  - `service-storage` attachment lifecycle read `ctx.result ?? ctx.input.doc ?? ctx.input.data`
  - `plugin-sharing` primary-BU projection read `(ctx.input.data ?? ctx.input.doc).user_id`
  - `runtime`'s hook sandbox read `engineCtx.input ?? engineCtx.doc` and `engineCtx.previous ?? engineCtx.previousDoc`

  Every ObjectQL write context spells the payload `data` — measured and pinned by
  `hook-input-shape-contract.test.ts` in `@objectstack/objectql` ("insert carries
  `data` — never `doc`", #5273). The top-level pair is the same family one level
  up: `HookContextSchema` declares `input` / `result` / `previous` and neither a
  `doc` nor a `previousDoc`, and `engine.ts` — the sole producer of a HookContext
  — builds neither. The limbs survived only because the old `HookContext.input`
  contract table documented insert as `{ doc, options }`; that table was corrected
  in #5668, and the same alias was removed from `trigger-record-change` in #5671.
  These are the remainder (#5906), removed rather than left as a second de-facto
  contract (PD #12).

- c51ffa5: sandbox: `ScriptContext.user` 由 `unknown` 收窄为命名联合 `ScriptUser`(#5521)

  沙箱接缝 `ScriptContext`(`packages/runtime/src/sandbox/script-runner.ts`)把交给 hook /
  action body 的调用者声明为 `user?: unknown`,类型系统对这个字段一无所知 —— 第四个
  dispatch 面明天再手搓一个 user 字面量,编译器不会说一句话。而"三个 dispatcher 手搓出三种
  形状"正是 #5372 的成因:它能存在几个版本,部分原因就是没有任何声明可以违背。

  现在它是 `user?: ScriptUser`,`ScriptUser = ActorUser | HookContext['user']` —— 两个**实测
  的真实生产者形状**的联合,与 33 行外的姊妹字段 `ScriptSession`(#5613 / #5991)同构:

  - action body 收 `ActorUser`(`security/actor-user.ts`,#5372 起的唯一生产者,#6011 后
    `positions` 为唯一拼法);
  - hook body 收 `HookContext['user']`(ObjectQL `buildUser()` 的 `session.userId` 快捷方式:
    `id` / `name` / `email` / `organizationId`,全部可选)。

  刻意**不**收成单一类型:hook 快捷方式不带 `positions` / `permissions` / `systemPermissions`,
  收成 `ActorUser` 会在 hook 面断言一套它从未生产过的授权词汇;也**不**收成 spec 的
  `EvalUser`(issue 选项 1)—— 实测 `buildUser()` 根本不产 `positions`,而 `EvalUser` 要求它,
  那是套着 spec 外衣的同一种过度声明。

  行为零变化:两个写入方从 `any` 引擎上下文赋值,唯一的 VM 侧读取方收 `unknown`。TS 消费者
  可见,故走 patch。`ActorUser` 同时作为**类型**从包入口导出,使联合的两支都可被消费者命名。

- 6146b67: `os migrate plan` no longer creates a database on a project that has never been started (#6743)

  `migrate plan` is a dry run, and since #3917 it has reported the boot-time
  create-table DDL and the artifact seed instead of performing them. It still
  brought the database file itself into existence, though: SQLite creates the
  file at open, so a `plan` in a fresh project left behind a 0-table
  `.objectstack/data/objectstack.db` — a write side effect from a read-only
  command, and one that erased the only signal ("no database file yet") by which
  the next command can tell a never-started project from a started one.

  A missing SQLite target is now opened as an empty in-memory database instead of
  being created. **The plan output is unchanged**, deliberately: a database with
  zero tables is exactly what a freshly created empty file is, so "every table
  needs creating" — the true and useful answer for a new project — still prints,
  and the `Database:` line still names the real target path rather than the
  in-memory stand-in.

  New driver capability, additive and off by default:
  `SqlDriverConfig.sqliteAbsentFile` (`'create'` | `'empty-in-memory'`, default
  `'create'`). Every existing caller keeps SQLite's own create-if-absent
  behaviour. It is threaded to the driver as a host-composition option
  (`createDefaultDatasourceDriverFactory`, `DefaultDatasourcePlugin`,
  `createStandaloneStack`), not as an authorable `datasource.config` key — a
  datasource must not be able to declare itself into never persisting.

  `os migrate apply` deliberately does **not** use it: it boots deferred too, but
  flushes the deferred DDL after confirmation and needs a real file to flush into.

- 8fbed3b: `GET /api/v1/notifications` now refuses a malformed query parameter with a proper
  ADR-0112 refusal (`400`, `error.code: VALIDATION_FAILED`, `details.fields[]` naming
  the parameter with an ADR-0114 field code) instead of coercing it into a value
  nobody asked for.

  Wire-visible for raw-HTTP callers only — the typed SDK's `limit` is a `number`, so
  it could never produce these:

  - `?limit=abc` coerced to `NaN`, which survived `listInbox`'s clamp
    (`Math.min(Math.max(NaN ?? 50, 1), 200)` — `??` does not catch `NaN`) and reached
    the driver as `data.find({ limit: NaN })`. Driver-dependent behaviour, always a 200. Now a 400. Non-integers (`1.5`, `Infinity`, a repeated `?limit=1&limit=2`)
    are refused on the same rule.
  - `?read=1` / `?read=TRUE` / `?read=` answered `false`, silently serving the
    **unread** half of the inbox to a caller who asked for the read half. Only
    `true` and `false` are accepted now.
  - A repeated `?type=a&type=b` became the single topic `'a,b'` — an empty inbox and
    a 200. A non-string `type` is refused.

  Unchanged on purpose: every value that already had a defensible answer keeps it,
  including the **clamp** for out-of-range numbers, which is declared contract
  (`?limit=1000` still answers 200 rows, `?limit=-5` still answers 1), absent/empty
  parameters, and unknown query keys such as the retired `cursor`, which stays
  ignored rather than refused.

- 1fa224a: feat(plugin-auth): the fixed-window counter gets its own `./rate-limit-storage` entry (#6040)

  `rate-limit-storage.ts` is the repo's ONE fixed-window counter —
  `incrementFixedWindow` / `createLazyCounterStore` / `InProcessCounterStore`,
  ADR-0069 D2 — and #4790's cross-reference asks later arrivals to reuse it
  rather than write a third copy. They did, and from outside auth:
  `@objectstack/runtime` counts inbound requests and endpoint policy through it,
  and `@objectstack/service-sms` counts its daily SMS budget through it (#2814).

  `@objectstack/plugin-auth` published exactly one entry, `"."`, whose `export *`
  chain takes **value** imports on `better-auth/adapters`
  (`objectql-adapter.ts`) and `@better-auth/core/db` (`backfill-account-issuer.ts`).
  Value imports are evaluated eagerly, so reaching those ~90 lines of counting
  loaded `better-auth` + `@better-auth/{core,oauth-provider,scim,sso}` + `jose` +
  `@noble/hashes` + `@objectstack/rest` + `@objectstack/platform-objects` first.
  Measured against the built package: `require('@objectstack/plugin-auth')` puts
  109 modules in `require.cache`; the counter needs one.

  So the counter is now published on its own:

  ```ts
  // before — 109 modules, the whole better-auth family
  import { incrementFixedWindow } from "@objectstack/plugin-auth";
  // after — 1 module, 3.7 KB
  import { incrementFixedWindow } from "@objectstack/plugin-auth/rate-limit-storage";
  ```

  `tsup` emits the second entry with `splitting: false`, so it is a self-contained
  bundle rather than a nominal split: `dist/rate-limit-storage.mjs` is 3.71 KB
  against `dist/index.mjs`'s 330.28 KB, contains zero top-level imports and zero
  occurrences of the string `better-auth`. The one better-auth reference that
  survives is `import type { BetterAuthRateLimitStorage }`, which is erased at
  build and costs a consumer nothing at runtime.

  **Nothing is removed.** The root still re-exports every one of these symbols, so
  existing `@objectstack/plugin-auth` imports keep working unchanged — this is a
  new entry point, which is why it is `minor` rather than breaking. The `patch` on
  `runtime` and `service-sms` is the import-specifier switch in those packages;
  their behaviour is identical.

  `src/rate-limit-storage-isolation.test.ts` pins the invariant from both sides,
  in the shape `packages/types/src/node-isolation.test.ts` (#4700) established for
  the `./node` split: it walks the real import graph from the subpath entry and
  fails on any better-auth **value** import or any undeclared external package,
  it fails if a consumer reaches the counter through the package root again, and
  it fails if the root ever _stops_ pulling better-auth eagerly — because at that
  point the split stopped buying anything and deserves re-measuring rather than a
  suite that passes for the wrong reason.

- 0e043d8: feat(automation)!: 未声明 `resumeAuthority` 的暂停节点改为 fail-closed —— 通用 resume 路由从「默认开门」变成「显式 `'any'` 才开门」(#5561 第二步)

  <!-- adr-0087: registered action-descriptor-resume-authority-default-flip -->

  **BREAKING**(仅影响注册了暂停型节点、且描述符未声明 `resumeAuthority` 的执行器 ——
  本仓内为零)。`AutomationEngine.resolveResumeAuthority` 对缺省值的解析由 `'any'` 翻成
  `'service'`:一个从未声明「谁可以续跑它产生的暂停」的节点类型,其暂停在通用路由
  `POST /automation/:name/runs/:runId/resume` 上被拒绝(`PERMISSION_DENIED` / 403),
  直到它的描述符把话说出来。通用 resume 门从此是描述符**主动 opt-in** 的一扇门,不是每个
  暂停节点**继承**来的默认。

  这是 ADR-0044 2026-07-28 修正案里「记录但刻意不在此建造」的第一项,分两步落地。
  第一步(#5561 / PR #5725,非 breaking)把 `ActionDescriptorSchema.resumeAuthority`
  的 Zod `.default('any')` 摘成 `.optional()`。那个默认值的问题不只是取值不对,而是它
  **抹掉了事实**:`defineActionDescriptor` 在任何消费者看到对象之前就把 key 填上了,于是
  「作者选了 `'any'`」和「作者从没考虑过」parse 出逐字节相同的描述符,遗漏根本无法被观测。
  默认值摘掉之后「缺省」才重新可见,注册告警与 `check:resume-authority-declared` CI 门也
  才写得出来。第二步就是本次改动:让缺省真正意味着 fail-closed。

  ### 为什么往「拒绝」这个方向猜

  两种猜错的代价不对称,这就是全部理由。猜 `'any'`,会让一次 resume 走过一个**没有任何
  记录的决策**,而且悄无声息 —— #3823 就是这么发生的:ADR-0044 把审批的 `revise` 边指向
  了通用 `wait`,`wait` 本身声明 `'any'` 完全正确,而站在「服务持有」位置上的那个暂停
  继承了一个没人选过的 fail-open 值;实测代价是一次未经审计的重新提交,外加一个被销毁的
  远程 run。猜 `'service'`,则是返回一次拒绝,并把修好它的那一行原样交回作者手里。
  两种错误里只有一种能被犯错的人自己发现。

  ### 迁移:`resumeAuthority` 未声明 → 显式声明(一行)

  只有**注册暂停型节点的插件作者**需要动手,处方是在描述符上加一行:

  ```ts
  // FROM —— 依赖旧默认值,暂停可被通用路由续跑
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
  });

  // TO —— 通用路由确实是这个暂停的正门时(screen 式收集输入、signal wait 式外部生产者)
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
    resumeAuthority: "any",
  });

  // TO —— 续跑是「某个服务必须先授权并记录的决策」的尾巴时
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
    resumeAuthority: "service",
  });
  ```

  两个值都被接受,**只有沉默改变了含义**。三条运行时通道会指着同一件事说话:注册时按类型
  去重的一次告警、resume 被拒时那条点名缺省字段并给出处方的错误消息,以及本仓自有执行器的
  `check:resume-authority-declared` CI 门。

  ⚠️ `supportsPause` 本身是一个没有任何执行路径强制的声明(#5703)—— run 会暂停是因为
  `execute()` 返回了 `suspend: true`。所以一个「会暂停但把 `supportsPause` 留成 false」
  的执行器,注册告警与 CI 门**都看不见它**,只有 resume 时的拒绝消息会带上同一份处方。
  请按同一条规则手工核一遍这类执行器。

  ### 仓内零行为变化

  在册的六个暂停类型全部已显式声明:`screen` / `wait` / `subflow` / `map` 声明 `'any'`
  (第一步补齐),`approval` / `approval_revise` 声明 `'service'`。解析器测试与端到端测试
  都把这份清单和它们的解析结果一起断言 —— 一个只靠「什么都没注册」而变绿的零点名,和真的
  零点名是两回事。

  `@objectstack/runtime` 只是注释与路由账本(`route-ledger`)的记述同步,无行为改动。

- f8fe47e: feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

  #3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
  ledger 的现有条目一行未改，字段缺省即「未声明」。

  ## 为什么是这一步

  #3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
  237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
  里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
  是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
  缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
  将来有东西可棘。本次落地的就是后者。

  ## 字段语义

  `responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
  路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
  由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

  五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
  字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
  相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
  **名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

  ## 已填的两条（实证，不是批量）

  只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
  且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

  - `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
  - `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

  `GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
  `discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
  所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

  ## 新增守卫

  - `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
    每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
    调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
    陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
  - `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
    schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。

- 6155c3c: fix(runtime): a metadata write carries the session's organization only for types that declare `allowOrgOverride` (#7018)

  The dispatcher threaded the caller's active organization into
  `protocol.saveMetaItem` **unconditionally**, and `SysMetadataRepository.put`
  stamps `organization_id` for every type. So any session with an active
  organization minted an org-scoped `sys_metadata` row even for types the registry
  declares NOT per-org overridable — and cold boot (`loadMetaFromDb`) hydrates
  `organization_id IS NULL` only.

  Those rows were **phantom writes**: correct for the life of the process, silently
  absent after the next restart. The measured specimens are the ones #6190 filed —
  a `flow` authored in Studio binds its triggers, fires all day, and stops firing
  after a restart with nothing said; an `object` written the same way 404s every
  record. For `allowOrgOverride: true` types (`view`, `dashboard`, `report`,
  `translation`, `email_template`) the same skip is the ADR-0005 design, because
  those overlays are loaded on demand by `getMetaItem`/`getMetaItems`.

  Both runtime write sites now consult the type's registry declaration:

  - `PUT /api/v1/meta/:type/:name` — the active organization rides the write only
    when the target type declares `allowOrgOverride: true`. Otherwise it is
    dropped and the write lands env-wide, producing exactly the row (and exactly
    the receipt) a session with no active organization already produces today.
  - `POST /api/v1/packages/:id/publish-drafts` — the ADR-0045 §3 visibility flip
    writes `app` (`allowOrgOverride: false`), so it now lands env-wide, on the row
    cold boot hydrates and the App Switcher reads. The org-scoped flip was itself a
    phantom: the app looked published until the next restart and then went back to
    `_unpublished: true`, because the env-wide row it left untouched is the only
    one boot loads.

  The predicate is derived from `DEFAULT_METADATA_TYPE_REGISTRY`, so a registry
  entry flipping `allowOrgOverride` moves the runtime with it — there is no second
  list to keep in sync. It deliberately does **not** consult the
  `OS_METADATA_WRITABLE` escape hatch: that hatch unlocks the _write_, and an
  env-unlocked type's org rows are hydrated no more than any other's, which is the
  same call `reportUnhydratableOrgScopedRows` already made on the read side.

  No authoring change and no new refusal: writes that succeeded still succeed, with
  the same response body. What changes is which partition the row lands in for
  types that never had a per-org read channel.

  Part of the #6190 maintainer ruling (Option A, runtime half).

- d13f627: fix(objectql): the discrete transaction trio joins an open ambient transaction, so a sandbox body no longer opens a second one (#6406)

  #6168 taught the callback face (`ctx.api.transaction(fn)` on `ScopedContext`)
  the ADR-0067 D2 join. It could not reach the SANDBOX face: a QuickJS hook or
  action body's `ctx.api.transaction(fn)` is VM-side sugar over three host leaves
  (`__txBegin` / `__txCommit` / `__txRollback`) that drive `ScopedContext`'s
  discrete `beginTransaction` / `commitTransaction` / `rollbackTransaction` trio —
  a different method, which had no join branch of its own. So a body running
  inside a host `engine.transaction()` still opened a SECOND driver transaction:

  1. it asked the pool for a second connection — the deadlock D2 exists to avoid
     on a single-connection pool (knex/SQLite); and
  2. it committed itself, so its writes SURVIVED the outer rollback. The caller
     was told the unit of work had been undone while some of its rows were still
     there — no error, no log.

  `beginTransaction()` now makes the same first move as both callback faces:
  before looking a driver up it reads the engine's ambient transaction store, and
  where one is open it returns THAT handle in a child context, with `owned: false`
  in its result (#5696's signal, in the shape this face can carry it).
  `commitTransaction` and `rollbackTransaction` abstain for such a handle, so the
  outer caller keeps the one and only commit/rollback. An explicit rollback of a
  joined handle performs no driver rollback: that is the same answer the callback
  faces give, where the joined branch has no rollback either and a throw
  propagates to the outer owner, which rolls the whole unit back. In the sandbox
  that path is exact — the sugar's catch reaches `__txRollback` and RE-THROWS, so
  the body's failure travels out to the host owner.

  The abstention lives on `ScopedContext`, not in the caller, so no trio caller
  can close a transaction it does not own. The QuickJS runner additionally
  honours the `owned` bit at all three of its close paths (commit leaf, rollback
  leaf, and the teardown cleanup that rolls back a transaction a timed-out body
  left open) — the runner closes what the runner opened.

  Measured, not assumed: at `__txBegin` time the engine's ambient store IS
  readable from the sandbox leaf (the leaf runs on a chain awaited down from the
  host's `txStore.run`), which is why no separate capture mechanism is needed.
  What the trio still cannot do is PUBLISH — with no closure spanning
  begin→commit there is nothing to hand `txStore.run` — so a transaction it opens
  itself stays invisible to ambient readers, exactly as before, and the #6167
  surface (handles the engine cannot attribute) is unchanged.

- 378d8b1: Dispatcher-face `/share-links` enforcement now receives the caller's complete resolved `ExecutionContext` (#6551 — the dispatcher half of #6206). The domain handler used to rebuild a two-field `{ userId, tenantId }` subset and hand it to `createLink` / `listLinks` / `revokeLink`, dropping `accessible_org_ids`, `positions`, `permissions`, `org_user_ids`, `systemPermissions`, `posture` and `tabPermissions` on the way into enforcement. Under the `group` tenancy posture the Layer 0 wall reads `accessible_org_ids` and an absent set denies (fail closed), so creating a link answered 403 for records the caller reads fine elsewhere; a record visible only through a position-bound permission set was likewise refused even under the `single` posture. The envelope is now passed through whole per the #6511 contract; the routes' own 401 gate still reads only `userId`.
- 68f5ecc: refactor(runtime,cli): give the optional Turso/libSQL loader ONE owner (#6268)

  `@objectstack/driver-turso` is an optional install, so neither host can let the
  open-core datasource factory build the `default` datasource for a `libsql://`
  selection — both inject a host driver factory instead. That loader was written
  out **twice**: `packages/runtime/src/turso-driver-factory.ts` (`os migrate` /
  `createStandaloneStack` / embedded hosts, #5820) and
  `packages/cli/src/utils/storage-driver.ts` (`os serve` / `os start`, #5602). The
  two were kept equal **by hand**, which is the #3741 → #3758 shape: one decision,
  two implementations, one of them fixed and the other missed for three months.

  It had already begun. #6345 moved the CLI's `isTursoDriverId` onto
  `@objectstack/spec`'s shared driver vocabulary and left the runtime half on a
  private `Set(['turso', 'libsql'])` — equal only because the spec table's `turso`
  row happens to list exactly those two aliases today.

  **The runtime now owns it and the CLI consumes it.** `@objectstack/runtime`
  exports `loadTursoDriverFactory`, `isTursoDriverId`, `MissingDriverPackageError`,
  `TURSO_DRIVER_PACKAGE` and `TURSO_DRIVER_INSTALL_COMMAND`;
  `packages/cli/src/utils/storage-driver.ts` re-exports them, so every existing CLI
  import site is unchanged. `UnsupportedDriverError` stays in the CLI — it is
  CLI-only semantics (a `turso` selection with no URL), not a copy.

  **One class identity, deliberately.** `serve.ts` decides whether a boot failure
  is fatal with `e instanceof MissingDriverPackageError`. A convergence that left
  two same-named classes would make that predicate silently stop matching and
  degrade a fatal branch to a non-fatal one with no diagnostic anywhere, so the
  CLI re-exports the runtime's class rather than declaring its own, and a test pins
  that an error raised by the runtime loader still satisfies the CLI-side
  `instanceof`.

  **Behaviour, for operators:** unchanged, with one exception. Missing package
  still fails loudly with the same `npm install @objectstack/driver-turso`, the
  same error fields and no SQLite fallback; a present package still yields the same
  factory handle shape. The exception is the missing-package **message**, which is
  now one wording for both hosts and therefore names both consequences (a server
  booted against an empty local database, and an `os migrate` DDL run against that
  same one) instead of only the one its host used to mention.

  Two things stay host-owned because moving them would change behaviour: the
  dynamic `import()` specifier (it resolves from the node_modules tree of whichever
  module evaluates it, and the package is an optional **peer** of
  `@objectstack/cli` that `@objectstack/runtime` does not declare at all), and the
  error TYPE for a url-less turso config. Only the message for the latter is
  shared.

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
- Updated dependencies [63f3b87]
- Updated dependencies [06be54e]
- Updated dependencies [29e28a3]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [ad878e7]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [db12b88]
- Updated dependencies [fe2dfa1]
- Updated dependencies [6f6fec7]
- Updated dependencies [7d1ff75]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [e0f300b]
- Updated dependencies [53aeb02]
- Updated dependencies [bf32d4a]
- Updated dependencies [10c4ea9]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e9b5265]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [04476e7]
- Updated dependencies [de6b7f1]
- Updated dependencies [79228cd]
- Updated dependencies [01faeb1]
- Updated dependencies [d92ed03]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [fec7848]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [262e40d]
- Updated dependencies [55da611]
- Updated dependencies [d367f03]
- Updated dependencies [45e711a]
- Updated dependencies [465a0fa]
- Updated dependencies [6de592c]
- Updated dependencies [d254421]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [6fde910]
- Updated dependencies [9c82b89]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [b7d3be4]
- Updated dependencies [2a0d65e]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [6029cc1]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [d5e9f6e]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [d53bd0b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [cafec0a]
- Updated dependencies [c8d6f6e]
- Updated dependencies [dba7747]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [a92b179]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [c733ae8]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [ef678d0]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [ea1d916]
- Updated dependencies [465c5fc]
- Updated dependencies [30bed70]
- Updated dependencies [c804f19]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [f6e59f7]
- Updated dependencies [dbe92a7]
- Updated dependencies [6146b67]
- Updated dependencies [c6b6bb4]
- Updated dependencies [07383fe]
- Updated dependencies [9e9445b]
- Updated dependencies [f3e26b7]
- Updated dependencies [870f90c]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [5e247fd]
- Updated dependencies [83a3b1f]
- Updated dependencies [2443bb4]
- Updated dependencies [1a53a02]
- Updated dependencies [623d008]
- Updated dependencies [73648ba]
- Updated dependencies [1507ba3]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [7c6261a]
- Updated dependencies [08863dd]
- Updated dependencies [1da39f5]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [bf42e76]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [7e1b480]
- Updated dependencies [bfe689b]
- Updated dependencies [d0d5205]
- Updated dependencies [b948a41]
- Updated dependencies [725c7b0]
- Updated dependencies [4bb6f01]
- Updated dependencies [e39dd66]
- Updated dependencies [ac244ad]
- Updated dependencies [bed427f]
- Updated dependencies [9960cd2]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2934761]
- Updated dependencies [b295e4b]
- Updated dependencies [2233a85]
- Updated dependencies [de43f94]
- Updated dependencies [252f71b]
- Updated dependencies [4c31321]
- Updated dependencies [a5d2573]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [d586366]
- Updated dependencies [54fe9d5]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [1fa224a]
- Updated dependencies [3fb42d2]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [4df747c]
- Updated dependencies [7084313]
- Updated dependencies [47a4e67]
- Updated dependencies [91cefb8]
- Updated dependencies [2c2a212]
- Updated dependencies [9bc846b]
- Updated dependencies [773f80a]
- Updated dependencies [f3f855a]
- Updated dependencies [2873eb9]
- Updated dependencies [0e043d8]
- Updated dependencies [4fedb11]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [271cee1]
- Updated dependencies [75e6871]
- Updated dependencies [e6025e9]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
- Updated dependencies [9e9445b]
- Updated dependencies [89d7b35]
- Updated dependencies [d13f627]
- Updated dependencies [e5fd28c]
- Updated dependencies [a841151]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [3264516]
- Updated dependencies [1f6ed16]
- Updated dependencies [dc61def]
- Updated dependencies [9f7a7c2]
- Updated dependencies [6443b79]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [62159bd]
- Updated dependencies [d48aad5]
- Updated dependencies [3de535b]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [d86815e]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [bee5ffe]
- Updated dependencies [e13fd91]
- Updated dependencies [3172831]
- Updated dependencies [939f579]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [b0c16a5]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [d19fb5c]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [50a8d11]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
- Updated dependencies [c9bf940]
- Updated dependencies [a682670]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/objectql@17.0.0-rc.6
  - @objectstack/metadata-protocol@17.0.0-rc.6
  - @objectstack/plugin-security@17.0.0-rc.6
  - @objectstack/driver-sql@17.0.0-rc.6
  - @objectstack/rest@17.0.0-rc.6
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/metadata-core@17.0.0-rc.6
  - @objectstack/service-datasource@17.0.0-rc.6
  - @objectstack/driver-memory@17.0.0-rc.6
  - @objectstack/metadata@17.0.0-rc.6
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/plugin-auth@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6
  - @objectstack/service-i18n@17.0.0-rc.6
  - @objectstack/observability@17.0.0-rc.6
  - @objectstack/service-cluster@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ee3bde1]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
- Updated dependencies [148d451]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/objectql@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/driver-memory@17.0.0-rc.5
  - @objectstack/driver-sql@17.0.0-rc.5
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.5
  - @objectstack/formula@17.0.0-rc.5
  - @objectstack/metadata@17.0.0-rc.5
  - @objectstack/metadata-core@17.0.0-rc.5
  - @objectstack/metadata-protocol@17.0.0-rc.5
  - @objectstack/observability@17.0.0-rc.5
  - @objectstack/plugin-auth@17.0.0-rc.5
  - @objectstack/plugin-security@17.0.0-rc.5
  - @objectstack/rest@17.0.0-rc.5
  - @objectstack/service-cluster@17.0.0-rc.5
  - @objectstack/service-datasource@17.0.0-rc.5
  - @objectstack/service-i18n@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- 739f496: feat(runtime)!: action body `ctx.session` emits `positions` (canonical) alongside the deprecated `roles` (#5613)

  `buildActionSession()` — the one producer of the action-body `ctx.session` — now
  emits the caller's position names under **both** `positions` (canonical) and
  `roles` (deprecated alias), with the same array under both names. This is the
  **runtime half** of #5613 phase 2 under the maintainer's contract-first ruling
  ("C skeleton + A semantics"); the spec half (#5779) declared the shape this now
  produces, and phase 1 (#5697) declared the shape it produced before.

  **What was wrong.** The builder copied `ExecutionContext.positions` into a key
  spelled `roles` — the one spelling ADR-0090 D3 bans — while its own docblock
  claimed it "mirrors the hook `ctx.session` shape". That sentence stopped being
  true at #5050, which retired `HookContext.session.roles` outright: a body author
  met two different answers to one key name on one platform, and the comment
  pointed at the wrong one. The key set reached no schema and no gate until #5697,
  so nothing could see it drift.

  **Migration prescription — do this now.**

  - Read `ctx.session.positions`. It carries exactly the array `ctx.session.roles`
    carried (`ExecutionContext.positions` — the rename is a rename, not a semantic
    change), and it is the spelling the platform now uses everywhere: the
    execution context, the sharing service, `ctx.user.positions`, and the hook
    `ctx.session.positions` (#5605).
  - `ctx.session.roles` still resolves for the length of the deprecation window
    announced by the ADR-0087 semantic migration
    `action-session-roles-to-positions`, and is then removed on the path
    `session.tenantId` already walked (#3280 deprecated → #3290 removed in v11). A
    body still reading it at that point sees `undefined` with nothing to catch the
    change — which is why the read moves **inside** the window, not at its close.
  - Do **not** migrate an access check by renaming it. `roles.includes('admin')`
    rewritten as `positions.includes('admin')` migrates the defect: neither array
    is an authorization input. Privilege is judged by the security service, which
    evaluates capability grants, placements and the derived posture (ADR-0095).
  - Presence semantics are unchanged: a context with no positions (or a non-array
    `positions`) yields **neither** key — `'positions' in ctx.session` answers
    `false` exactly when `'roles' in ctx.session` does — and a call with no
    identity envelope still yields no session at all rather than `{}` (#3712).

  **Also breaking, for TypeScript consumers of the sandbox seam.**
  `ScriptContext.session` (`@objectstack/runtime`, `sandbox/script-runner.ts`) was
  `unknown` and is now the exported union `ScriptSession = ActionSession |
HookContext['session']` — the two declared producer shapes this one seam
  actually carries. Code that read an arbitrary property off it must now
  discriminate the body kind (or read one of the keys both shapes declare:
  `userId`, `organizationId`, `positions`). It is deliberately **not** narrowed to
  `ActionSession` alone: the seam really does carry hook sessions, and declaring
  otherwise would re-create the "one key, two realities" defect this change
  closes.

  The consistency between what the producer builds and what `ActionSessionSchema`
  declares stays pinned in
  `packages/runtime/src/action-session-shape-contract.test.ts`, and the observed
  shape is verified through a real dispatch in `http-dispatcher.test.ts`.

- 29c6c9d: feat(spec,core,runtime)!: declarative `apis:` refuses loudly instead of parsing into silence; the `ApiRegistry` family retires (#4936, #4939)

  The declarative API-endpoint surface was **zero-execution end to end**, and said nothing
  about it. Metadata loading worked perfectly — a stack declared `apis:`, `defineStack`
  accepted it, and `GET /api/v1/meta/api` returned every endpoint with every key intact.
  The execution side never fired once. On a real boot (showcase, 47 plugins) both declared
  paths answered a bare `404 {"error":"Not found"}` — not even the dispatcher's semantic
  404, because **no route was ever mounted** for a declared path, so the request died at
  Hono's `notFound`. Behind that, the dispatcher's `handleApiEndpoint` branch resolved the
  metadata service and called `matchEndpoint` on it — a method **no implementation in the
  repo has ever provided**. The branch returned "not handled" on every request ever served.

  So every key on `ApiEndpointSchema` was declared ≠ enforced: `path`/`method` (never
  mounted), `type`/`target`/`objectParams` (never executed), `cacheTtl`,
  `inputMapping`/`outputMapping`, `rateLimit`, `summary`/`description` — and
  **`authRequired`**, a security semantic that parsed green and gated nothing at all. That
  is false compliance, the failure ADR-0049 exists to stop, not debt.

  ## BREAKING — a non-empty `apis:` is now rejected

  Metadata that parsed cleanly before is now **refused at publish/validate**, with the
  prescription in the rejection itself:

  ```
  apis: `apis:` (declarative ApiEndpoint) is DECLARED BUT NOT EXECUTABLE in this runtime,
  so a non-empty array is rejected instead of silently accepted (#4936). …
  ```

  **FROM → TO.** `apis: [ …endpoints… ]` → `apis: []` (or delete the key; both are still
  accepted, and an empty array is not a special case). To actually serve the route today,
  mount it **in code** — a plugin manifest `contributes.routes` entry, or an `http.server`
  route. That is now the only honest path, and the one `examples/app-showcase` uses
  (`src/system/server/recalc-endpoint.ts`).

  The refusal lives on `ObjectStackDefinitionSchema` itself, which is the single choke
  point every path runs through — `defineStack`, the metadata plugin's artifact ingestion,
  `os validate`, the lint scorer and `EnvironmentArtifactSchema`. There is no path that
  forgot to check.

  **The `ApiEndpoint` vocabulary is deliberately KEPT.** Retiring it was considered and
  rejected: endpoint shapes are an industry-stable form, so a retirement would only mean
  re-introducing the identical schema later. Your endpoint definitions stay valid TypeScript
  and stay in the spec; only _authoring them into a stack_ is refused, and only until the
  executor lands. Keep them commented next to your stack — that is what the showcase does.
  The executor (route mounting + endpoint matching + per-key wiring for
  `authRequired`/`cacheTtl`/`inputMapping`/`outputMapping`/`rateLimit`) is tracked by
  **#5040**, which replaces this rejection with real execution.

  ## BREAKING — the `ApiRegistry` / `ApiEndpointRegistration` family is removed (#4939)

  The repo carried a **second**, unrelated declaration shape for "an API endpoint":
  `ApiEndpointRegistrationSchema` and the ~500-line `ApiRegistry` service that
  `createApiRegistryPlugin()` registered under `api-registry`. Nothing composed it — every
  assembly site lived in `packages/core/examples/`, with no registration in
  `packages/runtime`, `packages/cli` or any `examples/app-*`, and a real boot carried no
  such service. The whole family was therefore inert, including
  `ApiEndpointRegistration.requiredPermissions`, whose docs promised **in the present tense**
  that "the gateway layer automatically validates these permissions" while no gateway read
  it. Two declaration shapes, both dead; this retirement converges them on one.

  Removed from `@objectstack/spec/api`: `ApiEndpointRegistration(Schema)`,
  `ApiRegistry(Schema)`, `ApiRegistryEntry(Schema)`, `ApiMetadataSchema`,
  `ApiParameterSchema`, `ApiResponseSchema`, `ApiDiscoveryQuerySchema`,
  `ApiDiscoveryResponseSchema`, `ApiProtocolType`, `HttpStatusCode`,
  `ObjectQLReferenceSchema`, `SchemaDefinition` (12 JSON-Schema defs, 67 authorable keys).
  Removed from `@objectstack/core`: `ApiRegistry`, `createApiRegistryPlugin`.
  Removed from `@objectstack/plugin-hono-server`: the `useApiRegistry` option — it was
  defaulted to `true` and read by nothing, configuring a service that was never composed.

  **FROM → TO.** There is no replacement shape to migrate to, because nothing executed the
  old one: delete the registration objects. If you were assembling an `ApiRegistryEntry`,
  you were building a value only your own code read — keep it as your own type. Declarative
  endpoints have one vocabulary now, `ApiEndpointSchema`.

  `ConflictResolutionStrategy` **survives** the removal and moved to
  `@objectstack/spec/api`'s `router.zod` — same name, same four values
  (`error`/`priority`/`first-wins`/`last-wins`), same import path. It is pinned there by two
  independent ratchets and is not part of the retired surface.

  ## Also in this change

  - **BREAKING (`@objectstack/runtime`):** `HttpDispatcher.handleApiEndpoint()` is deleted,
    along with its now-orphaned private `callData` delegate, and `/__api-endpoint` leaves
    `LEGACY_CHAIN_PREFIXES` and the route ledger. The method was public, so this is an API
    removal — but it returned `{ handled: false }` for every call it ever received, so no
    caller can observe a behaviour change beyond the missing symbol. Delete the call.
    Absence is now loud (ADR-0076): the surface is refused at authoring rather than 404ing
    at runtime with dead code behind it.
  - `examples/app-showcase` no longer declares endpoints, and its coverage manifest no
    longer claims the capability is `demonstrated` — that entry read "executed by the runtime
    dispatcher (handleApiEndpoint)", which was exactly the advertise-what-you-don't-deliver
    claim Prime Directive #10 forbids.
  - The endpoint-level `rateLimit` tracking pointers left by #4910/#5006 now name **#5040**,
    the live executor card, instead of #4936, which closes with this change.

- d9cac60: **BREAKING** — `GET /meta/:type/:name` now answers exactly one body shape: the
  `GetMetaItemResponseSchema` envelope `{ type, name, item, … }` that
  `packages/spec` has always declared for it. On the default configuration this
  endpoint used to answer the **bare metadata document** instead (#5563).

  ### What changed, and why it is breaking

  The route had two mutually exclusive branches with different response
  structures. The cached branch — reached whenever `metadata.enableCache` is on,
  which is the **default** (`enableCache: z.boolean().default(true)`) — served
  `getMetaItemCached`'s `result.data`, and that value has the envelope already
  stripped. The uncached branch served `getMetaItem`'s envelope. So the one shape
  the spec declared was the one a default deployment could not obtain, and the
  envelope surfaced only when the cache was off or when the read structurally
  bypassed it (`app`, `doc`, `book`, `?state=draft`, `?preview=draft`,
  `?package=`). Consumers had no correct static type — they sniffed at runtime or
  reached for `as any` (#5545 was blocked on exactly this).

  The dispatcher's `/meta` domain had the same split one layer down: the protocol
  resolver answered the envelope while the ObjectQL-registry and MetadataService
  fallbacks answered bare documents. Both fallbacks now wrap what they found,
  taking `type`/`name` from the request.

  ### Migration

  `GET /api/v1/meta/object/customer`, default configuration:

  ```jsonc
  // before — the bare document
  { "name": "customer", "label": "Customer", "fields": { /* … */ } }

  // after — the declared envelope; the document is verbatim under `item`
  {
    "type": "object",
    "name": "customer",
    "item": { "name": "customer", "label": "Customer", "fields": { /* … */ } }
  }
  ```

  - **Reading the body directly** (`fetch`, `client.meta.getItem`,
    `client.meta.getCached().data`): read the document at `.item`. Nothing inside
    it changed. `type` is the canonical singular metadata type name, so
    `/meta/objects/customer` and `/meta/object/customer` answer the same `type`.
  - **`useObject` / `useFields` (`@objectstack/client-react`)**: `useObject().data`
    is now the envelope — `data.item.label`, `data.item.fields`, where it used to
    be `data.label` / `data.fields`. `useFields()` is unchanged (it already
    returns the flattened field list) and is the shorter path when fields are all
    you need.
  - **`isMetaEnvelope`, exported from `@objectstack/rest`, is REMOVED.** It
    existed only to tell the two shapes apart. There is one shape now, so the
    replacement for `isMetaEnvelope(r) ? r.item : r` is `r.item`.
  - **Not converged, deliberately**: `?layers=true` still answers the layered
    diagnostic projection `{ type, name, code, overlay, overlayScope, effective,
validation }`. Collapsing three layers into one `item` would delete the
    diagnostic. Unaffected unless you pass that flag.

- 0cd08d5: refactor(runtime)!: retire the exported `HttpServer` delegating wrapper — it declared `implements IHttpServer` and forwarded none of the contract's optional members (#5122)

  **BREAKING.** `@objectstack/runtime` no longer exports `HttpServer`, and
  `packages/runtime/src/http-server.ts` is deleted.

  ## What it was, and why it could not stay

  The class took an `IHttpServer` in its constructor and forwarded that server's
  **required** members — `get` / `post` / `put` / `delete` / `patch` / `use` /
  `listen` / `close` — while declaring `implements IHttpServer`. It forwarded not
  one of the contract's **optional** members:

  | Optional member         | What wrapping it cost                                                                                                                        |
  | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
  | `getPort?()`            | the real bound port after `listen(0)`; harnesses and `@objectstack/http-conformance` address the server through it                           |
  | `getRawApp?()`          | the framework-native escape hatch four consumers feature-detect (cloud-connection ×2, metadata's HMR routes, cloud's serverless node server) |
  | `setFallbackHandler?()` | since #5111, the **only** entry path there is for declarative `apis:` endpoints                                                              |

  `packages/spec/src/contracts/http-server.ts` tells consumers to feature-detect
  those members with `typeof server.X === 'function'` and to degrade when they are
  absent. Wrapping a capable adapter therefore made every probe answer **false**
  and the capability disappear — with the adapter underneath providing it the
  whole time. Write this row down before reaching for a wrapper of the same shape:
  **a host that wrapped `HonoHttpServer` and registered the wrapper as
  `http.server` would answer 404 to every endpoint its metadata declared**,
  because the seam those endpoints mount through was never forwarded. The dispatcher's
  own #5409 declaration — the seam's absence announced at `warn`, welded by
  `packages/runtime/src/dispatcher-plugin.fallback-absence-warn.test.ts` — remains
  the runtime-side backstop and still fires here, but it can only name the missing
  seam; it cannot name the wrapper that swallowed it.

  ## Migration

  **Register an `IHttpServer` adapter INSTANCE, don't wrap one.** Every real host
  in this repository already does; `new HttpServer(` had zero occurrences in the
  repository, examples included, which is why this retirement carries no rollback
  risk and why it is cheaper to take now than later.

  | Wrote                                                                  | Write instead                                                                                                                                                                                  |
  | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `new HttpServer(new HonoHttpServer(port))` registered as `http.server` | register the `HonoHttpServer` (or your own adapter) directly — `HonoServerPlugin` already does                                                                                                 |
  | a wrapper of your own to add cross-cutting behaviour                   | forward **every** member you did not deliberately drop, optional ones included, and re-probe with `typeof` after wrapping; a delegator that narrows the contract silently removes capabilities |
  | `import { HttpServer } from '@objectstack/runtime'`                    | remove it — `tsc` reports this one, the symbol is simply gone                                                                                                                                  |

  Unlike a method quietly dropped from a class, this break is visible to the
  compiler: the export does not exist, so nothing type-checks past it. Its absence
  from the barrel is additionally pinned at runtime by
  `packages/runtime/src/http-server-retirement.test.ts`.

  ## Why retirement rather than conditional forwarding

  Growing a forwarding surface nobody composes would have to be maintained forever
  and re-audited every time `IHttpServer` gains an optional member — it gained one
  as recently as #5080. The 2026-08-06 maintainer ruling took the #4939
  (`ApiRegistry`) precedent instead — retiring a part that was never assembled
  beats repairing it — under ADR-0049's remove side.

- dca5bd3: **BREAKING**: `ctx.user.roles` 已移除 —— action body / AI 路由处理器上的调用者位置(positions)只保留一个拼法 `ctx.user.positions`(#6011)

  `ActorUser`(action body 的 `ctx.user`、AI 路由处理器的 `req.user`)过去同时发出两个键,值完全相同(`roles` 是 `positions` 的逐字副本)。`roles` 是 ADR-0090 D3 明令保留并禁用的词,且没有关闭日期 —— 维护者 2026-08-06 裁定**立即退役**,不设弃用窗口、不双发。

  ### 迁移:FROM → TO

  ```js
  // FROM — v17 起该键不再存在,读到的是 undefined
  const positions = ctx.user.roles;
  if (ctx.user.roles.includes('sales_rep')) { … }

  // TO — 权威拼法,值逐字不变
  const positions = ctx.user.positions;
  if (ctx.user.positions.includes('sales_rep')) { … }
  ```

  一行修复:把 body / 路由处理器里的 `ctx.user.roles` 改写成 `ctx.user.positions`(`req.user.roles` → `req.user.positions`)。**值不变** —— 两个键此前由同一次赋值产生,所以这是一次纯粹的改键,不是改语义。`positions` 数组恒存在,空时是 `[]` 而非 `undefined`,无需 `?? []`。

  ### ⚠️ 改键不等于修好了权限判断

  `positions` 与此前的 `roles` 一样,**都不是授权输入**。权限由 security service 判定(capability 授予、placement、ADR-0095 推导出的 posture),不由名字字符串比较判定。因此:

  ```js
  // 这不是迁移,这是把缺陷换了个拼法
  if (ctx.user.roles.includes('admin')) { … }      // 旧的错
  if (ctx.user.positions.includes('admin')) { … }  // 一样错,只是改了键名
  ```

  把 `roles.includes('admin')` 改写成 `positions.includes('admin')` 迁移的是**缺陷本身**,不是那次读取。这类判断应改为向 security service 询问能力,而不是比对位置名。(与 #5991 的 `ctx.session` 更名同一告诫。)

  ### 不受影响的面

  - **`ctx.session.roles` 不在本次范围内**,仍按 #5613 的弃用窗口双发 `positions` + `roles`,由 ADR-0087 语义迁移 `action-session-roles-to-positions` 约定其关闭时点。两个面同名不同物,请勿混为一谈。
  - better-auth 会话上的 `user.roles`、`/api/v1/auth/me/permissions` 返回体的 `roles`、CEL/formula 的 `current_user.*`,都是各自独立的生产者,均未改动。

### Minor Changes

- 64cd010: fix(runtime,types)!: `/analytics/query` no longer echoes RLS policy field names — the declared-server-fault withhold is shared by both HTTP boundaries (#5811)

  **Observable behaviour change — read this if you read, log, or assert on
  `error.message` from a dispatcher-plugin route.** An error that **declares a
  server fault** in the ADR-0112 envelope (`status >= 500` _and_ a non-empty
  `code`) now leaves `dispatcher-plugin.errorResponseBase` with its message
  replaced by `"Internal server error"`. It previously reached the caller verbatim
  unless it happened to _sound_ like a SQL/driver dump. This applies to every route
  that plugin mounts — `/analytics`, `/packages`, `/i18n`, `/automation`, `/auth`,
  `/notifications`, `/mcp`, … — not only the one that motivated it. Nothing a
  machine reads changed: the producer's `code` still arrives in the response
  (`error.code`, promoted there from `details` by the shared envelope builder,
  #3842), the status is untouched, and the full original text still goes to the
  server log and `errorReporter` via `__obsRecordedError`.

  ## What was wrong

  #5367 (maintainer ruling 2026-08-06) made `read-scope-sql.ts`'s ten fail-closed
  RLS lowering refusals `READ_SCOPE_COMPILE_FAILED` / 500 and taught
  `POST /analytics/dataset/query` to withhold their message, because those messages
  name the field names and comparands of an **administrator's** sharing rule:

  ```
  [read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to
  build read scope (fail-closed).
  ```

  The caller never wrote that field name and must not be able to read it out of an
  error body. But the **sibling** analytics face was never closed.
  `compileScopedFilterToSql` runs on both `NativeSQLStrategy.applyReadScope` and
  `ObjectQLStrategy`'s echoed SQL, both of which serve `POST /analytics/query`,
  which exits through `dispatcher-plugin.errorResponseBase`. That exit's only
  message guard was `looksLikeInternalErrorLeak` — a heuristic over SQL/driver
  _phrasing_ — and all eleven read-scope message shapes return `false` from it.
  Measured at that boundary: **11 of 11 echoed verbatim**, at 500, with the policy
  content in `error.message`. A real reachable disclosure, not a theoretical one.

  ## What changed

  - **`@objectstack/types` gains `declaresServerFault(err)`**, exported from
    `error-leak.ts` beside `looksLikeInternalErrorLeak`. The heuristic asks whether
    a message _sounds_ internal; the declaration asks whether the producer _said
    so_. `error-leak.ts`'s own file header already states the principle — "do not
    ship driver internals to clients" is a property of the HTTP boundary, not of
    one router — and this is the second predicate that principle asks for.
  - **Both boundaries read it.** `dispatcher-plugin.errorResponseBase` gains the
    withhold (the fix); `rest-server.ts`'s `/analytics/dataset/query` catch drops
    its in-line copy of the same test in favour of the shared one. #5808 wrote that
    rule in-line on purpose — promoting a rule with one consumer is a speculative
    surface — and this is the second consumer, so it was promoted rather than
    duplicated (`#3843`/`#3867` paid for the two-implementations shape twice).
    The REST face's verdict is unchanged in every case: same `status >= 500` plus
    non-empty `code` test, over the same two fields.

  ## What deliberately did NOT change

  - ⛔ **This is not "withhold every 5xx".** #5667 kept **undeclared** 5xx errors
    legible on purpose: a bare `Error` from our own code ("no strategy can handle
    query …") is the operator's own bug report, names nothing tenant-sensitive, and
    still falls to `looksLikeInternalErrorLeak` alone. A 5xx carrying only half an
    envelope (a status with no code) is likewise still readable — inventing the
    withhold for it would be the consumer-side leniency Prime Directive #12 removes.
  - **4xx is untouched.** `declaresServerFault` requires `status >= 500`, so a
    deliberate business/validation answer can never be swallowed by it.
  - **`statusCode` is not accepted as a substitute for `status`.** `status` is the
    channel ADR-0112 declares; making a disclosure rule depend on which spelling a
    producer reached for would be the same leniency in a different place.
  - **The heuristic was not taught to recognise `[read-scope-sql]`.** That would be
    more prose sniffing — the mechanism #5352/#5367 exist to remove — and would only
    ever cover the family someone remembered to add.

  Coverage: `analytics-query-read-scope-withhold.test.ts` (runtime) drives six RLS
  policy shapes end-to-end through a **real** `AnalyticsService` on the real
  native-SQL path and the real mounted route, asserting the 500, that the whole
  serialized body contains no policy detail, that `error.code` still carries
  `READ_SCOPE_COMPILE_FAILED`, and that the full text is still on the
  `__obsRecordedError` side-channel — plus a positive control and both sides of the
  declared-vs-undeclared tiering. `error-leak.test.ts` (types) pins the predicate
  directly, including that all eleven read-scope shapes stay invisible to the
  heuristic. The REST face's existing `analytics-read-scope-refusal-envelope.test.ts`
  is green before and after, unchanged, which is the pin on the refactor.

- db9c331: fix(runtime,cli): 未设置 `NODE_ENV` 时 `/discovery` 不再自称 `development`,统一按 `production` 解读 (#5673)

  同一个「宿主没有设置 `NODE_ENV`」的事实,仓里原本有两套相反的默认:`os start` 未设时强制
  `NODE_ENV='production'`(`start.ts:248`),`os serve` 与 `os doctor` 按
  `NODE_ENV || 'production'` 解析 `.env*` 级联,而 `/discovery` 的 `environment` 字段
  直接把缺省读成 `development`。

  **为什么这个方向的错报是危险的那个。** `environment` 是**机器可读面**上的字段,客户端
  拿它回答「我在不在生产环境」,并可能据此不显示生产警示、放宽破坏性操作的二次确认。一个
  忘记设 `NODE_ENV` 的真实生产部署,过去会拿到 `development` —— 两种错法里代价更高的那种。
  按 maintainer 2026-08-06 裁定,缺省统一收敛到保守值 `production`。

  **迁移说明(行为变更,请对照自己的部署方式读)**

  - **生产部署忘设 `NODE_ENV`**:`/discovery` 的 `environment` 由 `development` 变为
    `production`。这正是本次修复的目标 —— 报的是实情,不需要任何动作。
  - **本地开发**:不受影响。`os dev` 会 spawn `serve --dev`,而 `serve` 在 `--dev` 且
    `NODE_ENV` 未设时就地设 `NODE_ENV='development'`(`serve.ts:490-491`),所以
    `pnpm dev` / `pnpm dev:showcase` / `dev:crm` / `dev:todo` 链路上 `NODE_ENV` 早已是
    显式的 `development`,`/discovery` 仍报 `development`。没有任何脚本因此改动。
  - **需要 `development` 却不走 `os dev` 的场景**(裸 `os serve`、以库形式内嵌运行时、
    自建容器入口):现在必须显式 `NODE_ENV=development`。这是本次唯一需要动手的一类。
  - **已设置的合法拼法一律不变**:`production`/`prod` → `production`,
    `staging`/`sandbox` → `sandbox`,`development`/`dev`/`test` → `development`。
  - **无法识别的拼法处置不回退**:`qa`、`preview`、`uat` 这类**设了但认不出**的值仍然
    降级为 `development`,#4828 的「绝不凭猜测宣称 production」保持原样。缺省不是猜测,
    是宿主选择不说 —— 两条是不同的规则,本次只动前者。

  **`os doctor` 新增一行提示。** `NODE_ENV` 未设时报
  `NODE_ENV  Not set — this environment is being treated as production`(warning,不影响
  退出码),`--verbose` 展开显式设置的两条命令。已设置的环境完全没有这一行,报告与从前
  逐字一致。统一默认让缺省变得**安全**,但也让「疏忽」和「有意的生产部署」变得无法区分;
  这一行是唯一能把两者分开的地方。

  **已知残留(已另开 #5936 跟进,本次不动)。** `/discovery` 有两个生产者。本次改的是
  `@objectstack/runtime` 的 `HttpDispatcher.getDiscoveryInfo()`;经 `@objectstack/rest`
  暴露的 `MetadataProtocol.getDiscovery()`(`packages/metadata-protocol`)把真实缺省原样
  递给共享映射函数,该函数对缺省仍返回 `development`。裁定把落点限定在 runtime 侧、把
  `packages/metadata-protocol` 标为跨域文件面,所以此处如实记录而非顺手绕过。

- 77022a9: feat(spec,runtime,metadata-protocol)!: one schema for both discovery producers — `capabilities` canonical, `features`/`endpoints` retired, `scoping` declared (#4828)

  `/discovery` is a machine-readable surface, but nothing compared what the two
  producers emit against what `packages/spec` declares. The only schema the
  protocol layer referenced was `GetDiscoveryResponseSchema` —
  `DiscoverySchema.partial().required({version}).extend({apiName})` — so
  `.partial()` hid every missing REQUIRED key while zod's default unknown-key
  strip hid every UNDECLARED emitted one. The two producers then drifted in
  opposite directions through the same blind spot.

  `DiscoverySchema` is now authoritative for producers, and each producer package
  carries a `discovery-schema-conformance.test.ts` that parses its LIVE shape
  against it and checks its emitted key set against the protocol schema's shape.

  **Breaking for anyone reading the dispatcher's `/.well-known/objectstack` body:**

  - `features` → **`capabilities`**, the name `DiscoverySchema` has always
    declared, in the declared `{ enabled }` shape. The same flags survive. This
    fixes a real defect: the SDK's `client.capabilities` getter reads
    `discoveryInfo.capabilities`, so against a dispatcher-served host it returned
    `undefined` for every flag while the answers sat one key away under `features`.
  - `endpoints` — **removed**. It duplicated `routes` verbatim as a
    "backward compatibility" alias; a consumer census across `objectstack`,
    `objectui` and `cloud` found no reader. Use `routes`.
  - `environment` is now **mapped** into its declared enum instead of passing
    `NODE_ENV` through raw (`test` → `development`, `staging` → `sandbox`,
    unrecognized → `development`, never `production` on a guess). `NODE_ENV=test`
    and `staging` previously advertised values outside the declared enum.

  **Additive elsewhere:**

  - `DiscoverySchema` declares `scoping` (optional) — the environment-scoping
    posture the REST endpoint has always emitted and `packages/client` has always
    consumed, now part of the contract instead of an undeclared extra.
  - The REST `/discovery` body gains the required `name` / `environment` /
    `locale`, so it can satisfy `DiscoverySchema` at all. `locale` is derived from
    the registered i18n service, the same way the dispatcher derives it.
  - `name` is canonical on both producers. `apiName` remains as a deprecated alias
    carrying the identical value and is **scheduled for removal in protocol 18**.
  - New exports: `DiscoveryEnvironmentSchema`, `DiscoveryEnvironment`,
    `resolveDiscoveryEnvironment`.

- fd8521f: fix(runtime): the HTTP dispatcher serves each request from its OWN resolved kernel — two tenants can no longer swap data sources under each other (#5155)

  A host constructs exactly **one** `HttpDispatcher` (`dispatcher-plugin.ts`
  `start()`), and every route it serves shares that instance. The kernel a request
  resolves to, however, is per request: on a multi-tenant host the injected
  `kernelResolver` (ADR-0006) picks a different one per environment.

  That per-request answer was being stored on a dispatcher **instance field**,
  `this.kernel`, written once per request by `resolveRequestScope()` and then read
  by `resolveService()` / `getService()` / `getObjectQL()` /
  `getRequestKernelService()` / `announceKernelEvent()` / `getRegisteredAiRoutes()`
  — every one of them behind at least one `await`. Node's single thread is no
  protection here: what it protects is code that does **not** hold mutable shared
  state across an `await`, and this held it across several.

  So two interleaved requests on two environments produced this:

  1. request A resolves, `this.kernel` = env-1's kernel;
  2. A yields at an `await` (session lookup, driver query);
  3. request B resolves, `this.kernel` = env-2's kernel;
  4. A resumes and resolves `objectql` / `metadata` / `automation` off **env-2**.

  One tenant's request reading another tenant's data source — a correctness and
  isolation defect, not a performance one. Single-environment deployments were
  never affected (`this.kernel === defaultKernel` always, so the write was
  idempotent), which is exactly why no local run or CI job ever showed it. It is
  now covered by a deterministic interleaving regression test
  (`http-dispatcher.multi-tenant-concurrency.test.ts`), which fails on the old
  code with request A being served env-2's data.

  **The fix: the resolved kernel travels on the request, and every facility that
  reads a kernel takes the request explicitly.** `HttpProtocolContext` gains a
  `kernel` field, written by `resolveRequestScope()` alongside the
  `environmentId` / `dataDriver` / `executionContext` it already writes there.
  There is no longer any `this.kernel` to rewrite. An `AsyncLocalStorage` carrier
  was deliberately **not** used: it would have reintroduced implicit mutable
  ambient context, which is the shape of this bug in a new costume.

  Three host-level readers moved to the host kernel explicitly, where they had
  been reading whichever tenant resolved most recently: `/ready` (readiness is a
  property of the replica), its driver-health probe, and the memoized
  single-environment `default-project` lookup.

  **Migration — `DomainHandlerDeps` and `ActionExecutionDeps`.** Every
  kernel-reading member now takes the request as its **first** parameter. If you
  implement or call either contract (both are exported from
  `@objectstack/runtime`; nothing in this monorepo or the sibling distributions
  did):

  - `deps.resolveService(name, envId)` becomes `deps.resolveService(context, name, envId)`
  - `deps.getService(name)` becomes `deps.getService(context, name)`
  - `deps.getObjectQL(envId)` becomes `deps.getObjectQL(context, envId)`
  - `deps.getRequestKernelService(name)` becomes `deps.getRequestKernelService(context, name)`
  - `deps.announceKernelEvent(event, payload)` becomes `deps.announceKernelEvent(context, event, payload)`
  - `deps.getRegisteredAiRoutes()` becomes `deps.getRegisteredAiRoutes(context)`

  `context` is the `HttpProtocolContext` the domain handler already receives. The
  same rule applies to the `action-execution` helpers, which take it right after
  `deps`: `callData`, `resolveAutomationService`, `dispatchFlowAction`,
  `invokeBusinessAction`, `resolveRouteActionDeclaration`.

  `HttpDispatcher.getDiscoveryInfo(prefix)` gains an **optional** second argument,
  the request context. Callers that serve `/discovery` straight off the host (the
  adapters, the dispatcher plugin) need no change and now describe the host kernel
  deterministically instead of whichever tenant asked last.

  `resolveProjectKernelObjectQL(context)` keeps its direct-caller kernel swap;
  the swap is now written onto that context, so it stays visible to the rest of
  that request and to nothing else.

- 81e2744: 端点链接线:声明式 `apis:` 端点的派发步现在跑完整条链 —— 匹配 → 策略(`authRequired` / `rateLimit` / `cacheTtl`)→ 目标执行(`object_operation` 走 `/data` 同一个 `callData`,`flow` 走 automation 服务)。

  兜底器(`dispatcher-plugin`)补齐三根一直缺的线:把完整的 `EndpointPolicyContext`(请求头、`remoteAddress`、与 server 级限流器同一个会话查询、每端点限流注册表、`trustProxy`)喂给派发步;把 `answer.headers` **写到线上**(此前 429 的 `Retry-After` 会被丢掉,客户端拿到一个不知道何时重试的 429);并在匹配前解析本请求的环境 / 身份(与 `dispatch()` 同一个 `HttpDispatcher.resolveRequestScope`),使委派调用带着调用方的 `ExecutionContext` 运行,而不是以 system 身份绕过 RLS。

  `cacheTtl` 的 `Cache-Control` 只挂在**成功**答复上,任何错误答复都不带它。多租户 host 若无法把请求解析到某个环境,该步**弃权**(不写任何东西,保留传输层原本的 404),而不是拿默认 kernel 的数据来回答。

  现网行为零变更:publish / validate 对非空 `apis:` 仍然硬拒(#5040 E7 前不撤),因此本链结构性不可达。

- 277eb36: **声明式端点的执行目标委派:`endpoint-executor` 纯模块(#5040 E5)**

  命中的 `apis:` 端点按 `type` 委派到**既有**执行管线,零新执行语义 —— 这是 #5040 §4 的裁决:声明式端点是既有管线的「稳定 URL 别名 + 策略层」,不是第二套执行方言;同一操作经声明端点与经内建路由必须得到一致的答案。

  - `type: object_operation` → `action-execution.callData`,参数形状逐条对齐 `/data`(`find`→`('query', {object, query})`、`get`→`('get', {object, id, select?, expand?})`、`create`→`('create', {object, data})`、`update`→`('update', {object, id, data})`、`delete`→`('delete', {object, id})`)。记录 id 取 `query.id`(词表未定义路径模板,执行器不发明一套);`object` **只**来自声明,请求改不动它。身份信封(`executionContext`)在五个操作上一律透传 —— #4936 摘除的死代码正是丢了这个参数,真跑起来会以 system 身份绕过 RLS。
  - `type: flow` → `IAutomationService.execute(target, buildAutomationContext(body, ctx))`,复用 `/automation` 触发路由**同一个**上下文构造函数(该函数因此从 `domains/automation.ts` 导出):`{recordId, objectName, params}` 翻译与完整身份信封转发一并继承,`runAs:'user'` 的流程不会 fail-closed 被拒(#3760)或以他人身份运行(#1888)。automation 槽为空或自称非 handler 时答 501,携带 discovery 同款处方句(ADR-0076 D12)。
  - `type: script` / `proxy`,以及缺 `objectParams` 的 `object_operation`:结构化 **501 NOT_IMPLEMENTED**(带处方),不猜语义。这个「不支持子集」在模块里只列一处,供 E7 的 publish 门直接照读。
  - 失败一律走既有错误包络:状态优先级与 `details` 组装照抄 `HttpDispatcher.errorFromThrown`(`.status` → `.statusCode` → 校验失败 400 → 兜底 500),5xx 消息过 `looksLikeInternalErrorLeak` 消毒(#3867/#3918)。新模块已加入 `error-envelope.conformance.test.ts` 的源码扫描名单。

  **本次落地不接线**:调度步(`api-endpoint-step.ts`)命中后仍答 501,把它换成「策略 → 执行」链是随后的小型接线单(等 E4 #5091 一并落地);叠加 publish 对非空 `apis:` 的硬拒(E7 前不撤),该模块结构性不可达,现网行为零变更。

- 41e605e: **声明式端点的映射键:`inputMapping` / `outputMapping` 链内应用(#5040 E5c)**

  两个键此前被 `ApiEndpointSchema` 声明、被 runtime 读取零次:作者写了、publish 放行、端点跑起来映射什么也不做 —— 正是 #5040 要消灭的「解析通过然后什么也不发生」中间态,也是 ADR-0049 `declared ≠ enforced` 的教科书形状(对 AI 写的元数据尤其糟:静默忽略的键不产生任何信号)。新纯模块 `api-mapping.ts` 是它们的唯一读者,语义**只**来自冻结词表的 describe 文本,取其最小忠实解读:

  - **`inputMapping`(_Map Request Body to Internal Params_)**:`source` 按点路径读**请求体**,投影出目标入参;在策略链通过之后、委派之前应用,因此映射永远买不通 `authRequired` / `rateLimit`,而 `endpoint-executor` 保持纯委派、对映射无感知。词表只说 body,**query 不并入**(合并会凭空发明一条谁覆盖谁的优先级规则),query 照旧原样抵达管线。
  - **`outputMapping`(_Map Internal Result to Response Body_)**:只作用于**成功**答案的载荷(`{success, data, meta}` 的 `data`),包络逐字保留 —— 声明改不动 `success`,也就无法把失败装扮成数据。401 / 429 / 400 / 501 一律不重映射。
  - **映射是投影,不是合并**:结果只由声明的 `target` 组成,未声明的字段不随行。出站方向因此天然是一份 allow-list —— `apis` 是平台的对外面(ADR-0121 D3),默认泄漏内部字段不是可接受的缺省。
  - **`source` 解析不到 ⇒ `target` 不写**(映射是投影不是校验器);**无声明 ⇒ 逐字节直通、按引用原样传递**,未声明映射的端点与 E5b 的行为完全一致。
  - **无法服务的声明响亮拒绝**,不静默跳过、不半应用:`transform`(全仓无「transformation function name」注册表,发明它是沙箱裁决而非映射细节)、不可用路径(空串、空段 `a..b`、`__proto__` / `prototype` / `constructor`)、互撞的 `target`(同路径或一个写进另一个内部)—— 均为结构化 **501 NOT_IMPLEMENTED**(带处方,点名具体条目如 `inputMapping[1].transform`),与 `endpoint-executor` 的 `unsupported` 分支同类同形。`outputMapping` 的这道判定在**委派之前**做:投影坏掉的 `create` 不该先插入记录再拒绝作答。
  - 新模块已加入 `error-envelope.conformance.test.ts` 的源码扫描名单。

  **现网行为零变更**:非空 `apis:` 在 publish / validate 仍被硬拒(E7 #5111 前不撤),整条端点链结构性不可达。上述「不支持子集」应由 E7 的 publish 门在作者写应用时就拒掉,本模块是运行期兜底,不是主关口。

- 2649ccb: feat(runtime,hono): 挂载 seam —— `setFallbackHandler` 实现 + 声明式端点派发步(#5040 E3, #5090)

  给声明式 `apis:` 端点铺上**唯一一条**能进入处理器的通路,并且这条通路在构造上不可能遮蔽任何
  已注册路由。执行器本身尚未落地,本次改动**零现网行为变更**:任何 stack 目前都无法发布非空
  `apis:`(publish 硬拒,直到 #5040 E7 翻转),所以这里新增的一切在真实组合里结构性不可达。

  **`@objectstack/plugin-hono-server` —— `IHttpServer.setFallbackHandler` 的实现**

  契约(#5080 落在 `@objectstack/spec/contracts`)的四条保证逐条兑现:

  - 映射到 Hono 的 `app.notFound` 钩子,**不是**通配路由。这是全部要点:通配路由要与之后注册
    的每一条路由竞争,而 Hono 按先注册者赢裁决,归属就变成插件 `start()` 顺序的函数 ——
    ADR-0076 D11 正是为此存在。兜底器只在全部显式路由未命中后运行,**零注册顺序依赖**。
  - handler 拿到的 `req.body` **可读**(与 `use()` 中间件 seam 相反,后者的契约明确不填充
    body),按 content-type 解析,与真实路由处理器走同一段代码。
  - 重复安装即**替换**,不成链。
  - handler 不写响应 → 适配器既有的未命中答案(404,或方法不匹配时 405 + `Allow`)原样保留。

  配套的一处属主收敛:404/405 应答此前由 `HonoServerPlugin.start()` 直接写在
  `getRawApp().notFound(...)` 上。`app.notFound` 是后调用者覆盖,兜底 seam 落在同一个钩子上,
  两个写入方意味着幸存者由插件启动顺序决定 —— 应答本体因此移入 `HonoHttpServer`
  (`installNotFoundSeam()` / `setFallbackHandler()` 在其中组合),一个钩子一个属主。行为
  逐字节不变(`notfound-405.test.ts` 原样通过)。

  顺带修好同一段代码上的两处不一致:适配器构造的 `IHttpRequest` 现在一律带
  `remoteAddress`(此前只有中间件 seam 有,同一个契约有两种形状);处理器**同步**抛出与
  异步 reject 现在报同一种结果(此前同步抛出会逃到 Hono 自己的错误页)。

  **`@objectstack/runtime` —— dispatcher 端点派发步**

  dispatcher-plugin 在 `start()` 中探测 `typeof server.setFallbackHandler === 'function'`
  并注册兜底器。对落在 ADR-0121 D1 保留段 `<prefix>/apps/<命名空间>/<子路径>` 下的请求,
  探测 `metadata` 服务的 `matchEndpoint`(#5089 的实现在并行开发,探测缺席即穿透):

  - **命中** → `501 NOT_IMPLEMENTED`,包络说明执行器随 17.x 落地(#5040 E4–E5 接策略键与
    执行目标);
  - **未命中 / 无 matcher / 无 metadata 服务 / 路径不在挂载前缀下** → **不写任何响应**,
    传输层既有的 404/405 答案原样成立(有回归测试逐字节钉住);
  - `matchEndpoint` 抛错按 5xx 出口应答,不降级为 404 —— 故障不得伪装成「没有这条路由」。

  派发步**不重入** `dispatch()`:那条管线会解析环境与 `executionContext`、跑匿名拒绝门、并以
  语义 404 收尾,把全部未命中请求灌进去会改变今天未命中请求的答案。裸 404 与语义 404 的收口
  是另一个决定,本次刻意不做。

  `route-ledger.ts` 新增 `* /apps/**` 登记行与 `NON_DISPATCH_MOUNT_PREFIXES`(本包在
  `dispatch()` 之外挂载的前缀),注记如实描述已接线的部分与**尚未**接线的执行部分;新增
  一致性测试钉住 ADR-0121 D1 赖以成立的事实 —— `/apps` 不属于任何内建域。

- a70cd0a: 声明式端点的策略键接线:`authRequired` / `rateLimit` / `cacheTtl`(#5040 E4)

  新增 `packages/runtime/src/endpoint-policy.ts` —— `ApiEndpointSchema` 三个策略键的唯一读取方,并接入端点派发步(匹配命中 → 策略链 → 答复)。三个键全部复用既有原语,零发明:

  - `authRequired`:复用 `shouldDenyAnonymous` 与 `ANONYMOUS_DENY_*` 常量,未认证得到与 `/meta`、`/ai`、`/security` 完全相同的 401 包络。默认值由 schema 物化(缺省即 `true`),执行器读不到「未声明」这个中间态;`authRequired: false` 是唯一的开门方式,且在 diff 中可见。
  - `rateLimit`:复用 #5006 的 `deriveBucketConfig` / `resolveRateLimitKey` / `SharedTokenBucketLimiter`,桶键为 `apiep:<端点名>:<主体或 IP>` —— 与 server 级预算各自独立计量,互不侵蚀。超限答与 server 级限流器逐字节一致的 429 + `Retry-After`。
  - `cacheTtl`:仅响应头语义(不实现服务端缓存,#5091 已裁)。正值 → `Cache-Control: private, max-age=<ttl>`(`private` 是安全规则:任何响应都可能是按主体裁剪过的);`0`/负值 → `no-store`;缺省 → 不发头;非 GET → 不发头并 warn 点名。

  链序按 #5040 §3:**先限流、后鉴权**、再算缓存头 —— 凭据爆破本就是匿名流量,先答 401 会让扫号者完全绕开计量。

  **结构性不可达、零现网行为变更**:非空 `apis:` 在 publish/validate 仍被硬拒(E7 翻转前),且派发步在未获得策略上下文时的答复与此前逐字节相同。

- 55dbbba: feat(spec,runtime,hono): `server.security.rateLimit` — an authored budget that actually returns 429 (#4910, #4937)

  Rate limiting in ObjectStack was three shapes with nothing between them. `packages/spec`
  declared `RateLimitConfig` in three places and the whole repo had **zero readers** for any
  of them, so an author wrote a budget, it parsed, and nothing happened (#4686).
  `@objectstack/runtime` shipped a token bucket whose comments claimed, in the present tense,
  that the dispatcher called it and short-circuited with 429 — it had **zero call sites**
  outside its own unit test, and the `DispatcherPluginConfig.rateLimit` field it told you to
  tune did not exist (#4937). Neither half was broken; they were simply never connected, and
  both were documented as if they were.

  They are connected now, along one narrow path.

  ## What you write

  ```ts
  export default defineStack({
    manifest: {
      /* … */
    },
    server: {
      security: {
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 600 },
      },
      trustProxy: false,
    },
  });
  ```

  `server:` is a **new** top-level stack key. Nothing declared it before, so no existing
  stack changes behaviour on upgrade — there is no configuration that was inert yesterday
  and starts throttling today.

  It is deliberately **narrow**: it carries `security.rateLimit` and `trustProxy` and
  nothing else, because those are the two keys with a consumer. It is NOT the nine-key
  `HttpServerConfigSchema` — the other seven have no reader and no authoring surface, and
  mounting them here would have made seven dead keys writable in one move (their
  enforce-or-remove fate stays with #4938). It is strict from birth (#4001), so a misspelled
  budget is rejected with the correction rather than silently defaulted, and `maxRequests: 0`
  is refused at `defineStack` rather than at 3am.

  **No `server.port`.** The listening socket belongs to the deployment, not the artifact, and
  `objectstack serve -p` already owns it. The precedence rule is recorded in the schema and
  the docs in advance, so it cannot be re-litigated per caller: **CLI flag > `server:` >
  built-in default.**

  ## What happens

  Every inbound request the server routes — REST, dispatcher, service routes, anything
  mounted on that transport — consumes from a token bucket sized `capacity = maxRequests`,
  refilling at `maxRequests / (windowMs / 1000)` per second. An empty bucket answers **429**
  with a `Retry-After` computed from the bucket itself and the standard error envelope
  (`code: "RATE_LIMIT_EXCEEDED"`). `OPTIONS` preflights are never metered.

  The bucket is keyed by **resolved principal**, falling back to the caller's **IP** for
  anonymous traffic — so one abusive session cannot spend another user's budget, and
  credential-stuffing traffic (which has no principal yet) is still metered per source. That
  IP comes from `X-Forwarded-For` / `X-Real-IP` **only when `trustProxy: true` is declared**;
  otherwise it is the transport's own peer address. Undeclared, those headers are attacker
  input: honouring them by default would hand anyone an unlimited supply of fresh buckets and
  let them drain a chosen victim's.

  Counters live in the kernel `cache` service when one is registered, so a multi-node
  deployment enforces one budget instead of one per node (ADR-0069 D2), resolved lazily at
  consume time so a cache plugin that registers later is still picked up (#4772). With no
  cache service at all it falls back to a per-process store and says so once, naming the
  consequence: the effective limit becomes the declared budget multiplied by the number of
  nodes, and nothing about the deployment looks wrong.

  ## Also in this change

  - **`IHttpServer.use()` is a real middleware seam.** The Hono adapter's implementation
    passed `{}` for both `req` and `res` and called `next()` unconditionally, so a registered
    middleware could not read the request, write a response, or decline to continue — a
    declared seam with no execution behind it, unnoticed because nothing called it. It now
    delivers method/path/query/headers plus the transport peer address
    (`IHttpRequest.remoteAddress`, new), and honours a short-circuit. Middleware must be
    registered before the routes it guards; the kernel's two-phase boot makes that automatic
    (`init()` before every `start()`).
  - **`packages/runtime/src/security/rate-limit.ts` no longer describes an execution chain it
    does not have** (#4937). The token-bucket arithmetic is extracted so the synchronous
    in-process limiter and the new shared-store one cannot drift, and `DEFAULT_RATE_LIMITS` is
    now labelled as the reference material it always was rather than as live defaults.

  ## Explicitly NOT wired

  `ApiEndpointSchema.rateLimit` and `ApiEndpointRegistrationSchema.rateLimit` remain
  **known-unwired**. Declaring them still changes nothing. They are not retired here either:
  the fate of the whole declarative `apis:` surface is undecided (#4936), and retiring one
  key of a surface that may yet be implemented would only have to be undone. Tracked, not
  silent.

- ae490ef: feat(mcp): 开源发行版终于消费 skill —— `instructions` 半边投影为 MCP `prompts` 原语 (#3905)

  `stack.zod.ts` 与 ADR-0063 §2 把 **skill 定为唯一第三方扩展原语**,而开源发行版
  (BYO-AI,cloud ADR-0025)里零消费方:`SkillSchema` 可作者化、被两条 lint 规则认真
  校验(`validateAiToolReferences` / `validateAiSurfaceAffinity`),却没有任何代码路径
  读它 —— 作者写 skill → 校验通过 → lint 通过 → **永不运行且无人告知**。这正是本仓
  ratchet 存在的意义所要消灭的 declared ≠ enforced 形状。

  **skill 的两个半边,现在各自说清楚跑在哪。**

  - **`instructions`(判断力)→ MCP `prompts` 原语,处处可用。** MCP 服务器补齐了
    `prompts/list` / `prompts/get`:每个带 `instructions` 的已注册 skill 成为一个
    MCP 客户端可以列出并取回的 prompt(prompt 名 = skill 机器名,`label` → `title`,
    `description` 原样带上)。HTTP 与 stdio 两条传输都服务它。
  - **`tools` / `surface` / `triggerConditions`(接线)→ 明确标注 cloud-runtime-only。**
    绑工具与激活判定是 in-product agent 循环的属性;MCP 里模型在客户端、服务端只有
    一张扁平工具表,AI 暴露的 Action 早已通过 `list_actions` / `run_action` 可达。
    文档与 schema JSDoc 如实写明,不再装样子 —— 但两半边在两个发行版里都照旧接受
    **校验**,所以开源里写的 skill 到 cloud 上语义完整,不必写两遍。

  **协议合规。** `prompts` 能力按规范声明:只有当宿主能读到本环境的 skill 元数据时
  才声明并注册处理器(能力协商如实,与 action 工具同一套优雅降级);无 skill 时
  `prompts/list` 返回**空列表而非报错**;`prompts/get` 取不存在的名字返回
  `-32602 InvalidParams`;没有 `instructions` 的 skill 与 `active: false` 的 skill
  不投影。HTTP 面的投影从**本请求自己的 bridge** 读(与 `describeObject` 同一条
  per-environment 通道),多租户宿主不会把一个环境的 skill 服务给另一个环境。

  **同时修掉同仓重名。** `packages/mcp/src/skill.ts` 从来不是 skill 元数据类型,
  而是 ADR-0036 Amendment C 的 `SKILL.md` 分发物 —— 在 `packages/mcp` 里 grep
  `skill` 先找到的一直是它。现在按各自承载的产物命名:`skill-md.ts`(SKILL.md
  分发物)与 `skill-prompts.ts`(skill 元数据 → prompts 投影),两侧模块头互指。
  包的公开导出名(`renderSkillMarkdown` / `OBJECTSTACK_SKILL_NAME` /
  `OBJECTSTACK_SKILL_DESCRIPTION` / `RenderSkillOptions`)一个未变。

- aac90a5: feat(spec,runtime,metadata-protocol,client)!: one closed capability vocabulary — every discovery producer emits every key (#5672)

  `#4828` renamed the runtime dispatcher's top-level `features` map to the
  canonical `capabilities`, which collapsed the _spelling_ split between the two
  discovery producers. It did not touch the deeper one: the two went on filling
  **disjoint key sets**.

  | producer                                                                             | keys it filled                                                                        |
  | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
  | `getDiscovery()` — `@objectstack/metadata-protocol`, upstream of REST `/discovery`   | `comments` `automation` `cron` `search` `export` `chunkedUpload` `transactionalBatch` |
  | `getDiscoveryInfo()` — `@objectstack/runtime` dispatcher, `/.well-known/objectstack` | `search` `websockets` `files` `analytics` `ai` `notifications` `i18n`                 |

  Only `search` overlapped. `DiscoverySchema.capabilities` was an open
  `z.record`, so both shapes parsed clean and no gate could see the split — while
  `packages/client`'s `capabilities` getter **asserted** the result was a
  `WellKnownCapabilities`. Against a dispatcher-served host
  `client.capabilities.transactionalBatch` was therefore statically `boolean` and
  actually `undefined`, as were `comments`, `cron`, `export` and `chunkedUpload`.

  Per the maintainer's 2026-08-06 ruling, the vocabulary is now closed and
  mandatory.

  **What a consumer sees.** Before: which capability flags exist depended on
  which kind of host answered, and a flag you were typed to receive could simply
  be missing. After: every discovery response carries **every** flag, always a
  boolean. A capability the host does not deliver is `enabled: false` — never an
  absent key — so a client can read a flag without knowing whether it reached a
  dispatcher, the REST endpoint, or anything else. `client.capabilities` no longer
  asserts its own return type: it enumerates the spec's key list, so the type is
  true by construction, and it reads a key an older server omits as `false`
  (fail-closed, matching the wire rule).

  **`@objectstack/spec`.** `WellKnownCapabilitiesSchema` becomes the one
  vocabulary and gains the six flags that were previously the dispatcher's alone
  (`websockets`, `files`, `analytics`, `ai`, `notifications`, `i18n`) — all six
  were already real answers on the wire, so this declares them rather than
  inventing them. `DiscoverySchema.capabilities` changes from an optional open
  record to a **required closed object** derived from that vocabulary, one entry
  per key. New exports: `WELL_KNOWN_CAPABILITY_KEYS` (the key list, derived from
  the schema so nothing can hand-list a fourth dialect) and
  `CapabilityDescriptorSchema` / `CapabilityDescriptor` (the `enabled` +
  optional `features` / `description` entry shape, previously inline).

  Required, not optional, is the `scoping` precedent read the other way round:
  `scoping` is optional because only one producer can honestly answer it, whereas
  every producer can answer `capabilities` — and an optional block would leave a
  consumer back at `undefined` for every flag.

  **Producers.** Each answers all thirteen keys from its own facts, with the basis
  recorded per key in the code. The dispatcher now measures `comments` off the
  `sys_comment` object in the registry it already resolves for its `/data` domain,
  and `automation` / `cron` / `export` / `chunkedUpload` off the same service
  predicates that gate its route advertisements. Its one honest `false` is
  `transactionalBatch`: the atomic cross-object `/batch` route is mounted by
  `@objectstack/rest`, and this dispatcher has no batch branch at all, so claiming
  the runtime's `transaction()` here would advertise an endpoint the host does not
  serve. `getDiscovery()` answers the six new flags off the service registry it
  already reads, gated on serveability so a self-declared stub does not advertise
  a capability it cannot back.

  **Gates.** The three `discovery-schema-conformance.test.ts` suites built by
  `#5682` and extended to `routes` by `#5743` gain a fullness criterion — every
  vocabulary key present, every `enabled` a real boolean, no key outside the
  vocabulary — with the allowance derived from the schema rather than written out.

  **Upgrading.** A producer or fixture that builds a `DiscoverySchema`-shaped
  document must now include a complete `capabilities` block; build it from
  `WELL_KNOWN_CAPABILITY_KEYS` rather than by hand. Consumers need no change:
  they receive strictly more keys than before, and any flag they already read
  keeps its meaning. The lenient wire wrapper `GetDiscoveryResponseSchema` still
  allows the block to be absent, so a response from an older server still parses.

### Patch Changes

- 9fe9c1d: feat(spec): declare the action-body `ctx.session` contract (#5697)

  An action body reads `ctx.session` on every dispatch, and until now **nothing
  declared it**. `actionContext` is a bare `any` at both dispatch sites
  (`domains/actions.ts`, `action-execution.ts`), the sandbox seam types
  `ScriptContext.session` as `unknown`, and the one spec-side mention was an
  inline literal on `ActionHandlerContext` carrying a `[k: string]: unknown`
  catch-all. Declared-nowhere, produced-anyway: no schema, no gate, no generated
  reference page, and nothing the liveness ledger could reach.

  That is how the surface drifted without anyone noticing. Its `roles` key carries
  `ExecutionContext.positions` — the ADR-0090 D3 vocabulary handed to authors under
  the one spelling that ADR forbids — while the hook side retired its own
  `session.roles` at #5050. One platform, one key name, two opposite answers.

  **`ActionSessionSchema` (`@objectstack/spec/ui`) declares that shape as built.**

  ```ts
  { userId?: string; organizationId?: string; roles?: string[] }
  ```

  This release changes **nothing about what the runtime produces** — it is phase 1
  of #5613's contract-first ruling, and declaring current reality is deliberately
  not the same as endorsing it:

  - `roles` is declared **deprecated** in its `.describe()` and its JSDoc. The
    rename to `positions`, with a deprecation window and an ADR-0087 semantic
    migration, is #5613 phase 2. There is deliberately **no `positions` key yet** —
    minting one before the migration would ship two live spellings of one value.
  - The schema is **not strict**, matching `HookContextSchema`: this is a runtime
    shape the platform hands a body, never authored, and closing it would turn a
    future engine-side enrichment into a parse failure for whoever parses a context
    they were given.

  Three facts the declaration now states, all of them previously discoverable only
  by reading the builder:

  - **Absent means the key is absent.** The builder uses conditional spreads, so
    `'organizationId' in ctx.session` answers `false` — not "present and
    `undefined`". The hook path's `input.id` on a bulk write is the opposite case
    (#5668); an `in` test does not port between them.
  - **No identity envelope yields no session at all** — `undefined`, never `{}`, so
    a body can tell "no caller" from "an anonymous caller" (#3712). One consequence:
    `roles` never appears on its own.
  - **`organizationId` is the blessed name** for the caller's active org; the
    v11-removed `session.tenantId` alias (#3280 / #3290) does not come back.

  Type-only on the runtime side, no behaviour change: `buildActionSession()` now
  declares `ActionSession | undefined` instead of `any | undefined`, and
  `ActionHandlerContext.session` is the schema's inferred type rather than an
  inline literal with a catch-all. A handler annotated with `ActionHandler` that
  read an undeclared key off `ctx.session` now gets a compile error naming it —
  that key was never produced. `ScriptContext.session` deliberately stays
  `unknown`: it is one seam over both body kinds, and hook and action sessions are
  different objects.

  The declaration ships with the gate it needed —
  `packages/runtime/src/action-session-shape-contract.test.ts` executes the real
  producer and asserts a non-strict parse of the built object returns it
  **unchanged**, so a key the builder starts producing without declaring here is
  stripped and the pin goes red.

- da5d1b4: fix(runtime): `ctx.user.name` is the acting user's display name, on every dispatch path (#5372)

  An action body reading `ctx.user.name` got the raw user id back — a _declared_
  key delivering a plausible **wrong value**, which is the failure mode
  "declared = enforced" exists to prevent. Nothing downstream can detect it: the
  value is a perfectly good string, so no `??` chain and no consumer-side guard
  tells it apart from a real name. Apps that trusted the declaration wrote opaque
  ids into user-facing surfaces (an activity timeline rendering
  `usr_01j…` as its actor for every logged activity).

  Three dispatchers built the caller's `user` object three different ways, and
  all three landed on the id:

  - **REST `/actions`** hardcoded `name: ec.userId`.
  - **MCP `run_action`** read `ec.userName ?? ec.userDisplayName ?? ec.userId`.
    Neither alias is declared on `ExecutionContextSchema` and nothing ever
    assigned either, so the chain's only reachable arm was the id.
  - **The AI routes** spelled the key `displayName` (same dead chain behind it)
    and read the caller's address off `ec.userEmail` — the declared field is
    `ec.email` — so `req.user.email` there was permanently `undefined`.

  **What changes.** One shared producer builds the user envelope for all three
  paths. `name` now carries `sys_user.name`, the platform's own profile
  display-name column, resolved once per request (a memo keyed on the request's
  ExecutionContext, so N action dispatches in one request cost one indexed read
  — ~0.22 ms measured against real SQLite — and nothing is cached across
  requests, so a rename takes effect on the user's next request).

  Resolution is **quiet**: no `sys_user` row, no engine, a failing read or a blank
  name falls back to the id. A missing display name never fails an action. So
  `name === id` now means exactly one thing — _this user has no resolvable display
  name_ — which is what makes the fix detectable from application code: any
  workaround of the form "if `ctx.user.name` differs from `ctx.user.id`, trust
  it; otherwise look the name up myself" **self-retires** the moment this lands,
  with no coordinated deploy.

  **One shape, and it is the spec's.** [ADR-0068 D1] declares `EvalUser` as the
  one user-context contract, mounted under `current_user` / `user` / `ctx.user`
  on the predicate surface — with `name` on it, meaning "display name". The
  dispatch envelope's identity core is now built through that same
  `createEvalUser` factory, so an action's `visible` predicate and its `body` —
  both spelled `ctx.user` — see one object: `id`, `name`, `email`, `positions`,
  `isPlatformAdmin`, `organizationId`. On top of that core the dispatch surfaces
  keep publishing what they already published: `userId` and `displayName`
  (aliases of `id` / `name`, same values), `roles` (the pre-ADR-0090 alias of
  `positions`), and the two authority channels `permissions` (permission-set
  names) and `systemPermissions` (capabilities), still side by side and never
  merged. Additive for every existing reader; no key was removed.

  The AI routes' second `req.user` producer (the concrete per-route mounts) is
  built by the same function, so the two can no longer drift apart by hand. Its
  display name comes from the session's own `user.name`, needing no extra read;
  its former `?? user.email` middle arm is gone so that `name === id` means the
  same thing on every producer — the address is still served under `email`.

  `buildActionSandboxContext` is unchanged: it passed the user through verbatim
  all along, and was never where the name was lost.

- 9f747ee: fix(runtime): unknown `/auth` sub-paths answer a clean 404 instead of leaking an internal `TypeError` (#5085)

  Measured on a real showcase boot:

  ```
  POST /api/v1/auth/login
  → HTTP 500
  {"success":false,"error":{"code":"INTERNAL_ERROR",
    "message":"request.headers.get is not a function","httpStatus":500}}
  ```

  `/auth/login` is an obvious guess — it is the industry-habitual name — and any
  integrator who tried it got a 500 naming an internal function call. The positive
  control `POST /api/v1/auth/sign-in/email`, a real better-auth route reached
  through the same forwarding layer on the same boot, answered 200 all along.

  **The producer.** `createDispatcherPlugin` mounted one legacy explicit route,
  `POST ${prefix}/auth/login`, and it was the only place in this repo that handed
  better-auth a **non-Fetch** request. `IHttpServer` gives a handler the adapter's
  internal `IHttpRequest`, whose `headers` is a plain object built from
  `c.req.header()`; the `/auth` domain forwards `context.request` whole to
  `IAuthService.handleRequest(request: Request)`, and better-auth's fetch-style
  handler opens with `request.headers.get(…)`.

  That route could not work for any caller: `/login` is not a better-auth endpoint
  (it appears in neither `plugin-auth`'s route ledger nor the documented endpoint
  list, which already stated "There is no `/auth/login` route"), and the domain
  does not route on the sub-path at all. Its only effect over the `/auth/*`
  wildcard the auth plugin mounts on the raw app was a 500 where the wildcard
  yields better-auth's own clean 404. **It is deleted** — per Prime Directive #12
  the fix belongs at the producer, not in a consumer-side conversion that would buy
  nothing but a more expensive 404. Every unknown auth sub-path now falls to the
  namespace owner exactly like every other one.

  **The exit.** A **throw** out of `IAuthService.handleRequest` is unattributable
  in the `/auth` domain: it never inspected the sub-path, never parsed the body,
  and cannot tell a caller mistake from a handler bug. Its message used to reach
  the client verbatim, because both dispatcher exits sanitise only on
  `looksLikeInternalErrorLeak` — a SQL/driver-dump heuristic with nothing to say
  about a `TypeError`. The message is now withheld **unconditionally**, following
  the same discipline as `mapDataError`'s terminal `UNCLASSIFIED_FAULT` branch:
  HTTP 500 with the catalog's `INTERNAL_ERROR` / `Internal server error`, and the
  original error handed to the server log where an operator reads it.

  Nothing changes for the honest paths. better-auth answers its own failures with a
  `Response` rather than by throwing, so a real 401/403/404/422 is still returned
  with its own body untouched, and `POST /auth/sign-in/email` still answers 200
  with its `set-cookie`.

- 43ca399: fix(runtime): `callData`'s ObjectQL fallback answers a missing record id with 404 `RECORD_NOT_FOUND` (#5138)

  `callData` (the data bridge behind `/data`, the MCP bridge and the declarative
  endpoint executor) is protocol-first with an ObjectQL fallback. The fallback
  gave **three different answers to one fact** — that `id` names no row:

  | verb     | before                                                      | on the wire             |
  | -------- | ----------------------------------------------------------- | ----------------------- |
  | `get`    | `return … : null`                                           | `200 { data: null }`    |
  | `update` | `throw new Error('[ObjectStack] Not Found')` — no `.status` | **500**                 |
  | `delete` | no existence check at all                                   | `200 { deleted: true }` |

  The protocol path has answered `404 RECORD_NOT_FOUND` on all three verbs since
  #4435 (re-asserted for the batch path by #5088), so the answer to the same
  request depended on something no caller can see: whether the deployment
  registered the `protocol` slot (`MetadataPlugin` / `@objectstack/metadata-protocol`).
  All three fallback branches now throw the SAME envelope the protocol throws.

  Two of these were actively harmful. `update` reported a caller mistake as an
  internal fault — every dispatcher exit reads `.status` → `.statusCode` → 500, so
  a 4xx fact entered error reporting and alerting as a 5xx. `delete` reported
  success for a row that never existed, which is the hardest class to notice: an
  integrator reading `200` records the cleanup as done.

  The envelope is not re-spelled. `recordNotFoundError` is now exported from
  `@objectstack/metadata-protocol` and imported by the fallback, so there is one
  construction point and the two paths behind one `callData` cannot drift apart
  again.

  **Upgrade note.** If you run an assembly WITHOUT the metadata-protocol plugin
  (lean hosts, and the MCP multi-env path that threads a raw driver), these three
  calls change their answer for a missing id — from `200`/`200`/`500` to `404
{ code: 'RECORD_NOT_FOUND', message: 'Record <id> not found in <object>' }`.
  Deployments that DO register the protocol slot are unaffected: they already
  answered `404` and this release does not touch that path. A client that
  branched on `data === null` from `GET /data/:object/:id` should branch on the
  `404` instead; a client that treated `DELETE` as idempotent should treat `404`
  as "already gone". Declarative endpoints (`object_operation`) inherit the same
  answer, since they reuse `/data`'s delegation.

  `delete`'s existence check is a `find` probe, not a read of what `ql.delete`
  returned: `IDataDriver.delete` declares `Promise< boolean >` and the protocol
  can read it, but `IDataEngine.delete` declares `Promise< any >` and the engine
  returns its driver's result through the hook chain — testing that for `false`
  would be reading a signal the contract does not promise, and it fails in the
  direction this fixes.

- eda599e: fix(platform-objects): 超预算后台 seed 期间不再空库自证 —— 一次启动不再跑两套契约

  #4769 已把 ADR-0104 的空库自证从 `kernel:ready` 挪到 `app:seeded`(本次启动自身数据的结算点),但保留 `kernel:ready` 作为「从不 seed 的内核」的兜底。剩下的窗口是这两个钩子**到达顺序可以颠倒**:`AppPlugin` 的 inline seed 超出软预算(`OS_INLINE_SEED_BUDGET_MS`,默认 8s)后转入后台,于是 `kernel:ready` 先到、兜底自证在 seed 仍在写的时候签发证书并把闸门翻到 strict——同一次 seed 运行的后半段撞上前半段从未见过的契约。showcase 冷启(`OS_INLINE_SEED_BUDGET_MS=1`)实测:自证发生在 +0.470s,seed 结算在 +3.617s,窗口 3.147s。

  现在两个钩子都先问一句「本次启动自己的 seed 落定了吗」,任一处报告仍有未结算的 seed 源就不签发。`app:seeded` 同样受这道检查约束——多 config app 的 bundle 会每个 app 触发一次,第一次并不是本次启动的结算点。

  新增 `seed-settlement` 契约(`@objectstack/spec/contracts`)承载这个信号,而不是让 platform-objects 去嗅 runtime 内部的 `seed-datasets` 服务:那个数组的存在只能说明「seed 源存在」,永远说明不了「已经落定」,而这两件事之间的差正是本 bug 的整个窗口。runtime 在选择分支之前先声明 seed 源,并在写入真正结束的同一刻结算它。

  **multi-tenant 与 `skipSeedData` 的 ADR-0104 姿态(2026-08-06 裁定,#4795)**:这两种部署会注册 seed 数据但在启动时并不写入(前者按 org 在 `sys_organization` insert 时重放,后者是 `os migrate` 的只读规划启动,#3917),`app:seeded` 永不触发。它们的姿态是**启动时不自证,等 `os migrate … --apply` 在真实扫描的证据上落笔**——由同一个判据自然得出,不需要单独分支。这是答案而不是缺口:在启动那一刻断言一次尚未发生的 per-org 重放不含违规值,正是 #4769 的同一个错误、只是引信更长;而停在 warn-first 是可恢复的方向,随时可由 `os migrate value-shapes --apply` / `os migrate files-to-references --apply` 关闭。

  `@objectstack/objectql` 侧只更新了 #4769 撤销机制的注释:「后台 seed 收尾晚于签发」不再是它要兜的场景(已在源头关闭),它对 `os dev` 热重载 seeder、运行期 marketplace 安装以及 lax 开关仍然有效。

- 7bf3d1c: fix(runtime): `callData('delete', …)` 的 ObjectQL 兜底返回 spec 声明的 `{ object, id, success }`,与 protocol 路径同形 (#5581)

  `callData` 是 protocol 优先 + ObjectQL 兜底,两条路径此前对「删除成功」给的是两种形状:

  | 路径                   | 此前                            | 现在                            |
  | ---------------------- | ------------------------------- | ------------------------------- |
  | protocol(`deleteData`) | `{ object, id, success: true }` | 不变                            |
  | ObjectQL 兜底          | `{ object, id, deleted: true }` | `{ object, id, success: true }` |

  规范只有一个:`DeleteDataResponseSchema`(`packages/spec/src/api/protocol.zod.ts`)声明的是
  `{ object, id, success }`,`deleted` 从未被任何 schema 声明;公开的 HTTP 文档
  (`content/docs/protocol/kernel/http-protocol.mdx`)也一直写的是 `success`。所以兜底是唯一
  的偏离方,protocol 路径与 spec、与文档都无需改动。

  这是 #5138 同一族缺陷的成功侧:#5138 收敛的是「记录不存在」的答案,本次收敛的是「删除成功」
  的答案 —— 后者是每一次正常请求都会走到的面,而非只在 id 写错时才碰到。此前按
  `DeleteDataResponseSchema` 写的客户端,在**未注册 `protocol` 槽**的精简装配上会从一个 HTTP 200
  里读到 `success === undefined`,即「删除到底成没成功」读不出来,而调用方无从分辨自己走的是哪条
  路径。消费端各自兼容 `success ?? deleted` 两种拼写正是 contract-first 禁止的形状,所以修在
  生产方,不在消费方。

  ## ⚠️ 升级须知(行为变化)

  **仅影响没有安装 `MetadataPlugin`(`@objectstack/metadata-protocol`,即注册 `protocol` 槽)的
  精简装配。** 装了该插件的部署走 protocol 优先路径,本来就返回 `success`,不受影响。

  在这类精简装配上,以下三个面的 `DELETE` 成功体键名由 `deleted` 改为 `success`:

  - `DELETE /api/v1/data/:object/:id`
  - MCP 的 `delete_record` 工具(`domains/mcp.ts` 的 `remove` 桥)
  - 声明式端点(`objectParams.operation: 'delete'`,#5092)

  若你的代码读的是 `response.data.deleted`,请改读 `response.data.success` —— 这也是 spec 与
  公开文档自始至终声明的键。删除行为本身(含 #5138 落的「记录不存在则 404 `RECORD_NOT_FOUND`
  且不发出写」)完全未变,变的只有成功体拼写这一个键。

- 217b791: fix(runtime): an HTTP adapter without `setFallbackHandler` now warns that declarative endpoints are unreachable (#5400)

  `setFallbackHandler` is the ONE seam by which a metadata-declared `apis:`
  endpoint reaches a handler, and it is optional on `IHttpServer`. On an adapter
  that omits it, every declared endpoint is permanently unservable and the caller
  gets the transport's bare 404 — indistinguishable from a typo.

  Until now the dispatcher announced that at `debug`, which the default
  `level: 'info'` does not print at all, so operators had no signal whatsoever.
  That level was correct only while a non-empty `apis:` was rejected wholesale at
  publish (#4936): no deployment could be missing anything, because none could
  declare anything. The #5040 E7 publish flip ended that premise — declarations
  publish now and stacks ship them — so the line is raised to `warn` and carries
  both halves AGENTS.md's "Absence must be loud" requires:

  - **consequence** — every metadata-declared `apis:` endpoint is UNREACHABLE on
    this transport and will answer a bare 404;
  - **remedy** — compose an HTTP adapter that implements `setFallbackHandler`
    (e.g. `@objectstack/plugin-hono-server`).

  `warn` and deliberately not `error`: this is a functional degradation (a
  capability is not mounted, and its next caller finds out), not a durability one
  — nothing here claims to have persisted anything. The level is welded by
  `packages/runtime/src/dispatcher-plugin.fallback-absence-warn.test.ts`, which
  fails both on a slide back to `debug` and on escalation to `error`, and pins
  that a conforming adapter stays silent.

  Operator-visible only: no API, schema or routing change. A deployment already on
  a conforming adapter (the default `@objectstack/plugin-hono-server`) sees
  nothing new.

- 18b8eaa: fix(runtime,tooling): `saveMetaItem` 进入持久性词表,包发布的可见性翻转不再静默丢写 (#4754)

  #4632 立的「Degradation log levels」规则由 `pnpm check:durability-log-level` 机械执行,
  但它只认 `DURABILITY_CRITICAL_CALLEES` 这张显式词表 —— 词表以外的持久性接缝它发现不了。
  #4669 的事故正是这一类:`protocol.saveMetaItem()` 失败被吞掉,整条投影路径停摆却一个红灯
  都没有,跨了一个发布周期才被偶然看见。本次把 `saveMetaItem` 加进词表,并把它照出来的
  每一处逐个判过。

  **真丢失的那一处已修好。** `POST /packages/:id/publish-drafts` 的 ADR-0045 可见性翻转
  (`packages/runtime/src/domains/packages.ts`)是一次搭别人便车的元数据**写入**:草稿已经
  发布,所以这个路由无论如何都答 200,而写失败只会在响应体里留下一个没人读的 `unhideError`。
  症状因此是「我明明发布了,应用却没出现」,而且要很久以后才有人把它和这里联系起来 ——
  正是 #4669 的形状。现在它按范本在 `error` 级别报告:点名是哪个包、其 app 仍然以
  `hidden: true` 存着因而在启动器里不可见、发布却报告了成功,并给出修复动作(重跑
  publish-drafts,幂等;或直接 `PUT /meta/app/<name>` 置 `hidden: false`),同时带上原始
  错因。响应契约不变 —— 仍然是 200,仍然带 `unhideError`。

  **闸门自身的两个精度缺陷一并修掉**(词表加一个条目就让它们暴露了,8 处命中里 4 处是误报):

  - **同文件 concise-arrow 报告器看不见。** 闸门文档明说 `catch` 一侧会追同文件的 helper,
    但遍历只访问子节点,而 `const logError = (...a) => console.error(...a)` 的函数体**就是**
    那个调用表达式本身,于是 `rest-server.ts` 里最响的两处 `/meta` PUT 反被判成「完全静默」。
  - **一处接缝被按嵌套层数重复指认。** 一个已被内层 `catch` 消化掉的调用,仍然算在每一层
    外层 `catch` 头上 —— 而那些外层多半是正确的路由级错误处理器。`packages.ts` 里同一个
    `saveMetaItem` 因此被报了三次。现在只有当内层 `catch` 每条路径都向外传播时,外层才被
    判定为真正的守卫。

  两个修复都在 `--self-test` 里双向钉住(改前必失败,改后才通过),自测用例由 CI 执行。

  判定为「故障已答给调用方」的三处(`meta.ts` 的 4xx/422、`protocol.ts` 两处结构化逐项
  失败报告)不是降级,记入 shrink-only 基线并附理由与关闭条件(#5241)。

- 78adc2e: fix(runtime): disabled packages no longer come back enabled after an empty-env restart (#5047)

  An operator who disables a package has that decision persisted to
  `<OS_HOME>/package-state/<environmentId>.json`, and boot replays it by seeding
  the registry's initial-disabled set **before** any package is registered — so
  every registration path (boot-artifact decomposition, `sys_packages`
  rehydration, HTTP install) installs those packages disabled.

  That seed ran inside `AppPlugin.init` **after** the empty-env early return. An
  empty environment is one whose artifact carries no app payload — which is
  exactly the environment where every package arrives later, from
  `PackageServicePlugin`'s Phase 2 replay of `sys_packages` or from an HTTP
  install. So on precisely those DB-driven environments the initial-disabled set
  stayed empty, and a package the administrator had disabled came back **enabled**
  on every restart, with no error anywhere: the disable had persisted correctly,
  it was simply never read.

  The seed now runs before that return, alongside the default hook/action body
  runners and the authored-translation sync, which are before it for the same
  reason. Non-empty environments are unaffected — the seed still lands before the
  manifest is decomposed — and the seed remains best-effort, degrading silently on
  kernels with no engine.

- 1203bb2: **声明式端点进 OpenAPI 文档;`/openapi.json` 的影子属主摘除(#5040 E6,并入 #5078)**

  `GET {basePath}/openapi.json` 只有一个属主,而且实测坐实是 `packages/rest`(#5078:真实 boot 拿到 355KB 的 OpenAPI 3.1 文档,`servers[0]` 按 Host 注入、`{object}` 展开出 199 条 paths、两条 `x-template` —— 三个指纹全部是 rest-server 的行为)。因此 `apis:` 端点的文档面加入 **rest-server 既有的 enrichment 管线**(与 `{object}` 展开同根、同一次请求、同样 best-effort),而**不是**在某个 metadata service 上实现 `generateOpenApi` —— 那会造出 ADR-0076 第 1 条明令禁止的第二属主。E1 的契约成员因此已剔除。

  每条声明贡献一个 path 条目:`path` 原样、`method` 小写作为 Operation 键、`operationId` = `name`,以及词表**真正带有**的两个文档字段 `summary` / `description`(缺省即缺省,不生成替身)。除此之外只写「执行器会怎么对待这条声明」的事实,逐条注明出处:`object_operation` 的 `get`/`update`/`delete` 记录 id 取 `query.id`(词表无路径模板语法)、`create` 答 201 其余 200、`script` / `proxy` 与缺 `objectParams` 的 `object_operation` 答 **501**。不编造任何 request/response schema —— 出厂文档的 `components.schemas` 是空的,凭空写 `$ref` 只会得到悬空引用。

  `authRequired` 由 schema parse 物化(缺省即 `true`),为 true 的条目引用**从文档自身读出**的 security 方案(不在 rest 里硬写方案名,否则就是第二处需要保持正确的地方),为 false 的条目写显式 `security: []` —— 这是 review 时一眼能看见的那个形状。不满足 `ApiEndpointSchema` 的存量条目**响亮跳过**并点名(与端点匹配器的装载门同一姿态);同 `method+path` 撞车时按「`name` 字典序在前者胜」裁决,与匹配器**同一条规则**,否则文档会指认一个运行时并不执行的端点;撞上内建路径时内建保留,声明被略过并报错。

  同时摘除 `http-dispatcher.ts` 里的 `generateOpenApi` 探测死分支:该方法在本仓与两个兄弟仓**零实现**,且 boot 实测**没有任何路由**把 `/openapi.json` 送进 `dispatch()` —— 双重死。`route-ledger.ts` 里对应的行与 `LEGACY_CHAIN_PREFIXES` 条目一并移除(原注记「falls through when metadata service lacks a generator」把「从来没有」写成了「有时没有」,正是 #5078 立单的失准点;把 prefix 留在一张自述为「if-chain 分支」的清单里,会在同一个 PR 里再造一次同样的谎)。该路由的唯一台账行在 `packages/rest/src/rest-route-ledger.ts`,一直是准的。

  **现网行为零变更**:publish / validate 对非空 `apis:` 仍然硬拒(E7 前不撤),所以今天枚举出的是空集,enrichment 原样返回同一个文档对象 —— 服务出去的字节与本次改动前逐字节相同,并有测试钉住。

- 2ddba89: fix(tenancy): eight sites answered "is this deployment multi-org?" with the demoted `OS_MULTI_ORG_ENABLED` (#5262)

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the authoritative knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — therefore reads `false` from
  `resolveMultiOrgEnabled()` while running a fully mounted organization wall.
  #5233 corrected two sites in `plugin-auth`; a census found eight more, all
  written before that function's doc comment was corrected. Third recurrence of
  the shape (cloud#1020, #5233).

  Each site was judged separately for **which** posture answers its question —
  what the operator REQUESTED, or what the `tenancy` service reports is actually
  IN FORCE — rather than converted mechanically:

  - `objectql` `SchemaRegistry` — the env-derived multi-tenant default. Reads the
    REQUESTED posture (it is constructed below the kernel, with no service
    registry to ask). The `organization_id` column was always provisioned; what
    diverged is its INDEX, so a posture-only deployment ran the Layer 0 wall's
    hottest predicate unindexed while SecurityPlugin compiled that same wall.
  - `plugin-dev` — whether to load the enterprise `@objectstack/organizations`.
    REQUESTED posture, mirroring `serve.ts`: this branch is what mounts the wall,
    so asking whether the wall is up would be circular. A posture-only dev stack
    previously never loaded the package at all and served traffic unwalled. Its
    diagnostic now names the posture that was requested instead of asserting
    `OS_MULTI_ORG_ENABLED=true` at an operator who never set it.
  - `runtime` `AppPlugin` (inline seed + hot-reload seeder) — EFFECTIVE posture,
    via the `tenancy` service. These ask "will the per-org replay run instead of
    me?", and on an ADR-0093 D5 degraded boot that replay does not exist, so
    keying on the request would defer to a replay that can never happen. Walled
    deployments previously inline-seeded exactly the NULL-organization rows the
    code's own comment exists to avoid.
  - `cloud-connection` marketplace local install (install-time seed + rehydrate
    heal) — EFFECTIVE posture, same reasoning. The install path is a write path:
    a walled deployment wrote every sample row with no `organization_id`, landing
    the app's data outside the wall its own reads apply.
  - `driver-sql` `isMultiTenantMode()` — REQUESTED posture (a driver has no
    kernel to ask, and a suppressed warning is the costlier error for a
    diagnostic). It also no longer memoises into `_multiTenantMode`: that froze a
    process-level fact into a per-instance verdict on whichever write landed
    first. The gate now resolves live, which is affordable because
    `auditMissingTenant` consults it only after the `tenantId` early-out.
  - `cli` `os verify` — REQUESTED posture. This one produced a green verification
    run over an unverified property: a posture-only deployment silently skipped
    every multi-tenant proof and exited 0.

  **No configuration change is needed anywhere.** Deployments setting only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  belt-and-braces configuration stays valid. Deployments that set only
  `OS_TENANCY_POSTURE` can now drop the redundant boolean. Single-org behaviour is
  unchanged at every site; only the knob each one reads is corrected.

- ef7845a: fix(runtime): 可见性翻转中途失败时,已落盘的 app 不再从响应里整批消失 (#5242)

  `POST /packages/:id/publish-drafts` 的 ADR-0045 可见性翻转是一个**循环**:每个 app 一次
  独立的 `saveMetaItem`,每次成功各自落盘。但 `unhidden` 数组声明在 `try` 之内、
  `result.unhiddenApps` 又只在整个循环跑完之后才赋值 —— 5 个 app 里第 3 个抛异常时,前 2 个
  **确实已经翻转并持久化**,却随栈一起被丢弃:响应里 `unhiddenApps` 压根不存在。

  后果有两层,都指向同一个「机器可读面在撒谎」:

  1. **响应少报了真实发生的事。** 调用方看到的是「翻转失败」,看不到「其中 2 个已经生效」。
  2. **`metadata:reloaded` 对这 2 个 app 漏播。** 紧随其后的重绑定段读的正是 `unhiddenApps`,
     字段缺失 → 这 2 个已经变可见的 app 不进 `changed` → boot-cached 的消费者(首当其冲是
     automation engine)不重新同步它们,要等下一次重启。

  修法按 PM 裁定取**增量累积**而非预校验:`unhidden` 与它的赋值一并提到 `try` 之外,名字只在
  对应的 `saveMetaItem` **兑现之后**才 push,因此这个列表在任意时刻恰好等于「已经落盘的那些」。
  赋值移到 `try/catch` 之后,成功与中途失败两条路径都会执行,并且仍在 announce 段之前 ——
  部分失败时 `unhiddenApps` 与 `unhideError` **并存**:前者说什么翻成功了,后者说还有没翻完的。
  `unhidden` 是每请求的局部量,不引入任何共享可变状态,符合 #5385 确立的显式传参姿态。

  同时修掉那条 `error` 日志的措辞:它原先断言「其 app **全部**仍以 `hidden: true` 存着」,
  一旦有翻转已落盘这句话就是假的。现在按两半如实点名 —— 哪些确实翻了(列出名字)、哪些仍然
  是隐藏的,以及一如既往的后果与修复动作。

  响应契约不变:仍然 200,字段还是原来那两个,只是部分失败时它们可以同时出现;重跑依旧幂等
  (已翻转的 app `hidden !== true`,循环会跳过)。

- 5aaa6fc: Deny anonymous callers on the `/actions` and `/automation` dispatch routes (#5519)

  `@objectstack/rest`'s `/data` and the dispatcher's `/meta`, `/ai` and `/security`
  have answered an unauthenticated caller 401 `UNAUTHENTICATED` since #3963 made
  "anonymous access is always denied" a platform promise (the `api.requireAuth`
  opt-out is a tombstone). The dispatcher's own `/actions/*` and `/automation/*`
  routes — mounted by `dispatcher-plugin.ts` onto the host server, a different
  registration path from the REST one — carried no anonymity check at all.

  `/actions` was the expensive half: a `script` action's body executes with
  `isSystem: true` forced on (`buildActionExecutionContext`), so an
  unauthenticated POST bought an RLS/FLS-bypassing SYSTEM write. The only gate
  ahead of it was ADR-0066 D4's `requiredPermissions`, which allows every action
  that declares none — i.e. most authored actions. On `/automation`, anonymous
  callers could trigger a flow run, list every flow, register one, and
  unregister one.

  Both domains now call the shared `shouldDenyAnonymous` decision before anything
  dispatches, returning the same 401 envelope every other seam returns. Finer
  authorization is unchanged and still runs for callers who clear the floor —
  `requiredPermissions` (ADR-0066 D4), `ai.exposed`, the ADR-0104 param contract.

  **What passes unchanged:** any authenticated caller (session, API key or OAuth
  principal), and internal `isSystem` contexts. CORS preflight (`OPTIONS`) is
  exempt as always. Internal dispatch paths never enter these HTTP handlers and
  are untouched — the MCP `run_action` bridge, the declarative endpoint executor
  (a `type: 'flow'` endpoint keeps its own `authRequired` gate, so an explicit
  `authRequired: false` endpoint stays public), and engine-internal record-change
  and schedule triggers.

  **Behaviour change to expect:** an unauthenticated call that previously got 200
  (or 403 on a `requiredPermissions` action, or 405/501) now gets 401. If a
  deployment relied on unauthenticated action or flow invocation, the supported
  replacement is a declared endpoint with `authRequired: false`, a public-form
  grant, or a share-link token — never an anonymous `/actions` POST.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [f7df82c]
- Updated dependencies [978fed2]
- Updated dependencies [c36abfe]
- Updated dependencies [cfc293f]
- Updated dependencies [d085670]
- Updated dependencies [de70b42]
- Updated dependencies [2f6516e]
- Updated dependencies [01c0bae]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [7a40b7a]
- Updated dependencies [7cf1531]
- Updated dependencies [586d6f7]
- Updated dependencies [2d14b35]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [c497d26]
- Updated dependencies [e96ad55]
- Updated dependencies [bbdbf28]
- Updated dependencies [93929c2]
- Updated dependencies [2e284b2]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [75bb3af]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [533a0a4]
- Updated dependencies [1f82d1e]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [846ed1f]
- Updated dependencies [947d4f9]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [3133cda]
- Updated dependencies [99d7a93]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c794f78]
- Updated dependencies [9ce0ca9]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [2b63a00]
- Updated dependencies [06ba036]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [0f17114]
- Updated dependencies [ecc61ab]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [96d3d4d]
- Updated dependencies [db0d53c]
- Updated dependencies [afa6aa5]
- Updated dependencies [afb83d3]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [2b2175b]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [729a43a]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [d97f2a2]
- Updated dependencies [d9cac60]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [290d944]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [5d3ced9]
- Updated dependencies [9fa6bab]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [61dc08e]
- Updated dependencies [8dcf607]
- Updated dependencies [b691ba9]
- Updated dependencies [65159ae]
- Updated dependencies [1eadac0]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b26699]
- Updated dependencies [95b4f0d]
- Updated dependencies [877545c]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [444a07c]
- Updated dependencies [288e5a4]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [60a7a2d]
- Updated dependencies [1c625ca]
- Updated dependencies [b5459bc]
- Updated dependencies [1624f4a]
- Updated dependencies [e6db317]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [1cae606]
- Updated dependencies [4addd9d]
- Updated dependencies [108ba8d]
- Updated dependencies [b9cc17d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [75f82f3]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [de113a4]
- Updated dependencies [db8c285]
- Updated dependencies [0d24078]
- Updated dependencies [089767f]
- Updated dependencies [5b8f95b]
- Updated dependencies [da538b1]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [79822b5]
- Updated dependencies [15e61fb]
- Updated dependencies [72bd873]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [dde9202]
- Updated dependencies [37a8f2b]
- Updated dependencies [441d79f]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [9c5abf4]
- Updated dependencies [dc6abfd]
- Updated dependencies [39396bd]
- Updated dependencies [577cd27]
- Updated dependencies [5897552]
- Updated dependencies [91ec1ea]
- Updated dependencies [2d25303]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [bf1edef]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5ab0842]
- Updated dependencies [5c94f83]
- Updated dependencies [d275c10]
- Updated dependencies [f98fa65]
- Updated dependencies [73e576f]
- Updated dependencies [2680cd3]
- Updated dependencies [1d29e6d]
- Updated dependencies [c5a5996]
- Updated dependencies [5ea8e1e]
- Updated dependencies [cba7454]
- Updated dependencies [b40f81c]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [1216dcc]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [193cd5c]
- Updated dependencies [5aae790]
- Updated dependencies [07f1822]
- Updated dependencies [ef8b1ff]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [d56bcdb]
- Updated dependencies [dca25e1]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [488b66c]
- Updated dependencies [c89d18c]
- Updated dependencies [acf34e3]
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
- Updated dependencies [90fa077]
- Updated dependencies [e92e2c3]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [38f53a0]
- Updated dependencies [c183a12]
- Updated dependencies [69a89ce]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
- Updated dependencies [2b52bc8]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/driver-sql@17.0.0-rc.4
  - @objectstack/driver-memory@17.0.0-rc.4
  - @objectstack/rest@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/metadata-protocol@17.0.0-rc.4
  - @objectstack/metadata@17.0.0-rc.4
  - @objectstack/plugin-auth@17.0.0-rc.4
  - @objectstack/objectql@17.0.0-rc.4
  - @objectstack/plugin-security@17.0.0-rc.4
  - @objectstack/service-datasource@17.0.0-rc.4
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4
  - @objectstack/metadata-core@17.0.0-rc.4
  - @objectstack/observability@17.0.0-rc.4
  - @objectstack/service-cluster@17.0.0-rc.4
  - @objectstack/service-i18n@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- 0e96e46: refactor(spec,cli,runtime)!: 退役 `crypto.hash` 能力 —— 声明了四层、构建期还自动推断,沙箱从没实现(#4391,ADR-0049 enforce-or-remove)

  `crypto.hash` 是四层声明、零层实现:`HookBodyCapability` 枚举收它、枚举旁的文档表列它、CLI 提取器**自动推断**它、`ScriptContext.crypto.hash` 还写了签名 —— 而 `installCtx` 只往 VM 的 `ctx.crypto` 上装了 `randomUUID`。于是这个 token 唯一授权的那次调用,**每一次都在 VM 里抛**。

  这比普通的 declared ≠ enforced 更毒一档,坏就坏在**构建期推断**:作者(尤其是 AI 作者)写下 `ctx.crypto.hash(...)`,提取器就替他把能力加进 `capabilities`,`os build` 因此全绿 —— 系统亲手把人送进一条必炸的死路,而唯一诚实的记录是文档表格里一句 `_(not yet wired)_`,没有作者会先读表格再写 body。

  **裁决是 remove,不是实现**(维护者 2026-08-02):从未实现、调用即抛、**零投诉** —— 对一个每次使用都抛错的能力来说,这本身就是最强的活性证据,没人需要它。在沙箱里实现 crypto 会扩大沙箱的能力面与安全审查面,那是长期成本而非一次性工时,无业务拉动不做。真需要哈希时按能力准入流程重提:**实现先行,声明随实现走**(ADR-0049 的 enforce 腿留给有实现的那天)。

  ## FROM → TO

  | 写了什么                            | 现在怎么办                                                                            |
  | :---------------------------------- | :------------------------------------------------------------------------------------ |
  | `capabilities: ['crypto.hash']`     | **删掉这个 token**。它从未授权成任何东西                                              |
  | `await ctx.crypto.hash(algo, data)` | **删掉这次调用**。它从未返回过值 —— 今天能跑的代码没有一行依赖它                      |
  | 确实需要哈希                        | 在 host 侧做(Connector recipe,或引擎侧 hook)。沙箱内哈希须走能力准入流程重开,实现先行 |

  一句话修法:**两个都删**。`os migrate meta --from 16` 会自动帮你剥掉 token;那行**死调用是你自己要删的** —— 转换层刻意不改 body 源码(见下)。

  ## 定级理由(逐条自证,未照抄前例)

  三问按 #4535 §5 逐条走:

  1. **会不会 TS2305 / TS2339?** 会,两处。`HookBodyCapability` 是 public 导出类型,把它当**字面量联合**用的代码(`const c: HookBodyCapability = 'crypto.hash'`、对 token 做穷举 switch)现在编译失败;`ScriptContext.crypto.hash` 的调用点以 TS2339 失败。实测三仓(objectstack / cloud / objectui)裸名扫描 `crypto.hash` / `ctx.crypto.hash` / `'crypto.hash'` —— **两个兄弟仓零命中**,本仓命中全在本 PR 内清理。
  2. **有没有元数据迁移?** 有。token 是写在作者源 hook/action body `capabilities: []` 数组里的**值**,也会躺在已存的 `sys_metadata` 行里 —— 故注册了 ADR-0087 D2 转换 `hook-body-crypto-hash-removed`(D3 挂 protocol-17)。这是与 #4767 / #4783 / #4616 的分界:那三单退役的是**导出名 / 运行时描述符**,没有作者源可改写;本单有,和 `object-enable-trash-mru-removed` / #4734 同侧。
  3. **形状变更?** 是**枚举值收窄**(6 → 5),不是 key 移除。故**没有 `retiredKey()` 墓碑** —— `capabilities` 这个 key 本身依然活着、依然被强制。处方改由枚举自己的 error map 承载,并按 `object.managedBy: 'system'` 的先例**以 `issue.input` 为键**:只有「曾经合法」的那个拼写会被告知「was removed」,写错成 `crypto.hsah` 的作者拿到的仍是 zod 自己那条列出合法 token 的消息 —— 告诉他「你的值被退役了」属于误导。

  `@objectstack/cli` 与 `@objectstack/runtime` 同定 **major**:前者 `ExtractedBody.capabilities` 的公开联合类型收窄(赋值给它的代码 TS2322),后者 `ScriptContext.crypto` 少一个成员(TS2339)。

  ## 门禁实报

  枚举值收窄对四张 ratchet **全部不可见**,这一点值得单独记一笔:`authorable-surface.json` 记到 key 级(`data/ScriptBody:capabilities`),`json-schema.manifest.json` 记 def 名(`data/HookBodyCapability` 仍在),`packages/spec/json-schema/` 本身 gitignore。所以 `check:authorable-surface` / `check:api-surface` 实跑**零变化**,`check:liveness` / `check:empty-state` 同样 PASS(`capabilities` key 仍活,不产生台账行变更)。

  也就是说:**本次移除没有任何一张基线能自动兜住它** —— 兜住它的只有本 PR 新增的 pin 测试(spec / cli / runtime 各一组,已 sabotage 实跑验证复活即红)。`check:generated` 8/8 绿,移动的是 `spec-changes.json`、`docs/protocol-upgrade-guide.md` 与两页生成参考文档(`data/hook-body.mdx`、`ui/action.mdx`,枚举选项随之少一项)。

  ## 转换刻意不做的事

  `hook-body-crypto-hash-removed` 只从 `body.capabilities` 里剥掉死 token,**不碰** body 源码里那行 `ctx.crypto.hash(...)`。这是有意的:那行调用从未返回过值,剥掉授权不会让任何还能跑的东西变坏;但把它一并「修好」会让作者失去唯一一个还在提醒他「这里有段死代码」的信号。`retiredFromLoadPath: true` —— 枚举当场拒绝,活作者在 parse 时就被教育,转换存在的意义是让已存的 16.x / 17-rc 行重放干净(否则永远被打成 `metadata_spec_invalid`,把链上历史误标成当期违约)以及让 `os migrate meta --from 16` 改写作者源。

### Minor Changes

- 430dcc2: fix(runtime,lint): `action.body` binds a handler only for `type: 'script'` (#4352)

  `ActionSchema.body` has always described itself as "Only used when type is
  `script`", and its JSDoc went further — "Only meaningful when
  `type === 'script'`. When set, the runtime invokes the body inside the sandbox
  … and ignores `target`." The runtime read none of it:
  `actionBodyRunnerFactory` bound a handler the moment `body` parsed, and
  `collectBundleActions` collected any named action. A `type: 'url'` action
  carrying a leftover `body` was therefore registered in the action registry and
  executed in the sandbox — reachable through
  `POST /api/v1/actions/:object/:action` and through
  `ql.object(o).execute(name)`, and counted by the governance inventory as a live
  handler.

  Declared ≠ enforced, in the shape that is hardest to debug: an author flips
  `type` from `script` to `url`, reasonably concludes the body is now dead code,
  and it keeps running with nothing anywhere saying so.

  **Behaviour change.** `body` now runs only under `type: 'script'`:

  | Action                                                         | Before    | After                                                  |
  | :------------------------------------------------------------- | :-------- | :----------------------------------------------------- |
  | `type: 'script'` + `body`                                      | body runs | unchanged — body runs                                  |
  | `type` omitted + `body`                                        | body runs | unchanged — body runs (`ActionType.default('script')`) |
  | `type: 'url' \| 'modal' \| 'flow' \| 'api' \| 'form'` + `body` | body ran  | **no handler is bound**; the refusal is logged         |

  Only an action that **explicitly** declares a non-`script` type _and_ carries a
  `body` changes behaviour. An omitted `type` still means `script`, because the
  collectors walk raw bundle objects — a `strict: false` `defineStack` or a legacy
  `manifest.actions[]` never passes through `ActionSchema`, so the schema's own
  default has to be applied at the gate rather than assumed to have been applied
  already.

  **FROM → TO.** If you have an action whose body you want to keep running, set
  `type: 'script'` and move the navigation/dispatch target elsewhere; if you want
  the target behaviour, delete the now-inert `body`:

  ```diff
    {
      name: 'open_portal',
  -   type: 'url',
  +   type: 'script',
      target: '/portal',
      body: { language: 'js', source: "await ctx.api.object('lead').update(…)", capabilities: ['api.write'] },
    }
  ```

  The refusal is **not** silent — silence would only relocate the invisibility the
  issue is about. `actionBodyRunnerFactory` logs a warning naming the action, its
  declared `type`, and both fixes.

  Authoring-time rejection of the same contradiction already shipped in #4438
  (`ActionSchema` rejects `body` alongside a non-`script` `type`), so what remains
  reachable here is data at rest published before that gate existed, plus bundles
  that never parsed. This release closes that half. New tests also pin that the
  **publish gate resolves to the rejecting schema** — through
  `getMetadataTypeSchema('action')` and `ObjectSchema.actions` — so a re-point of
  either registration cannot silently reopen the hole while the schema's own unit
  tests stay green.

  `@objectstack/lint`'s `validate-action-body-writes` filters by `type` again.
  #4344 deliberately made that rule type-blind on the grounds that "the runtime
  binds a handler from `action.body` alone … checking what executes beats checking
  what the schema says should" — true then, and the comment predicted its own
  revision. Execution and declaration are the same set again, so a non-`script`
  body no longer produces write-set advice about writes that provably never
  happen; the publish gate names that metadata's real defect (`type`) with its own
  prescription.

  `collectBundleActions` stays deliberately type-blind: it feeds governance
  surfaces that must enumerate every declared action, bound or not, and the other
  bind path (`engine.setDefaultActionRunner`, for Studio-authored actions) never
  walks it. The gate lives at the single point where a `body` becomes an
  executable handler, so there is no second copy of the rule to drift.

- 63b33e6: A `datasourceMapping` rule is routing, not a hint — an object mapped to an
  unreachable datasource no longer silently reads and writes the DEFAULT store
  (#4462).

  **Observable behavior change; read this before upgrading.** Measured on `main`
  during the v17 verification: map an object to a Postgres datasource with a bad
  URL and the boot succeeds, `/ready` answers `200`, the datasource name appears in
  **zero** log lines, `POST /api/v1/data/<mapped object>` returns `201` — and the
  row is physically in the default store. The operator finds out by opening the
  database they declared and finding it empty. ADR-0062 D2's phase-1 note called a
  mapping-only datasource "decorative" to keep an example byte-for-byte unchanged;
  what that bought was a silent data-placement bug.

  The fix is a pair, and each half is what makes the other correct:

  1. **Routing stops falling through** (`@objectstack/objectql`). `getDriver` step
     2: a mapping rule that MATCHES and names a datasource with no live driver now
     throws — `DatasourceUnavailableError` when the connect layer recorded a
     verdict, otherwise an error naming the object, the datasource and the two
     remedies. `default` still resolves onward: the default driver keeps its
     natural name (#3826), so step 5 is how routing to it works.
  2. **ADR-0062 D2 grows gate (d)** (`@objectstack/service-datasource`,
     `@objectstack/runtime`). A datasource a mapping rule routes at least one
     object to is auto-connected at boot, and a boot-time connect failure is
     **fatal** with an operator-readable reason — the same call gate (b) already
     makes for an explicit `object.datasource` binding, now correct for (d)
     because half 1 removed the fallback. `OS_ALLOW_DRIVER_CONNECT_FAILURE` still
     degrades the boot instead, as for every other fatal connect.

  The mapped-object list is resolved by the boot path from the engine's own
  matcher (`ObjectQLEngine.resolveMappedDatasource`, newly public) and passed to
  `connectDeclared({ mappedObjects })`; the connection service never re-derives
  rule matching. Two matchers drifting by one clause would connect a datasource
  routing never uses, or route to one nothing connects — the defect again.

  **What to do if this breaks your boot.** It means a `datasourceMapping` rule in
  your stack points at a datasource that cannot be connected. Either fix the
  datasource configuration, or delete the rule — the second is what
  `examples/app-crm` did in this change, and it is what keeps that example's
  runtime behavior identical: its rules routed everything to an unconnected
  `:memory:` datasource, i.e. to the default store by fall-through.

- ac471a0: **BREAKING**: `IAutomationService.getSuspendedScreen(runId)` is now **async** — it returns `Promise<ScreenSpec | null>` instead of `ScreenSpec | null` (#4515).

  FROM → TO for anyone calling or implementing it:

  ```ts
  // caller
  - const screen = automationService.getSuspendedScreen(runId);
  + const screen = await automationService.getSuspendedScreen(runId);

  // implementer
  - getSuspendedScreen(runId: string): ScreenSpec | null
  + async getSuspendedScreen(runId: string): Promise<ScreenSpec | null>
  ```

  One-line fix: `await` the call (the enclosing function is almost certainly already `async`), and make any test double resolve rather than return (`mockResolvedValue`, not `mockReturnValue`).

  Why it had to change: the method could only ever read the engine's in-memory hot cache, because a synchronous signature cannot consult the durable suspended-run store. `SuspendedRun.screen` _is_ persisted (`sys_automation_run.screen_json`) and `resume()` cold-reads it back, so after a process restart a still-suspended screen run could be resumed (`POST …/runs/:runId/resume` → 200) while `GET …/runs/:runId/screen` returned 404 “No pending screen for run” — the refresh-safe re-fetch failing in exactly the situation it exists for (page refresh, another device), and the rendering half of ADR-0019's durable-suspend promise missing while the resuming half shipped.

  `AutomationEngine.getSuspendedScreen` now takes the hot cache as its fast path and falls through to the store via the same loader `resume()` rehydrates from. A run that does not exist, is no longer suspended, or paused at a non-screen node still resolves to `null`, so `GET …/runs/:runId/screen` keeps returning 404 for genuinely absent runs. No sync variant of the method remains on the contract.

- eb4204b: feat(automation): a `script` node's purity contract is declared, and a function that writes can say so (#4396)

  The `script` executor's contract — _the named function returns a value; data I/O
  stays on the flow graph_ — existed only as a comment inside the executor, while
  #4354's run summary depended on it. That summary reports no record metrics for a
  `script` step precisely because a pure function's writes are downstream
  `create_record` / `update_record` nodes counting themselves. A function that
  wrote anyway made its run report `selected: 30, acted: 0` — indistinguishable
  from the broken sweep the counters exist to detect, recorded permanently on
  `sys_automation_run`.

  **The rule is now visible.** `ActionDescriptor` carries
  `handlerContract: 'none' | 'pure'`, and the `script` descriptor publishes
  `'pure'`, so the action catalog, the designer palette and the reference docs
  state the rule an author has to follow instead of an executor holding it
  privately.

  **And a legitimate writer can opt out honestly.** A `defineStack({ functions })`
  entry may declare what it does, in either shape:

  ```ts
  defineStack({
    functions: {
      scoreLead: (ctx) => ({ score: 42 }), // pure — the default
      syncBilling: { handler: syncBilling, effect: "writes" }, // declared writer
    },
  });
  ```

  A step calling a declared writer reports `unmeasuredEffect`, so the run's
  `unmeasured` tally keeps the broken-sweep query
  (`selected > 0 AND acted = 0 AND unmeasured = 0`) off that flow — and only that
  flow. Marking _every_ `script` step unmeasured was rejected: it would blind the
  detector on every flow that calls any function in order to cover the few that
  break the rule.

  Nothing here is retired or renamed: a bare `functions: { fn }` entry is
  unchanged and means `effect: 'pure'`. The declaration is carried end to end —
  `ObjectQL.registerFunction` accepts `{ packageId, effect }` alongside the
  existing `packageId` string and exposes `resolveFunctionEntry(name)`,
  `objectstack build` lowers a declared entry without dropping it, and the
  artifact loader re-attaches the module's callable to the declaration the JSON
  carried.

  **Also fixed:** `bindHooksToEngine` returned before registering a bundle's
  functions when the stack declared no hooks, so a flow-only app's
  `defineStack({ functions })` reached the engine as nothing and every `script`
  node calling one failed with "no function named 'x' is registered".

- 8aacf94: feat(rest,runtime,client): `POST /meta/_migrate-stored` — run the stored-metadata migration without a shell (#4327)

  `os migrate meta --stored` (#4327) gave ADR-0087's stored-metadata chain a finish
  line, but only for someone who can reach the deployment's database from a
  terminal. A hosted operator cannot, so on a managed deployment the chain had no
  finish line at all — just the per-read conversion, running forever, with no way
  to assert what protocol the rows are on.

  The same pass is now reachable over HTTP:

  ```ts
  const preview = await client.meta.migrateStored(); // writes nothing
  const result = await client.meta.migrateStored({ apply: true });
  const flows = await client.meta.migrateStored({ types: ["flow"] });
  ```

  It returns the same `StoredMigrationReport` the CLI renders, and takes the same
  posture:

  - **Preview by default.** `apply` must be literally `true`; an empty body, a
    missing body, and `"apply": "yes"` all preview. Nothing is inferred.
  - **Gated on `manage_metadata`.** Unlike the single-item `PUT /meta/:type/:name`
    next door, this rewrites every eligible row in the deployment, so it demands
    the ADR-0066 D1 authoring capability rather than just a session, and answers
    `403` otherwise. The gate runs before the protocol is probed, so an
    unauthorized caller cannot use `403`-vs-`501` to learn which kernels can be
    migrated. `/meta`'s anonymous-deny umbrella still closes it to anonymous
    callers first.
  - **Attributed to the caller.** The `actor` recorded on the history and audit
    rows names the user who fired it — that is the question those rows exist to
    answer.

  **Flows need no extra setup on this path.** The CLI has to boot an inert
  automation engine to hold the executor registry ADR-0078's conflict guard needs;
  a server already has a live one, and the protocol resolves it from the services
  registry itself (#4498), so this route covers flow rows by simply running in the
  process that owns them.

  Registered on both the REST server and the runtime dispatcher's `/meta` domain,
  ledgered in both route ledgers, and mounted before `/:type` so the
  leading-underscore segment is never captured as a metadata type name.

- 071d0dc: feat(runtime,cli,core): boot reconciliation and `os migrate resume` for the migration journal — an interrupted run can no longer go unnoticed (ADR-0119 D2, #4617)

  Completes ADR-0119 D2. The runner and `sys_migration_journal` landed in #4668; this is the discovery channel that makes an interrupted run findable by someone who does not already know it happened.

  **`MigrationRecoveryPlugin` (`@objectstack/runtime`)** — at `kernel:ready`, scans the journal for runs that started and never concluded, and warns per run: how many chunks committed, which have an **unknown** outcome (`chunk_started` with no `chunk_done`), whether a compensation was left half-finished, and the exact command that will act. It also owns the `migration-plans` registry service.

  **`os migrate resume` (`@objectstack/cli`)** — lists interrupted runs (read-only, the default), or acts on one with `--run <id>`, under confirmation. Exits non-zero when a run ends `failed`, so a scripted recovery cannot move on from a migration that needs a human.

  **`MigrationPlanRegistry` (`@objectstack/core`)** — where a resume finds the plan it has to re-run.

  ## Boot discovers, the CLI acts

  This is the design decision, and it is deliberate rather than incidental.

  Resuming is a large, irreversible, potentially hour-long write against production data. Doing that as an unrequested side effect of a process starting is the kind of behaviour an operator finds out about from a graph. It is also not always possible at boot: a resume needs the plan's live callbacks, and the package that owns them may not be loaded in whichever process happened to restart first.

  So boot surfaces the run and names the command; the command acts, under explicit operator intent. ADR-0119 D2's per-plan `onCrash` policy still decides **what** acting means — resume forward from the first chunk lacking `chunk_done`, or unwind what committed — it just does not decide **when**, and "when" is the part a human should own.

  Deferring is safe precisely because of the runner's re-entrancy: `started ∧ ¬done` is durable, so an interrupted run stays exactly as recoverable an hour later as it was at boot. Nothing decays while the operator decides.

  ## Why a plan registry exists at all

  A journal cannot hold a plan. `forward` and `compensate` are functions and `load()` reads the live database, so none of it crosses a process boundary — which is why the journal records the plan **hash**, not the plan. Recovery therefore needs the plan handed back by the code that owns it, and `migration-plans` is that seam: between "the journal knows a run stopped at chunk 7" and "something in this process knows what chunk 7 was supposed to do".

  A run whose plan no loaded package registers is **reported**, never silently skipped — the operator is told which plan id is missing. "Nothing to resume" and "the code that owns this run is not here" are different facts, and only one of them is safe to ignore.

  ## Degradation

  No engine, or no `sys_migration_journal` registered (a lean kernel that never composed platform-objects) → the scan is skipped in **silence**: such a kernel has no interrupted runs to find, and a warning there would train operators to ignore this plugin's output, which is the one thing it cannot afford. A scan that **fails**, by contrast, is reported — "I could not check" and "there is nothing to find" are different answers.

  11 new tests pin the split (boot writes nothing to the journal), the three states an operator must tell apart (clean / interrupted / half-unwound), and both degradation paths.

- ea90179: fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

  Four independent surfaces where the answer a caller received contradicted the
  contract the surface declares. All four were found driving a real showcase boot
  against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

  - **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
    refusing to run untrusted code that asked for a capability it does not hold,
    which is the crash contract's case (#3951), not a deliberate rejection of a
    malformed request. It now answers 500, and the `SandboxError:` debug prefix
    no longer reaches the client.

  - **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
    write path returned `record: null` / `success: true` for an id that resolves
    to nothing, while GET on the same id correctly 404s; `deleteMany` reported
    every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
    can no longer read a successful envelope as proof the write landed.

  - **#4436 — the unsupported-filter-operator refusal shipped without
    `error.code`.** A refusal with no code is unmatchable by a client, and the
    message leaked the internal `[sql-driver]` prefix. It now speaks
    `INVALID_FILTER` without the driver prefix.

  - **#4483 — the `$search` auto field set admitted its lead field
    unconditionally.** `nameField`/`name`/`title` were prepended without passing
    `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
    The lead field now only ORDERS the set it is already a member of; it can no
    longer admit one.

  These change responses that were observably wrong, so callers coded against the
  buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
  see different status codes. Graded `minor` on that basis rather than `patch`.

- dadb43f: refactor(spec,client,metadata-protocol,runtime)!: retire the workflow service slot — declared end to end, implemented nowhere (#4451)

  The `workflow` slot was ADR-0078's silently-inert declaration at every layer at
  once: a `CoreServiceName` nothing ever registered or resolved (ADR-0115
  Evidence 5 — "no code in this repository resolves either slot", verified across
  both repositories), an `IWorkflowService` contract with zero implementations, a
  `WorkflowProtocol` whose three methods no code ever provided, a discovery
  `routes.workflow` field no builder could truthfully populate, and a
  `/api/v1/workflow` advertisement for a path no host ever mounted (the
  pre-#3586 `DEFAULT_DISPATCHER_ROUTES` already listed it among routes that
  never existed). The capability it promised is live elsewhere and has been for
  majors: record state machines are enforced by the `state_machine` validation
  rule, approvals are first-class flow nodes on the approvals runtime
  (ADR-0019), and record-triggered automation is lifecycle hooks +
  `record_change` flows (`service-automation`).

  FROM → TO:

  - `CoreServiceName 'workflow'` / `ServiceRequirementDef.workflow` /
    `CORE_SERVICE_PROVIDER['workflow']` → removed; there is no slot to fill.
  - `IWorkflowService` (`@objectstack/spec/contracts`) → removed; no
    implementation ever existed. Register nothing — use the mechanisms above.
  - `WorkflowProtocol` + `GetWorkflowConfigRequest/Response`,
    `WorkflowState`, `GetWorkflowStateRequest/Response`,
    `WorkflowTransitionRequest/Response` (`@objectstack/spec/api`) → removed,
    along with the seven published JSON schemas. Delete the import; nothing
    ever answered these shapes.
  - Discovery `routes.workflow` / `services.workflow` / `features.workflow`
    (metadata-protocol + runtime builders) → absent. A reader keying on them
    only ever saw `unavailable` / `false`; delete the read.
  - `RouterConfig.mounts.workflow` → removed; there was never a surface to
    mount at it.
  - `RestApiRouteCategory 'workflow'` → removed; categorize automation-adjacent
    routes as `'automation'`.
  - `@objectstack/client` re-exports of the four workflow types → removed with
    their source. (The `client.workflow.*` methods were already removed earlier
    in the v17 cycle — this retires the types they returned.)
  - Also removed: the stray `graphql` entry in `CORE_SERVICE_PROVIDER` and the
    `graphql: { route: '/graphql' }` discovery entry — `graphql` was never a
    `CoreServiceName`, and the dispatcher had already dropped `/graphql` as out
    of the product plan (#2462 follow-on).

  The retirement kit: the `workflow-service-slot-retired` semantic migration
  (major 17) carries this prescription into `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool. These are TS/API surfaces and a
  discovery response field — never stored in stack metadata — so there is no
  load-path conversion and nothing for `os migrate meta` to rewrite; the
  21 `authorable-surface.json` baseline lines and 7 `json-schema.manifest.json`
  entries for the deleted schemas are dropped deliberately in the same change
  (the plugin-runtime precedent: a prescription nobody can receive is noise —
  nothing parses these shapes any more).

### Patch Changes

- 7e7a605: fix(runtime): carry the capability channel onto an AI route's `req.user` (#4705)

  `/ai/*` was the one route domain in the platform where a capability check could
  not be written. The dispatcher builds `req.user` from the request's
  ExecutionContext, and `resolveAuthzContext` resolves a caller into **two** lists
  that look alike and are not:

  | ExecutionContext field | Carries                                                                                                                            |
  | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
  | `permissions`          | permission-**set names** (`admin_full_access`, `organization_admin`, `member_default`) plus the synthesized `ai_seat`              |
  | `systemPermissions`    | **capabilities** — `manage_metadata`, `studio.access`, `setup.access`, … — the union of every resolved set's `systemPermissions[]` |

  Only the first was copied. Every other surface gates on the second
  (`domains/meta.ts`'s `manage_metadata` check, `action-execution.ts`,
  `rest-server.ts`), so the same test written against an AI route's
  `req.user.permissions` was **permanently false** — a gate built on it would not
  have tightened the route, it would have closed it on platform admins too. That
  is what blocked the capability gate on
  `POST /api/v1/ai/tools/:toolName/execute`, where any authenticated user can
  currently run any registered tool (`create_object`, `apply_blueprint`,
  `create_seed`) in the default configuration.

  `req.user` now carries `systemPermissions` alongside `permissions`, with the
  same fail-closed default the neighbouring fields use: a non-array — or an
  ExecutionContext that has none, since the field is optional — becomes `[]`,
  never `undefined`. The two channels are copied **side by side and never merged**:
  flattening either into the other would corrupt every existing reader of
  `permissions` while appearing to fix this.

  This is transport only. No route in this package gates on the new field, and the
  declared-but-unenforced `route.permissions` mechanism is untouched — consumers
  decide policy, on the platform's existing `systemPermissions` contract.

  The other producer of an AI-route `req.user` — `dispatcher-plugin`'s
  `resolveRequestUser`, backing the concrete per-route mounts — has no
  ExecutionContext to read and stays capability-less on purpose. It now says so in
  the same shape (`systemPermissions: []`, spelled out rather than omitted) so a
  consumer never sees `undefined` on one path and `[]` on the other, and so needs
  no fallback of its own to tell them apart.

- 2826d1e: fix(automation,approvals): an approval decision can no longer succeed while its flow stays parked (#4420)

  A flow paused at an `approval` node, a deploy, then an approver clicking
  Approve: the request row flipped to `approved`, the UI toasted success — and
  the flow never moved. No next-stage request, no error, the record's mirrored
  status frozen mid-workflow. Approval flows pause for days by design, so a
  restart mid-flight is the normal case: every release could quietly zombify
  every in-flight approval, with the approvers none the wiser.

  Durable suspended runs (#1518) had shipped and were not the missing piece. Two
  other things were.

  **The wiring could enable a store over a table nobody had created.** Object
  registration and store activation resolve different services in different
  phases — `manifest` at `init()`, `objectql` at `start()` — and the plugin
  declared no ordering. Composed ahead of ObjectQL, `init()` found no `manifest`,
  warned, and continued; `start()` then attached the DB-backed store anyway. Every
  suspend failed with `no such table: sys_automation_run` into a log line nobody
  read, pauses silently stayed in memory, and the next restart lost them all.
  Now: `AutomationServicePlugin` declares `optionalDependencies:
['com.objectstack.engine.objectql']` (order-if-present, per ADR-0116 — an
  engine-less kernel must still boot); a registration missed at `init()` is
  retried at `start()`, which still lands before ObjectQL's schema sync; the
  store is never attached when registration did not happen, and says so at
  **error** level instead of warning; the table is probed once at boot so a
  broken setup surfaces there rather than one failed write at a time; and a
  failed durable write of a paused run is logged at error — it is data loss in
  waiting, not a warning.

  **A reported resume failure read as success.** `AutomationEngine.resume()`
  answers a lost run by _returning_ `{ success: false }`, never by throwing.
  `ApprovalService` discarded that return value, and `decide()` counted only a
  thrown error as failure — so a decision against a dead run came back
  `resumed: true`, HTTP 200. Resume failures are now classified
  (`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, joining
  `PERMISSION_DENIED` / `INVALID_SIGNAL`), so a run that is gone for good is
  distinguishable from a store that is merely unreachable, and the raw resume
  route maps them to 404 / 503 / 409.

  Approvals acts on them. A new `AutomationEngine.hasSuspendedRun(runId)` — which
  reads the suspension store, unlike `getRun()`, and throws rather than answering
  `false` when the store is unreadable — pre-flights every flow-advancing
  operation (`decide`, `sendBack`, `resubmit`) **before its first write**, so the
  zombie half-state is never created rather than merely reported: the decision
  fails with `RESUME_TARGET_LOST` (HTTP 409) and the request stays actionable. A
  resume that fails after the decision is durable can no longer be undone, but it
  now throws `RESUME_FAILED` (HTTP 500) naming the stranded run instead of
  reporting success. A concurrent duplicate resume stays benign — the engine's
  idempotency guard is doing its job — and reports through the new optional
  `resumeError` field. Recall and revise-window cancellation stay non-fatal by
  design (they abandon the request), but log at error with the reason instead of
  swallowing it. Compositions with no automation engine attached are unaffected.

  Existing zombie requests from affected deployments (already `approved`, run
  stranded) are not repaired by this change — `releaseDeadRunRequests` only
  sweeps requests that are still `pending`.

- ff17642: fix(runtime): declarative `defineJob` cron jobs are actually scheduled (#4567)

  Every background job authored as `defineJob({ schedule: { type: 'cron', … } })`
  was **silently never scheduled**. `JobSchema.parse` rewrites the cron
  `expression` into the canonical expression envelope
  (`{ dialect: 'cron', source: '0 1 * * *' }` — the authoring/persistence tier),
  but `AppPlugin` handed `job.schedule` verbatim to `IJobService.schedule`, whose
  boundary contract documents `expression` as a **bare cron string** because
  `CronJobAdapter` passes it straight to croner. croner rejected the object
  (`CronPattern: Pattern has to be of type string.`), the throw was swallowed by a
  per-job `try/catch` that only `warn`ed, and the author saw a green build and a
  green boot with the job never running. `interval` / `once` schedules and
  flow `schedule` triggers were unaffected.

  **Fix (contract-first).** The authoring→boundary downgrade now happens at the one
  place the two tiers meet — `AppPlugin`'s declarative-job registration, alongside
  the existing `retryPolicy` / `timeout` threading — via
  `toBoundaryJobSchedule()`. The adapters stay strict: no `typeof === 'object'`
  tolerance was added downstream, so the boundary keeps exactly one shape.
  A schedule that cannot be reduced to it (unknown type, AST-only or non-`cron`
  expression envelope, missing `intervalMs` / `at`) is rejected by name.

  **The failure path is no longer silent.** A job that cannot be scheduled now logs
  at **error** level with its own message (`Background job FAILED TO SCHEDULE — it
will never run`), plus a boot summary line when any job failed, and increments
  the new `job_schedule_failures_total` counter
  (`SEMCONV.jobScheduleFailuresTotal`, labels `app` / `job`) on the observability
  metrics registry. "Failed to schedule" no longer shares the quiet `warn` used by
  "handler not found in bundle.functions" — the first is an outage of declared
  work, the second is a job that was never going to run.

  No authoring change is required: existing `defineJob` cron declarations start
  working on upgrade.

- 20bc357: fix(spec,metadata-protocol,runtime): discovery stops advertising routes for the kernel-internal cache/queue/job slots (#4318)

  The metadata-protocol discovery builder declared `/api/v1/cache`, `/api/v1/queue`
  and `/api/v1/jobs` — three paths that existed nowhere else in the repository: no
  dispatcher domain, no adapter mount, no plugin registration, and the shipped
  providers (`service-cache`/`-queue`/`-job`) are in-process contracts that will
  never mount one. Every default boot therefore advertised a route inside the same
  `ServiceInfo` whose `handlerReady: false` said the opposite — a single record
  contradicting itself (ADR-0076 D12).

  These slots are route-less now, like `realtime` — but unlike `realtime` an
  unmarked real implementation stays `available`: the slot's contract is
  in-process, so "no HTTP surface" is not reduced capability for it. `handlerReady`
  is reported `false` on both discovery builders — for a route-less slot it is not
  a proxy for anything, it is the fact itself (the dispatcher used to claim
  `handlerReady: true` here for an unmarked occupant, a handler that does not
  exist). The explanatory message is written once, as
  `inProcessServiceMessage(slot)` in `@objectstack/spec/system`, so the two
  builders cannot drift apart.

- 5a84d41: fix(automation): `resume` enforces the suspended screen's declared field contract (#4477)

  A `screen` node's `config.fields` is a complete input contract — the author
  declares the keys, their `required`-ness, and (via `visibleWhen`) when a field
  is even asked for. The RENDER half honoured all of it: the paused result and
  `GET …/runs/:runId/screen` carry `required` and `visibleWhen` intact. There was
  no VALIDATION half — `POST …/runs/:runId/resume` folded whatever bag it was
  handed straight into the flow variables, so a caller that skipped the dialog and
  posted here directly was unconstrained by every `required` the author wrote.
  Missing required fields, and keys the screen never declared, all completed the
  run with `success: true`.

  Screen flows are the one place where the declared field contract is the ONLY
  contract — no object schema sits behind a screen node to catch a bad bag
  downstream. The platform already enforces the analogous contract everywhere else
  this seam appears: action params (ADR-0104 D2), record writes (ADR-0113),
  approval `decisionOutputs` (#3447). This is that rule for screen resume, built in
  the same shape.

  `resume` now refuses a non-conforming submission with the new
  `AutomationResult.code` `'INVALID_SCREEN_INPUT'` (a transport maps it to **400**,
  as the automation domain route now does) and an `Invalid screen input: …` message
  that names each violation and lists the declared field names. The refusal happens
  BEFORE the suspension is consumed, so the pause stays live and the legitimate
  submission still lands.

  `visibleWhen` is evaluated against the SUBMITTED values first (layered over the
  run's variable snapshot), so a hidden field's `required` never fires — enforcing
  it would dead-end the run at a field the user was never shown, which is #3528
  reproduced server-side. A predicate that cannot be evaluated is logged and
  treated as hidden rather than visible: the client decides what the user saw, and
  a broken predicate is not evidence a field was on screen.

  Scope, deliberately narrow — three shapes keep the historical pass-through:

  - an **object-form** screen (`kind: 'object-form'`), whose `fields` is empty by
    construction because the client renders the object's own form and the write
    path enforces that object's `required` fields itself;
  - a **message-only** screen (`waitForInput: true`, no fields), which declares no
    keys and so constrains none — the same pass-through `enforceActionParams`
    gives a param-less action;
  - `signal.output`, the node-OUTPUT namespace, which belongs to the approval-style
    resume envelope rather than to the screen's collected-values channel.

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [0800433]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [328ccc5]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [f2eb850]
- Updated dependencies [8bd437f]
- Updated dependencies [5046afe]
- Updated dependencies [203a449]
- Updated dependencies [6dcbbc3]
- Updated dependencies [ac37fc6]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [58434f5]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [c4ab50b]
- Updated dependencies [6117f7b]
- Updated dependencies [be25f97]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [ff17642]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [8aacf94]
- Updated dependencies [4c45be1]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [05d8a54]
- Updated dependencies [9b43ee2]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [127f091]
- Updated dependencies [9fd9ae7]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [4c80fd6]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [63b33e6]
- Updated dependencies [8aacf94]
- Updated dependencies [6beb708]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [83cf2d3]
- Updated dependencies [071d0dc]
- Updated dependencies [beefe89]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [69b509f]
- Updated dependencies [7e05d8e]
- Updated dependencies [0d9a779]
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
- Updated dependencies [4b945fc]
- Updated dependencies [1ee48bc]
- Updated dependencies [705e5c8]
- Updated dependencies [f61edce]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [0657f6b]
- Updated dependencies [666f542]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [304423e]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [26bb053]
- Updated dependencies [be90dea]
- Updated dependencies [04f1182]
- Updated dependencies [c03108c]
- Updated dependencies [5647006]
- Updated dependencies [50185a8]
- Updated dependencies [d6bd5a1]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [24915d2]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/metadata-protocol@17.0.0-rc.2
  - @objectstack/objectql@17.0.0-rc.2
  - @objectstack/plugin-auth@17.0.0-rc.2
  - @objectstack/plugin-security@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/rest@17.0.0-rc.2
  - @objectstack/driver-sql@17.0.0-rc.2
  - @objectstack/driver-memory@17.0.0-rc.2
  - @objectstack/metadata@17.0.0-rc.2
  - @objectstack/service-datasource@17.0.0-rc.2
  - @objectstack/observability@17.0.0-rc.2
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/metadata-core@17.0.0-rc.2
  - @objectstack/formula@17.0.0-rc.2
  - @objectstack/service-cluster@17.0.0-rc.2
  - @objectstack/service-i18n@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- 195ad76: fix(actions)!: failures speak HTTP — business rejections are 400, success is a single wrap (#3962)

  **BREAKING (raw-HTTP callers of `POST /api/v1/actions/...` only).** The
  200-with-inner-envelope wire was never a designed contract: no ADR or doc ever
  specified it, it originated as the route's catch block reusing
  `deps.success()`, and `/actions` was the only route of 12 that double-wrapped.
  #3962 classifies it as a bug. Five defects traced back to that one extra layer
  (the console's green toast on failed actions, `redirectUrl` never firing, a
  marketplace install reported as installed when it failed, the client-envelope
  divergence #3927 papered over, and crashes invisible to monitoring).

  The contract now, identical to `/data`:

  | Outcome                                                        |         HTTP          | Body                                                                  |
  | :------------------------------------------------------------- | :-------------------: | :-------------------------------------------------------------------- |
  | Ran, returned                                                  |        **200**        | `{success: true, data: <handler return value>}` — single wrap         |
  | Ran, rejected (business rule / validation)                     |        **400**        | `{success: false, error: {message, code, details: {code?, fields?}}}` |
  | Never dispatched (unknown / denied / wrong type / unavailable) | 404 / 403 / 400 / 503 | unchanged (#3930/#3951)                                               |
  | Crashed (`TypeError`, driver class, sandbox timeout)           |        **500**        | unchanged (#3951)                                                     |

  A validation rejection carries `details.code: 'VALIDATION_FAILED'` and
  `details.fields[]` — the exact payload #3937 fought for, now on the same wire
  shape `/data` has always used, which `@objectstack/client` normalizes to
  `err.code` / `err.fields` (#3927). A rejected flow is a 400 with
  `details.code: 'FLOW_FAILED'`. The crash-vs-rejection discriminator (#3951,
  error `name`) now selects 400 vs 500.

  `client.actions.invoke` / `invokeGlobal` still never throw: they fold every
  failure status into `{success: false, error}`, read the single wrap on
  success, and keep a NARROW legacy heuristic so a current SDK talking to a
  pre-#3962 server still folds the old double-wrapped 200s correctly.

  **Migration for raw-HTTP third parties:** branch on the HTTP status — a
  non-2xx is the failure, `error.message` / `error.details` carry the detail; on
  a 200, `data` is the handler's return value directly (one level less than
  before). Callers using `@objectstack/client` need no change.

- 698cbc2: feat(runtime)!: action params are enforced by default, and the opt-in is gone (#3438, ADR-0104 D2)

  A request bag that violates an action's declared `params[]` — a missing
  `required` param, a value outside its `options`, a scalar where `multiple`
  declares an array, a non-id where a `reference` declares one, or a key the
  action never declared — is now **rejected before the handler runs**:
  `400 VALIDATION_FAILED` on REST, a thrown error on MCP. It used to be logged
  and passed through.

  ```diff
  - OS_ACTION_PARAMS_STRICT_ENABLED=1   # removed — enforcement is the default
  + OS_ALLOW_LAX_ACTION_PARAMS=1        # escape hatch: warn and pass, as before
  ```

  **What breaks.** Only calls that were _already_ wrong. The declaration was a
  complete contract that informed nothing but the client dialog, so a bag the
  server accepted could still have been silently ignored by the handler — which
  is exactly how a correctly-intended `reference: 'sys_user'` degraded into a
  paste-a-UUID box (#3405) with a success envelope on top. Those calls now fail
  loudly instead of quietly. Actions declaring no `params` are untouched, and the
  dispatcher's own `recordId` / `objectName` are allowlisted
  (`ACTION_PARAM_BUILTIN_KEYS`), so the keys dispatch itself merges in were never
  candidates for the unknown-key error.

  **Fixing a rejection** takes one edit at the call site: the message names the
  offending param and the declared list. If an integration you cannot reach in
  time is affected, set `OS_ALLOW_LAX_ACTION_PARAMS=1` to restore the old
  pass-through — the violation still logs once per action, so the drift stays
  visible rather than becoming invisible again.

  **Why 17.0 rather than a warn window in 17 and the flip in 18.** R3 asked for
  warn-then-error, and ADR-0104's 2026-07-30 addendum declined it on the merits
  rather than postponing. What a violation strands is a **caller**, not data: the
  rejection reaches a developer or an agent who can fix it in one edit, no stored
  row is made unwritable, and the escape hatch makes it reversible in a restart.
  Deferring that by a major would have charged every deployment a second upgrade
  ceremony — 16→17 is already a substantial, tested migration — to postpone a
  break that costs one edited call. v17 already carries harsher zero-window
  flips (`allowExport` unset now means denied; an undeclared action handler 404s
  with no opt-out at all), so holding the milder change to a stricter standard
  would have been inconsistent rather than cautious.

  For AI and MCP callers specifically — the population D2 was built for — a 400
  is corrective feedback consumed in-loop, while a server-side warning is
  feedback nobody ever reads.

  D1's value-shape half went the opposite way for the opposite reason: it rejects
  on the basis of **stored data**, which an author cannot edit their way out of,
  so it stays gated per deployment on that deployment's own migration evidence.

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

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

- 347f460: **[ADR-0110 D3, revised] The undeclared-action refusal has no opt-out —
  `OS_ALLOW_UNDECLARED_ACTIONS` is removed before 17 ships.**

  D3 as accepted refused an undeclared handler but shipped
  `OS_ALLOW_UNDECLARED_ACTIONS=1` as a migration valve that ran it anyway,
  "slated for removal in 18". Removed now, for two reasons:

  - **It contradicts the ruling it accompanies.** A flag that executes an
    ungoverned, system-elevated handler _is_ the fail-open D3 closes. ADR-0049's
    trichotomy has no "enforced unless a flag says otherwise" state.
  - **It had no observed users.** A reconciliation sweep across the platform
    packages, every example and every plugin found the only `engine.registerAction`
    call sites are `app-todo`'s eight, all declared. The valve would have shipped
    a documented way to reopen the gate for a population nobody has ever seen.

  What it was buying is covered without it: the app still boots, every declared
  action still works, D5's boot inventory names each offender at startup, and the
  404 names the `defineAction` to add. Migration costs a code change rather than
  an env var — the correct price for reopening an authorization gate.

  Setting the retired variable has no effect; a regression test pins that, so a
  stale deployment script fails loudly rather than silently re-opening the gate.

- 8a341a4: A dispatcher domain whose route is mounted but whose implementation is absent answers **501**, not a 404 that blames the route (#4093 follow-up).

  Two different facts were being answered with whatever each domain happened to reach for, and only `mcp` told them apart:

  - **The route is not there.** `/mcp` when the server is disabled for the environment; `/analytics` when the service is unserveable, because `dispatcher-plugin` gates the _mount_ and never registers those paths (#4000). A path the server does not expose is a **404** from the host's own router. **Unchanged** — that half was already right.
  - **The route is there; the implementation is not.** Every unconditionally-mounted domain. The request reached a handler that had nothing to delegate to. That is **501**, and it is what changes here.

  `/automation` and `/notifications` returned `{ handled: false }`, which looks neutral but lands on the dispatcher plugin's single exit: `404 ROUTE_NOT_FOUND` with the hint _"No handler matched this request. Check the API discovery endpoint for available routes."_ Both halves were false — a handler did match, and discovery correctly does not list the route, so the hint pointed at a page that would never mention it. An operator reads that as a routing bug and goes looking for one that does not exist.

  `/ui` answered **503**, which claims the condition is temporary. An uninstalled MetadataPlugin does not become installed by retrying.

  `/ai` answered **404** for the same mounted-but-unimplemented case.

  The refusal now carries the same remedy sentence discovery reports for that slot (`serviceUnavailableMessage`, shared via `@objectstack/spec/system`), so the wall and the discovery entry cannot drift into naming different fixes — `POST /api/v1/automation` on a stack without the service answers `501 Install @objectstack/service-automation to enable`. `/ai` keeps a local message: its real provider ships outside this workspace as a Cloud/EE package, so the shared table — verified against workspace packages — records no entry and would otherwise describe it as "nothing ships".

  Deliberately unchanged: `analytics`'s route-mount gate (a genuinely absent path); `mcp`'s 404-vs-501 pair, which is the model; the `handled: false` at the END of each domain, which means "no sub-route matched" and is a true 404; `GET /ai/agents`'s empty-list 200, a deliberate courtesy for the console's per-navigation poll; and `/ai`'s `503 routes not yet initialized`, which is a different condition (service present, internal state unready) and may genuinely be transient.

  FROM → TO: requests to `/automation`, `/notifications`, `/ui/*` and `/ai/*` on a deployment lacking the backing service now get `501` (with the package to install) instead of `404`/`503`. Anything branching on the old status should branch on `status >= 400` or read the error code; the capability was equally unavailable before, so no working flow changes. Discovery is unaffected — it already reported these slots `unavailable` and advertised no route for them.

- 8dcc0f5: feat(runtime)!: retire the inert `DriverPluginOptions` — `DriverPlugin` takes `(driver, driverName?)` (#4320)

  `new DriverPlugin(driver, { datasourceName, registerAsDefault })` never did
  what it promised: both options configured a datasource-registration block in
  `start()` gated on `metadata.addDatasource`, a method **no metadata service
  implements** — so the block early-returned on every boot since inception and
  the options were dead weight (found while typing service lookups for #4251).

  **Migration** — delete the options argument; nothing changes at runtime
  because nothing ever happened:

  - FROM `new DriverPlugin(driver, { datasourceName: 'x', registerAsDefault: false })`
    TO `new DriverPlugin(driver)`
  - FROM `new DriverPlugin(driver, 'name', options)` TO `new DriverPlugin(driver, 'name')`
  - The string second argument (`new DriverPlugin(driver, 'memory')`) is unchanged.

  If you passed `datasourceName` expecting routing to a named auxiliary driver:
  that routing never came from the option. It keys off the **driver name** —
  `DriverPlugin.init()` registers `driver.<name>`, ObjectQL's discovery loop
  adopts it, and the engine's lifecycle/datasource resolution looks the name up
  (see the telemetry provision in `os serve` for the pattern: stamp
  `driver.name`, register the plugin, done). For Setup → Datasources visibility,
  declare the datasource through `DatasourceConnectionService` /
  `registerInMemory('datasource', …)` (ADR-0062).

  The `DriverPluginOptions` interface was module-local (never exported from the
  package root), so the only public break is the constructor's second/third
  argument shape.

- 5b08389: The `/auth` domain no longer fabricates a login. With no auth service registered it answers **501**; the mock that answered 200 with a made-up session is deleted (#4113).

  `packages/runtime/src/domains/auth.ts` carried a `mockAuthFallback` that answered `POST /auth/sign-up/email`, `/register`, `/sign-in/email`, `/login`, `GET /get-session` and `POST /sign-out` with **200 and a fabricated user plus a 24-hour `mock_token_*` session — for any email and any password, which was never read**. It shipped in `@objectstack/runtime` rather than behind a dev-only plugin, and gated on nothing but an empty `auth` slot, so `os serve --preset minimal` and any embedder that mounts the dispatcher without `@objectstack/plugin-auth` served it.

  It was never a bypass: no session store backs the token, so `resolve-execution-context.ts` still resolved anonymous and `shouldDenyAnonymous` still denied data access. It was worse in a different way — it told the client the one thing a server must never lie about, that it had authenticated someone, while discovery simultaneously reported `auth: unavailable` and advertised no `routes.auth`. Its stated justification ("MSW/browser-only environments") had no consumer in this repository or in `objectui`, whose auth tests mock at the HTTP client layer; the only things pinning it were tests asserting the mock itself.

  ADR-0115 retired this whole class of fabricating fallback inside `plugin-dev`. This was its last surviving member and the only one that shipped to production; the lineage before it — the #3891 analytics shim, #4000's dev stub, the three in #4058/#4086, #4126's security trio — was retired the same way: deleted, not put behind a flag.

  **501 rather than 404**, following `/i18n`, the nearest precedent in shape: a core capability, a dispatcher-owned domain, an optional plugin behind it, and a route discovery already declines to advertise when the slot is empty. The route is mounted; what is missing is the implementation behind it — which is what 501 states and 404 would misdescribe. A wrong-shaped occupant (a service without the contract's `handleRequest`) takes the same 501, which is the sharper case: the slot is filled, so discovery advertises `routes.auth`, and that request previously got a fabricated session.

  FROM → TO: a deployment without an auth service now gets `501 "Auth service not available — register @objectstack/plugin-auth to enable authentication"` on `/api/v1/auth/*` instead of a 200 carrying a session that never worked. Install `@objectstack/plugin-auth` (it is in the default `os serve` preset), or treat the absence as production already required — the 200 never produced a session the identity path accepted, so no working flow depended on it. Front-ends that mocked auth through this fallback should mock at the HTTP client layer or with an MSW handler, as `objectui` already does.

### Minor Changes

- 6e141bc: fix(actions): an action that CRASHED is a 500, not a 200 reporting success:false (#3913 follow-up)

  #3937 settled that a failed action reports in the payload at HTTP 200 — "an
  action that fails is a normal outcome, not a transport error". That is a
  statement about the action **rejecting**: a business rule saying no. The same
  exit was also covering a third case it never argued for.

  A `TypeError` in a handler, a driver blowing up, a sandbox timeout — those are
  not outcomes the action chose to report, they are the server failing to produce
  one. Serving them as 200 hid **every handler crash** from the layers that exist
  to catch server faults: gateway error rates, retry and circuit-breaker policy,
  APM auto-capture, alerting, `fetch().ok`. For a platform whose main extension
  surface is customer-authored script bodies, "customer action bodies are
  throwing" had no signal short of body-parsing at every hop.

  Those are **500** now, through the same `errorFromThrown` exit every other
  domain catch has used since #3925 — which also means a driver dump finally goes
  through the internal-error-leak sanitiser (#3867) instead of reaching the client
  verbatim in a 200 body.

  **Nothing #3937 put in the payload moves.** A rejection and a crash are told
  apart by the error's NAME, the signal `@objectstack/rest` already uses on this
  exact distinction ("non-default names (`TypeError: …`) […] signal a genuine
  script bug rather than a deliberately thrown business rule"):

  | Thrown                                                              | Verdict                   | Wire          |
  | :------------------------------------------------------------------ | :------------------------ | :------------ |
  | `new Error(msg)` — a registered handler rejecting                   | rejection                 | 200 + payload |
  | `SandboxError` with `innerMessage` — a body's deliberate throw      | rejection                 | 200 + payload |
  | Anything carrying `code` / `fields`, or a `ValidationError` by name | rejection                 | 200 + payload |
  | A throw with no `name` at all                                       | _not confidently a fault_ | 200 + payload |
  | `TypeError` / `ReferenceError` / `SqliteError` / a driver's class   | crash                     | **500**       |
  | `SandboxError` with no `innerMessage` — timeout, capability denial  | crash                     | **500**       |

  Deliberately the narrow direction: only what is _certainly_ a fault moves, and
  everything uncertain keeps the 200 it has today.

  One related fix in the same exit: an error carrying its own `status` /
  `statusCode` (a plugin's `FORBIDDEN` with `status: 403`) is now served with it
  rather than buried in a 200 payload — that status was the one thing the thrower
  was unambiguous about. Record `ValidationError`s deliberately carry no
  `.status`, so #3937's cases never reach that branch.

  Documented in `api/error-catalog.mdx` (new **Action Errors** section with the
  full status table and the two-check pattern a raw `fetch` caller needs) and
  `ui/actions.mdx`.

- a4e2684: feat(runtime): the sandbox reports an action body's discarded `ctx.record` writes at invocation time (#4345)

  #4362 closed the author-time half of #4345: `action-record-write-discarded`
  warns when a body assigns to `ctx.record` and the snapshot is provably dead.
  This is the run-time half, and it exists because a parse cannot reach three
  things a running action can:

  - **computed keys and aliases** — `ctx.record[k] = v`, `const r = ctx.record;
r.x = 1`, which the lint deliberately skips rather than guess at;
  - **a wholesale replacement** — `ctx.record = {…}`;
  - **bodies no lint ever sees** — metadata authored through Studio or the API
    never passes through `os validate` / `os lint` / `os compile`.

  The sandbox installs a `set`/`deleteProperty`/`defineProperty` proxy over the
  snapshot, behind an accessor so a wholesale replacement cannot swap the recorder
  out, and surfaces the touched keys as `ScriptResult.droppedRecordWrites`.
  `actionBodyRunnerFactory` logs a warning naming the discarded fields and the
  `ctx.api.object(...).update(...)` remedy. Writes still work _inside_ the VM, so
  a body using the snapshot as scratch keeps its reads coherent — only the silence
  is removed.

  **Only dead writes are reported**, on the same reading #4362 uses: a snapshot
  that leaves the body as a value may have carried the write with it, so

  ```js
  ctx.record.stage = "won";
  await ctx.api.object("crm_deal").update(ctx.record); // lands — stays quiet
  ```

  is not reported, while a plain property read does not rescue a write (the
  `ctx.recordId || (ctx.record && ctx.record.id)` guard idiom real action bodies
  are written with still reports). An `ownKeys` after a write marks the escape.
  A wrong "discarded" asserts something false about the stored record, which is
  worse than a miss.

  Hooks carry no `record`, so they install no proxy and pay nothing. `ctx.record`
  remains read-only; whether the runtime should instead refuse or honour the write
  is still open — reporting a discard prejudges neither answer.

- c2bbd97: fix(actions): reach global actions at their real registration key, and 404 an action that never dispatched (#3913)

  **1 — the registration key and the lookup key disagreed.** Both writers
  register an objectName-less action under the literal `'global'`: `AppPlugin`
  (`action.object || 'global'`) and `ObjectQLPlugin.actionObjectKey`. The REST
  route's fallback probed `'*'`, and `engine.executeAction` is an exact-string
  `Map` lookup with no wildcard semantics — so the probe could only ever miss:

  ```
  Action 'log_call' on object '*' not found
  ```

  `POST /api/v1/actions/global/log_call` worked by **accident** (the path segment
  happened to spell the registration key); `POST /api/v1/actions//log_call` never
  worked at all, and neither did falling back from an object-scoped route to a
  global handler. `'global'` is now the canonical key
  (`GLOBAL_ACTION_OBJECT_KEY`), the probe order is
  `[<routed object>, 'global', '*']` for both the REST route and the MCP
  `run_action` bridge (`actionHandlerObjectKeys` — one list, two surfaces), and a
  single-segment path (`/actions//:action`) routes at `'global'` instead of
  400-ing. A handler registered directly under `'*'` still resolves; the doc
  comments that called `'global'` a "wildcard" are corrected at every site.

  **2 — "no such action" was reported as a success.** The not-found exit called
  `deps.success(...)`, which always emits `{status: 200, body: {success: true,
data}}`, so a request naming an action that does not exist came back as:

  ```json
  {
    "success": true,
    "data": {
      "success": false,
      "error": "Action 'log_call' on object '*' not found"
    }
  }
  ```

  Every caller that did not hand-unwrap the INNER envelope read the outer
  `success: true` and reported a success that never happened — including the
  shipped console, which showed a green toast (fixed on that side in
  objectui#2963). Nothing **dispatched** there, so it is a **404** now, joining
  the answers this route already gives a status: 403 denied, 400 wrong action
  type, 503 unavailable. The miss also names the **routed** object rather than
  whichever probe ran last (the old fallback said `on object '*'`, an object the
  caller never asked for).

  A handler that **ran and rejected** is unchanged: HTTP 200 with
  `data: {success: false, error, code?, fields?}`. That is a business outcome,
  not a transport error, and #3937 pins it. The line is "did a handler run" —
  below it the payload, above it the status.

  `client.actions.invoke` / `invokeGlobal` still do **not** throw. `client.fetch`
  throws on every non-2xx, so `invoke` now catches and folds a dispatch failure
  into the same `{ success, data?, error? }` result with `error` as a plain
  string — otherwise the routes that just gained a status would have started
  propagating exceptions into callers that only ever checked `result.success`.

- 32ccb23: feat(spec,core,runtime)!: ADR-0112 batch 1 — one error-code vocabulary, SCREAMING_SNAKE, schema-enforced (#3841)

  Settles #3841 per ADR-0112: the top-level `error.code` vocabulary is
  SCREAMING_SNAKE, in two tiers.

  - **`StandardErrorCode` members renamed in place** (`validation_error` →
    `VALIDATION_ERROR`, all 53). Breaking for importers that branch on the old
    lowercase members; the type name and member _meanings_ are unchanged.
  - **New `ERROR_CODE_LEDGER`** (`@objectstack/spec/api`): service-specific codes
    (`AUTH_REQUIRED`, `VALIDATION_FAILED`, `ATTACHMENT_DOWNLOAD_DENIED`, …) are
    registered per owning package. `ErrorCode` = standard ∪ registered.
  - **`ApiErrorSchema.code` is now `ErrorCode`**, not `z.string()` — an
    unregistered code fails parse, so the envelope conformance suites assert
    values, not just shape.
  - **`FieldErrorSchema.code` widened to `z.string()`** (ADR-0112 D6): field-level
    codes are a separate vocabulary the enum never described; #3977 owns its real
    catalog.
  - **Derived codes changed case on the wire**: `standardErrorCodeForHttpStatus`
    now yields SCREAMING members (`permission_denied` → `PERMISSION_DENIED`,
    `method_not_allowed` → `METHOD_NOT_ALLOWED`, …) — this map was #3842's
    designated one-file sweep point for exactly this decision.
  - **`ANONYMOUS_DENY_CODE` is `'UNAUTHENTICATED'`** (was `'unauthenticated'`) —
    the promoted code on anonymous-denied requests and the REST `enforceAuth`
    body change spelling with it.

  `error-catalog.mdx` and the error-handling guides are rewritten to the single
  vocabulary; a spec test now locks the catalog page's headings to the enum so
  they cannot drift apart again. Remaining lowercase emitters (cloud-connection,
  plugin-auth envelope codes, metadata-protocol, …) are the batch-2 sweep.

- f5a4ef0: refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

  Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
  the set; this batch moves the emitters that still spoke lowercase `snake_case`
  onto it.

  **Wire-visible change.** Error codes on these surfaces change spelling. Generic
  conditions collapse onto the standard catalog rather than keeping a synonym:
  `unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
  `PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
  `INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
  `NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
  registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
  `PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
  `cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
  `service-messaging`, `service-automation`, `trigger-api`.

  Branch on `error.code` values rather than pattern-matching their case: the
  console's fix for the same rename (objectui#2977) reads codes case-insensitively
  for exactly this reason, and that is the pattern to copy in your own consumers if
  you support servers on both sides of the change.

  **Four routes stop putting a code in the message slot.** The webhook redeliver
  route, the API-trigger webhook, and two `rest` routes answered
  `{ success: false, error: '<code>', message }` — the code occupying `error`, the
  declared object envelope nowhere. They now emit `error: { code, message }`, and
  three API-trigger branches gained a message they never had. Clients reading
  `body.error` as a string on those routes must read `body.error.code`.

  **`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
  `@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
  two `RetryStrategy` types. The connector-side pair is renamed; importers of the
  `integration` subpath update the name. Side effect: the api-side `ErrorCategory`
  and `RetryStrategy` now appear in the generated API reference at all — the name
  collision had been silently dropping them.

  **`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
  registration route put better-auth's arbitrary `body.error` string straight into
  `error.code`. The code is now ours and the upstream discriminator moved to
  `details.upstreamError`.

  **Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
  (ADR-0112 D6b): it is persisted audit history, and the same column holds
  non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
  200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
  `--json` output contract.

  A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
  code position, since the ledger's casing rule can only police codes that someone
  registers.

- 0f12193: feat(runtime): mount /analytics routes only when the capability exists (#3891 follow-through, ADR-0076 D11)

  `createDispatcherPlugin` used to mount `POST /analytics/query`,
  `GET /analytics/meta` and `POST /analytics/sql` on the `IHttpServer`
  unconditionally — so a deployment without `@objectstack/service-analytics`
  still had the routes in its table: a `PUT` answered `405` with
  `Allow: POST`, advertising a method on an API that wasn't there (the `POST`
  itself answered 404 since #3989).

  The mounts are now capability-conditional. Plugin `start()` runs after the
  kernel's Phase-1 init, so service presence is authoritative:

  - **single-kernel mode, `analytics` not registered** — the three routes are
    NOT mounted; every method on `/api/v1/analytics/*` answers the adapter's
    shared not-found contract (`404 { "error": "Not found" }`), and a boot log
    names the fix (`Install @objectstack/service-analytics`);
  - **single-kernel mode, `analytics` registered** — unchanged;
  - **multi-tenant host** (a `kernel-resolver` is wired) — mounted
    unconditionally, because mounts are host-global while the analytics service
    lives in each per-project kernel: capability presence is a per-request
    question, answered by the analytics domain's existing `handled:false` → 404
    (new public `HttpDispatcher.isMultiTenantHost()` exposes the mode).

  With this, the `/analytics` API surface exists exactly when the capability is
  installed — completing the #3891 arc: #3989 emptied the slot (no more
  unscoped-aggregate shim), #4010 made the body contract strict at the entry,
  and this change removes the last wire-level residue of the uninstalled API.

- 9b6fe7c: fix(spec,runtime)!: `AnalyticsQueryRequest` is the bare `AnalyticsQuery`; the dispatcher validates `/analytics` bodies at the entry (#3878)

  **Spec.** `AnalyticsQueryRequestSchema` used to describe a
  `{ cube, query: {...}, format }` ENVELOPE — the dialect of the retired degraded
  analytics shim (#3891), which the real engine never understood: an envelope
  body inferred a column-less cube and died as an SQL syntax error
  (`SELECT  FROM …`) instead of a shape error. The schema now describes what the
  engine and every real caller actually use — the **bare `AnalyticsQuery`**:

  ```
  FROM  { "cube": "orders", "query": { "measures": ["count"] }, "format": "json" }
  TO    { "cube": "orders", "measures": ["count"], "dimensions": [...], "where": {...} }
  ```

  `cube` + `measures` are required at the top level; `dimensions` / `where` /
  `timeDimensions` / `order` / `limit` / `offset` / `timezone` sit beside them.
  The schema is `.strict()`; `query` and `format` are tombstoned (`retiredKey`)
  so both `tsc` and the parse answer with this exact migration. `format` was
  never implemented (every response is the JSON envelope) — for CSV/XLSX use the
  export surface. The removal is registered as two step-17 semantic migrations
  (`analytics-query-request-envelope-retired`,
  `analytics-query-request-format-retired`) — it is an HTTP-wire change with no
  stored metadata to rewrite.

  **Runtime.** `POST /api/v1/analytics/query` and `/analytics/sql` now validate
  the body against that schema AT THE ENTRY and answer
  **400 `VALIDATION_FAILED`** with per-field details — including the envelope
  prescription above, and a bespoke hint that `filters` is not a contract field
  (the filter field is `where`, the same canonical FilterCondition `find()`
  takes). Previously a malformed body reached the engine and failed as a 500 SQL
  syntax error, or had its off-contract filter key silently ignored. A valid
  body is forwarded to the analytics service byte-identical (validation only —
  parsing would inject the schema's `timezone: 'UTC'` default and override
  org-timezone resolution). An uninstalled analytics capability still answers
  404 before any body inspection (#3891).

- c9d254a: feat(datasource,runtime): kernel teardown disconnects through the one datasource path — and never closes an adopted pool (#3993)

  After the #3826 connect convergence, ADR-0062 D5's "owns connect/disconnect"
  was half-true: nothing disconnected the `default` (or a declared datasource's
  pool) on graceful shutdown. `DriverPlugin` never had teardown, `ObjectQLPlugin`
  teardown never touched drivers, and the kernel's actual teardown phase is
  `destroy()` — the Plugin contract has no `stop()`, so stray `stop` methods were
  never called by anything.

  The disconnect half now mirrors the connect half:

  - **`DatasourceConnectionService.disconnect(name, { asDefault })`** resolves
    the default under its NATURAL name (the same #3826 rule that makes
    `drivers.get('default')` impossible — the old lookup could never have found
    it), and honours a new ownership discriminator recorded at connect time.
  - **`disconnectAll()`** closes exactly the pools THIS service opened —
    `'connected'` states only. `already-registered` drivers belong to whoever
    registered them (an `onEnable` bridge, the default's idempotent replay) and
    are never touched.
  - **`DatasourceDriverHandle.ownership: 'factory' | 'host'`** is the
    discriminator. `createPrebuiltDriverFactory` stamps its handles `'host'`:
    an ADOPTED instance's pool outlives the kernel (the cloud control-plane
    driver doubles as every environment kernel's proxy base; per-environment
    drivers are registry-cached across kernel rebuilds), so kernel teardown —
    including a cloud LRU eviction's `kernel.shutdown()` — clears the retained
    verdict but NEVER closes the pool. Factory-built instances disconnect as
    before there was a before.
  - **`DefaultDatasourcePlugin.destroy()`** and
    **`DatasourceAdminServicePlugin.destroy()`** wire the sweep at the kernel's
    real teardown phase, best-effort (a failed disconnect never masks shutdown).

  A welcome side effect: a file-backed `sqlite-wasm` default with
  `persist: 'on-disconnect'` now actually flushes on graceful shutdown.

  Also flips ADR-0062's status to reflect the completed convergence (#3992):
  D1 is fully implemented across both repos since cloud#915; the remaining
  `DriverPlugin` uses are documented named-auxiliary/escape-hatch cases, and the
  degraded-boot parity guard stays with its role shifted to "the escape hatches
  must not drift".

- c3bcb42: feat(runtime,datasource): the default-datasource connect seam accepts a host driver factory — adopt pre-built instances without forking the verdict (#3826)

  ADR-0062 D1's open-core convergence (#3869/#3886) left one structural question
  open: a host whose `default` needs a driver the shared factory cannot build —
  the cloud distribution's `turso`, or an instance pooled BEYOND one kernel (the
  cloud control-plane driver doubles as the proxy base of every environment
  kernel; per-environment drivers are cached across kernel rebuilds) — had only
  two options, both bad: stay on the legacy pre-built `DriverPlugin` path, whose
  connect verdict lives in `ObjectQLEngine.init()` (the second implementation
  #3826 exists to retire), or fork the connect orchestration. Either re-opens the
  #3741 → #3758 drift this whole line of work is about.

  Two additive pieces close it:

  - **`DefaultDatasourcePlugin` accepts an injected `IDatasourceDriverFactory`**
    (defaults to the shared open-core factory, byte-for-byte unchanged when
    omitted). The factory only changes what `create()` returns — the policy-free
    init connect, `bootCritical` fail-fast, `OS_ALLOW_DRIVER_CONNECT_FAILURE`
    escape hatch, and the start() replay into retained admin state are identical
    either way, and the new tests pin that (an adopted instance that cannot
    connect takes the exact same verdict).
  - **`createPrebuiltDriverFactory(driver, { driverId?, fallback? })`** in
    `@objectstack/service-datasource` — the "adopt an existing driver" seam the
    first #3826 pass found missing, landed AS a factory so it composes into the
    one connect path instead of becoming a second entry point. `create()` returns
    the SAME instance every call: construction, pooling, and reuse stay host
    concerns; only the verdict converges. Not for the common case — a `default`
    expressible as `{ driver, config }` should stay a plain definition.

  The `@objectstack/verify` dogfood harness now boots through
  `DefaultDatasourcePlugin` (declared `sqlite-wasm` definition) instead of a
  pre-built `DriverPlugin` — so the dogfood gate exercises the same declared
  -default connect path `objectstack dev`/`serve` use, which is the §Risk
  mitigation ADR-0062 promised ("behind the dogfood gate") and did not yet have.
  The degraded-boot parity guard stays: `ObjectQLEngine.init()`'s verdict is
  still live for the boot re-verification, `DriverPlugin` escape-hatch drivers,
  and the cloud compositions until they converge onto this seam.

- 03d26f7: fix(runtime,spec)!: the dispatcher's `error.code` is the semantic string it always declared; the HTTP status moves to `httpStatus` (#3842)

  `HttpDispatcher.error()` took the HTTP status as its `code` argument and wrote it
  straight into the field `ApiErrorSchema` reserves for a semantic string, so
  `error.code` came back as `400`/`403`/`503` — a number, duplicating the response
  status and occupying the one slot a caller is meant to branch on. The real code
  then had to go somewhere else, and did, three somewhere-elses: `details.code`
  (auth gate, permission denial, anonymous deny), `details.type`
  (project-membership gate), and `error.type` (`routeNotFound`). Four sites, three
  parking spots, because the declared one was full.

  **FROM → TO on the wire.** A dispatcher error body

  ```json
  {
    "success": false,
    "error": {
      "message": "…",
      "code": 403,
      "details": { "code": "PERMISSION_DENIED" }
    }
  }
  ```

  is now

  ```json
  {
    "success": false,
    "error": { "code": "PERMISSION_DENIED", "message": "…", "httpStatus": 403 }
  }
  ```

  | Reading       | Was                                                        | Now                                               |
  | ------------- | ---------------------------------------------------------- | ------------------------------------------------- |
  | semantic code | `error.details.code` / `error.details.type` / `error.type` | `error.code`                                      |
  | HTTP status   | `error.code`                                               | `error.httpStatus` (or the response status)       |
  | context       | `error.details` (with the code mixed in)                   | `error.details` (context only, absent when empty) |

  **One-line fix for a direct reader:** replace `body.error.details?.code ??
body.error.type` with `body.error.code`, and `body.error.code` with
  `body.error.httpStatus`. **SDK callers need no change** — `ObjectStackClient`
  already normalised this (`err.code` semantic, `err.httpStatus` numeric) and still
  reads the old shape, so a client newer than its server is unaffected.

  Every code already on the wire moves **verbatim** — `PERMISSION_DENIED`,
  `ROUTE_NOT_FOUND`, `PASSWORD_EXPIRED`, `PROJECT_MEMBERSHIP_REQUIRED`,
  `VALIDATION_FAILED`, `unauthenticated`. This change moves a field; it does not
  rename anything. Reconciling the repo's two code vocabularies is #3841, and this
  leaves it exactly one map and one enum to sweep instead of four parking spots.

  A branch with no code of its own is served one derived from the status, via the
  single declared map `HttpStatusErrorCodeMap` / `standardErrorCodeForHttpStatus`
  in `@objectstack/spec/api` (`403` → `permission_denied`, `503` →
  `service_unavailable`, …). Derivation is necessary because `ApiErrorSchema.code`
  is required; drawing it from `StandardErrorCode` keeps a derived code a
  catalogued one rather than an invented string.

  **Spec changes:**

  - `ApiErrorSchema` gains optional `httpStatus: number` — the precedent is
    `EnhancedApiErrorSchema.httpStatus`. Additive.
  - `StandardErrorCode` gains `method_not_allowed` and `precondition_required`,
    the two statuses the runtime returns that the enum could not name. Additive.
  - **Breaking — `DispatcherErrorCode`** was `'404' | '405' | '501' | '503'` (string
    spellings of HTTP statuses, for matching against the numeric `error.code`). It
    is now `'ROUTE_NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'NOT_IMPLEMENTED' |
'SERVICE_UNAVAILABLE'` — the same four members the removed `error.type` enum
    declared, moved verbatim. FROM `DispatcherErrorCode.parse('404')` TO
    `DispatcherErrorCode.parse('ROUTE_NOT_FOUND')`; to match a status, read
    `error.httpStatus`. TypeScript flags every call site.
  - **Breaking — `DispatcherErrorResponseSchema`**: `error.code` is `z.string()`
    (was `z.number().int()`), `error.type` is **removed** (folded into `code`), and
    `error.httpStatus` / `error.details` are declared. This schema is what
    legitimised the deviation — it declared the opposite of `ApiErrorSchema` for
    the same field. FROM `{ code: 404, type: 'ROUTE_NOT_FOUND' }` TO
    `{ code: 'ROUTE_NOT_FOUND', httpStatus: 404 }`.

  **Also aligned, because they are the same wire surface:** `dispatcher-plugin`'s
  `errorResponseBase` (the THROWN-error exit) and its inline 404, and the MCP 405.
  `errorResponseBase` previously discarded a thrown error's `.code` outright — it
  had nowhere to put it — so the two exits of one surface disagreed about what a
  caller would see; they now agree. Every body on this surface is built by one
  helper (`packages/runtime/src/error-envelope.ts`), guarded in both directions by
  `error-envelope.conformance.test.ts`: each branch driven and parsed against the
  schema imported from `packages/spec`, plus a source scan so a new branch cannot
  quietly reintroduce a numeric `code` or a `type`-as-code sibling.

  This deletes the #3687 pin in `http-dispatcher.test.ts`, which asked to be
  deleted rather than updated once the dispatcher was fixed.

- 33a5ff4: `os migrate` no longer touches the database before you confirm, and refuses a
  SQLite database another process is using (#3917).

  **Nothing is written before the prompt.** `plan` called itself a dry run and
  `apply` gated on `[y/N]`, but both booted the full plugin set first — and boot
  schema-sync issued create-table/add-column DDL (plus the artifact's inline seed
  wrote rows) against the target database before either promise was kept.
  `SqlDriver` gains `setDeferredDdl` / `previewDeferredSchemaWork` /
  `flushDeferredSchemaDdl`: while armed, `initObjects` still registers every
  in-memory map drift detection depends on but records the physical work instead
  of performing it. Both commands boot with it armed, render the held-back work
  as a `New (additive)` section of the plan, and `apply` performs it only after
  confirmation. `os meta resync` / `os migrate files-to-references` keep the old
  behaviour — they need the tables to exist.

  **Occupancy check.** A live `os dev`/`os serve` holding the same SQLite file is
  the usual way a migration goes wrong: the migration is transactional and swaps
  tables inside the file, but the running server keeps prepared statements and a
  schema cookie the migration invalidates. `os migrate` now probes the target
  before booting — `PRAGMA locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` under
  `busy_timeout = 0`, which reports `SQLITE_BUSY` when another connection is
  _attached_, not merely writing. (`wal_checkpoint(TRUNCATE)` only sees an active
  writer, and `-wal`/`-shm` presence cannot tell a live server from a crashed one;
  both are encoded as tests.) `apply` refuses with exit 1 — `error: database_busy`
  under `--json` — unless the new `--force` flag is passed; `plan` warns and
  continues, since it writes nothing either way. SQLite only: Postgres and MySQL
  take their own server-side locks.

  `@objectstack/runtime` also exports `resolveStandaloneDatabase()`, so a caller
  can resolve the database target with the same precedence the boot uses without
  building the stack, and `createStandaloneStack` accepts `skipSeedData`.

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

- a1b61e0: Request bodies are now checked against the schemas the API catalog declares for them (#3899, the request-side dual of #3877).

  **Routes that now answer `400 VALIDATION_FAILED` + `fields[]` for a body violating their declared `requestSchema`** (previously the body was consumed raw, and a malformed one silently executed different semantics):

  - `POST /data/:object/query` — body must be a QueryAST (`FindDataRequestSchema`); a garbage body used to degrade into an unfiltered full read. The path `object` is now pinned into the forwarded query (a body `object` can no longer contradict the path).
  - `POST /data/:object` / `PATCH /data/:object/:id` — body must be a record object (`CreateDataRequestSchema` / `UpdateDataRequestSchema`).
  - `POST /data/:object/batch` — body must be a `BatchUpdateRequestSchema` (`operation` + `records[]`).
  - `POST /data/:object/createMany` — body must be a bare JSON array of records (`CreateManyDataRequestSchema`); `{ records: [...] }` (updateMany's envelope) is rejected with a pointer.
  - `POST /notifications/read` — body must be `{ ids: string[] }` (`MarkNotificationsReadRequestSchema`); a misnamed key used to become `markRead(userId, [])` — a 200 no-op that never cleared the badge.

  **Dispatcher automation routes now validate their bodies** (no catalog schema; hand-written guards):

  - `POST /automation` and `PUT /automation/:name` require a flow-definition object, and POST requires a non-empty `name` — a mistyped `name` used to register the flow under the key `undefined` and echo 200.
  - `POST /automation/:name/toggle` is strictly `{ enabled?: boolean }` — `{"enable": false}` (one letter off) used to ENABLE the flow and answer 200 `{enabled: true}`; it is now a 400 naming the offending key. An empty body still means enable.

  **`QuerySchema` now declares the search contract ADR-0061 actually serves** (additive): `search` accepts the canonical bare query string as well as the structured `FullTextSearch` form, and the server-validated `searchFields` narrowing is formally declared. Previously the schema declared only the object form while every surface (and the ADR's own conformance proof) sent the string — drift that surfaced the moment request bodies started being validated.

  **Catalog corrections in `@objectstack/spec` (`plugin-rest-api.zod.ts`)** — documentation-only tables:

  - `DEFAULT_NOTIFICATION_ROUTES` drops the four device/preferences endpoints — those server routes were removed in #3612 (never built), yet the table kept declaring them, `requestSchema` and all.
  - `DEFAULT_AUTOMATION_ROUTES`' trigger endpoint path is corrected `/trigger` → `/trigger/:name` (the mounted path; the flow name rides the path) and its `AutomationTriggerRequestSchema` declaration is removed — that schema never described this route's wire shape.
  - `DEFAULT_DATA_CRUD_ROUTES` gains the `POST /:object/query` entry (mounted since forever, previously undeclared), repoints create/update to the schemas the routes actually validate (`CreateDataRequestSchema` / `UpdateDataRequestSchema` — the old `CreateRequestSchema`/`UpdateRequestSchema` names described a `{ data }` envelope the wire never had), and drops `requestSchema` from GET/DELETE entries (path/query-bound inputs; nothing can violate them as a body).
  - New gates: catalog `requestSchema`/`responseSchema` strings must resolve to real exported Zod schemas, `requestSchema` may only sit on body-carrying methods, and every declared `requestSchema` on a mounted route has a violating-body → 400 conformance case (`packages/rest` + `packages/runtime` request-schema-gate suites).

  Migration: clients that already send the documented shapes are unaffected. If you relied on a malformed body being silently accepted (e.g. posting `{ records: [...] }` to `createMany`, a non-boolean `enabled` to toggle, or an off-schema analytics/query body), fix the request to the declared shape — the 400's `fields[]` names each offending key.

- 3ba8d77: fix(actions): dispatch on the declared action `type` over REST — flow actions are no longer MCP-only (#3915)

  `POST /api/v1/actions/:object/:action` had **no action-type branching at all**.
  Whatever an action declared, the route went straight to `ql.executeAction` — the
  script-handler registry — while the MCP `run_action` bridge had implemented the
  `flow` branch since #2849. The spec is unambiguous that every non-`script` type
  dispatches on `target` (`packages/spec/src/ui/action.zod.ts`), so a REST/SDK
  caller who followed it and invoked a `type: 'flow'` action got

  ```
  Action '' on object '*' not found
  ```

  and had to know, out of band, to call `POST /api/v1/automation/:target/trigger`
  itself. Worse for the Studio-authored case: `resyncAuthoredActions` deliberately
  registers **no** handler for a flow-typed action ("no body (target/flow/url
  action)"), so there was never anything for the registry to find.

  The two headless surfaces now share one dispatch:

  - **`flow`** → `automation.execute(action.target, …)` via the new
    `dispatchFlowAction`, which the MCP path now calls too. The caller's identity
    (`userId` / `positions` / `permissions` / `tenantId`) is forwarded, so a
    `runAs: 'user'` flow enforces RLS as the invoker instead of falling into the
    user-less UNSCOPED path (ADR-0049). A flow action on a kernel with no
    automation service reports **503**, not a `{ success: false }` body.
  - **`script`** → the handler registry, unchanged. An action with no resolvable
    declaration is handler-only by definition and keeps that path.
  - **`url` / `modal` / `form` / `api`** → **400** naming the type and the
    prescription (for `api`, the `target` endpoint to call directly) instead of a
    registry miss that reads like the action does not exist.

  The route also resolves **standalone declarations** now — `defineAction`
  artifacts in the ObjectQL registry and Studio-authored `action` metadata rows,
  neither of which appears inside any object's `actions[]`. They were invisible
  to this route before, which is why a flow-typed one could not be dispatched —
  and, separately, why its `requiredPermissions` were declared-but-unenforced on
  REST while MCP honoured them. The ADR-0066 D4 gate still runs **before** the
  type check, so an unauthorized caller learns nothing about how an action
  dispatches.

  **Migration:** a caller invoking a `url`/`modal`/`form`/`api` action through
  this endpoint used to receive `{ success: false, error: "Action '' on object
'*' not found" }` (HTTP 200) and now receives a 400 that says what to call
  instead. No spec-faithful action changes behavior.

- 4be9d99: fix(runtime,hono,plugin-dev): retire the dispatcher's `/storage` bridge — it never spoke the storage contract (#4087)

  `POST /api/v1/storage/upload` and `GET /api/v1/storage/file/:id` were a
  dispatcher-side bridge to the `file-storage` service slot, written against a
  service shape that does not exist:

  - **Upload** called the contract's `upload(key, data, options?)` as
    `upload(file, { request })` — the parsed file object landed in the `key`
    slot and `{ request }` in `data`. That is a `TypeError` against every
    implementation in the repo (`S3StorageAdapter`, `LocalStorageAdapter`,
    `SwappableStorageService`, plugin-dev's in-memory one), not a
    near-miss: `Buffer.from({}) → ERR_INVALID_ARG_TYPE`, or an object used as
    an S3 object key / `path.join` segment.
  - **Download** branched on `result.url` / `result.redirect` / `result.stream`
    / `result.mimeType` while the contract's `download(key)` resolves a
    `Buffer`, so every branch fell through and the route answered a
    JSON-serialized Buffer.

  Both routes are removed, along with `HttpDispatcher.handleStorage()`, the
  `/storage` domain registration, the dispatcher-plugin mounts and the two route
  ledger rows.

  **Migration.** There is nothing to migrate off in practice — neither route
  could complete a request. (They were reachable: `service-storage` mounts
  `/storage/upload/presigned`, not `/storage/upload`, so nothing shadowed them.
  They simply had no caller — no SDK method builds those URLs.)
  `/api/v1/storage` is `@objectstack/service-storage`'s surface and always was
  the working one:

  - Upload — FROM `POST /api/v1/storage/upload` TO the presigned protocol
    (`POST /storage/upload/presigned` → direct `PUT` to the returned URL →
    `POST /storage/upload/complete`), or `client.storage.upload(file)`, which
    runs all three steps.
  - Download — FROM `GET /api/v1/storage/file/:id` TO
    `GET /storage/files/:fileId/url` (`client.storage.getDownloadUrl(fileId)`)
    for a signed URL, or `GET /storage/files/:fileId` for a stable browser URL
    that 302s to it.

  Install `@objectstack/service-storage` to get those routes; without it
  `/api/v1/storage` now has no handler, which is the same answer every other
  uninstalled capability gives.

  Two follow-on corrections keep `declared === enforced`:

  - `@objectstack/hono` no longer mounts `app.all('<prefix>/storage/*')`. That
    wildcard claimed the whole `/storage` subtree for the two dead routes, so
    every other path under it — service-storage's protocol above all — got the
    bridge's own 404 rather than falling through. Storage is ordinary catch-all
    traffic now.
  - Discovery keeps gating `routes.storage` on `isServiceServeable` — the shared
    `handlerReady` predicate #4058 step 2 introduced — and plugin-dev's in-memory
    implementation now self-declares `handlerReady: false`. #4058 deliberately
    left that one serving because the `/storage` bridge was still there to serve
    it; with the bridge retired nothing routes HTTP to that slot, so `false` is
    the honest value — the position `realtime` has held since ADR-0076 D12. The
    implementation keeps working for in-process callers; it is simply no longer
    advertised as a reachable HTTP capability.

### Patch Changes

- bc35e00: fix(runtime): action bodies execute under a real execution context — every owner-scoped write no longer dies FORBIDDEN

  An action body's `ctx.api` was never bound. The sandbox's `buildSandboxApi`
  walked its whole fallback chain — no `actionCtx.api`, and the raw `ObjectQL`
  engine has no `.object()` (that lives on `ScopedContext`, reachable only via
  `engine.createContext()`, which the action path never called) — and landed on a
  repo facade that proxied every call to the engine with **no `context`**.
  `ctx.engine` had the identical hole.

  Context-less is not "trusted", it is **identity-less**, and identity-less is
  strictly worse than either coherent posture: plugin-sharing's write gate
  short-circuits on `!context.userId` (no user to own the record) and its bypass
  needs `context.isSystem` (never set). So a `type: 'script'` action whose body
  called `ctx.api.object('crm_case').update(...)` failed with
  `FORBIDDEN: insufficient privileges to update crm_case` — **as the built-in
  admin** — while the `[action-audit]` line on the same request announced
  RLS-bypassing TRUSTED execution. Objects with a `public` sharing model, no
  owner field, or a bypass listing passed the gate early, so only _some_ actions
  broke and the defect read as object-dependent flakiness.

  Both dispatch paths (REST `/actions/:object/:action` and MCP `run_action`) now
  bind `ctx.api` to `engine.createContext(...)` and thread the same envelope
  through `ctx.engine`, matching what hook bodies already get from the engine's
  `buildHookApi`. The envelope is the caller's `ExecutionContext` elevated with
  `isSystem: true` — the posture the action surface already documents and gates
  for at invoke time (the ADR-0066 D4 capability gate and the `ai.exposed` gate
  are what admit a body to trusted execution). The caller's fields are spread
  first, so a body's writes stay attributable (`userId` stamps
  `created_by`/`updated_by`), org-scoped (`tenantId` stamps the org column and
  drives driver-level tenant isolation), and joined to an open transaction —
  rather than the unattributable, org-less rows a bare `{ isSystem: true }` would
  write.

  No authoring change is required: `ctx.api.object(name)` inside a `body` now
  does what the docs always said it does. Bodies that worked before (public /
  owner-less objects) are unaffected apart from their writes now being correctly
  attributed and org-stamped.

- 48fcf70: **[ADR-0110 D5] The action-governance inventory moves to the engine plugin —
  AppPlugin never ran it on the platform's own dev path.**

  Dogfooding the inventory with a positive control (an injected undeclared
  handler) showed the `kernel:ready` hook it hung on never fired under `os dev`:
  AppPlugin is registered conditionally (`serve.ts` skips it when the host wraps
  itself; the dev fast path loads apps without it), so the checklist that
  justifies D3's no-opt-out refusal was never printed where an upgrade most
  needs it.

  - The addressing vocabulary (`GLOBAL_ACTION_OBJECT_KEY`,
    `actionHandlerObjectKeys`, `isObjectLessActionKey`,
    `resolveActionHandlerKeys`) and the reconciliation move into
    `@objectstack/objectql` — the engine owns the map they describe, and the
    dependency direction (runtime → objectql) permits no other home.
    `@objectstack/runtime` re-exports them unchanged, so dispatch, the MCP
    bridge and existing importers keep reading ONE implementation.
  - `ObjectQLPlugin` now runs the inventory in its existing `kernel:ready`
    handler — after `resyncAuthoredActions`, so the audited registry is final —
    and again on `metadata:reloaded`, fingerprint-suppressed so a reload that
    changed nothing action-related logs nothing. A Studio edit that orphans or
    binds a handler updates the report live; the old boot-only snapshot went
    stale on the first edit.
  - Verified end-to-end with a programmatic kernel: the injected orphan is
    named, a clean registry is silent. The `os dev` / `os serve` consoles still
    swallow ALL plugin boot logs (pre-existing, tracked separately) — on those
    surfaces the inventory becomes visible once that sink is fixed.

- 0ecc656: feat(lint): an action body's discarded `ctx.record` write warns at author time (#4345)

  `#4344` deliberately left `ctx.record` alone, and said why: an action's
  `ctx.record` is a plain snapshot (`unwrapProxyToPlain(actionCtx?.record)`) that
  `boundActionHandler` never writes back — the hook path's
  `applyMutationsToInput` has no action-side counterpart — so `ctx.record.x = …`
  is discarded for **declared and undeclared fields alike**. Reporting that
  through the unknown-field rule would have been actively wrong: flagging only
  the undeclared half implies the declared half persists, which is the false
  completion this rule family exists to stop manufacturing. It needed its own
  finding, and now has one.

  **New rule — `action-record-write-discarded` (advisory).**

  **It is not "flag every `ctx.record.<field>` assignment"** — that would be a
  false-positive machine, because mutating the snapshot to build a payload is a
  legitimate idiom:

  ```js
  ctx.record.stage = "won";
  await ctx.api.object("crm_deal").update(ctx.record); // the write is LIVE
  ```

  So the finding requires the write to be **provably dead**: reported only when
  `ctx.record` never escapes the body as a value. Property reads
  (`ctx.record.id`) do not rescue a write and do not suppress the finding;
  handing the object to anything — an argument, an assignment RHS, a spread, a
  return — does. Aliasing (`const r = ctx.record`) reads as an escape, which is
  the safe direction: it costs a missed finding, never a false one.

  Truthiness and type tests are **not** escapes, and that distinction is what
  makes the rule fire on real code rather than almost never. Running it against
  the showcase app is what surfaced it: `mark_done` opens with
  `ctx.recordId || (ctx.record && ctx.record.id)`, the defensive idiom action
  bodies are actually written with, and counting that guard as an escape silenced
  the finding on the one body in the repo that had a record write. A test reads
  the reference and yields a boolean — or, for `&&`/`||`/`??`, yields the left
  operand only when it is falsy, which is null or undefined and persists nothing.
  Only the LEFT operand is a test: `x || ctx.record` really does evaluate to the
  object, and still escapes.

  **One suite member, two rule ids.** Both findings fall out of one parse of one
  source on one surface, so `validateActionBodyWrites` reports both rather than
  `REFERENCE_INTEGRITY_RULES` growing a second member that would parse every
  action body again to say two things about the same walk. The alternative —
  hand-wiring it into the three CLI commands — is the drift that suite exists to
  end, and `validateReadonlyFlowWrites` is the standing proof: wired into
  `validate` and `compile`, never into `lint`. The trade-off is written down at
  both ends rather than left to be rediscovered.

  **The ledger ratchet fired, as designed.** `record-property-assign` joins the
  shared `HOOK_BODY_WRITE_PATTERNS` — the extractor's shape inventory, not any
  one rule's — and both existing consumers had to classify it before it could
  land. That was not cosmetic on the hook side: a `record-property-assign` write
  carries no `object`, and `validateHookBodyWrites` branched on exactly that to
  mean "a `ctx.input` write", so the new shape would have been reported as _"the
  hook writes 'stage' to its input"_. The hook rule now declares its own
  consumed subset (`HOOK_BODY_WRITE_PATTERN_IDS`) and its exclusion with a
  reason — a hook sandbox context has no `ctx.record` at all
  (`buildSandboxContext` never sets it), so the expression throws at run time
  rather than silently no-op'ing, and a loud failure is not an advisory rule's
  business.

  `extractHookBodyWriteSet` is the new one-parse entry point, returning the
  writes plus the `ctxRecordEscapes` signal; `extractHookBodyWrites` stays as a
  thin projection of it.

  **Boot path.** The action gate's prefilter widens from `api` to `api`-or-
  `record`, so a body reaching neither still never loads the ~9 MB TypeScript
  compiler. `lazy-deps.test.ts` pins it — and its header and two case names,
  which still claimed every lazy dep waited on "a react page", now say which
  trigger each one pins (typescript has also been loaded by the hook-body gate
  since #4271).

  `@objectstack/spec` / `@objectstack/runtime`: `ScriptBodySchema`,
  `ActionSchema.body` and `ScriptContext.record` now state that
  `ctx.api.object(...)` is the only path that persists anything, and that
  `ctx.record` is read-only in effect. Doc comments only — no schema or
  generated-artifact change. Whether the runtime should instead refuse or honour
  a record write stays open on #4345.

- 0c90ece: fix(actions): the object-less `POST /actions//:action` shape is actually reachable over HTTP (#3913 follow-up)

  #3913 taught `handleActionsRequest` to route a single-segment path — the
  object-less shape `POST /api/v1/actions//:action` — at the canonical `'global'`
  key. That code was correct and unit-tested, and **unreachable**: the dispatcher
  mounts its routes explicitly, `:object` does not match an empty path segment,
  and no registration covered the `//` form. Over real HTTP the request fell
  through to Hono's `notFound` and answered a bare `{error: 'Not found'}` with the
  actions domain never running — so the exact URL #3913 was filed against still
  did not dispatch.

  The tests could not catch it because they call `dispatcher.handleActions()` /
  `dispatcher.dispatch()` directly, bypassing the route table. This is the same
  class of bug `dispatcher-plugin.routes.test.ts` was created for after `/mcp` and
  `/keys` shipped the same way; the guard now covers the action routes too.

  Found by dogfooding the running showcase app, not by the suite.

  `POST /api/v1/actions//:action` now answers identically to
  `POST /api/v1/actions/global/:action` — same envelope, same `'global'` key. The
  object-scoped registrations are untouched and unshadowed (Hono matches the
  literal `//` without competing with `:object/:action`).

- 6fa1827: fix(runtime): the `/ai/agents` degraded fallback answers in the declared envelope (#4053)

  `GET /ai/agents` was the last unenveloped SDK-addressable route. The framework's
  degraded fallback — what an open-source runtime with no `service-ai` answers —
  now returns `{ success: true, data: { agents: [] } }` via `deps.success`, and the
  route-envelope guard's last ratchet retires with it: **0 ratcheted on both
  surfaces.**

  ## Why `data: { agents }` and not `data: []`

  #3983 set the precedent that `data` carries the payload directly, and following it
  here would have looked consistent. It would also have been wrong, and silently so.

  `AiAgentsResponseSchema` is a **declared** payload schema; share-links' `{ links }`
  was an ad-hoc wrapper with none. So this is the #3843 relocation — the declared
  payload moves under `data` unchanged, the way `SettingsNamespacePayload` did —
  rather than a reshape.

  That distinction decides the blast radius. `unwrapResponse` returns `body.data`
  when a body has a boolean `success` **and** a `data` key, so:

  | conversion                    | `client.ai.agents.list()`           |
  | ----------------------------- | ----------------------------------- |
  | `data: { agents }` (this one) | reads `.agents` off it — **works**  |
  | `data: [...]` (flattened)     | `.agents` is `undefined` → **`[]`** |

  An empty list is not a visible failure on this route. `useAiSurfaceEnabled` gates
  the entire AI surface on `agents.length > 0`, and an empty catalog is the _correct_
  answer for a seat-less user (ADR-0068) or a Community-Edition deployment. The
  broken state and the legitimate one are indistinguishable — no error, no 403, no
  log.

  ## Consequence: no lockstep

  Because the SDK reads both shapes identically, **each surface converts on its own
  schedule**. Cloud's `service-ai` still answers unenveloped and keeps working
  unchanged; objectui already reads all four shapes (objectui#2992). The
  "three repos in one batch" framing #4053 opened with does not apply to this
  variant.

  Five tests in `@objectstack/client` pin it, including the road not taken: the
  flattened body asserts `[]`, so the cost of choosing it is recorded rather than
  rediscovered.

- 05154a1: Discovery stops telling Cloud/Enterprise deployments that nothing implements `ai` (#4093 follow-up).

  `CORE_SERVICE_PROVIDER` recorded `null` for `ai` because no **workspace** package provides it, and `serviceUnavailableMessage('ai')` therefore produced _"No implementation ships for the 'ai' slot"_. That is false: `@objectstack/service-ai` registers the slot in `objectstack-ai/cloud`. The table conflated "not in this repository" with "does not exist" — the same class of wrong answer the table was introduced to end, one step further out.

  Verified against the cloud repository rather than inferred: `packages/service-ai/src/plugin.ts` calls `ctx.registerService('ai', …)`, and the package is `private: true`, so there is genuinely nothing to install — which is why `null` stays right and an `Install X` sentence would still be wrong. `search`, `workflow` and `graphql` were checked the same way and nothing registers them in either repository, so their `null` and their "nothing ships" sentence are accurate.

  `ai` now carries a `REMEDY_DETAIL` sentence — _"Provided by @objectstack/service-ai in ObjectStack Cloud/Enterprise — no implementation ships in the open framework"_ — the mechanism `ui` already used. Both discovery (`services.ai.message`) and the `/ai` 501 body report it.

  This **removes** code: `/ai`'s domain had a local message override, added because the shared sentence was wrong there. Correcting the table fixed the domain _and_ discovery, which the override could never reach, so the override and `capabilityUnavailable`'s `message?` parameter are both gone. A slot whose sentence is wrong needs the table corrected, not a local exception.

  Also corrected: three places still describing `/ai`'s absent-service answer as a 404 (`docs/api/client-sdk.mdx`, `docs/releases/v17.mdx`, and a comment in `packages/client`'s URL-conformance test) — stale since that answer became 501.

  FROM → TO: `services.ai.message` and the `/ai/*` 501 body change text. Nothing branches on either — `status` and `enabled` are the contract, the message is prose for humans and agents.

- fce14ab: fix(runtime): the `callData('query')` ObjectQL fallback serves the caller's query instead of dropping it (#4386)

  When the protocol service is unavailable (lean assemblies, MCP multi-env with
  a raw driver), the fallback passed only `{ context }` to `ql.find` — the
  caller's `where`/`orderBy`/`limit` never left the function, and the ENTIRE
  table came back as an ordinary-looking `{ records, total }`. The sibling
  `get`/`update`/`delete` fallbacks all built a proper `where`; `query` was the
  only verb whose fallback forgot the request.

  The fallback now forwards the canonical QueryAST keys both possible
  recipients execute (`where`, `fields`, `orderBy`, `limit`, `offset` — engine
  option bag and raw-driver QueryAST are aligned by design), drops a
  caller-supplied `context` (server-derived only, matching `findData`), and
  refuses with 501 anything it cannot reproduce without the protocol layer —
  wire spellings needing fold/lowering (`sort`, `select`, `skip`, `populate`)
  and capabilities a raw driver would silently drop (`search`, `expand`). The
  protocol path is unchanged and keeps accepting wire spellings.

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

- 7309c81: fix(runtime,cli): `projectRoot` reaches the metadata repository; stop compiling tests into the CLI's dist (#4065)

  Two defects behind the last of #4065's stray `.objectstack/` directories — the
  one under `packages/cli/`. Neither is cosmetic.

  **1. `projectRoot` only got half the stack.** `createStandaloneStack`'s
  `projectRoot` is documented as scoping a boot's on-disk state to the project
  folder "so different examples / apps don't share a single database by accident",
  and it did redirect the default sqlite database. But it was never passed to
  `MetadataPlugin`, whose `FileSystemRepository` kept rooting at `process.cwd()`.
  So one "project root" meant two different directories: a boot pointed at project
  A wrote `A/.objectstack/data/` and `<cwd>/.objectstack/metadata/`. It now
  forwards `rootDir`, and `bootSchemaStack` accepts a `projectRoot` to pass down
  (defaulting to `process.cwd()`, which is right for every real `os migrate` — the
  CLI runs from the project directory). The two migrate integration suites, which
  build a fixture project in a tempdir, now scope their boots to it.

  **2. The CLI compiled its own tests into `dist/` — and vitest ran them.**
  `tsconfig.build.json` included all of `src` with no exclude, so every
  `src/**/*.test.ts` was emitted as `dist/**/*.test.js`. Two consequences:

  - `files: ["dist"]` **published** them.
  - This package has no vitest config, so `vitest run` collected the compiled
    copies alongside the sources: **81 test files and 849 tests where the sources
    hold 58 and 581**. Every `src/` test also ran as a stale `dist/` twin built
    from whatever the source said at the last build.

  That is not just noise — it silently defeats edits. A fix to a source test
  appeared not to work, because the run was still executing the pre-fix compiled
  duplicate; that is exactly how the `.objectstack` residue survived a correct
  fix long enough to look like a different bug. It also means a source test could
  be edited to pass while its stale twin kept asserting the old behaviour, and
  neither would be obviously wrong. Test files are now excluded from the build.

  No other package is affected: the rest build with `tsup`, which emits only
  declared entry points. Verified by scanning every `packages/*/dist` for
  `*.test.js` — the CLI was the only hit.

- 41dcda3: fix(spec,runtime,service-automation): `IAutomationService` declares the connector registry it already serves (#4127)

  The fourth and last of the dispatcher call sites #4127 found calling a method its
  contract never declared. The first three shipped in #4143; this one was held back
  because the fix is a **type move**, not a type addition — `ConnectorDescriptor`
  was declared in `@objectstack/service-automation`'s engine, which is one
  _implementation_ of `IAutomationService`. A contract cannot name a type that
  lives inside its own implementation, so `getConnectorDescriptors` could not be
  declared at all until the type had a home in the spec.

  **`IAutomationService` += `getConnectorDescriptors?()`.** It is the sibling of
  `getActionDescriptors`, which the contract has declared since ADR-0018: the two
  fill the flow designer's `connector_action` node together — node vocabulary from
  one, the connector → action → input pickers from the other. Only one of them was
  written down. `GET /api/v1/automation/connectors` has served the other since
  ADR-0022 by probing for the method and then re-typing its own result as `any` to
  filter on `?type=`, which is a filter on a field the type system did not know
  existed — one typo from silently matching nothing and answering an empty
  registry, which is also what this route legitimately returns when the method is
  absent, so the failure had no distinguishable symptom.

  Optional for the same reason `getActionDescriptors` is: a connector registry is a
  capability of the flow-engine implementation, not a property of every automation
  slot. A script-runner filling the slot has no connectors to describe, and the
  route answers an empty registry rather than a 404 — the `handlerReady` posture
  does not apply, since the slot is serveable and only this capability is absent.

  **`ConnectorDescriptor` / `ConnectorActionDescriptor` / `ConnectorOrigin` /
  `ConnectorState` move to `@objectstack/spec/integration`**, beside the ADR-0097
  provider contract, for the reason that file already states about itself: they are
  pure types, so a connector plugin — or a designer client, or the dispatcher —
  speaks about registered connectors depending only on the spec, with no runtime
  coupling to the engine. `ConnectorOrigin` is ADR-0097 §4 vocabulary and
  `ConnectorState` is #3017 vocabulary; neither was ever engine-private in meaning,
  only in location.

  Nothing is renamed and no shape changes. `@objectstack/service-automation`
  imports the four back and re-exports them from its index — the same names, from
  the same entry point — so every existing importer compiles unchanged.
  `ConnectorState` joins that re-export, which it should have been in all along: it
  is a required field of the descriptor the index has always exported.

  **The test fixture had already drifted, which is the concrete cost.** The
  dispatcher's connector mock declared `{ name, label, type, actions }` and omitted
  `origin` and `state` — both **required** on `ConnectorDescriptor`, and both the
  fields a designer reads to tell a live declarative instance from a plugin one
  (ADR-0097 §4), or a dispatchable connector from a degraded one that is listed
  honestly rather than hidden (#3017). Nothing caught it, because an undeclared
  return type cannot be checked against. The fixture is typed now, so it cannot
  drift again, and a new test pins that `origin` / `state` / `degradedReason`
  survive the hop through the route rather than only `name` and `type`.

  Verified: `@objectstack/spec` **7089 tests / 272 files** (2 new contract tests),
  `@objectstack/service-automation` **457 / 41**, `@objectstack/runtime`
  **218 http-dispatcher tests** (1 new), `tsc --noEmit`, `pnpm lint`, the liveness
  and empty-state gates, and the three generated-artifact gates — all clean.

- a225ef5: fix(runtime,webhooks): the path object wins on /data/:object/query, and the webhook envelope owns its keys (#3946)

  Follow-up sweep for the shape behind #3897 and #3933 — a trusted, server-derived
  value written into an object literal with a caller-controlled bag spread OVER
  it. Both of those were in the same block of REST code, so the pattern was swept
  across all 1313 non-test TypeScript files in `packages/`. Nine candidate sites;
  one real, one worth hardening, seven verified clean (recorded in #3946 so the
  next sweep does not re-litigate them).

  **`POST /data/:object/query` (runtime dispatcher).** The `/data` domain built
  `{ object: objectName, ...body }`, so `{"object":"other", …}` in the body moved
  the read to a different object than the URL named.

  This is NOT an authorization bypass, and the tests pin why: `callData` gates
  API exposure on `params.object`, so the gate followed the body and agreed with
  the read — an object hidden by `apiEnabled: false` was refused either way. What
  broke is that the URL stopped describing the operation (audit trails, logs, and
  anything keyed on the request path saw object A while object B was read), and
  that one endpoint spoke a second dialect of the contract the REST side had just
  standardised on: the path object wins. The other handlers in that file never had
  the problem — they nest caller data (`data: body`, `query: normalized`) instead
  of splatting it, and the GET-by-id branch already allowlists its query params
  against exactly this pollution.

  **Webhook delivery envelope.** `auto-enqueuer` built
  `{ object, recordId, action, timestamp, ...payload }`, letting an event payload
  rewrite the envelope a subscriber receives. Behaviour-neutral for the engine's
  own publishers — `data.record.*` payloads are `{ recordId, after, changes }`
  with record fields nested under `after`, so none of those four keys collide
  today — but the shape was wrong, and the `payload.id` fallback right above it
  suggests publishers that flatten record fields do exist. Envelope keys are
  written last now.

- c20b875: **Correct the stale premise left behind by #4012: the degraded-boot stderr copy
  survives the operator's LOG LEVEL, not `os serve`'s boot-quiet window.**

  `emitDegradedBootBanner` writes the `OS_ALLOW_DRIVER_CONNECT_FAILURE` banner to
  stderr in addition to `logger.warn`, and every comment and test name explaining
  why cited the same reason: `os serve` swallowed all of stdout while the kernel
  booted, and `Logger` routes `warn` to stdout. #4012 fixed that — the boot window
  now buffers and replays `warn`-and-above — which retires the _stated_
  justification for a duplicate that is nonetheless still load-bearing:

  `Logger.write()` returns before touching a stream when the record is below
  `config.level`, so at `--log-level error`, `fatal` or `silent` the banner's
  `logger.warn` reaches **no** stream at all. A production host at `error` is
  exactly the deployment this escape hatch exists for, and exactly where a
  logger-only banner would vanish. Removing the stderr copy on the strength of
  #4012 would therefore have been a regression — so this documents the reason that
  is still true, in the places someone would read before deleting it:
  `degraded-boot.ts`, the engine's emit site, and all three parity tests
  (objectql, runtime, service-datasource), which are renamed off "which `os serve`
  boot-quiet cannot swallow" to "which the operator log level cannot filter away".

  The objectql parity test now proves the claim instead of asserting around it: it
  drives a **real** `ObjectLogger` at `level: 'error'` and requires the banner on
  stderr _and_ nothing on stdout. Set the level to `warn` and it fails — so the
  test is pinned to the level filter rather than passing for any reason.

  Also corrected in the same sweep, all comment-only, all previously overstating
  what #4012 had not yet fixed:

  - the automation wiring summary (`format.ts`, `serve.ts`, its test) claimed the
    boot window swallowed the engine's binding warnings. Its real justification is
    stronger and unchanged: a flow that silently fails to arm emits **no** log line
    at any level, so binding state has to be read off the live engine — absence of
    a warning was never evidence of a bound flow.
  - the seed summary (`seed-summary.ts`, `format.ts`, its test) and `AppPlugin`'s
    seed-outcome note attributed the silence to the boot window; the operative
    gate is that `SeedLoader`'s result logs are `info`, under the default `warn`.

  No behavior changes.

- 0373d52: Both discovery builders now derive the `data` service entry from the implementation in the slot, closing the hardcoded "kernel-provided" block (#4130).

  #4089 computed `metadata`; `data` was the last entry that judged itself, reporting `status: 'available'` and `handlerReady: true` unconditionally. That was true — but by a convention in a different package, not by anything either builder checked: ObjectQL is the slot's only producer, and plugin-dev always loads `ObjectQLPlugin` as a child, so plugin-dev's `data` stub (`find()` returns `[]`, `insert()` mints an id and stores nothing) never reaches the slot. A second producer, or a trimmed dev config, and the hardcode starts lying about the platform's most load-bearing capability.

  Both builders now read the registered service's `__serviceInfo`:

  - a real engine carries no marker ⇒ `available` + `handlerReady: true`, byte-identical to the hardcode it replaces (verified on a real kernel boot);
  - a self-declared stub ⇒ its own `status` and `message`, with `handlerReady: false` (the default for `stub`), so a consumer that gates on `handlerReady` stops treating an empty query engine as a real one.

  `handlerReady` is derived here rather than pinned `true` as it is for `metadata`, because the two routes differ: `/meta` answers from the protocol whatever fills the metadata slot, while `/data` needs the `protocol` or an objectql-shaped service and 503s without them — and the only stack where a stub occupies the `data` slot is one where ObjectQL never registered. No routing, gating or dispatch behavior changes: the `data` domain resolves its engine directly and never consulted this slot.

- 4f30943: Both discovery builders now compute the `metadata` service entry from the implementation that fills the slot, instead of hardcoding opposite verdicts for it (#4089).

  `metadata` sat in a "kernel-provided (always available)" block above the loop that reads `__serviceInfo`, hardcoded separately in each builder — and the two disagreed about the same slot:

  - `@objectstack/runtime`'s dispatcher declared it permanently `status: 'degraded'` with `message: 'In-memory registry; DB persistence pending'`, so a stack with `MetadataPlugin` and a real `sys_metadata` table was still reported as having no persistence.
  - `@objectstack/metadata-protocol` declared the same slot permanently `status: 'available'`, so the kernel's in-memory fallback (`createMemoryMetadata`, auto-registered when no metadata plugin is present) read exactly like a persisted registry — the `__serviceInfo` marker #4058 gave it went unread here.

  Both now read the registered service's `__serviceInfo` (via `readServiceSelfInfo`) and report what it declares:

  - kernel in-memory fallback, or plugin-dev's dev registry → `status: 'degraded'` plus that implementation's own `message`, which names what is missing and what to install.
  - `MetadataPlugin` (or any implementation carrying no marker) → `status: 'available'` with no message.

  `handlerReady: true` is now stated unconditionally on both sides: it answers "is `/api/v1/meta` mounted?", and that route is served by the protocol whichever implementation occupies the slot — a degraded service in it does not unmount the route. Nothing about routing, gating, or dispatch changes; consumers that treat `status` as a capability claim (AI agents, the console) simply stop being told two different things by two hosts.

- 86a71d1: Discovery's "install this to enable" now names a package that exists (#4093 follow-up).

  Discovery tells a consumer two things about an absent capability: that it is absent, and what to do about it. The first has been carefully honest since #2462/#4000. The second was invented from the slot name.

  The dispatcher templated `Install a ${slot} plugin to enable` across twelve slots, and `metadata-protocol` carried a hand-written table in which **ten of fifteen entries named a package that does not exist** — `plugin-redis`, `plugin-bullmq`, `job-scheduler`, `plugin-notifications`, `plugin-storage`, `plugin-automation`, `ui-plugin`, plus `plugin-ai`, `plugin-search` and `plugin-workflow` for slots nothing implements at all. That value is also surfaced as discovery's `provider`.

  A remedy naming a package that cannot be installed is a dead end handed to someone at the exact moment they are trying to fix their stack — and an agent reading discovery cannot tell it apart from a package it should install. It is the same `declared ≠ enforced` failure this lineage has been closing, one level over: not "does the capability exist" but "is the fix real".

  `CORE_SERVICE_PROVIDER` and `serviceUnavailableMessage()` in `@objectstack/spec/system` are now the one place that sentence is written, and both discovery builders read them, so the two hosts cannot tell a consumer to install different things (the drift #4089 and #4130 closed for the `metadata` and `data` entries). Entries were verified against what actually calls `registerService` for each slot rather than against name similarity — which is how `notification` turned out to be filled by `@objectstack/service-messaging`, the one slot whose package shares no word with its name.

  Four slots — `ai`, `search`, `workflow`, `graphql` — have no implementation anywhere, so they now say so instead of naming a plausible package. `ui` keeps the fuller sentence it got in #4146 (`/ui` is served by the `protocol` service; nothing registers the `ui` slot), and that sentence now reaches both builders instead of one.

  `scripts/check-service-providers.mjs` (wired into the lint workflow as `check:service-providers`) fails CI when a named package is not a real workspace package, or when a `CoreServiceName` slot has no entry — so a rename or a deletion cannot leave a stale instruction behind.

  FROM → TO: `services.<slot>.message` and `services.<slot>.provider` change text for most unavailable slots. Anything matching on the old `Install a <slot> plugin to enable` wording should match on `status: 'unavailable'` instead — the status field is the contract; the message is prose for humans and agents.

- d5c75e2: fix(spec,runtime,service-i18n): the dispatcher domains and their service contracts describe the same surface (#4127)

  #4087 retired a `/storage` bridge that called `upload(key, data, options?)` as
  `upload(file, { request })` — a shape no implementation has. Sweeping the other
  dispatcher domains against `packages/spec/src/contracts/*` found the mirror-image
  gap in three places: the call site and the implementation agreed, and the
  **contract** was the thing that had never been written down. Each one was worked
  around at the call site with `typeof x.foo === 'function'` — a duck-type is what
  "the contract does not cover this" looks like when nobody fixes the contract.

  Fixed at the contract, per Prime Directive #12.

  **`INotificationService` — the inbox half.** `listInbox` / `markRead` /
  `markAllRead` now exist, with `InboxQuery` / `InboxNotification` /
  `InboxListResult` / `MarkReadResult`. Three SDK-expressed routes
  (`notifications.list` / `.markRead` / `.markAllRead`) have rested on them all
  along, implemented by `service-messaging`, while this contract described only
  `send`. The cost was not theoretical: the dev notification stub implements
  exactly `send` and `sendBatch` **because it followed the contract**, so the one
  implementation written to spec was the one the dispatcher had to duck-type past.

  They are optional, and the probe stays: an inbox needs a durable store, and a
  send-only provider (SMTP, Twilio, a Slack webhook) fills the slot legitimately
  without one. `handlerReady` cannot express that — the slot is serveable, one
  capability of it is absent. The `/notifications` domain now takes
  `INotificationService` instead of `as any`, and each write route probes its own
  method rather than riding the entry `listInbox` check (they are separately
  optional, so "has an inbox to read" never implied "has read-state to write").

  **`II18nService.getFieldLabels`.** Both serving surfaces — the dispatcher's
  `/i18n/labels/:object/:locale` and service-i18n's own mount — probed for it and
  both documented it as "optional on `II18nService`", which was not true. It is
  now. service-i18n's probe loses two casts with it (one through
  `Record<string, unknown>`, one re-declaring the signature inline).

  **`IAutomationService.getFlowRuntimeStates`** + the `FlowRuntimeState` type.
  `GET /automation/_status` (and the CLI boot summary, and the
  `kernel:bootstrapped` audit) already called it while the contract stopped at
  `listFlows(): string[]`. The dispatcher's inline cast declared it as
  `{ name, enabled, bound }` — a third copy of the shape and a narrower one than
  the engine returns, dropping the `status` / `triggerType` / `object` fields that
  say WHY a flow is unbound.

  Two runtime fixes fell out of the same sweep:

  - **`POST /automation/trigger/:name` now builds a real `AutomationContext`.**
    It passed the raw HTTP body to `execute(name, body)`, so the
    `{ recordId, objectName, params }` translation never ran and — the sharper
    half — no caller identity was forwarded. A flow's default `runAs` is `'user'`,
    and a `runAs:'user'` run whose trigger resolved no user has its data
    operations REFUSED (#3760, fail-closed), so `client.automation.trigger()`
    could not run a data-touching flow at all while `POST /:name/trigger` could.
    service-automation's own comment claims "most trigger surfaces (REST action /
    trigger endpoint) already resolve the full envelope"; for this endpoint it was
    not true. Both routes share one context builder now.
  - **The dead `automationService.trigger(...)` probe is gone.** Nothing in the
    repo has ever implemented `trigger` on the automation slot and the contract
    never declared it, so the branch was unreachable on every deployment and its
    `execute` "fallback" was the route. Declaring `trigger?` would have blessed a
    second name for `execute`; the dead branch is deleted instead.

  No migration. Every added contract member is optional, so existing
  implementations stay valid; the two runtime fixes only make routes that were
  failing or degraded behave like their working twins.

- bb192c4: Gate every dispatcher service domain on `handlerReady` instead of on slot occupancy (#4058 step 2).

  #4000 made the `/analytics` domain execute ADR-0076 D12's third conclusion ("consumers treat only `handlerReady: true` as a real capability"); every other domain still gated on "is a service registered", so a self-declared stub occupying `automation` / `notification` / `ai` / `file-storage` / `i18n` was called like a real implementation and its fabricated answer went out as a 200. Step 1 (#4082) made the two kinds of dev implementation distinguishable; this is the gate that reads the distinction.

  - The `/analytics`, `/automation`, `/notifications`, `/ai`, `/storage` and `/i18n` domains, the route-mount gate, discovery's `routes`/`features`, and the metadata-protocol builder's route advertisement now share one predicate (`isServiceServeable`): a slot whose occupant self-declares `handlerReady: false` is answered exactly as an empty slot is — the domain's existing 404, or the explicit 501 `/storage` and `/i18n` use. One predicate, so what is advertised and what is served cannot disagree.
  - `handlerReady`, not `status`, is the test. An implementation that declares `degraded` defaults to `handlerReady: true` and keeps serving — which is why the in-memory `file-storage` and `i18n` implementations are unaffected.
  - `discovery.services.*` stays presence-gated: a registered stub still reports `{ enabled: true, status: 'stub', handlerReady: false }` (with no `route`), which says strictly more than collapsing it to `unavailable` would.
  - `/ai` improves for the stub case: an occupied-but-unserveable slot used to fall through to a 503 "AI service routes not yet initialized" and lose the `GET /ai/agents` empty-list answer the console polls for on every navigation. Both are restored.

  No change for a host whose services are real implementations. If you register your own stub under one of those six slots and relied on the dispatcher calling it, either drop the `handlerReady: false` self-declaration (declare `degraded` if it genuinely serves) or install the real service. Not gated, deliberately: `/data`, `/meta`, `/auth` and the security path — their dev stubs back the dev stack's own core loop, and gating them would 404 the dev stack itself.

- 98e7cc7: fix(runtime): dispatcher error exits serve VALIDATION_FAILED as 400 with `fields[]` (#3918)

  `ValidationError` — what objectql's record and rule validators throw — carries
  `.code = 'VALIDATION_FAILED'` and `.fields[]`, one entry per offending field. It
  deliberately carries no `.status`, no `.statusCode`, and no `.issues`: it is a
  plain domain error, and deciding it means "400" is the HTTP boundary's job.
  `@objectstack/rest` has always done that (`mapDataError` → 400 with `fields[]`).
  The runtime dispatcher's two error exits did not, because each read exactly the
  properties this error lacks:

  - **`HttpDispatcher.errorFromThrown`** (the RETURNED-error path — `/meta` save,
    `/packages` publish, …) fell back to the caller's `fallbackStatus` for want of
    a `.status`, and built its structured `details` from `.issues` alone, so
    `fields[]` was dropped.
  - **`dispatcher-plugin`'s `errorResponseBase`** (the THROWN-error path — every
    route the plugin mounts: `/analytics`, `/packages`, `/i18n`, `/storage`,
    `/automation`, `/auth`, `/notifications`, `/mcp`, …) took the same 500
    fallback, and its body was only `{message, code}`. Landing on 5xx then dragged
    the message through the #3867 leak sanitiser, so a user typing a bad email
    address got back a **500 "Internal server error"** — no status a client could
    act on, no message worth showing, and nothing to attach to the input.

  Both exits now recognise the shape and answer the way rest-server does: **status
  400**, with the error's `fields[]` passed through verbatim in `details`
  alongside `code: 'VALIDATION_FAILED'`. Any surface the dispatcher serves can
  therefore highlight the specific field the user got wrong, the way a form served
  by `/data` already could.

  Matched by duck-typing on `code === 'VALIDATION_FAILED' || name ===
'ValidationError'` — the same both-ways predicate `mapDataError` uses — so a
  hook or service that throws `{ code: 'VALIDATION_FAILED', fields }` by hand is
  served identically, and the runtime takes no dependency on objectql. An explicit
  `.status` / `.statusCode` on the error still wins: 400 is supplied only as the
  fallback that was previously 500. Non-validation errors are untouched — same
  status, same message sanitising, same `details`, and `errorResponseBase` still
  emits the exact two-key body it always did.

- 4cf7c61: fix(runtime): route every domain `catch` through `errorFromThrown` so status and `fields[]` survive (#3918 follow-up)

  #3867 taught `dispatcher-plugin`'s `errorResponseBase` to read an error's
  `status` (not just `statusCode`), and #3918 taught
  `HttpDispatcher.errorFromThrown` the `VALIDATION_FAILED` shape. Both fixes were
  invisible to a whole tier of handlers underneath them: the domain modules each
  caught their own errors and called `deps.error(e.message, e.statusCode || 500)`
  directly, bypassing `errorFromThrown` entirely — 13 call sites, 9 of them in
  `/packages` alone.

  The consequence on `/packages`, `/meta/_drafts`, `/ui`, `/security` and the
  `/mcp` transport:

  - **A deliberate status was downgraded to 500.** Every protocol-layer domain
    error in this codebase carries its HTTP status as `status`, not `statusCode`
    (`OBJECT_NOT_FOUND`, `RECORD_NOT_FOUND`, `CLONE_DISABLED`, plugin-sharing's
    `FORBIDDEN`, …) — the exact read #3867 fixed one tier up. So a 404 these
    routes meant to return arrived as a 500, and the message was dragged through
    the 5xx leak sanitiser on the way out.
  - **A `ValidationError` still lost its `fields[]`** and its 400, re-opening
    #3918 on precisely the routes it was filed against.

  Every one of those catches now calls `deps.errorFromThrown(e, …)`, so both
  fixes finally reach the routes that need them. Deliberate per-route fallbacks
  are preserved rather than flattened to 500: the `/meta` save fallback keeps
  **501** (that branch is reached only when the protocol has no `saveMetaItem`,
  so "unsupported" is the honest default) and the `/meta` two-part lookup keeps
  **404** — but a validation failure on either now answers 400 with its fields
  instead of being swallowed by the fallback.

  `domains/keys.ts` is deliberately **not** converted: it discards the underlying
  error on purpose, because the message could echo row contents. Its literal
  `'Failed to create API key'` is the correct answer there and stays.

  No behaviour change for errors that already carried `statusCode` — that read is
  preserved, only widened.

- b5f9397: fix(sharing,runtime): a `sort` passed straight to the engine never ordered anything; migrate every in-repo engine call to canonical QueryAST keys (#4346)

  Two changes with different weights, from one sweep of every in-repo engine
  call site that still speaks a deprecated alias.

  **The bug — three dropped sorts.** #4346 made the engine fold `filter`→`where`
  and `top`→`limit` on all six methods. The other four pairs in
  `RPC_QUERY_ALIAS_SLOTS` (`select`, `sort`, `skip`, `populate`) are folded at
  the RPC/wire layer only — their values need shape lowering that belongs to
  those layers — and a **direct `engine.find()` never crosses that layer**. Three
  call sites passed `sort` there, so it rode onto the AST untouched, every
  driver's `Array.isArray(query.orderBy)` guard declined to emit an ORDER BY, and
  the query returned an ordinary-looking, arbitrarily-ordered result:

  | call site                           | asked for                                         | actually got                |
  | ----------------------------------- | ------------------------------------------------- | --------------------------- |
  | `share-link-routes.ts`              | shared AI conversation messages, `created_at asc` | messages in arbitrary order |
  | `runtime/domains/share-links.ts`    | same route, runtime-domain copy                   | same                        |
  | `share-link-service.ts` `listLinks` | the 200 most recent share links                   | an arbitrary 200            |

  All three combine the dropped sort with a `limit` — the "latest N" shape whose
  failure #4226 spelled out: an unapplied sort returns rows in arbitrary order,
  which `limit` then slices into an arbitrary page. #4226 fixed that in the wire
  normalizer; these calls sit one layer below it. `listLinks` had no test at all,
  which is why it went unnoticed. Now pinned — on the option bag the engine
  receives, not on row order, because the failure is that the key never becomes
  `orderBy` and a fake engine honouring either spelling would pass either way.

  **The cleanup — 27 no-op renames.** Every remaining in-repo engine call passing
  `filter` now passes `where` (approvals 5, auth 2, reports 6, sharing 11,
  webhooks 2, plus the one `filters` in a spec doc example). These are strict
  no-ops since #4346 folds the alias — the point is that the framework stops
  depending on a spelling it asks users to migrate off, which is a prerequisite
  for ever retiring the aliases. Service-level `filter` PARAMETERS (each
  service's own public API, e.g. `listRequests(filter)`) are deliberately
  untouched — those are not engine option bags.

  Two of the renamed calls were live victims of the #4346 bug rather than
  cosmetic: `auth-manager`'s `stampIdentitySource` read the table's first row via
  `findOne({filter})` and counted the whole table via `count({filter})`, so a
  federated sign-in never stamped `source: 'idp_provisioned'`. #4346 already
  corrected the behaviour; this makes the call say what it means.

- 385c4b0: fix(actions): seed a flow action's params with the row id, like the trigger route does (#3915 follow-up)

  #3915 gave the REST `/actions/:object/:action` route its flow dispatch and
  documented it as "equivalent to `POST /api/v1/automation/:target/trigger`,
  without having to know the flow name". A real run showed that claim did not
  hold: the params bag carried the subject record's fields — so `id` — but never
  `recordId`. The CRM's own `crm_convert_lead` action declares
  `recordIdParam: 'recordId'` and its flow reads `{recordId}`, so invoking it
  through the actions endpoint reached the automation engine and then died at its
  first node:

  ```
  Flow 'crm_convert_lead_wizard' failed: Node 'get_lead' failed: get_record:
  refusing to run — 1 filter condition(s) resolved to nothing … `{recordId}` (at id)
  ```

  while the identical run through `/automation/crm_convert_lead_wizard/trigger`
  paused normally on its first screen. Only a live invocation surfaced it — the
  unit tests mock `automation.execute`, so they pinned the call shape without
  noticing the bag was missing the key flows actually read.

  `dispatchFlowAction` now seeds the row id under the same keys
  `domains/automation.ts` seeds for the trigger route — `recordId` and the
  `<objectName>Id` camelCase alias — plus the action's own declared
  `recordIdParam` (sourced from `recordIdField`, default `id`) when it names a
  third key. Explicit action params still win over every seed, and the seeding
  applies to the MCP `run_action` path too, which shared the same gap. A declared
  `recordIdParam` that no dispatcher honoured was the `declared ≠ enforced` shape
  in miniature.

- 45dc446: Every in-memory fallback and dev stub now self-describes with the standard `__serviceInfo` descriptor, classified by what it actually is (#4058 step 1).

  ADR-0076 D12 gave services one way to say "I am not the real thing", but the producers never converged on it:

  - The kernel's own fallbacks (`createMemoryCache` / `Queue` / `Job` / `I18n` / `Metadata`) carried `_fallback: true` — a marker **no** consumer recognized, `readServiceSelfInfo` included — so both discovery builders reported them as fully `available`.
  - `plugin-dev` marked all of its implementations with the same `_dev: true`, normalized to `status: 'stub', handlerReady: false`. That declared a working in-memory search index exactly as fake as an AI stub returning invented text.

  Both now carry `__serviceInfo`, split by a rule that holds across the whole set:

  - **`degraded`** — really does the work, with reduced capability: `cache`, `queue`, `job`, `file-storage`, `search`, `i18n`, `metadata`, `workflow`, `realtime`. Its answers are true answers; the `message` names what is missing (no persistence, no scheduling timer, no state-machine validation, …).
  - **`stub`** — the answer is fabricated: `ai`, `automation`, `notification`, `data`, `auth`, `security.permissions`, `security.rls`, `security.fieldMasker`. Never to be mistaken for a capability.

  `handlerReady: false` is set independently wherever no HTTP handler serves the slot (`cache` / `queue` / `job` / `realtime`, and every `stub`).

  Discovery output changes accordingly — a kernel fallback that used to report `status: 'available'` now reports `degraded` with an explanatory message. No routing, gating, or dispatch behavior changes: every dispatcher domain still resolves services exactly as before. Consumers reading `discovery.services.*` get the truth instead of a uniform claim.

  For anything that duck-typed the old markers: `svc._fallback` / `svc._dev` → `readServiceSelfInfo(svc)` from `@objectstack/spec/api` (the legacy `_dev` key is still understood by that reader, so third-party stubs carrying it keep working).

- 507b92a: fix(spec,objectql,rest,runtime): field-validation messages answer in the caller's language, named by the field's label (#3957)

  The write path built every built-in validation message by concatenating the **API
  field name** into a **hardcoded English** template. Those strings are what the
  Console toast, the CSV-import row report, the CLI and any custom client display
  verbatim, so a Chinese-locale user importing a bad row read:

  ```
  第 1 行:penalty_amount must be ≥ 0
  ```

  …for a field declared `label: '处罚金额'` with a full `zh-CN` bundle loaded. The
  form layer localized the _same_ constraint correctly (the browser's native
  `min`), so the language flipped depending on which layer caught the value.

  **Three things changed.**

  1. **The message is rendered in the caller's locale** from a built-in catalog
     (`BUILTIN_VALIDATION_MESSAGES`, `@objectstack/spec/system`) shipping `en`,
     `zh-CN`, `ja-JP`, `es-ES` — the same four locales as the platform bundles.
     The locale comes from `ExecutionContext.locale`, whose contract already read
     "Drives message catalogs"; this is the consumer that makes that true. Both
     HTTP entries (REST server, runtime dispatcher) now resolve it from the
     request's `Accept-Language` / `?locale` first, falling back to the workspace
     `localization.locale` — so a rejection message and the field labels around it
     can no longer disagree.

  2. **The field is named by its label, never the API name**: translation bundle
     (`objects.<obj>.fields.<f>.label`) → declared `label` → API name as the last
     resort. `FieldValidationError.field` still carries the API name so a form can
     focus the right input.

  3. **The constraint is exposed as data**, so a client can format its own text
     instead of parsing the sentence:
     `{ field, code, message, label, constraint: { min: 0 } }`. This rides
     ADR-0114's existing `constraint` / `value` positions on `FieldErrorSchema`
     (`constraint` tightens from `unknown` to `Record<string, unknown>`) rather
     than adding a parallel payload — `label` is the only new field. The bag
     carries `min`/`max`/`minLength`/`maxLength`/`actual`/`allowed`/`type`, and the
     message templates interpolate from exactly those keys.

  Covered end-to-end, not only in the validator: single and batch insert,
  single-id and multi-row update, ADR-0113's clear-out rejection, the object-level
  rule evaluator's own built-in messages (`requiredWhen`, per-option gating,
  state-machine fallbacks), and the importer's cell-coercion, required pre-check
  and #3956 bound pre-check messages — all of which land in the same row report.

  **What this changes for consumers.**

  - `code` is unchanged (ADR-0114's `FieldErrorCode`) and remains the thing to
    match on. Message keys are finer-grained than codes — `invalid_datetime`,
    `invalid_option_value`, `required_cleared` are rendering detail and never reach
    the wire — so localization never splits the client-facing vocabulary.
  - `message` **text changes**: it is localized, and it names the field by label
    even in English (`Budget must be ≥ 0`, not `budget must be ≥ 0`). Anything
    asserting on the old English string should match `code` (and now
    `constraint`) instead.
  - An author-written validation-rule `message` is never touched — it is already
    in the language its author chose.
  - A deployment can override any built-in message with a `translation` item
    defining `validation.field.<messageKey>` (e.g.
    `validation.field.min_value: '{{label}}不得小于 {{min}} 元'`).
  - The importer's reference-failure message no longer names the target object's
    API name (`no sys_user matches "…"`): naming internal identifiers is the
    defect being fixed, and the column plus the offending value are what an
    importer can act on.

- 99b4392: Advertise `mcp` in `/discovery` only when it is actually serveable (#4024).

  Both discovery producers gated the `/mcp` route on `isMcpServerEnabled()` alone.
  The stated justification was a lockstep — `os serve` auto-loads plugin-mcp from
  the same flag, so on that path advertised did imply mounted. But the lockstep is
  a property of the CLI, not of the dispatcher: `@objectstack/rest` has no
  `@objectstack/mcp` dependency, mounts no `/mcp` route and performs no auto-load,
  so a host that embedded it without plugin-mcp advertised `/mcp` in `/discovery`
  and then answered 501 on it — the `declared ≠ enforced` failure #3369 forbids,
  and a broken contract for third-party clients that read `/discovery` to decide
  what exists.

  Both producers now require the flag AND a serveable MCP service. The runtime
  dispatcher gates on the handler's own predicate (`typeof
mcp.handleHttpRequest === 'function'`), so a wrong-shaped service can't
  over-promise either. `@objectstack/rest` probes via the per-request kernel or the
  single-env `serviceExistsProvider`; when it genuinely cannot probe it keeps the
  prior flag-only answer rather than hiding a working endpoint (fail-open,
  ADR-0057 D10). The `os serve` / `os dev` path is unchanged — it loads the plugin,
  so the service resolves and `/mcp` is still advertised.

  Also exercises the `mcp: false` seam in `route-parity.integration.test.ts`, which
  had existed unused since the file was written: `bootServe()` was only ever called
  with no args or `{ notification: false }`. The one capability whose advertisement
  was not service-presence gated was also the one whose absence was never tested.

- 39eb01b: fix(runtime,cli,types): `os migrate` and the dev runtime now share one `__search` companion schema view (#3955)

  On a zh-locale deployment the dev runtime provisions the hidden `__search`
  pinyin companion column (ADR-0098) on every eligible object, but the
  `os migrate plan`/`apply` boot went through `createStandaloneStack`, which
  never derived the locale-gated pinyin decision from the compiled artifact.
  Its metadata therefore lacked every companion column, and `migrate plan`
  reported each live `__search` column of a dev-created database as a
  destructive orphan — with `--allow-destructive` as the printed remediation,
  which would have dropped live feature columns.

  - `@objectstack/types`: new `collectConfiguredLocales(i18n)` and
    `stampSearchPinyinEnabled(i18n)` — the single resolve-and-stamp helper for
    `OS_SEARCH_PINYIN_ENABLED`. An explicit env value still wins; only a
    positive locale-derived decision is stamped.
  - `@objectstack/runtime`: `createStandaloneStack` stamps the decision from
    the artifact's `i18n` before any plugin constructs a `SchemaRegistry`, and
    surfaces `i18n` on its result like `requires`/`objects`/`manifest`.
  - `@objectstack/cli`: the `serve`/`dev` boot now stamps through the same
    shared helper (behaviour unchanged), so create/serve and plan/apply cannot
    compute different schema views of the same source tree.

  A fresh CLI-created database is now also born with the same `__search`
  columns the dev runtime would provision, instead of acquiring them on the
  next dev boot.

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- 2cb6d3c: fix(spec,runtime): `resolveService` returns the slot's contract too, and the `: any` escapes on core slots are gone (#4127)

  Batch 2 of the #4127 gate. #4168 typed `getService` — easy, because every one of
  its call sites already passed a `CoreServiceName`. `resolveService` is the mixed
  one, and it is where the remaining `any` lived.

  **Overloads split it exactly where the evidence does.** A `CoreServiceName`
  resolves to the slot's contract; anything else keeps `any`:

  - **Core slots, however written.** 17 call sites address a core slot with a bare
    literal — `'metadata'` ×10, `'automation'` ×3, `'auth'` ×3, `'ai'` — rather
    than `CoreServiceName.enum.*`. The same slot was being addressed two ways;
    both resolve to the contract now, with no edit to the call sites.
  - **Everything else** — `protocol` (×22), `objectql` (×9), `mcp`,
    `kernel-resolver`, `security`, `scope-manager`. Real services with no
    `CoreServiceName` entry and no written contract. They keep `any` rather than
    being given a shape here that nothing verifies: **that `any` is where the
    ledger honestly ends**, and writing those contracts is its own change.

  **The typing was being erased at three call sites, and that is the actual
  finding.** A `const x: any = await deps.resolveService('auth', …)` defeats every
  bit of this — the annotation wins, and #4168's work does nothing there. Sweeping
  for the pattern found three on core slots:

  **`/mcp` ×2 — two more undeclared methods.** The domain calls
  `authService?.getMcpResourceUrl?.()` and `?.getMcpResourceMetadataUrl?.()`.
  `AuthManager` implements both (and plugin-auth uses them internally);
  `IAuthService` declared neither. Classic #4127 shape — call site and
  implementation agree, the contract is the thing nobody wrote.

  The `: any` + optional-chaining combination made this _worse_ than the earlier
  gaps, not better: it made the call invisible to the type system **and**
  accidentally safe. An absent method returns `undefined`, so the skill route
  silently fell back to deriving an MCP URL from the request host — meaning a real
  disagreement between the auth service's canonical value and the derived one
  would have looked exactly like normal operation. The whole point of
  `getMcpResourceUrl` is that it comes off the auth `basePath` so the two _cannot_
  disagree about the API prefix; the route's own comment says "the auth service
  owns the canonical value".

  Both are declared optional: an auth provider without MCP/OAuth support fills the
  slot legitimately, and `getMcpResourceMetadataUrl` returning `null` (OAuth track
  off — AS disabled or the origin fails the OAuth 2.1 transport rule) stays
  distinct from the method being absent.

  **`/packages` ×1 —** `const metadata: any = await deps.getService(…metadata)`,
  feeding `new SeedLoaderService(ql, metadata, …)`. Annotation dropped; it
  typechecks against `IMetadataService` now. Its neighbours `protocol` and `ql`
  keep their `any` for the honest reason above.

  No other core-slot lookup is annotated away — the sweep is exhaustive over
  `domains/*.ts`.

  Verified: `@objectstack/runtime` **937 tests / 65 files**, `@objectstack/spec`
  **7112 / 273** (3 new on the auth contract), adapter-hono **73**; `tsc --noEmit`
  on spec, runtime, downstream-contract and all four examples; `pnpm lint`; all
  nine `check:*` gates. `api-surface.json` is unchanged — the two additions are
  interface MEMBERS, not new exports.

- a3cb9c8: Retire the dev-mode `analytics` stub, and make the dispatcher gate `/analytics` on `handlerReady` rather than on service presence (#4000).

  Retiring the degraded analytics shim (#3891) made an empty `analytics` slot the honest signal: `/api/v1/analytics/*` 404s and discovery reports `unavailable`. `plugin-dev` refilled that slot with a stub, which re-created the retired shape in dev mode — the dispatcher gated on "is a service registered", so the stub was called like a real engine and its empty result came back as a 200.

  - `plugin-dev` no longer registers an `analytics` dev stub; the slot stays empty (`NO_DEV_STUB_SERVICES`). Every other dev stub is unchanged.
  - The `/analytics` domain, its route-mount gate, and discovery's `routes`/`features` now share one predicate (`isAnalyticsServiceServeable`): a service that self-declares `handlerReady: false` (ADR-0076 D12 — `__serviceInfo`, or plugin-dev's legacy `_dev: true`) is treated as an empty slot. A `degraded` implementation that genuinely serves requests keeps serving; `discovery.services.analytics` still reports a registered stub as `status: 'stub'`, which says more than `unavailable` would.

  FROM → TO for dev setups that relied on the stub answering `POST /api/v1/analytics/query` with `{ rows: [], fields: [] }`: install the real engine — `@objectstack/service-analytics` runs an InMemory strategy and needs no database of its own. Nothing else changes; hosts that already install it (including `os serve`, where `analytics` is in `ALWAYS_ON_CAPABILITIES`) are unaffected.

- a2266a6: fix(spec,data): the five RPC query aliases resolve by ONE fold — spec table, not per-reader prose (#3795)

  `RpcQueryOptionsSchema` accepts five legacy aliases next to their canonical
  QueryAST keys and stated the precedence in prose only ("the normalizer uses
  the new key"). With no fold in the schema, every reader re-implemented it —
  the #3713 condition — and the two readers disagreed:

  | pair                  | spec prose | runtime dispatcher | metadata-protocol             |
  | --------------------- | ---------- | ------------------ | ----------------------------- |
  | `where` > `filter`    | canonical  | canonical          | **alias consulted first**     |
  | `fields` > `select`   | canonical  | canonical          | **alias clobbered canonical** |
  | `offset` > `skip`     | canonical  | canonical          | **alias clobbered canonical** |
  | `expand` > `populate` | canonical  | —                  | **alias consulted first**     |
  | `orderBy` > `sort`    | canonical  | canonical          | canonical                     |

  Four of five inverted in `protocol.ts`, so `?select=a&fields=b` answered
  `[a]` on one path and `[b]` on the other — reachable from a plain HTTP
  request.

  **The mapping now lives once, in the spec** (`RPC_QUERY_ALIAS_SLOTS` +
  `foldQueryAliasSlots`, both exported), under the rule #4181 already
  established for the filter pair:

  - an **alias alone** folds into its canonical key — `filter`→`where`,
    `select`→`fields`, `sort`→`orderBy`, `skip`→`offset`, `populate`→`expand` —
    and the alias key is **dropped from the parsed output**;
  - **both spellings, same value**: redundant, tolerated, alias dropped;
  - **both spellings, different values**: irreconcilable — picking a winner IS
    the silent drop — so the parse fails (schema) / the request is `400
INVALID_REQUEST` (wire), naming the spellings and the canonical key;
  - an explicit **`null` spelling is a withdrawal**, never a conflict: a null
    alias is dropped silently, a null canonical keeps its slot-specific answer.

  `RpcQueryOptionsSchema` and the four `filter`-mixin option schemas
  (update/delete/count/aggregate requests) apply the fold as a parse transform,
  so parsed output speaks canonical keys only — a TS consumer reading
  `parsed.query.populate` now **fails to compile** instead of silently reading
  `undefined` (the #3742 / #3764 shape, one layer down; hence the minor). The
  protocol normalizer folds raw wire input by the same table (extended with the
  wire-only `filters` / `$filter` / `$expand` spellings), and the runtime
  dispatcher's second copy of the fold is deleted outright.

  **Authoring/callers unchanged for the supported cases**: every alias alone
  keeps working on every path, and identical duplicates still pass. What
  changes is mixed vocabularies with **different** values — previously answered
  differently per route, now refused loudly on all of them — and a direct
  `expand: [names]` array on `POST /data/:object/query`, which used to be read
  by its indices ("Unknown field '0'") and now lowers to the expand record like
  `populate` always did.

- 5c13368: feat(objectql,runtime): the default-runner setters are first-wins, and the private-field probes that used to enforce that are gone (#4251)

  `setDefaultBodyRunner` / `setDefaultActionRunner` now enforce their own
  documented contract — "the runtime layer sets this once per engine" — by
  keeping the first runner and returning `false` for any later call. Public
  accessors `getDefaultBodyRunner()` / `getDefaultActionRunner()` join them, and
  the fields become real `private` members instead of `(this as any)` attachments.

  Before this, the invariant lived in the CALLERS: AppPlugin probed the engine's
  private `_defaultBodyRunner` / `_defaultActionRunner` fields through `any` to
  avoid clobbering another AppPlugin's runner on a shared kernel — an invariant
  owned by every caller and enforced by none, and a private reach that a field
  rename would have broken silently (the guard reads `undefined`, every AppPlugin
  reinstalls). The engine's own `bindHooks` fallback and ObjectQLPlugin's
  authored-action re-sync read the same fields the same way. All three read the
  public accessors now; the only remaining `_default*` mentions in the repo are
  comments and test doubles.

  Caller audit before the semantics change: every setter call site either owns a
  fresh engine (the sandbox and hook-binder tests) or wants exactly
  keep-the-first (AppPlugin) — nobody replaces a runner on a live engine. Return
  type `void` → `boolean` is additive; AppPlugin uses it to keep its "Installed
  default … runner" log truthful (skipped when the engine kept an earlier one).

  Pinned in hook-binder tests: second install refused end-to-end (the first
  runner is the one that executes) and the accessors expose exactly what was
  kept.

- 1d5dc46: fix(runtime): carry `code` / `fields[]` across the sandbox boundary so form actions can anchor validation errors (#3918 follow-up)

  Found by dogfooding the merged #3918 chain against a running app. Submitting a
  record that fails validation through a form **action** came back as:

  ```
  HTTP 200
  { "success": true, "data": { "success": false,
                               "error": "ValidationError: issued_on is required" } }
  ```

  No status a client could branch on, no code, no `fields[]`. The chain's
  dispatcher fixes could not help: the field list was already gone before any
  dispatcher exit ran. It was lost at the QuickJS boundary, twice —

  1. **host → VM.** `vm.newError({ name, message })` dropped every other property,
     so a body reaching a record `ValidationError` through
     `ctx.api.object(x).update(...)` saw bare prose.
  2. **VM → host.** The wrapper's reject handler flattened the error to the string
     `<name>: <message>` before the host ever saw it.

  Both hops now carry an explicit **allowlist** — `code` and `fields` — alongside
  the message, and `SandboxError` exposes them as `.code` / `.fields`. The
  allowlist is a security boundary, not a style choice: host errors routinely hang
  driver state, connection details or whole record payloads off themselves, and
  anything crossing INTO the VM is readable by untrusted sandboxed code. Copying
  the error's own enumerable keys would leak all of it.

  `/actions` then surfaces them, so a form can highlight the offending input:

  ```
  HTTP 200
  { "success": true, "data": { "success": false,
                               "error": "ValidationError: issued_on is required",
                               "code": "VALIDATION_FAILED",
                               "fields": [ { "field": "issued_on", "code": "required", … } ] } }
  ```

  **The `/actions` wire contract is deliberately unchanged.** The status stays
  200 and `success: false` remains the failure signal: that route has always
  reported business failure in the payload (an action that "fails" is a normal
  outcome, not a transport error) and every caller branches on `data.success`.
  Making it a 4xx would be a break in exchange for a strictly additive fix, so the
  fix is additive — `code` and `fields` are simply omitted when absent, and a
  caller that ignores them sees exactly what it saw before.

  Message channels are byte-identical: `SandboxError.message` keeps the
  `<kind> '<name>' threw:` debug wrapper for server logs and `.innerMessage` stays
  the plain business text a toast shows. The structured payload rides alongside
  them, never instead of them.

  Also adds `dispatcher-validation-error.real.test.ts`, which pins both dispatcher
  exits against the **real** objectql `ValidationError` rather than a hand-built
  fixture — including its deliberate absence of `.status`, the assumption the
  whole #3918 fix rests on. The existing fixture-based tests restate that contract;
  these check it, so a future change to the class fails a test instead of quietly
  regressing production.

- 627b188: fix(seed-loader): count reference fields dropped from rows that were still written

  The loader had two failure outcomes and only counted one. A record it cannot
  write is counted in `errored`. But an unusable **reference value** (an object
  where a natural key belongs, an array on a single-value field) is removed from
  the record — never written as NULL, which would sever an existing link on
  upsert replay — and the row is written **without it**. Nothing counted that.

  So a load that quietly severed N associations reported `totalErrored: 0`, and
  every count-driven surface read clean. The CLI boot banner — the one seed signal
  that survives `os dev`'s boot-quiet window and the default `warn` level — printed
  `showcase 42 rows`, and the warn line said `0 dropped record(s)`: true, and
  useless ([#3932](https://github.com/objectstack-ai/objectstack/issues/3932)).

  `SeedLoadResult.referencesDropped` and `SeedLoaderSummary.totalReferencesDropped`
  now count it. It is deliberately **not** folded into `errored` — the row _was_
  written, so that would break the `inserted + updated + skipped` reconciliation
  against `total`. The banner names it separately:

  ```
  ⚠ Seeds:   showcase 42 ok / 3 lost links ⚠
  ```

  Both counters are additive with a `0` default, so an existing producer or
  consumer of `SeedLoaderResult` is unaffected.

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

- 1e38158: fix(cli,runtime): an artifact you NAMED and a boot input you don't have are different failures — say which (#4110 follow-up, #4131 step 1)

  Three corrections, all from the same principle: a platform may boot with no
  application (#4085), and that says nothing about how a MISSING NAMED INPUT
  should be read.

  - **A named-but-missing artifact boots empty and silently.** #4110 made an
    absent artifact non-fatal all the way down — right for the conventional
    `<cwd>/dist/objectstack.json`, which is just "not compiled yet". But
    `OS_ARTIFACT_PATH` / `{ artifactPath }` skip the existence check by design, so
    the tolerance reached them too: `OS_ARTIFACT_PATH=/nope os serve` printed
    "booting from artifact", reached `Server is ready`, and named the missing path
    NOWHERE in its output (serve's boot-quiet window drops the loader's calm
    line). `createDefaultHostConfig` — the boot with no config, where the artifact
    IS the deployment — now rejects a named local artifact that does not exist,
    naming both the path and which source named it. The loader keeps its
    tolerance, so the config-boot path #4085 fixed is untouched.

  - **"Configuration file not found" never said where it looked.** The two things
    that actually happen are a typo'd filename and the wrong working directory,
    and the second is the common one. It now names the config path, the artifact
    path, and that `OS_ARTIFACT_PATH` is unset — and still refuses rather than
    inventing a zero-object platform, pointing at `objectstack start` for a boot
    that is app-less on purpose.

  - **That refusal was being truncated.** `this.exit(1)` unwinds to oclif's
    `process.exit`, which does not drain a piped stdout, so a diagnostic split
    across several `console.log` calls loses its tail — measured: only the first
    two lines of the new message survived a pipe, i.e. exactly the part that says
    where to look went missing. Both of `serve`'s pre-flight refusals now emit one
    write. Caught by the e2e added here, not by review.

  Also corrects the plugin-ordering claims in `createStandaloneStack` and in the
  test that pinned them: the comment said the datasource plugin's array position
  "MUST precede ObjectQLPlugin: its start() connects the default driver", and the
  test asserted that index with the same rationale. The connect happens in
  `init()`, and the kernel resolves order from the dependency graph — which hoists
  ObjectQLPlugin ahead of the datasource plugin (measured: 6 slots earlier), the
  reverse of what the slot reads as. The test now pins the declared dependency
  that actually orders the two inits, which deleting the array position cannot
  break and deleting the declaration does. #4131 tracks making the AppPlugin end
  of that contract enforced rather than conventional.

- 65a3a84: fix(runtime,spec): guard the service-lookup typing with a lint rule — which immediately found the project-membership gate not gating (#4127)

  Batch 4 of the #4127 gate. #4168/#4176/#4202 made a slot lookup return the
  slot's contract. Nothing protected that: an `any` annotation on the **result**
  switches the checking back off for that call site, silently, with no test
  failing and no visual difference from code that has it. Three such sites already
  existed and were found by grep — the same unrepeatable sweep this work replaced.

  **The rule** bans `: any` / `as any` on a `resolveService` / `getService` /
  `getRequestKernelService` result. Slots with no written contract (`protocol`,
  `mcp`, `kernel-resolver`, `scope-manager`) are exempted **by name, centrally**,
  in `eslint.config.mjs` — not by inline disables, because `pnpm lint` runs
  `--no-inline-config` and ignores those on purpose. The effect is the one worth
  having: a deliberate gap is a reviewed line in one file, a careless one is a
  build failure, and they stop looking identical in the code.

  **Its first run found a live fail-open.** `enforceProjectMembership` read the
  session as `authService?.api?.getSession?.(…)` with no `getApi()` fallback — the
  only one of the codebase's three `.api` readers without it. `plugin-auth`
  registers `AuthManager`, which has **no `.api` member at all**. So the read
  yielded `undefined`, `userId` stayed unset, and the function returned at its
  "anonymous — upstream auth will decide" line **before ever querying
  `sys_environment_member`**. A signed-in non-member passed the gate, on every
  deployment with project scoping on — which is where the flag defaults to true.
  Anonymous callers were still denied elsewhere (#2567/#3963), so this was
  specifically the signed-in-non-member case.

  The existing test for that gate mocked auth as `{ api: { getSession } }` — the
  legacy shape the shipped provider does not have — so it was green throughout.
  That is the **fourth** test in this work line found encoding a contract nobody
  implements, after batch 1's three `auth.handler` mocks and batch 3's
  `status: 'open'`. The new test uses the `getApi()` shape and fails against the
  pre-fix code.

  **Also found by the rule**, all the same #4127 shape (implemented, called,
  undeclared) and all now declared: `IAuthService` gains `api`, `getApi`,
  `isAuthGateActive` and `verifyMcpAccessToken`; `IMetadataService` gains `load`
  and `loadDiagnosed`. `getApi`'s return type is the **evidenced subset** —
  `getSession({headers})` and the three fields callers read — not a re-declaration
  of better-auth's handle, which belongs to that library.

  **And the pattern's real root:** the lookup facade returning `any` was
  re-declared in **three** places. Batches 1-3 typed `DomainHandlerDeps` and left
  `ActionExecutionDeps` and `resolve-execution-context`'s `ResolveOptions` still
  saying `any` — so the copy that stayed untyped was the way around all the
  others, and it is where the auth reads lived. All three are typed now.

  Completing the interface: `getRequestKernelService` gets the same overload split
  (its one caller resolves the same `objectql` slot the `resolveService` fallback
  beside it does, so the two arms of one expression had different types), and
  share-links' `getEngine` loses a `Promise<any>` return annotation — a **third**
  erasure syntax after `: any` and `as any`, and one this AST rule cannot see.
  That residual is documented in the config.

  `getObjectQL` **stays** `any`, deliberately, with the reason recorded: it exists
  to reach ObjectQL's surface beyond `IDataEngine` (`registry`, `executeAction`),
  which has no contract. Typing it `IDataEngine` would be the comfortable-looking
  lie.

  Verified: `@objectstack/runtime` **952 tests / 67 files**, `@objectstack/spec`
  **7147 / 275**, plugin-auth **579**, rest **512**; `tsc --noEmit` on spec,
  runtime, downstream-contract and all four examples; `pnpm lint` (with
  `--no-inline-config`); all nine `check:*` gates.

- de6daa5: fix(runtime)!: the /share-links dispatcher domain stops emitting a duplicate `link`/`links` beside `data` (#4038)

  The producer-side other half of #3983. That PR moved the sharing plugin's routes
  onto the declared envelope; this removes the compatibility shim the dispatcher
  twin had been carrying _because_ that surface answered bare.

  Create and list answered with the payload under **two** keys:

  ```ts
  { success: true, data: link,  link  }   // POST /share-links
  { success: true, data: links, links }   // GET  /share-links
  ```

  The duplicate existed so readers predating the envelope kept working — which is
  why objectui's `ShareDialog` reads `body.links ?? body.data`. Once #3983 made both
  surfaces answer `data`, that first branch had no producer left, and the duplicate
  had no reader in **any** repo:

  - **framework** — no consumer of these routes at all
  - **objectui** — `ShareDialog` already falls through to `body.data`
  - **cloud** — swept: it only _registers_ `SharingServicePlugin` into per-environment
    kernels with `registerShareLinkRoutes: false` so this dispatcher serves the paths.
    It never calls them and never reads a body. That sweep is what #4038 was waiting
    on, and it came back clean.

  ## Shape

  | route               | was                               | now                        |
  | ------------------- | --------------------------------- | -------------------------- |
  | `POST /share-links` | `{ success, data: link, link }`   | `{ success, data: link }`  |
  | `GET /share-links`  | `{ success, data: links, links }` | `{ success, data: links }` |

  `data` is unchanged in both — only the duplicate key is gone. Anything reading
  `body.data`, or going through `ObjectStackClient.unwrapResponse`, sees no
  difference. A raw reader of the top-level `body.link` / `body.links` must move to
  `body.data`.

  The list route now routes through `deps.success(...)` like the domain's other
  three. Create stays hand-built, because `deps.success` hardcodes status 200 and
  this route is a **201** — the same reason `/keys` hand-builds its own 201, and the
  same shape it uses.

  ## Guard

  `scripts/check-route-envelope.mjs` does not and cannot cover this file: it scans
  route modules that write via `res.json(...)`, while dispatcher domains return
  `{ status, body }` for a central sender. So the drift was invisible to it by
  construction. Three tests in `domain-handler-registry.test.ts` cover it instead —
  two per-route, plus a general one asserting no success body carries a top-level
  key outside `success` / `data` / `meta`. Restoring the duplicates fails all three.

- bca935b: fix(spec,runtime): the slot→contract ledger extends past `CoreServiceName`, and `/security` stops passing unvalidated input to the security service (#4127)

  Batch 3 of the #4127 gate, after #4168 (`getService`) and #4176 (`resolveService`).

  Three slots — `security`, `shareLinks`, `objectql` — each had a written
  contract, a provider registering them, and call sites already inside the
  contract. The only missing link was that the slot name was not a
  `CoreServiceName` member, so nothing could connect them and all three sat behind
  `as any`.

  **The ledger extends past the enum rather than the enum growing.** The two
  answer different questions, and conflating them is what left these untyped:
  `CoreServiceName` answers _"what happens at boot when this slot is empty?"_ — it
  sits beside `ServiceCriticality` and drives startup orchestration and discovery,
  so adding a member changes runtime behaviour and is effectively permanent. The
  ledger answers _"what shape occupies this slot?"_ — pure type information. These
  three need only the second, so `ServiceSlotContracts extends CoreServiceContracts`
  adds them there and `resolveService` keys on `keyof ServiceSlotContracts`. Zero
  runtime effect. If one is later promoted to a genuine core service, its entry
  moves up and nothing else changes.

  Evidence, as always, before an entry: `plugin-security` registers `security` and
  `ISecurityService`'s own doc names that registration; `plugin-sharing` registers
  `ShareLinkService`, which declares `implements IShareLinkService`; and `objectql`
  is an **alias of `data`** — `packages/objectql`'s plugin registers the _same
  instance_ under both names two lines apart, so one object was resolving as
  `IDataEngine` through one name and `any` through the other. `protocol` (22 call
  sites) and `mcp` have no written contract and stay unmapped.

  **Turning it on found four things, all on the `/security` admin surface:**

  1. **Request input reached the security service unvalidated.** `?status=` was
     `String(query.status)` — any string — handed to a method whose contract
     declares exactly three values, and from there into the query's `where`
     clause. Not an injection (the `where` is structured, never interpolated), but
     `?status=garbage` matched no row and returned an empty list, which reads as
     "there are no suggestions" rather than "that is not a status". Now a 400.

  2. **A test pinned that bug as expected behaviour.** The existing case asserted
     `status: 'open'` — not one of the three declared values — reached the service
     and returned 200. It proved the delegate carried _a filter_ and nothing about
     that filter being a status. Same shape as batch 1's `auth.handler` mocks:
     coverage in appearance, a wrong contract in substance.

  3. **and 4. Two writes could not prove they had a caller.**
     `confirmAudienceBindingSuggestion`/`dismissAudienceBindingSuggestion` declare
     `callerContext: SecurityContext` non-optionally — deliberately, since the
     read beside them declares it optional — and the domain passed a possibly-
     `undefined` execution context.

     **This was not a live hole**, and the distinction matters: with no execution
     context `shouldDenyAnonymous` already denied, because it sees no
     `userId`/`isSystem` and its allowlist arm needs a non-empty `path` this seam
     never passes, so it fell through to `return true`. What it never did was
     narrow `ec` itself — it only read `ec?.userId`. Checking `ec` directly is
     behaviour-preserving and makes the invariant legible to the compiler and the
     next reader.

  The `?status=` rejection is the one **behaviour change**: an unknown status was
  a silent empty list and is now a 400 naming the accepted values. The accepted
  set is a `Record` keyed on the contract type, so adding a status to the contract
  leaves a key missing and renaming one leaves a key excess — either fails to
  compile, where a plain array would have drifted silently.

  Verified: `@objectstack/runtime` **945 tests / 66 files** (+8), `@objectstack/spec`
  **7141 / 274** (+29), plugin-security **677**, plugin-sharing **225**;
  `tsc --noEmit` on spec, runtime, downstream-contract and all four examples;
  `pnpm lint`; all nine `check:*` gates.

- d92c72d: fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

  The three selectors from #4321 all key off the erasure and the lookup being in
  ONE expression. Split them and every selector misses:

  ```ts
  let ql: any;
  try {
    ql = ctx.getService("objectql");
  } catch {
    /* optional */
  }
  ```

  Selector 1 needs the call inside the declarator (this declarator has no init),
  selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
  exactly as in `const ql: any = ctx.getService(…)`.

  **Why this could not wait for the batches.** The baseline's monotonicity check
  means a file that leaves the grandfather list can never be re-added. So every
  batch converted more of this shape from "grandfathered" into "lint covers this
  file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
  into that state. A ratchet that reports a cleaner number the more you sweep is
  the #4342 failure wearing different clothes, and the fix only gets more
  expensive per batch shipped.

  **It is a rule, not a fourth selector, and that is the whole finding.** esquery
  can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
  which declaration the assigned identifier resolves to — so it would equally
  flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
  runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
  identifier needs SCOPE analysis. That is cheap and needs no type information, so
  this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
  is a rule, and the earlier "just one more selector" estimate was wrong.

  Verified against exactly that: the rule flags all 16 real sites and none of the
  8 correctly-typed lookalikes.

  **Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
  at 37: 29 sites were already inside grandfathered files and simply invisible.
  16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
  in files never listed, 1 the regex sweep had missed) and are typed here —
  `runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
  `plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
  `runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
  added; the key set still only shrinks.

  Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
  `II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
  do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
  `EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
  those record something worth naming: `IHttpServer` has no `getRawApp()` (the
  contract is framework-agnostic and the raw app is Hono's own handle), and
  ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
  at all — the engine attaches them via `(this as any)` and publishes nothing,
  while `getHookMetricsRecorder()` exists for exactly that question about the
  metrics recorder. Declared rather than laundered through `any`, and filed.

- 8dcc0f5: fix(spec,runtime): the service-lookup `any` guard now sees the type-argument form, and its scope stops at nothing under `packages/` (#4251)

  The #4127/#4214 rule banned `: any` and `as any` on a service-lookup result but
  not `getService<any>('data')` — the form the codebase actually used (80 sites,
  zero matches), erasing the slot contract identically. And the rule's `files`
  covered only `packages/runtime`, leaving the composition roots (rest,
  plugins/_, services/_) that hold most lookups unlinted. Both gaps closed: a
  third AST selector catches the type-argument form, the scope is now all of
  `packages/`, and the 40 not-yet-swept files are grandfathered in a visible,
  shrinking ratchet list (`SLOT_LOOKUP_UNSWEPT`) — enumerated at 180 sites by
  running the widened rule with the list emptied. `http.server` joins
  `UNCONTRACTED_SLOTS` (three providers, no written contract).

  Typing the three in-scope runtime sites surfaced its first yield: both
  `addDatasource` datasource-registration branches (DefaultDatasourcePlugin,
  DriverPlugin) probed a method **no metadata service implements**, so they had
  never run on any boot — deleted rather than typed against a phantom shape. The
  inert `DriverPluginOptions` they configured are tracked in #4320.
  `registerInMemory('datasource', …)` is the actual visibility path (#3827).

  Contract members declared from evidence, both optional: `IDataEngine` gains
  `getDefaultDriverName?()` / `getDriverByName?()` (ObjectQL's driver registry —
  the surface `os migrate` and serve's storage detection reach through
  `driver.<name>` services), `IMetadataService` gains `registerInMemory?()`
  (MetadataManager's boot-time seeding primitive). Callers that supplied `<any>`
  to these lookups should pass the slot's contract type instead — or nothing:
  an unmapped slot deliberately resolves to `unknown`, not `any`.

- 75b9e51: fix(spec,runtime): a service-slot lookup returns the slot's contract, not `any` — and it immediately found two more gaps (#4127)

  #4127's most valuable item was the one it did not do: "**给这个类别加个 gate**".
  The four contract gaps it catalogued were found by a human sweeping the
  dispatcher by hand. A sweep is not repeatable, and this one was not complete —
  see `/auth` below.

  The root was one line:

  ```ts
  // domain-handler-registry.ts
  getService(name: string): any;   // ← every domain's service handle
  ```

  Against `any`, a domain calling a method its contract declares and a domain
  calling a method nobody declares typecheck identically. That is what let #4087
  ship a `/storage` handler passing two arguments no implementation takes, and
  what hid #4127's four.

  **`CoreServiceContracts` — the slot → contract ledger.** `CoreServiceName` named
  the slots and `contracts/*` described them; nothing connected the two. It does
  now, and `getService<K>(name: K)` resolves through it, so a call outside the
  contract is a **compile error at the call site**.

  An entry is a claim, so entries are only made where the binding is evidenced —
  by the provider that registers the slot (`service-storage` → `file-storage`,
  `objectql` → `data`, whose own comment reads "ObjectQL implements IDataEngine"),
  or by dispatcher work that proved it (#4143/#4150 for `automation`,
  `notification`, `i18n`). **`ui` is deliberately unmapped**: the slot exists and
  `domains/ui.ts` serves it, but no `IUiService` was ever written. An unmapped slot
  resolves to `unknown`, not `any` — it must be cast deliberately, so the gap stays
  legible instead of looking checked.

  **Two findings, within minutes of turning it on:**

  **`/auth` called a method that does not exist.** `domains/auth.ts` probed
  `authService.handler(request, response)`. `IAuthService` declares
  `handleRequest(request): Promise<Response>`; `AuthManager` implements exactly
  that and has no `handler`. The probe was false on every deployment — #4143's dead
  `automation.trigger` again. **#4127's manual sweep never mentions `/auth`**,
  neither in its gap list nor in its "扫干净的" list: the file the compiler flagged
  first is the one the human pass skipped entirely.

  Not a live hole: the Hono adapter calls `handleRequest` itself and only falls
  through to the dispatcher when no usable auth service answered, so nothing was
  served by the mock in that deployment. But reading the contract makes the branch
  reachable for the first time — a host calling `handleAuth` directly WITH an auth
  service registered used to get `mockAuthFallback`'s `mock_<uuid>` session instead
  of real authentication, and now gets the auth service.

  **`POST /analytics/sql` invoked an optional method unguarded.** `generateSql?` is
  optional on `IAnalyticsService` — unlike `query`/`getMeta` beside it — and the
  call had no probe, so a provider without it answers a 500 from `TypeError`
  instead of saying the capability is absent. service-analytics implements it,
  which is why nothing noticed; the contract permits a provider that does not, and
  this slot is multi-provider by design. It answers `handled: false` now, the same
  404 the file's entry gate already gives for absent analytics capability.

  **`isServiceServeable` is a type guard now** (`svc is NonNullable<T>`). Every
  domain already calls it first on a resolved slot, so one predicate narrows away
  the `undefined` for the whole handler body — the null check and the capability
  check were always the same check.

  **The test-side hole, closed for this batch.** #4127's last section predicted it:
  the mocks are written to what the handler wants, so handler and test agree with
  each other and with no implementation. **Three** tests across two files mocked
  `{ handler }` for auth — including one whose entire subject was the _resolution
  path_, so it proved the lookup worked and nothing about the call. `ContractMock<T>`
  (`Partial<Record<keyof T, unknown>>`) now guards the mocks: keys are checked
  against the contract, signatures deliberately left `unknown` so `vi.fn()` does not
  force everything back to `as any`. The automation mock's `trigger` — genuinely
  not on the contract — stays as an explicit, labelled negative control outside the
  checked literal, because a test asserting the route _never_ calls it is the point.

  Nothing is renamed and no runtime behavior changes except the two fixes above.
  The 12 domains not calling `getService` are untouched; `resolveService` (which
  also takes non-`CoreServiceName` names like `protocol` and `objectql`) is
  deliberately left for a later batch rather than widened here.

  Verified: `@objectstack/runtime` **933 tests / 65 files**, `@objectstack/spec`
  **7095 / 272** (6 new, pinning the map against the enum in both directions),
  service-automation **457**, service-analytics **413**, service-messaging **137**,
  service-i18n **62**, adapter-hono **73**; `tsc --noEmit` on spec, runtime,
  downstream-contract and all four examples; `pnpm lint`; and all nine
  `@objectstack/spec` `check:*` gates — clean.

- 77a77fd: test(runtime): correct the #4073 evidence — the `registerStandardEndpoints` flip IS a no-op for a composed host

  #4192 added a test concluding that turning the flag off makes `/api/v1/data/:object`
  a 404, and blocked the #4073 retirement on it. That conclusion was wrong.

  It mounted `createRestApiPlugin({})` against a STUB `objectql` service. REST
  generates CRUD from the object registry, so it needs a real engine — driver plus
  registered objects — and its own `api.api` config. Under-provisioned it serves
  nothing, which says nothing about REST.

  Provisioned the way `client.environment-scoping.test.ts` does it (that suite runs
  `registerStandardEndpoints: false` and asserts `GET /api/v1/data/task` → 200 from
  REST), `/data/:object`, `/discovery` and `/.well-known/objectstack` all return
  byte-identical responses with the flag on and off.

  The test now asserts that parity directly rather than a status code, because a
  status was what misled it: `/data/task` answers 404 `OBJECT_NOT_FOUND` here — the
  engine's answer, i.e. a route that WORKS — where a routing miss would be
  `{"error":"Not found"}`. A separate assertion pins that the compared routes are
  live, so parity cannot be satisfied by two identical misses.

  No production code changes. The default is untouched: flipping it is still a real
  change for a BARE host mounting neither REST nor the dispatcher, and that is an
  API decision, not one this test makes.

- d82f8c0: test(runtime): pin who actually serves `/data` and `/discovery`, blocking the #4073 default flip on evidence

  #4073 plans to retire `registerStandardEndpoints` by flipping its default to
  `false`, on the premise that everything it mounts is duplicate supply. Booted for
  real — real `HonoServerPlugin`, real dispatcher, real `createRestApiPlugin`, real
  listener, in `serve.ts`'s registration order — that premise holds for only one
  half of the surface:

  - **`/discovery` + `/.well-known/objectstack` — safe.** They cede by an explicit
    `kernel.hasPlugin(rest|dispatcher)` check (#4018), so the dispatcher's computed
    payload answers whether the flag is on or off. Order-independent.
  - **`/data/:object` — not safe.** There is no cede, and the shadowing was
    asserted purely on "REST registers first and wins". With the flag OFF the path
    returns **404**, with REST mounted or not. The flag's raw surface is the only
    thing answering it in every composition this harness can boot.

  So the flip is not the no-op the plan describes. This adds the harness that says
  so, asserting the current matrix, so the next attempt has to confront it rather
  than re-derive the assumption. No production code changes.

- 2053714: fix(hono,plugin-hono-server,runtime): one CORS source and one registry key — the last derivable copies from the #3786 sweep

  Re-ran the sweep across all 72 packages. The earlier pass globbed `packages/*/src`,
  which is one level deep, so it missed everything under `packages/plugins/` and
  `packages/adapters/` — the "sweep is basically clean" report was based on an
  incomplete scan.

  **A stale CORS default, on the one description callers actually read.**
  `HonoCorsOptions.allowHeaders`' TSDoc promised
  `['Content-Type', 'Authorization', 'X-Requested-With']` "which is sufficient for
  cookie and bearer-token auth". The real default carries three more:
  `X-Tenant-ID` and `X-Environment-Id` (multi-tenant routing) and `If-Match` (the
  OCC token on record PATCHes, objectui#2572). Sizing a custom `allowHeaders`
  against that sentence drops all three and every cross-origin save fails with
  "Failed to fetch".

  The instructive part: **three** Hono CORS sites each carried their own copy of
  the defaults under "keep in sync" comments, and the copies all agreed. What
  drifted was the _doc_ — the only description with no counterpart to be diffed
  against, and the only one a caller reads.

  Both defaults are now single constants, `DEFAULT_CORS_ALLOW_HEADERS` and
  `DEFAULT_CORS_EXPOSE_HEADERS`, exported from `@objectstack/plugin-hono-server`
  and imported by the adapter (which already depends on it — no new edge). The
  TSDoc links them rather than restating, and documents an asymmetry it never
  mentioned: `allowHeaders` REPLACES the default, `exposeHeaders` MERGES with it.

  `hono-plugin.test.ts` stopped stubbing `./adapter` wholesale and keeps the real
  constants via `importOriginal` — it asserts exact header lists, so a mocked copy
  would make the test agree with itself rather than with what ships. Verified:
  removing `If-Match` from the constant fails `should allow If-Match by default`,
  by name.

  **A third copy, in the public protocol docs.** `content/docs/protocol/kernel/
http-protocol.mdx` advertised `Access-Control-Allow-Headers: Authorization,
Content-Type` — two of the six — and methods missing `PUT` and `HEAD`, with no
  mention of the exposed headers at all. That is the copy an integrator builds a
  client against: reading it, you would not know `If-Match` is permitted (so you
  would not attempt OCC) or that `set-auth-token` is readable (so a rotated
  session would look like a bug). Corrected, with the three non-obvious allowed
  headers and the two exposed ones explained, and a pointer to the constants as
  the source of truth.

  **A hand-copied service-registry key.** `runtime`'s share-links domain resolved
  `'shareLinks'` as a string literal, copied from `SHARE_LINK_SERVICE` — whose own
  doc-comment says "keep in sync with the SharingPlugin registration". It now
  imports the constant. A drifted copy resolves nothing, so every share link
  answers 501 "Sharing is not configured for this environment" on an environment
  where it is configured perfectly well.

  **Plus a duplicate ledger entry**, which is the same defect one level up:
  `check-generated.ts` carried two `NO_GENERATOR` entries for
  `check:strictness-ledger`, because #4203 and #4252 each added one without seeing
  the other. Functionally harmless (the ledger is read into a `Set`) but it leaves
  two comments telling overlapping versions of the same story. #4203's is kept —
  it is the more complete account and it is the PR that fixed the underlying
  problem.

  Checked and deliberately left alone: `ApprovalStatus` (5 values) and
  `ApprovalActionKind` (12 values) versus their `plugin-approvals` selects — diffed
  verbatim, no drift today, still hand-copied across a package boundary.

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

- 43fc039: Discovery's `/ui` advertisement reads what `/ui` reads: the `protocol` service, not the vestigial `ui` slot (#4093).

  `domains/ui.ts` serves `GET /ui/view/:object` off the `protocol` service and 503s without it; the `ui` core-service slot never enters that decision, and nothing in the platform registers a `ui` service — plugin-dev's shapeless placeholder was its only occupant ever, and ADR-0115 retired it. Gating `routes.ui` on slot presence was therefore wrong in both directions: a dev boot with the placeholder but no protocol advertised a route that could only 503, and every boot without a placeholder — production always, and all dev boots post-ADR-0115 — hid a route that serves fine.

  `routes.ui` and `services.ui` now gate on `typeof protocol?.getUiView === 'function'` — the domain handler's own guard, byte for byte, the same rule the `mcp` advertisement follows. `services.ui` reports the serving implementation (provider `metadata-protocol`, honoring any `__serviceInfo` it declares), and the unavailable message names the actual remedy — register MetadataPlugin (`@objectstack/metadata-protocol`) — instead of "install a ui plugin", which names a plugin that does not exist.

  FROM → TO: `routes.ui` / `services.ui` may newly appear in deployments where the protocol service is registered (the route always served there; discovery just never said so) and newly disappear in protocol-less boots (it never worked there). No handler behavior changes.

- Updated dependencies [6a67d7a]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [3ec8186]
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [bb1ce2e]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [ea24593]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [fccec22]
- Updated dependencies [2af1988]
- Updated dependencies [b3a2318]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [fae74b5]
- Updated dependencies [7bf5349]
- Updated dependencies [366105c]
- Updated dependencies [c9d254a]
- Updated dependencies [42e3b01]
- Updated dependencies [c8124e5]
- Updated dependencies [9e8f04d]
- Updated dependencies [39eb01b]
- Updated dependencies [c3bcb42]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [f4d7f1d]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [0373d52]
- Updated dependencies [4f30943]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [bb192c4]
- Updated dependencies [9881074]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [dc530b4]
- Updated dependencies [f0d6594]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [6f98c2d]
- Updated dependencies [a4a9944]
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
- Updated dependencies [10575f3]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [99b4392]
- Updated dependencies [974c6d4]
- Updated dependencies [7309c81]
- Updated dependencies [495019b]
- Updated dependencies [20bc1ec]
- Updated dependencies [ac6c0be]
- Updated dependencies [90c2b15]
- Updated dependencies [33a5ff4]
- Updated dependencies [9e01213]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [55bbefc]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [3fe0ff1]
- Updated dependencies [be7945a]
- Updated dependencies [cc2de0e]
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
- Updated dependencies [4475c59]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [f5fe061]
- Updated dependencies [6c87cc9]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [dd5daac]
- Updated dependencies [ec796d5]
- Updated dependencies [77fadbf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [0931185]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [8d5bb5a]
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
- Updated dependencies [a62bd9e]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [c53aa53]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [3245174]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [7309c81]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/driver-memory@17.0.0-rc.1
  - @objectstack/driver-sql@17.0.0-rc.1
  - @objectstack/metadata@17.0.0-rc.1
  - @objectstack/plugin-security@17.0.0-rc.1
  - @objectstack/rest@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/plugin-auth@17.0.0-rc.1
  - @objectstack/metadata-protocol@17.0.0-rc.1
  - @objectstack/metadata-core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.1
  - @objectstack/observability@17.0.0-rc.1
  - @objectstack/service-cluster@17.0.0-rc.1
  - @objectstack/service-datasource@17.0.0-rc.1
  - @objectstack/service-i18n@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- af5a224: feat: enforce declared action-param contract at dispatch — ADR-0104 phase 2 (D2)

  An action's declared `params[]` (`type` / `required` / `multiple` / `options` /
  `reference`) was a complete value contract that only ever informed the client
  dialog — the server passed `reqBody.params` straight to the handler unvalidated
  (REST `handleActions` and the MCP `invokeBusinessAction` path), and handlers
  read an untyped bag. D2 makes the declaration enforced and typed.

  - **`@objectstack/spec/ui`** now exports `validateActionParams` (+
    `ResolvedActionParam`, `ActionParamIssue`, `ACTION_PARAM_BUILTIN_KEYS`): a
    pure check that validates a params bag against resolved param declarations,
    reusing the D1 `valueSchemaFor` so option membership, `multiple` arrays and
    reference-id shape all ride the one value contract. Also exports the typed
    authoring surface `ActionHandler` / `ActionHandlerContext` /
    `ActionEngineFacade` — annotate a handler with `ActionHandler` instead of
    `(ctx: any)`.
  - **Dispatch (runtime)**: both the REST and MCP action paths resolve the
    action's declared params (field-backed params resolved through the referenced
    object field) and validate the request bag **before the handler runs** —
    required presence, per-type value shape, and unknown keys (the dispatcher's
    own `recordId` / `objectName` are allowlisted).

  **Warn-first rollout (ADR-0104 R3).** A violation is **logged and passes** by
  default — params that were silently wrong before keep working while the drift
  becomes visible. Set `OS_ACTION_PARAMS_STRICT_ENABLED=1` to reject with a
  `400 VALIDATION` (REST) / an error (MCP). Actions that declare no `params` are
  untouched (nothing to validate against). The flip to strict-by-default rides a
  later minor once telemetry is quiet.

  Not included: file/image params becoming `sys_file` references — that depends
  on file-as-reference (ADR-0104 D3). Per-name static typing of `ctx.params` from
  the literal `params` array is a deferred DX nicety; the runtime guarantee holds
  regardless.

- 840ee4b: fix(analytics,runtime,types): gate cube auto-inference on object existence; stop the dispatcher boundary returning raw SQL (#3867)

  Two independent defects on the `/analytics` surface, found while verifying #3770
  against a real server. On an authenticated CRM dev server, before this change:

  ```
  POST /api/v1/analytics/query {"cube":"sqlite_master","measures":["count"],"dimensions":["type"]}
  → 200 {"rows":[{"type":"index","count":262},{"type":"table","count":71},{"type":"view","count":1}],
         "sql":"SELECT type AS \"type\", COUNT(*) AS \"count\" FROM \"sqlite_master\" GROUP BY type"}
  ```

  That is SQLite's internal schema table — never a registered object — read
  successfully through the analytics endpoint. Not merely "the name reaches the
  driver and errors": **any table the connection can see was readable.**

  **① The cube name reached the driver as a table name.** `AnalyticsService.ensureCube`
  auto-infers a minimal Cube when none is registered, with `cube.sql = <the queried
name>`. That is the intended "metric over an object" path — an `object-metric` KPI
  widget queries `crm_account` with no authored Cube — but it accepted _any_ string,
  so the endpoint could aggregate over an arbitrary physical table. The
  analytics-side twin of the data-path gap #3770 closed, and it was not covered by
  that fix: #3770 gated the protocol's `analyticsQuery`, which is the _degraded
  fallback_; a deployment with `@objectstack/service-analytics` installed runs the
  real engine instead (`ctx.replaceService`).

  Inference is now gated on the same schema registry the data path consults, via a
  new optional `AnalyticsServiceConfig.isRegisteredObject` that `plugin.ts` wires
  from the `data` engine's `getObject`. Three-way rule: a registered Cube runs
  untouched (its `sql` is whatever it declares); an unregistered name that IS an
  object still auto-infers exactly as before; neither → `CUBE_NOT_FOUND` / 404
  raised before any SQL exists, naming both ways to make the request valid. With no
  probe configured the gate stands down and warns once — the same tiering #3770
  took for a missing registry. `generateSql` (`/analytics/sql`) is gated too.

  **② The dispatcher boundary returned `err.message` verbatim.** `errorResponseBase`
  is the single error exit for _every_ route the dispatcher plugin mounts —
  `/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`, `/auth`,
  `/notifications`, `/mcp`. `@objectstack/rest` has guarded its data routes against
  driver dumps forever (`mapDataError`); this boundary guarded nothing, so any
  driver error on any of those routes shipped its SQL to the client. Unlike ①, this
  half is unconditional — it does not depend on the cube being invalid.

  The leak heuristic moved out of `rest-server.ts` into `@objectstack/types` as
  `looksLikeInternalErrorLeak` (both packages already depend on it) and is now
  applied at both boundaries — one predicate, one place to widen when a new
  dialect's phrasing shows up. `mapDataError`'s behaviour is unchanged. At the
  dispatcher it applies **only to 5xx**: a 4xx message is a deliberate
  business/validation answer and must reach the caller intact. Sanitising costs no
  diagnostics — the untouched error still reaches `errorReporter` through the
  existing `__obsRecordedError` side-channel.

  **Also fixed in the same function:** `errorResponseBase` read only
  `err.statusCode`, while domain errors across this codebase carry `status` (and
  `HttpDispatcher.errorFromThrown` already reads `status` first). Every deliberate
  4xx thrown through a dispatcher route — including #3770's `OBJECT_NOT_FOUND` on
  the analytics fallback path — was rendered as a **500**. It now reads `status`
  then `statusCode`.

  **Behaviour change.** `/analytics/query` and `/analytics/sql` return 404
  `CUBE_NOT_FOUND` for a cube that is neither registered nor a registered object;
  previously the name was passed to the driver. Dashboards and KPI widgets pointed
  at real objects or authored cubes are unaffected. A 5xx on a dispatcher route
  whose message looks like a driver dump now reads `Internal server error` — check
  server logs or your error reporter for the original.

- ad4af62: feat: single-source API-method derivation — the server is the only adjudicator (#3391)

  An object's effective API surface is now resolved from **six primitives**
  (`get/list/create/update/delete/bulk`) by ONE derivation table in
  `@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
  / `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
  the REST data surface, the runtime HTTP/MCP dispatcher, and the
  `/me/permissions` annotation. The `apiMethods` whitelist is three-state —
  `undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
  the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone. (This
  release also ships the enum shrink — see the `#3543` changeset: the authored
  enum IS the six primitives, and a stored legacy value is stripped at parse
  with a warning rather than honored.)

  **Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
  update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
  always on this phase); `aggregate`/`search` ⊆ list (search also needs
  `searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
  bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
  `enable.trash` flag was retired, #2377).

  **New response-side contract:** `EffectiveObjectPermissionSchema` extends
  `ObjectPermissionSchema` with an optional `apiOperations` array;
  `GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
  hands down the per-object effective operation set. The authoring
  `ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
  the effective set the server resolves, never the raw whitelist.

  **Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

  1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
     matching the documented three-state contract instead of the prior fail-open
     "no restriction". In-repo impact is zero (every `[]` object also sets
     `apiEnabled: false`, so 404 precedes 405).
  2. The runtime dispatcher / MCP whitelist is now live. It previously read the
     flat shape while `getObject()` returns the flags nested under `.enable`, so
     the gate never fired — a silent dead gate now enforced (nested-first,
     flat-compatible).
  3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
     explicit `import`/`export`) now admits import (⊆ create∨update) and export
     (⊆ list). Row-level FLS is shared with list; the export column header is now
     projected to the FLS-readable set so it can never expose a wider column set
     than list (previously a masked column leaked its name as an empty column).
  4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
     `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
     child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
     (`sys_user`, `sys_user_preference`, `sys_business_unit`,
     `sys_business_unit_member`) gained `bulk`; a third-party object with an
     explicit write whitelist that omits `bulk` will now 405 on the Many/batch
     routes.
  5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
     (enum-ordered), not the raw whitelist.

- 57a3bb3: fix(automation,approvals): the run-resume route is gated by the node the run is parked on (#3801)

  `POST /api/v1/automation/:name/runs/:runId/resume` forwarded a caller-supplied
  `{ inputs, output, branchLabel }` straight into `AutomationEngine.resume`, and
  `resumeInternal` validated **machine state only** — the concurrent-resume latch,
  the run exists, the flow exists, the suspended node still exists. Nothing asked
  _who was calling_.

  Approval nodes suspend and resume through exactly that mechanism. So a resume
  carrying `branchLabel: 'approve'` walked the approve edge with **no approver
  check, no `sys_approval_action` row and no status mirror** — the
  `sys_approval_request` row and the run then disagreed permanently. The only
  thing standing between the route and the approvals rules was convention; the
  showcase spelled it out in a comment ("decide via the approvals API, never a raw
  engine `resume`"), and a comment in an example is not an access control.

  Removing the route was not the fix: it is load-bearing for **screen flows** —
  the UI flow-runner posts `{ inputs }` there to advance a paused `screen` node.
  The gate therefore keys on **what the run is parked on**:

  - `ActionDescriptor.resumeAuthority` (`'any'` | `'service'`, default `'any'`) —
    a pausing node declares who may continue it. `approval` declares `'service'`.
  - The engine refuses a `'service'` suspension unless the signal carries
    `RESUME_AUTHORITY_SERVICE` (`@objectstack/spec/contracts`), a **symbol** the
    owning service stamps in-process — a JSON body can never produce one, so the
    transport cannot forge it. `ApprovalService` stamps it on the tail of a
    decision it has already authorized and recorded.
  - The gate follows a **subflow** pause down to the child the signal would
    actually reach, so resuming the parent is not a way around it.
  - Refusal returns `{ success: false, code: 'forbidden' }` and the route answers
    **403**. Nothing is consumed — the request stays pending and the run stays
    parked, so the real decision still lands.

  `screen` and `wait` pauses are unchanged, as is every path that already went
  through the approvals API. What changes for consumers:

  - **FROM:** finishing an approval with
    `client.automation.resume(flow, runId, { branchLabel: 'approve' })`
    **TO:** `client.approvals.approve(requestId, …)` (or `.reject` / `.recall`).
    The old call now answers 403 and changes nothing.
  - Registering your own pausing node whose continuation belongs to a service
    rather than to whoever holds the run id? Declare `resumeAuthority: 'service'`
    on its descriptor and stamp `RESUME_AUTHORITY_SERVICE` on the signal from that
    service.

  A suspension now records the node type that produced it
  (`SuspendedRun.nodeType` / `sys_automation_run.node_type`), captured at suspend
  time so a flow republished mid-pause cannot re-type the node out from under the
  gate; rows written before this fall back to the flow definition.

- 19e3e6e: feat(runtime)!: the standalone `default` datasource is a declaration, connected through the one datasource path (#3826)

  ADR-0062 D1 asked for exactly one "definition → live driver" path. Construction
  converged earlier; the _connect + failure verdict_ half did not — the standalone
  `default` driver was pre-built and smuggled into the engine as a `driver.*`
  kernel service, so "what if it cannot connect" lived in `ObjectQLEngine.init()`,
  a second implementation of the policy `DatasourceConnectionService` owns for
  every other datasource. #3741 → #3758 showed what two copies cost: a fix to one
  missed the other for three months.

  - **`createStandaloneStack` now emits a datasource DEFINITION**, not a driver.
    URL→config translation and `mkdir` stay host concerns; the new
    **`DefaultDatasourcePlugin`** (exported from `@objectstack/runtime`) connects
    the definition at boot through the shared `DatasourceConnectionService` —
    same driver factory, same failure verdict, same retained state. It must be
    registered before `ObjectQLPlugin` (boot schema-sync needs the driver);
    `createStandaloneStack` orders it correctly.
  - **`sqlite-wasm` joined the shared driver factory** (`sqlite-wasm` /
    `wasm-sqlite` ids) — it was the last bespoke construction site.
  - **`bootCritical` on `ConnectableDatasource`**: the host declares a datasource
    the platform cannot run without; a boot connect failure is then fatal
    regardless of object bindings, sharing `OS_ALLOW_DRIVER_CONNECT_FAILURE` and
    the `DEGRADED BOOT` banner with the engine-level guard. A connect policy that
    denies a boot-critical datasource fails the boot loudly — the #3828 "denial is
    not a failure" boundary was drawn for optional datasources.
  - **`connect(record, { asDefault: true })`**: registers the built driver as the
    engine's default under its natural name (no `'default'` stamping — routing to
    `default` goes through the engine's default-driver fallback, and the natural
    name keeps logs/lookups byte-for-byte with the previous boot).
  - **`default` is a host-reserved name**: an app bundle declaring a datasource
    named `default` is rejected at load (`AppPlugin`), and the runtime-admin
    create rejects it too. It would shadow the host's primary datasource and, if
    it passed the auto-connect gate, silently divert every unbound object.
  - The primary DB now shows a REAL `status` in Setup → Datasources (#3827) —
    `ok` when connected, `error` + reason when the operator boots degraded.
  - `ObjectQLEngine.init()` is unchanged and keeps its fail-fast: it re-connects
    the already-connected default (every open-core driver's `connect()` is
    idempotent), which is exactly the boot verification #3741 wants.
  - `DriverPlugin` remains the escape hatch for tests and pre-built/proxy drivers
    (e.g. the CLI's `telemetry` datasource) — no longer how the standalone
    default boots. The CLI serve config-load fallback (`createStorageDriver`,
    incl. mysql/turso) still constructs directly; tracked in #3826.

  **Migration.** Boots through `createStandaloneStack` (CLI `serve`/`dev`
  artifact path, quickstarts, embedders using the stack factory) change shape but
  not behavior: same driver kinds, same URLs, same fail-fast semantics, same
  escape hatch. Embedders that composed `DriverPlugin` manually are unaffected.
  An app that declared a datasource literally named `default` now fails to load
  with a rename instruction — that name never routed correctly to begin with.

- 394b7a1: feat(job): honor the authored `retryPolicy` / `timeout` in the job scheduler (#3494)

  `JobSchema.retryPolicy` and `JobSchema.timeout` used to be parsed-but-ignored
  (the 2026-06 liveness audit's aspirational-config cluster). They are now
  enforced end to end — built rather than pruned, since retry/backoff and
  per-run time limits are semantics job authors reasonably expect:

  - **spec**: `IJobService.schedule` gains an optional 4th `options` argument
    (`JobScheduleOptions` with `retryPolicy` / `timeout`, mirroring the
    authorable schema); new `JobRetryPolicy` type. Backward compatible —
    existing 3-arg implementations and callers are unaffected.
  - **service-job**: new `runWithPolicy` helper (exported, with
    `JobTimeoutError`) wraps every handler invocation in `CronJobAdapter` and
    `IntervalJobAdapter`; `DbJobAdapter` threads options through to its inner
    adapters. Failed attempts (including timeouts) retry with exponential
    backoff `backoffMs * backoffMultiplier^(retry-1)` up to `maxRetries`;
    an attempt exceeding `timeout` is recorded with execution status
    `'timeout'`. No `options` → exactly the legacy single-attempt behavior.
  - **runtime**: declarative-jobs registration in AppPlugin forwards the
    authored `retryPolicy` / `timeout` to the scheduler.

  Note: JavaScript cannot forcibly cancel an in-flight handler — a timed-out
  attempt is abandoned, not killed. The retry delay caps only via the
  multiplier arithmetic (no maxDelay knob yet).

  Refs #3494, #1878, #1893.

- 8e08bc3: feat(runtime): `/ready` reports 503 when a data driver stops answering (#3756)

  `/health` returned `{status: 'ok'}` unconditionally and `/ready` only checked
  whether the kernel state was `running` — a flag set once when bootstrap finishes
  and never revisited. Neither probe touched the data layer. So a database that
  went away _after_ boot (restart, failover, network policy change, pool exhausted,
  credentials rotated) left both probes green: the load balancer kept routing to a
  replica that failed 100% of its requests, and the orchestrator saw nothing wrong.
  The driver's `checkHealth()` already existed and was cheap (`SELECT 1` /
  `db.command({ping:1})`) but was only consumed by `datasource-admin`'s
  `testConnection` — no probe path called it, and `ObjectQL` exposed no way to ask
  (`drivers` is private with no accessor).

  This is the runtime-side half of #3741, which fixed only the boot-time version
  of the same defect.

  - New `ObjectQL.checkDriversHealth({ timeoutMs })` pings every registered driver
    and returns a `DriverHealth[]` verdict. Each probe is settled independently and
    bounded (default 2s) — `checkHealth()` swallows its own errors, but on a dead
    knex pool it does not return at all, waiting out `acquireConnectionTimeout`
    (60s by default), and a probe that hangs is as useless as one that lies. A
    driver implementing no `checkHealth()` is reported healthy: absence of a probe
    is not evidence of failure.
  - `GET /ready` now returns 503 with the failing driver names when the kernel is
    running but a driver is down, on top of the existing booting/shutting-down
    cases. The result is memoized for ~1s so Kubernetes' few-second polling does
    not become one database round-trip per probe per replica.
  - `GET /health` deliberately still checks nothing, and now says why in the code.
    A failing _liveness_ probe restarts the pod, which cannot fix an unreachable
    database but would put every replica into a restart storm for the length of the
    outage. Readiness — leave the rotation — is the failure mode that helps.

  The readiness check **fails open**: a kernel with no data engine (lite kernels,
  edge, metadata-only hosts), an engine predating `checkDriversHealth`, or a probe
  that itself throws all read as ready, exactly as before. Readiness gates whether
  a replica receives any traffic at all, so an inconclusive answer must not
  black-hole a working deployment. Only a driver that positively reports itself
  unhealthy takes the replica out.

  **Migration.** None. Deployments already wiring `/api/v1/ready` as their
  readiness probe get the stricter check automatically; deployments that pointed a
  _liveness_ probe at `/ready` should move it to `/health`, which is the endpoint
  that never fails on a dependency.

- 3216344: feat(runtime): extract the action-execution subsystem from the dispatcher — ADR-0076 D11 step ③, PR-8 (#2462)

  The 16-helper machinery behind server-registered business actions
  (declaration collection/resolution, ADR-0104 param enforcement, the
  permission/AI-exposure gates, the engine facade + session shape, invocation,
  and the `callData` protocol/ObjectQL bridge — ~560 lines) moves to
  `action-execution.ts`, depending only on the narrow `ActionExecutionDeps`
  slice (resolveService + getObjectQL; NO env-resolution state). The
  ADR-0104 warn-once statics ride along as module functions. The dispatcher
  keeps four thin delegates with in-class callers; twelve internal-only
  helpers are called directly on the module. This is the pre-cut that turns
  the `/actions` and `/mcp` domain extractions into mechanical moves (PR-9).
  Zero behavior change — runtime 649, http-conformance 41, dogfood 351 green.

- f5bfac8: feat(runtime): extract the /actions and /mcp dispatcher domain bodies — ADR-0076 D11 step ③, PR-9 (#2462)

  The two deep-coupled domains ride the PR-8 action-execution subsystem out
  of the dispatcher: `domains/actions.ts` (ADR-0066 D4 permission gate +
  ADR-0104 param contract) and `domains/mcp.ts` (JSON-RPC transport,
  `/mcp/skill` download, OAuth resource-metadata, the principal-bound tool
  bridge). Env-resolution state stays behind two new deps seams —
  `getDefaultEnvironmentId` and `resolveProjectKernelObjectQL` (the ADR-0006
  direct-caller kernel swap, side effect dispatcher-owned). The legacy
  `/mcp/skill`-before-`/mcp` precedence is reproduced with ordered registry
  entries incl. the `?` forms; the actions redundant trailing-slash regex
  (the CodeQL polynomial-redos twin) is dropped for split+filter. The authz
  identity pin for `buildMcpBridge(context)` follows the body to
  `domains/mcp.ts`. Zero behavior change — runtime 649, http-conformance 41,
  dogfood 351 green.

- 6163393: feat(runtime): extract the /auth and /ai dispatcher domain bodies — ADR-0076 D11 step ③, PR-7 (#2462)

  `/auth` (better-auth service bridge + the browser-safe mock fallback for
  MSW/test environments, with the local `randomUUID` wrapper moving alongside
  its only consumer) and `/ai` (dispatch to the AI plugin's kernel-cached
  route table with per-route auth-contract enforcement and actor threading)
  move to `domains/`. `DomainHandlerDeps` grows two lazily-read members:
  `isAuthRequired()` (the deployment's requireAuth posture —
  construction-order safe) and `getRegisteredAiRoutes()`. `/mcp` was
  deliberately excluded: `buildMcpBridge` couples to the action-execution
  family (callData / actionPermissionError / invokeBusinessAction), so it
  goes with the /actions /meta /data deep-coupling batch. Zero behavior
  change — http-conformance (41) plus 5 new seam tests.

- 688e9df: feat(runtime): extract the /automation dispatcher domain body — ADR-0076 D11 step ③, PR-6 (#2462)

  The automation bridge (flow CRUD, trigger/execute, runs history,
  pause/resume — the ADR-0018/0019/0022 surfaces, ~260 lines) moves to
  `domains/automation.ts` with zero new deps-contract growth. The route-order
  subtlety is preserved verbatim: `/actions`, `/connectors` and `/_status`
  keep their guard positions before the `/:name → getFlow` catch-all. Zero
  behavior change — http-conformance (41) plus 3 new seam tests.

- 8f124a7: feat(runtime): extract the first four dispatcher domain bodies into `domains/` modules — ADR-0076 D11 step ③, PR-2 (#2462)

  The `/analytics`, `/i18n`, `/notifications` and `/security` handler bodies
  move out of the `HttpDispatcher` god class into per-domain modules under
  `packages/runtime/src/domains/`, running against an explicit
  `DomainHandlerDeps` contract (resolveService / getService / success / error —
  the WHOLE dispatcher surface a domain may touch). The dispatcher keeps thin
  `handleXxx` delegates for direct callers, and `/notifications` + `/security`
  leave the legacy if-chain for the domain registry (new `match: 'segment'`
  preserves their `=== p || startsWith(p + '/')` branch shape exactly).

  Route registration stays dispatcher-owned on purpose: most service slots are
  multi-provider (i18n = I18nServicePlugin OR the AppPlugin in-memory fallback;
  analytics = service-analytics OR the ObjectQLPlugin fallback), so a route is
  the bridge to a SLOT, not the property of any one providing package. Zero
  behavior change — http-conformance (41 cross-adapter assertions) and the
  seam suite (18 tests) lock it.

- 21ca1d5: feat(runtime): extract /keys, /storage and /ui dispatcher domain bodies — ADR-0076 D11 step ③, PR-3 (#2462)

  Continues the per-domain decomposition: three more handler bodies move out
  of `HttpDispatcher` into `domains/keys.ts` (incl. the zero-tolerance
  API-key-mint security contract), `domains/storage.ts` and `domains/ui.ts`,
  running on the explicit `DomainHandlerDeps` contract (extended with
  `getObjectQL` for the data-plane domains). The `/keys` legacy branch's
  `'/keys?'` query-string form is reproduced with a second registry entry;
  storage drops its strictly-redundant `kernel.services` index-access fallback
  (dead under Map-shaped services, duplicate under object-shaped ones). Thin
  `handleXxx` delegates remain for direct callers. Zero behavior change —
  locked by the 41-assertion http-conformance suite and 6 new seam tests.

- 03b11e8: feat(runtime): thin domain-handler registry seam in the HTTP dispatcher — ADR-0076 D11 step ③, PR-1 (#2462)

  `dispatch()` routed every domain through one hand-written
  `if (cleanPath.startsWith('/xxx'))` chain — the "god implementation on a clean
  port" shape ADR-0076 D11 calls out. This lands the decomposition seam: a
  first-match `DomainHandlerRegistry` consulted before the legacy chain, plus a
  public `HttpDispatcher.registerDomainHandler()` so follow-up PRs can hand each
  domain's normalized handler to its owning service package.

  Migration discipline is "registry first, code moves later, ownership last":
  this PR only wraps four existing branches (`/health`, `/ready`, `/analytics`,
  `/i18n` — three shapes: no-service probe, service bridge, optional-service 501) into registry entries with faithful legacy matching semantics. Zero
  behavior change, locked by the 41-assertion http-conformance cross-adapter
  suite and 11 new seam tests.

- 8891f93: feat(runtime): extract the /meta and /data dispatcher domain bodies — ADR-0076 D11 step ③, PR-10, the terminal cut (#2462)

  The last two domains leave the dispatcher: `domains/meta.ts` (metadata
  read/write incl. ADR-0033 draft-aware protocol paths, ADR-0046 doc slimming
  riding along with its exclusive `slimDocList` helper) and `domains/data.ts`
  (CRUD/query over the action-execution `callData` bridge; the multi-tenant
  unresolved-environment 428 now keys off a semantic `isMultiTenantHost()`
  deps member instead of poking `kernelResolver`). **The dispatch() if-chain
  is now EMPTY of domains** — 18 domains resolve through the registry, and
  `createHonoApp`'s catch-all is ready for retirement (step ① of #2462).
  Zero behavior change — runtime 649, http-conformance 41, dogfood 351 green.

- d729a31: feat(runtime): extract the /packages dispatcher domain body — ADR-0076 D11 step ③, PR-5 (#2462)

  The largest domain so far (~680 lines: the handler plus its two exclusive
  helpers `assemblePackageManifest` and `applyPublishedSeeds`) moves to
  `domains/packages.ts` — list/install/enable/disable, ADR-0033 draft
  publish/discard, ADR-0067 commit history & rollback, ADR-0070 export /
  orphan adoption / duplicate, delete. `DomainHandlerDeps` grows the shared
  facilities the body needs: `errorFromThrown` (field-anchored 422s),
  `resolveActiveOrganizationId` (session org), `announceKernelEvent`
  (`metadata:reloaded` after publish), and an optional `logger`. The step-②
  (#3142) single-pipeline behavior is preserved. Zero behavior change —
  http-conformance (41) plus 4 new seam tests (incl. the 409
  duplicate-install guard).

- cb8322e: feat(runtime): extract the /share-links dispatcher domain body — ADR-0076 D11 step ③, PR-4 (#2462)

  The share-link capability-token surface (ADR-0047) moves out of
  `HttpDispatcher` into `domains/share-links.ts`. This is cloud's designed
  primary surface for per-env kernels (`registerShareLinkRoutes: false`, host
  dispatcher serves after kernel swap — the #2462 step-① re-scope finding), so
  the handler keeps working from the registry exactly as from the if-chain.
  `DomainHandlerDeps` grows `getRequestKernelService` (reads off the
  per-request RESOLVED kernel — the engine the shareLinks service is bound to)
  and `routeNotFound` (the shared 404 envelope). Zero behavior change — locked
  by http-conformance (41) and 5 new seam tests incl. token-resolve redaction.

### Patch Changes

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 6877e9a: test(client,runtime): the last wildcard was wrong evidence, not weak — AI ratchet 3 → 0 (#3718)

  The capstone (#3642) ratcheted "matched only by a `**` family" as weaker
  evidence, to be driven down by enumerating each dynamic family. 60 → 3 after
  #3656. The last 3 were `ai.nlq` / `ai.suggest` / `ai.insights` on `* /ai/**`.

  Enumerating that family (in `cloud`, where `service-ai` lives) showed the
  wildcard had not been weak evidence but **wrong** evidence. `buildAIRoutes()`
  mounts 12 routes — `chat`, `chat/stream`, `complete`, `models`, `status`,
  `effective-model`, six `conversations` — and **none** is `/nlq`, `/suggest` or
  `/insights`. The SDK's entire AI namespace is dead, the entire real AI surface
  is unexpressed by the SDK, and the two sets are disjoint (#3718).

  The old row's note even claimed the client "expresses nlq/suggest/insights
  against the REST AI routes". That was never verified and is false:
  `DEFAULT_AI_ROUTES` declares them but has no runtime consumer (only the spec's
  own test reads it), and `aiNlq?`/`aiSuggest?`/`aiInsights?` are optional
  protocol methods nothing implements.

  `/api/v1/ai/` becomes a bounded prefix exemption alongside the control plane —
  two cross-repo surfaces, both ledgered in `cloud` — and the wildcard-only
  assertion becomes `toBe(0)`, not a ratchet: every matched call now rests on an
  exact enumerated route. Mutation-checked in both directions (removing the
  exemption re-exposes exactly the 3, and the pre-change count was verified to be
  exactly those 3 and nothing else).

  Test-and-comment changes only; no runtime behaviour is affected.

- 0bab8bb: fix(client,runtime): analytics.meta/explain now call routes that actually exist (#3584)

  The route audit (#3563) ledgered four dispatcher↔client shape mismatches.
  Re-verification showed the two analytics shapes the client spoke —
  `GET /analytics/meta/:cube` and `POST /analytics/explain` — were served by
  **nothing**: not the dispatcher, not `@objectstack/rest`, not
  `service-analytics`. Both methods 404ed against every deployment.

  - `analytics.meta(cube?)` — FROM `GET /analytics/meta/:cube` TO
    `GET /analytics/meta[?cube=<name>]`. The cube argument is now optional; when
    given, the dispatcher threads it into `AnalyticsService.getMeta(cubeName?)`,
    which always supported the filter. Responses now use the dispatcher envelope
    (`{ success, data }`).
  - `analytics.explain(payload)` — FROM `POST /analytics/explain` TO
    `POST /analytics/sql` (the dispatcher's SQL dry-run route, backed by
    `generateSql`). Method name unchanged.

  No migration is expected in practice: a method that unconditionally 404ed can
  have no working callers (none exist in objectstack or objectui). Anyone who
  had hand-rolled fetches against the imaginary shapes should switch to the
  routes above.

  The two storage rows from the same audit are deliberately NOT reshaped: the
  presigned/chunked protocol the SDK speaks is registered autonomously by
  `service-storage` on any http-server and stays canonical; the dispatcher's
  bare `POST /storage/upload` / `GET /storage/file/:id` are reclassified in the
  route ledger as a `server-only` low-level compat surface.

- 3c8cfd1: fix(rest): make the API-exposure gate's metadata fail-open observable (#3545, #3391 follow-up)

  The object API-exposure gate (`apiEnabled` / `apiMethods`) fails OPEN when object
  metadata can't be resolved, so a transient metadata outage doesn't 405 every
  request. #3545 evaluated the residual risk of that path and confirmed it is
  acceptable — the gate is a **surface-area control, not the authorization
  boundary**: every request still passes auth and the ObjectQL security middleware
  (CRUD / FLS / RLS) on the data call regardless of the gate's outcome, so a
  fail-open can never bypass data authorization.

  The one gap was that the fail-open was **silent** — a persistent metadata fault
  (store down / corrupt schema doc), during which the gate allows every operation
  unchecked, looked identical to healthy operation.

  - **rest** `loadObjectItems` now LOGS a _thrown_ metadata read (a real fault)
    while leaving a legitimately-empty registry (a cold-start `[]`) silent — so a
    genuine outage is diagnosable without false alarms during normal startup. The
    behavior is unchanged (still returns `[]` → gate abstains → data path + security
    enforce).
  - **runtime** `api-exposure.ts` records the #3545 tiered decision in its
    contract doc: keep fail-open when the whole metadata service is unavailable
    (failing closed would break the cold-start window for no security gain); the
    narrow "object resolvable but its `enable` policy is present-yet-unreadable"
    widen (unreachable through Zod-validated registration) is deferred to the
    exposure-semantics window (#3543).

  No contract or behavior change to the gate itself — observability + decision
  record only.

- d3f2ff6: feat(client): `actions` surface — the SDK path to server-registered actions (#3563 PR-2)

  `client.actions.invoke(object, action, { recordId, params })` and
  `client.actions.invokeGlobal(action, opts)` dispatch handlers registered via
  `engine.registerAction` (`POST /api/v1/actions/...`). This closes the largest
  gap in the #3563 route audit: the whole `/actions` domain — the documented way
  to expose custom server-side operations — was unreachable from the SDK, and
  every console hand-rolled `fetch` for it. The record id travels in the body,
  which both server URL shapes honor; the handler's own business failure comes
  back as `{ success: false, error }` rather than a thrown exception.

  The route ledger flips all three `/actions` rows to `sdk` and the gap ratchet
  drops 27 → 24. Also takes the documentation-drift findings from the audit:
  the client README no longer documents six methods that do not exist,
  `CLIENT_SPEC_COMPLIANCE.md` is retired to a tombstone pointing at the
  CI-enforced ledger (its "FULLY COMPLIANT" verdict was measured against a
  route table nothing consumes), and the docs-site SDK page documents the new
  surface.

- b7550d6: feat(client): `keys`, `shareLinks`, and `security` surfaces (#3563 PR-3)

  Three more domains the route audit found with zero SDK expression:

  - `client.keys.create({ name?, expiresAt? })` — mints a `sys_api_key`
    (`POST /api/v1/keys`). The raw secret comes back exactly once; `user_id`
    is pinned server-side. There was previously no SDK path to create an API
    key at all.
  - `client.shareLinks.create / list / revoke` — authenticated management of
    record share links. Listing is server-constrained to the caller's own
    links; the public token-consumption routes stay browser-only by design.
  - `client.security.suggestedBindings.list / confirm / dismiss` — the
    ADR-0090 admin surface for package audience-binding suggestions.

  The route ledger flips all seven rows to `sdk` and the gap ratchet drops
  24 → 17.

- 0164f40: feat(client): the final six route-audit gaps — meta drafts/published/FSM + automation descriptors (#3563 PR-5)

  - `meta.getPublished(type, name)` — the published version of a metadata item
    (ADR-0033; compound names pass through unencoded, matching `getItem`).
  - `meta.listDrafts({ packageId?, type? })` — pending drafts the active-only
    lists hide.
  - `meta.getLegalNextStates(object, field, from?)` — ADR-0020 FSM
    introspection ("from here, where can this record go?").
  - `automation.listActions({ paradigm?, source?, category? })` /
    `automation.listConnectors({ type? })` — the ADR-0018/0022 descriptor
    registries backing the Studio designer's pickers.
  - `automation.getRuntimeStatus()` — per-flow enabled/bound engine state.

  With these, the #3563 gap ratchet reaches **0** (from 27): every dispatcher
  route that should be SDK-expressible is, and the conformance guard keeps it
  that way.

- e295ad1: feat(client): the eleven package-lifecycle methods (#3563 PR-4)

  `client.packages` grows from install/enable to the full lifecycle the server
  has shipped for three ADR generations: `update` (manifest edit),
  `publish`, `publishDrafts` / `discardDrafts` (ADR-0033 whole-app draft
  promotion), `listCommits` / `revertCommit` / `rollback` (ADR-0067 commit
  timeline), `revert`, `export`, `adoptOrphans`, `duplicate` (ADR-0070
  portability). All eleven routes existed with no SDK expression — Studio
  reached them via raw fetch.

  The route ledger flips all eleven rows to `sdk` and the gap ratchet drops
  17 → 6 (from 27 at the start of the audit).

- 48c110e: feat(datasource): a datasource that is down is visible, and says why when queried (#3827, #3828)

  #3816 made an explicitly-bound datasource that cannot connect refuse the boot. Two
  gaps survived that fix, both in the cases that still boot — a policy denial, an
  `autoConnect` datasource, or any failure the operator waved through with
  `OS_ALLOW_DRIVER_CONNECT_FAILURE`:

  - **It was invisible.** `DatasourceSummary.status` was the literal `'unvalidated'`
    for every row — the contract declared three states and the implementation only
    ever emitted one — so a dead datasource looked exactly like a healthy-untested
    one. `checkDriversHealth()` could not help either: it iterates registered
    drivers, and a datasource that never connected was never registered, so it is
    _absent_ from the probe rather than unhealthy. The only trace was a warning
    that scrolled past at boot, which made the diagnostic procedure "restart the
    server and re-read the logs".
  - **The query-time error said nothing.** `getDriver()` answered four different
    situations with one sentence, `Datasource 'x' is not registered.`: refused by
    policy, failed to connect under the escape hatch, a misspelled name, and
    `active: false`. Only the third is an authoring bug, so the other three sent
    the reader hunting for a typo that does not exist.

  Both come from the same root: `connect()` already produced a `ConnectResult` for
  every attempt and every caller threw it away.

  - **`DatasourceConnectionService` retains the last verdict per datasource**, with a
    coarse `availability` (`available` / `blocked` / `failed` / `unattempted`) beside
    the raw status. New `getConnectionState(name)` / `listConnectionStates()`.
    `disconnect()` drops it, so a removed pool stops explaining itself.
  - **`DatasourceSummary.status` tells the truth**: `ok` | `error` | `blocked` |
    `unvalidated`, with a new operator-facing `statusReason`. `blocked` is new and
    deliberate — a policy denial is a decision, not a fault, and will not clear on
    its own. Reported in **Setup → Datasources**, `GET /api/v1/datasources`, and the
    summary returned from create/update, so a "Save" whose pool failed to open is no
    longer presented as success.
  - **`ERR_DATASOURCE_UNAVAILABLE` (HTTP 503)**: new `DatasourceUnavailableError`
    from `@objectstack/objectql`, thrown by `getDriver()` when the connection layer
    recorded _why_ a declared datasource has no driver. An undeclared name keeps the
    original message — there is genuinely nothing to add. 503 rather than 500/400:
    nothing about the request is wrong, and the state may clear.
  - **A privileged/public split for the reason.** The error **never** carries the
    underlying cause — connect failures routinely contain hosts, ports and DSNs, and
    a policy's `reason` is written for operators. Those stay in the logs and the
    (admin-gated) datasource list. `DatasourceConnectDecision` gains an opt-in
    `publicReason` for hosts that want to tell tenants something specific
    (e.g. `'External datasources require the Scale plan.'`); it is the only string
    that reaches an end user.
  - **Readiness is deliberately not gated on this.** `/ready` still reflects
    registered-driver health only: an optional datasource being down must not pull an
    otherwise-working replica out of the load balancer.

  Also lands a drift guard for **#3826**, and corrects ADR-0062's status while doing
  it. The ADR claimed D1 ("exactly one definition → live driver path") as
  implemented; only the _construction_ half converged. The `default` driver is still
  registered as a `driver.*` kernel service and connected by `ObjectQLEngine.init()`,
  with its own failure verdict, pool teardown, and no connect policy. What blocks the
  merge is an input-shape mismatch, not ordering: `connect()` takes a datasource
  _definition_ and builds the driver, while `default` arrives pre-built, and routing
  it through the service would make `ObjectQLPlugin`'s boot depend on an optional
  higher-layer service. Until that is designed, `degraded-boot-parity.test.ts` pins
  both paths to the same operator-visible contract (fail-fast by default, identical
  `OS_ALLOW_DRIVER_CONNECT_FAILURE` parsing, `DEGRADED BOOT` on stderr) so a change
  to one that forgets the other fails CI — #3741 → #3758 was exactly that miss, and
  it cost three months and a second bug report.

  **Migration.** Additive. `DatasourceSummary.status` gains a `'blocked'` member: a
  consumer exhaustively switching on it needs a case (the admin UI shows it as a
  distinct state). Nothing that was `'ok'` or `'error'` changes meaning; rows that
  were reported `'unvalidated'` now report their real state. Query-time errors for a
  datasource the connection layer recorded change from a generic `Error` to
  `DatasourceUnavailableError` (503 instead of the previous catch-all status);
  matching on the old `is not registered` text still works for the undeclared-name
  case, which is the only one that was ever accurate.

- cbedd62: fix(runtime,hono): close the remaining raw-driver-message exits on the HTTP boundary (#3867 follow-up)

  #3867 sanitised `dispatcher-plugin`'s `errorResponseBase`. That covers errors
  **thrown** out of `dispatch()` — but not the ones it **returns**. A
  `{handled: true, response}` result goes to `sendResult`, never through that
  catch, and those bodies are built by `HttpDispatcher.error()`, which passed the
  message through verbatim. Sweeping the boundary for the same defect class (the
  follow-up #3867 called for) turned up two more live exits:

  **`HttpDispatcher.error()`** — the single construction point for every returned
  error response. Reachable with a raw driver message today through
  `errorFromThrown` (`/meta` save, `/packages` install) and the MCP transport's
  `deps.error(err?.message, 500)`. Pinned by a test that drives
  `PUT /meta/:type/:name` with a throwing `protocol.saveMetaItem`: without the
  guard the response body is the driver's `insert into \`sys_team\` … UNIQUE
  constraint failed: sys_team.id`, naming a physical table and column.

  **`@objectstack/hono`'s auth-config route** — a 500 built from a caught
  error with `message: err.message`. The auth service reads from the database, so
  that message can carry a driver dump.

  Both apply the same `looksLikeInternalErrorLeak` predicate #3867 put in
  `@objectstack/types`, and both are scoped to **5xx** for the same reason: a 4xx
  message is a deliberate business/validation answer (`Path must be
/actions/:object/:action`, a hook's own `throw`, a `saveMetaItem` field error)
  and must reach the caller intact. Structured `details` — the semantic `code` and
  per-field `issues` the Studio maps back to inputs — is never touched, so a
  sanitised 500 still carries everything a client can act on.

  Diagnostics are unaffected: callers that threw still hand the original error to
  `errorReporter` via `__obsRecordedError`, and every 5xx is logged server-side.

  Audited in the same pass and deliberately left alone: the inline error bodies in
  the `ai` / `mcp` domains (static literal strings, no interpolated error text) and
  `plugin-hono-server`'s 403s (4xx, deliberate messages). With this change every
  dynamic message on both dispatcher exits and the REST data routes goes through
  one predicate.

- 1d4756e: fix(i18n)!: `/i18n/labels/:object/:locale` emits the entry shape it declares —
  and stops discarding `help`/`options` (#3847)

  `GetFieldLabelsResponseSchema` has always declared each label as an object:

  ```ts
  labels: z.record(
    z.string(),
    z.object({
      label: z.string(),
      help: z.string().optional(),
      options: z.record(z.string(), z.string()).optional(),
    })
  );
  ```

  Both serving surfaces emitted `Record<string, string>` — a bare label per field.
  A client typed against `GetFieldLabelsResponse` read `labels[field].label` and
  got `undefined`, because the value was the string itself. The SDK's type was
  right the whole time; the servers were wrong.

  The cost is not only the type mismatch. `FieldTranslationSchema` carries `help`
  and `options`, bundles populate them, and the endpoint threw them away. objectui
  needs exactly those — its `spec-translations.ts` transform reads `label` **and**
  `options` (as `fieldOptions.<obj>.<fld>.<value>`) — and gets them by pulling the
  whole bundle from `/i18n/translations/:locale` and resolving client-side. The
  per-object endpoint could not have served it even if it wanted to: the data was
  being dropped at the emit site.

  Fixed at that emit site, `resolveObjectFieldLabels`, which both surfaces already
  share as of #3833 — so one change covers both. `help` and `options` are attached
  only when non-empty: an `options: {}` would claim a field has translated options
  and hand back none, and a `help: ''` would erase a caller's source help text.
  Fields with no non-empty `label` are still omitted entirely, which is what lets
  `ResolvedFieldLabel.label` be a required string.

  **The response schema is unchanged** — this moves the implementation onto the
  contract, not the contract onto the implementation. Generated docs are
  byte-identical for that reason.

  `placeholder` is deliberately left out. `FieldTranslationSchema` has it and the
  response schema does not, so emitting it would be widening the contract rather
  than satisfying it — and adding an optional response field later is additive and
  non-breaking, whereas guessing now is not.

  The regression guard is the part worth keeping: a test that builds the response
  body from the shared helper and parses it with `GetFieldLabelsResponseSchema`.
  Nothing had ever put the emitted value and the declared contract in one
  assertion, which is precisely why a bare string could sit under an object schema
  unnoticed. Third and last of the declared ≠ enforced gaps on this endpoint
  family, after #3676 (request filters no server read) and #3833 (a derivation
  scanning a retired dialect).

  BREAKING: `labels[field]` is now `{ label, help?, options? }` rather than a
  string. No consumer in this repo or objectui read it — objectui never calls this
  route, and in-repo use is the SDK method plus URL-shape tests — so the practical
  blast radius is nil, and this is the cheap moment to align it.

- 720c5ad: fix(runtime,i18n): the dispatcher's field-labels route reads the bundle shape
  producers actually write — one shared derivation (#3833)

  `GET /i18n/labels/:object/:locale` served through the dispatcher returned
  `{ labels: {} }` for every provider. Its derivation scanned for flat
  `o.<object>.fields.<field>` keys:

  ```ts
  const prefix = `o.${objectName}.fields.`;
  for (const [key, value] of Object.entries(translations)) { … }
  ```

  That dialect was retired by #3778 — no producer has ever written it, and a real
  bundle's top-level keys are the `TranslationData` groups (`objects`, `apps`,
  `messages`, …), so the prefix could not match anything. 4cca74c fixed the
  identical derivation in `service-i18n` and did not reach the dispatcher's copy.

  This is not a rare fallback. `getFieldLabels` is optional on `II18nService` and
  **nothing implements it** — not `memory-i18n`, not `file-i18n-adapter` — so the
  dedicated-method branch both surfaces check first is dead in production and this
  derivation is the only path there is. Any stack served by the dispatcher (the
  AppPlugin in-memory provider auto-registered for stacks declaring translation
  bundles) got an empty map, indistinguishable from "this object has no translated
  labels": nothing errored, nothing warned.

  Worse than the class it was found next to. #3676, which prompted the check,
  ignored a declared filter and returned the full bundle — a correct superset. This
  returned nothing and said it was fine.

  The derivation now lives once, as `resolveObjectFieldLabels` in
  `packages/spec/src/system/i18n-resolver.ts`, alongside the other resolvers that
  read `TranslationData`. Both surfaces call it. Keeping a copy each is precisely
  how one got fixed and the other did not; the next bundle-shape change now has one
  place to land. Fields carrying no non-empty `label` stay omitted rather than
  emitted blank — partial translation is the normal state, and callers merge this
  map over their source labels, where a `''` would erase them.

  ### The tests were fiction on both sides

  The dispatcher's fallback test fed flat `o.contact.fields.first_name` keys and
  asserted labels came back, so it passed on data that cannot occur while
  production returned `{}` — the same failure mode as the client test retired in
  #3676, which asserted a query string was built that no server read. It now feeds
  the nested shape, and was confirmed to fail against the pre-fix code (`expected
{} to deeply equal { first_name: 'First Name', … }`) rather than merely passing
  after it. The shared helper carries its own unit tests, including one pinning
  that the retired flat dialect resolves to `{}`.

  The same suite's mock also declared a `getFieldLabels` no shipped provider has,
  and returned flat-dialect data from `getTranslations`; both now reflect what a
  real provider does, with the divergence noted where it remains deliberate.

  Not addressed here, filed separately: `GetFieldLabelsResponseSchema` declares
  `labels` as `Record<string, { label, help?, options? }>`, but both surfaces emit
  `Record<string, string>` — a third declared ≠ enforced gap in the same endpoint,
  and a wire-shape change too breaking to fold into a correctness fix.

- 41642b0: fix(runtime,i18n)!: `/i18n/locales` answers in one shape — plus the
  success-envelope conformance gate that found it

  Follow-up to #3676 / #3833 / #3847. Those three were each a body that did not
  match the schema declaring it, and each survived a green suite because **every
  test asserted the emitted body against a hand-written literal**. Comparing
  output to a literal proves the code does what the test author believed; it
  cannot prove the code does what the contract declares. Nothing had ever put the
  emitted value and the declared schema in the same assertion.

  This adds that assertion as a suite — `i18n-success-envelope.conformance.test.ts`
  in `runtime`, the missing success-path twin of service-i18n's
  `error-envelope.conformance.test.ts` and the same pairing storage got in #3689.
  Every `/i18n` success body is parsed against `BaseResponseSchema` and against
  the schema `plugin-rest-api` names for that route (`responseSchema:
'GetLocalesResponseSchema'`, …), imported rather than restated.

  **It found a fourth gap on its first run.** `GET /i18n/locales` passed
  `getLocales()`'s raw `string[]` straight through the dispatcher, while
  `GetLocalesResponseSchema` declares `{ code, label, isDefault }[]` — and
  service-i18n, the _other_ provider of this identical route, already emitted
  descriptors. One endpoint, two shapes, decided by which plugin mounted it, with
  the dispatcher's form contradicting the SDK's own `GetLocalesResponse` type.

  That is the same split #3833 found in the field-labels derivation, one route
  over, and it happened for the same reason: two surfaces, one mapping, kept
  twice. So the mapping is now shared as `toLocaleDescriptors` in
  `packages/spec/src/system/i18n-resolver.ts`, next to `resolveObjectFieldLabels`,
  and both surfaces call it. `label` is the locale code — no display-name source
  exists in the tree and the schema requires the field; inventing an ICU
  display-name table here would be a product decision, not an implementation
  detail.

  The gate was verified the same way #3833's was: the fix was reverted and the
  suite confirmed to fail on it —

  ```
  locales body does not match its declared schema:
    [{"expected":"object","code":"invalid_type","path":["locales",0],
      "message":"Invalid input: expected object, received string"}, …]
  ```

  — rather than merely passing once written. Five existing tests pinned the bare
  `string[]`; they now assert on `.map(l => l.code)`, so the codes stay pinned
  while the shape is owned by the schema.

  BREAKING: `GET /i18n/locales` served by the dispatcher now returns
  `[{ code, label, isDefault }]` instead of `['en', …]`. Callers on the
  service-i18n mount already received this shape, and the SDK's published
  `GetLocalesResponse` type has always described it, so this ends a divergence
  rather than starting one.

  Worth generalizing beyond `/i18n`: `plugin-rest-api.zod.ts` already carries a
  `responseSchema` name on essentially every route (29 declarations across 28
  handlers), so the route → declaring-schema mapping needed to run this check
  repo-wide exists today and is unused.

- 0045682: feat(auth)!: membership grade is not a capability channel — the `sys_member.role`
  vocabulary is closed (ADR-0108, #3723)

  `sys_member.role` answers "what is your standing in this organization". It does
  not answer "what may you do" — that is what positions are for. One column was
  answering both.

  `resolve-authz-context` projects EVERY value stored in `sys_member.role` into
  `current_user.positions`, alongside the rows read from `sys_user_position`. So a
  business role handed out through the membership role _was_ capability — granted
  with none of the position system's controls: no `granted_by`, no ADR-0091
  validity window, no BU-subtree check, no `assignablePermissionSets` allowlist.
  That is what ADR-0057 D4 ruled out ("feed the names to better-auth **only** so
  invitations are accepted — **never as the authority for RBAC**"), what
  ADR-0090 D3's word ban restates (distribution = `position`), and what
  ADR-0095 D3 keeps out of the enforcement path.

  The vocabulary is therefore closed to the four framework-owned names:
  `owner` / `admin` / `delegated_admin` / `member`.

  **BREAKING — `additionalOrgRoles` is removed** from `AuthManagerOptions` and
  `AuthPluginOptions`, together with `plugin-auth/src/org-roles.ts` in full
  (`collectStackOrgRoles`, `collectRegisteredOrgRoles`,
  `normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
  `withMembershipRoleOptions`, `membershipRoleLabel`, `orgRoleNames`,
  `MEMBERSHIP_ROLE_OBJECTS`, `OrgRoleDescriptor`, `OrgRoleInput`,
  `OrgRoleLogger`) and the `kernel:ready` derivation hook that fed them. From
  `@objectstack/spec`, `MEMBERSHIP_ROLE_NAME_PATTERN` and
  `MEMBERSHIP_ROLE_NAME_MIN_LENGTH` are removed — they existed only to validate
  app-supplied names. A TypeScript error is the intended failure: an option that
  is silently ignored is `declared ≠ enforced` one more time.

  FROM → TO:

  ```diff
  - new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })
  + new AuthPlugin({ /* nothing — declare `sales_rep` as a position */ })

  - POST /organization/invite-member { email, role: 'sales_rep' }
  + POST /organization/invite-member { email, role: 'member',
  +                                    businessUnitId, positions: ['sales_rep'] }
  ```

  For an existing member, assign the position through `sys_user_position` (the
  governed write path). Invitation placement (ADR-0105 D8) is the one-step
  admission flow: issuance is authorized against the issuer's `adminScope` by
  dry-running `DelegatedAdminGate`, and acceptance writes real
  `sys_user_position` rows with a `granted_by` stamp. It reaches **further** than
  what it replaces — a delegated admin may use it within their subtree, where the
  membership-role route was open to org admins only (the invitation role cap holds
  anyone below admin grade to plain `member`).

  An invitation naming an app role now fails at better-auth's door with
  `ROLE_NOT_FOUND`, before any row is written.

  This reverses two changesets that were never consumed into a release
  (`app-org-roles-storable`, `auth-org-roles-self-derived`), so no published
  version ever offered the behaviour; both are removed rather than shipped and
  retracted in the same changelog. A pre-existing deployment could only have
  stored a custom value by direct DB write.

  Also derived rather than transcribed: `@objectstack/lint`'s `MEMBERSHIP_TIERS`
  now reads `BUILTIN_MEMBERSHIP_ROLES` from `@objectstack/spec`. The hand-kept
  copy carried `guest`, which the `sys_member.role` select has never offered — an
  approver authored as `{ type: 'org_membership_level', value: 'guest' }`
  resolved to nobody and the lint whose whole job is to catch that stayed silent.

- 7180ed5: fix(security): fail closed when an object's security posture can't be resolved
  (#3545)

  #3545 accepted the API-exposure gate's fail-open on unresolvable metadata on one
  load-bearing premise: that gate is a SURFACE-AREA control, while the real
  authorization boundary — auth + the ObjectQL security middleware (CRUD/FLS/RLS)
  — enforces unconditionally on the data call whatever the gate answers.

  Verifying that premise rather than assuming it shows it did not hold. The
  middleware does run unconditionally, but two of its INPUTS were read from the
  same object metadata and defaulted permissively when it could not be resolved,
  so the very trigger the issue is about reached one layer PAST the gate, into the
  boundary itself: an unresolved `access.default` read as PUBLIC (so a plain `'*'`
  wildcard covered an object ADR-0066 D2 excludes from it) and an unresolved
  `requiredPermissions` read as NO CONTRACT (so the D3 capability AND-gate was
  skipped entirely).

  `getObjectSecurityMeta` now flags `unresolved`, and the three consumers that turn
  posture into an access decision fail closed on it: the middleware denies (with an
  error log, so a persistent metadata outage is observable rather than a silent
  blanket-allow), `canExport` denies, and `getReadableFields` exposes no columns —
  the same stance already taken for a permission-resolution failure and a dangling
  delegator. `computeLayeredRlsFilter` keeps consuming the defaults deliberately:
  there the permissive value WITHHOLDS the cross-tenant exemption, so it is already
  the closed direction.

  Blast radius is bounded to the risky case. System/boot writes (`isSystem`) and
  principal-less/anonymous contexts short-circuit earlier in the middleware, so
  reaching the new check means an authenticated principal with resolved grants
  asking for an object whose declaration is missing; the cold-start window is
  served by those short-circuits, not by the permissive default. The exposure
  gate's own tiered decision (transient unavailability → fail open) is therefore
  unchanged — it now rests on a boundary that actually holds.

  The explain engine reports the denial on its existing `object_crud` layer naming
  the real cause, so the "why am I denied?" surface cannot drift from enforcement.

- 083c414: fix(runtime): replace the polynomial-redos trailing-slash regex in the notifications domain with split+filter (CodeQL high, surfaced by #3507)

  The legacy `path.replace(/\/+$/, '')` in the notifications handler had
  carried a polynomial-backtracking regex over request-controlled input since
  ADR-0030; the domain extraction (#3507) made the line "changed code" and
  CodeQL flagged it. Same split+filter treatment the security domain already
  uses for the identical pattern. Redundant slashes in the sub-path now
  collapse (`//read//` → `read`), matching the security domain's semantics.

- 3d5f726: feat(rest): route audit tranche 2 — the REST surface gets its own ledger +
  conformance guard (#3587, follow-up to #3563)

  The dispatcher tranche closed its 27 gaps and guards them (#3569…#3579), but
  `@objectstack/rest` mounts a second, larger surface the client also reaches —
  89 routes, never audited. `rest-route-ledger.ts` now records a reviewed
  disposition for every one of them (38 sdk, 43 gap, 3 server-only, 3 public,
  2 mismatch), and the guard is real enumeration on both sources: RouteManager
  routes via the `getRoutes()` introspection seam, and the two
  RouteManager-bypassing registrars (`package-routes.ts`,
  `external-datasource-routes.ts`) via captured mock-server registrations — no
  pinned-by-hand list. The client half
  (`rest-route-ledger-coverage.test.ts`) verifies every claimed method exists;
  a 43-gap ratchet is wired into CI. Every guard direction was negative-tested.

  Notable dispositions the audit surfaced: `POST /api/v1/packages` is a
  publish/install shape collision between REST and the dispatcher (REST
  registers first and wins) — ledgered `mismatch`; the REST
  `GET /ui/view/:object/:type` path dialect is unreachable by the SDK's
  query-param dialect — ledgered `mismatch`; `service-storage` /
  `service-i18n` mount a third route surface outside `@objectstack/rest`,
  explicitly out of scope here and tracked under #3587.

  No behavior change — data + tests only, plus a scope-note refresh in the
  runtime ledger pointing at the new REST ledger.

- 70a1ce1: fix(automation): the resume gate follows `map:` too, and the route stops accepting engine-internal variables (#3853)

  Two holes in the #3801 resume gate, both demonstrated with a repro.

  **1. The chain walk missed `map:`.** `resumeInternal` handles the two linked-run
  correlations oppositely — a `subflow:` pause _delegates_ the signal to the child,
  a `map:` pause _re-runs_ the map node — and the gate followed only the first. So
  a run parked on a `map` node was judged on `map` itself (`resumeAuthority: 'any'`)
  and let through even while the item it was waiting on sat on an `approval`.

  `map` is the batch-approval shape, and the map parent's run id is the one a
  launcher holds. Since `$mapState.started` is advanced past the in-flight item
  before the suspend, an empty-body resume of the parent **skipped that item's
  approval outright**, orphaning its still-pending request; a later real decision
  then bubbled into a parent already waiting on the next item, cascading the
  misalignment.

  The walk now follows both prefixes: a linked-run pause is waiting on a CHILD, so
  the child's node carries the authority — the gate reads _the item, not the loop_.

  **2. Resume `inputs` could write the engine's `$` namespace.** They are applied
  as bare flow variables, so a caller could set the exact handoff keys the engine's
  map bubble uses (`<nodeId>.$mapItemDone` / `$mapItemOutput`) and have the map
  record a per-item result for a decision nobody made — the node id is readable
  from `GET /automation/:name`. The same reached `$runId`, which `approval` /
  `wait` nodes use to correlate external state back to a run.

  `POST /automation/:name/runs/:runId/resume` now answers **400** when `inputs`
  names anything in the engine namespace (`$…`, or a `.$` segment). Enforced at the
  transport, not in the engine, so the in-process bubble keeps working — the same
  trust split the gate itself uses.

  Nothing changes for author-declared variables: `{ new_assignee: 'ada' }` and
  dotted names like `collect.note` are unaffected. If you were driving a batch-
  approval `map` by resuming the map's own run id, resume the **item's** run
  through its owning service instead (e.g. `client.approvals.approve`) — the map
  advances itself when the item completes.

- 93f267f: fix(automation): one chokepoint for the resume signal — `output` reopened the hole `inputs` had just closed (#3879)

  #3853 guarded `signal.variables` at the route. That closed one of **two**
  equivalent paths into the same variable map and left the other open:
  `signal.output` keys are merged under `${run.nodeId}.${key}`, and for a run
  parked on a `map` node `run.nodeId` **is** the map node — so

  ```jsonc
  {
    "output": { "$mapItemDone": true, "$mapItemOutput": { "result": "FORGED" } }
  }
  ```

  writes exactly the `<mapNodeId>.$mapItemDone` the `inputs` guard had refused,
  making the map record a result for an item nobody decided. Demonstrated with a
  repro, then fixed.

  Scope: the #3853 map gate still held, so a batch whose pending item sits on an
  `approval` was refused before any of this — the **approval bypass stayed
  closed**. The residual was forging the recorded result of an item on an
  _ungated_ pause.

  Two escapes with one shape is a design signal, not two bugs, so the fix is
  structural rather than a third patch:

  - **`applyResumeSignal` is the one place a resume signal reaches the variable
    map.** Both fields are collected into a single write list (already in final,
    prefixed form), checked, then applied — a new signal field is covered by
    construction rather than by remembering.
  - **All-or-nothing**, and checked _before_ the suspension is consumed: a
    rejected signal applies nothing (not even legitimate keys sent alongside) and
    the run stays parked, so the real continuation still lands.
  - **The engine owns the rule; the transport maps the verdict.** `resume` returns
    `{ success: false, code: 'invalid_signal' }`; the route answers **400**. The
    SDK and any future adapter inherit it — implemented in one transport it
    protected exactly one transport, and one field of it.
  - Engine-built signals (the subflow output mapping, the map item handoff) are
    exempt via a module-private symbol. Deliberately _not_
    `RESUME_AUTHORITY_SERVICE`: that marker means "the owning service authorized
    this decision", and a service still has no business writing engine internals.

  `AutomationResult.code` gains `'invalid_signal'` alongside `'forbidden'` — a
  `switch` over it needs a new arm; a plain read does not.

  Nothing changes for authoring: ordinary variables pass, `$` mid-name (`price$`)
  and dotted names (`collect.note`) included. Only names the engine reserves —
  `$…` or a `.$` segment — are refused.

- 48d5a1c: Route ledger + conformance guard for the dispatcher↔client surface (#3563)

  #3528's root-cause class — a route that exists and works while
  `@objectstack/client` has no way to express it — now has an inventory and a
  ratchet. `route-ledger.ts` records the audited disposition of every dispatcher
  route (sdk / gap / server-only / public / dynamic / mismatch);
  The guard is split along the package boundary (a runtime→client edge is a
  build cycle): runtime's `route-ledger.conformance.test.ts` fails when a
  dispatcher domain lands with no ledger entry and ratchets the audited gap
  count (27 at PR-1); client's `route-ledger-coverage.test.ts` fails when a
  ledger entry claims a client method that doesn't exist. Findings and follow-up slicing live
  in `docs/audits/2026-07-dispatcher-client-route-coverage.md`. No runtime
  behavior change.

- 810a3a2: fix(runtime,cloud-connection): multi-tenant seed replay covers every source, not just the first (#3453)

  In multi-tenant deployments (enterprise `@objectstack/organizations`) a brand-new org
  gets its own private copy of demo data by replaying the kernel's `seed-datasets` list
  on the `sys_organization` insert. That list is meant to hold the union of every seed
  source — every config-declared app AND every marketplace package — but two framework
  traps (the same pair #3444 fixed for seed-summary) shrank it to just the first source:

  - The standard `PluginContext` exposes `getService`/`registerService` but has NO
    `.kernel` handle, so `(ctx as any).kernel?.getService('seed-datasets')` always read
    `undefined`. Each source then saw "nothing registered" and overwrote the list with
    only its own datasets instead of extending it.
  - `registerService` throws on a duplicate name, so the second source's re-register was
    swallowed by the surrounding try/catch — its datasets (and, for a config app, its
    replayer) silently lost.

  Net effect: with two config apps, or a config app plus marketplace packages, a new org
  replayed only the first app's seeds.

  The fix mirrors #3444's seed-summary hardening: `seed-datasets` is now a single shared
  array, registered once and mutated in place by every source through a new
  `mergeSeedDatasets` helper that reads via the context's own resolver first. AppPlugin's
  per-org replayer reads that live list at invoke time instead of a captured snapshot, so
  it replays the full union — including datasets merged after its closure was built — and
  the replayer itself is registered once and reused by later config apps.

  Covered by seam-level unit tests (accumulation across app + marketplace sources; the
  replayer reads the live union). True multi-tenant end-to-end coverage requires the
  enterprise `@objectstack/organizations` plugin, which lives in the cloud repo.

- 9981c1d: Surface seed outcomes in the `os dev` / `os serve` boot banner (#3415). Seeds run inside the boot-quiet stdout window and SeedLoader's logs sit under the default warn level, so a fixture could silently lose most of its rows — the showcase shipped 1 of 5 projects with zero terminal signal. AppPlugin now stashes the per-boot seed counters on the kernel (`seed-summary` service) and the banner prints `Seeds: X inserted · Y updated · Z skipped`, escalating to a yellow `⚠ … N REJECTED` line when records were dropped.
- d60968c: Surface marketplace rehydrate/heal seed outcomes in the `os dev` / `os serve` boot banner (#3430), extending the config-app Seeds line from #3415.

  The seed pipeline's most useful result lines are all `logger.info`, but `os dev` forwards a default `warn` level and the serve boot-quiet window swallows stdout — so "marketplace package rehydrated onto a fresh DB with 0 rows", a fresh-DB self-heal, and row-level seed failures were all invisible unless you queried the database directly.

  The `seed-summary` kernel service is now a per-source list. AppPlugin (config apps) and the marketplace rehydrate/heal path each contribute a labelled entry, and the banner prints one combined line that ignores the log level:

  ```
  Seeds:   showcase 162 rows · hotcrm(marketplace) 157 ok / 5 errors ⚠
  ```

  Fresh-DB heals are marked `(healed on fresh db)`; a marketplace package that installed with seed datasets but landed 0 rows, and any run that dropped records, escalate to a yellow `⚠` line instead of passing silently.

- e231abb: feat(objectql,metadata-protocol)!: single-source the protocol assembly; drop objectql's protocol re-exports — ADR-0076 Step 2 PR-C (#2462)

  The ONE assembly now lives in `@objectstack/metadata-protocol` as
  `assembleMetadataProtocol()` — `createMetadataProtocolPlugin()` (delegated
  mode, cloud) and `ObjectQLPlugin`'s built-in convenience mode
  (`registerProtocol !== false`, single-kernel/dev boots) both mount the same
  code path (~112 inline lines deleted from the engine plugin). objectql's six
  protocol re-exports (`ObjectStackProtocolImplementation`,
  `SysMetadataRepository`, `SeedLoaderService`, `runBuildProbes` + types) are
  removed — import them from `@objectstack/metadata-protocol` directly
  (breaking, shipped as minor per the launch-window convention; the only known
  importers were five test files, repointed). Scope note vs the original Step-2
  recipe: the objectql→metadata-protocol dependency is deliberately KEPT for
  the convenience mount — `@objectstack/objectql/core` was already
  protocol-free, and forcing 20 framework boot sites to mount two plugins buys
  no runtime win. "Zero protocol dependency" lands as "zero assembly ownership,
  single source".

- 83c161f: feat(automation)!: a flow run with no trigger user may no longer touch data (#3760)

  An effective `runAs:'user'` run that resolves **no trigger user** used to execute
  its data nodes **UNSCOPED** — it presented no principal, and the data security
  middleware skips when there is no principal, so the run read and wrote every row.
  `runAs:'user'` is an access-_narrowing_ declaration; failing to resolve it must
  never resolve to a grant (ADR-0049). It now **refuses** the operation
  (`UnscopedRunDataAccessError`), naming `runAs:'system'` as the fix.

  **This was never really about schedules.** The docs, the spec, the runtime
  warning and the lint all described a schedule-shaped problem, and the lint only
  ever matched that shape. But the runtime predicate is "no user", and the
  commonest way to have no user is a **record-change flow fired by a write that
  carried none**: `isSystem` does _not_ suppress trigger dispatch — only
  `skipTriggers` does, and exactly three first-party paths set it — so every
  plugin/service system write, the approvals status mirror, and a `runAs:'system'`
  flow's own data node dispatched record-change flows with `userId: undefined`.
  Ordinary users reach those writes routinely (submitting for approval mirrors a
  status onto the target record), so the fail-open was reachable by unprivileged
  input and was the common case, not the rare one.

  Deliberately **not** implemented as "inherit the triggering write's posture and
  run as `isSystem`". That reads like a relabel but is a privilege escalation: the
  security middleware's `isSystem` short-circuit fires _before_ its
  package-managed-row, system-row, audience-anchor and delegated-admin gates, all
  of which a principal-less context still has to clear. Such a run cannot write
  `sys_user_position` today; as `isSystem` it could. "Unscoped" was never
  equivalent to "system".

  **Breaking — how to migrate.** A flow that reacts to system writes and needs to
  act beyond one user's grants declares `runAs: 'system'`, making the elevation
  explicit and audit-attributable. Otherwise ensure the trigger supplies a user.
  Flows that touch no data are unaffected (`runAs` is moot), and the failure is
  isolated: the trigger already swallows flow errors, so the originating write
  still succeeds. The engine warns at run _setup_, before any node executes.

  **#3712's user-less provenance path is subsumed, not broken.** That fix let a
  run with no trigger user write its own approval-locked record by carrying a
  provenance-only ObjectQL context (the run id, nothing else). Such a run can no
  longer perform a data operation at all — presenting no principal is exactly what
  made the write unscoped — so it is refused before the lock is consulted. The
  capability survives via the explicit route: a schedule that must write records
  declares `runAs:'system'`, which the lock hook exempts on its own `isSystem`
  branch. The `flowRunId` exemption itself stays live and load-bearing for what
  #3703 built it for — a `runAs:'user'` run that _does_ have a user — where the
  exemption is still provenance rather than privilege.

  Also in this change:

  - **`flow-schedule-runas-unscoped` → `flow-runas-unscoped`, and it now fails the
    build.** It read as a gate and behaved as a comment — `os compile` documented
    that the flow lint "NEVER fails the build" — which is close to no net at all
    for the audience it protects, very often an AI generating flows in bulk. It now
    also covers the other provably user-less triggers (`time_relative`, `api`), per
    ADR-0073 D5. It still cannot cover `record_change`, which is undecidable at
    authoring time — that is exactly why the runtime refusal exists.
  - **Three seed writes stopped firing automation.** The seed loader's pass-2
    deferred-reference back-fill and both of `AppPlugin`'s basic-insert fallbacks
    inlined a bare `{ isSystem: true }` instead of the shared seed options, so they
    seeded with record-change automation live — the self-trigger vector
    `skipTriggers` exists to prevent, on the writes that skipped it.
  - **ADR-0073 amended.** Its severity rationale ("an unprivileged user cannot
    trigger a schedule, so there is no untrusted-input path") is falsified, and its
    rejection of fail-closed ("breaks legitimate scheduled CRUD — 2/3 example flows
    relied on the default") expired when those flows were fixed to declare
    `runAs:'system'`. Refusal is an interim posture, forward-compatible with the
    ADR's `automation` principal: when that lands, the refusal point becomes the
    place that resolves it.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [735f850]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [c7f4417]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [3c8cfd1]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [f92096b]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [984396b]
- Updated dependencies [d0fea33]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [1003125]
- Updated dependencies [6e62a93]
- Updated dependencies [ecda20c]
- Updated dependencies [6e62a93]
- Updated dependencies [fc968af]
- Updated dependencies [0bfdf46]
- Updated dependencies [3949a43]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [19e3e6e]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
- Updated dependencies [cf5e033]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [ce1f100]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [307e0fe]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [aff9e56]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [65ac468]
- Updated dependencies [ef5e72d]
- Updated dependencies [dac6a08]
- Updated dependencies [313d7be]
- Updated dependencies [5faeac6]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [e1fa8d5]
- Updated dependencies [402f534]
- Updated dependencies [0045682]
- Updated dependencies [7180ed5]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [4e9e184]
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
- Updated dependencies [db48ad5]
- Updated dependencies [8e08bc3]
- Updated dependencies [16adb3c]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [bbd902d]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [f1a8114]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [d318b24]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [4c5a584]
- Updated dependencies [0c302a7]
- Updated dependencies [5cfd4d5]
- Updated dependencies [bd68f08]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [647ec8b]
- Updated dependencies [7457a09]
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [c073b8c]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [a629074]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [54f479a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/objectql@17.0.0-rc.0
  - @objectstack/rest@17.0.0-rc.0
  - @objectstack/driver-sql@17.0.0-rc.0
  - @objectstack/plugin-auth@17.0.0-rc.0
  - @objectstack/plugin-security@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/metadata-protocol@17.0.0-rc.0
  - @objectstack/service-datasource@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0
  - @objectstack/service-i18n@17.0.0-rc.0
  - @objectstack/metadata@17.0.0-rc.0
  - @objectstack/metadata-core@17.0.0-rc.0
  - @objectstack/observability@17.0.0-rc.0
  - @objectstack/driver-memory@17.0.0-rc.0
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.0
  - @objectstack/service-cluster@17.0.0-rc.0

## 16.1.0

### Patch Changes

- 818e6a3: fix(server-timing): emit the per-request, admin-gated `Server-Timing` header on the standard server (`os serve`/`dev`) (#3361)

  The per-request `Server-Timing` path (#2408) — where an admin sends
  `X-OS-Debug-Timing: 1` (or `json`) and gets phase timings while an ordinary user
  gets nothing — never emitted on the shipped Hono server. The disclosure gate the
  Hono middleware opens is only ever flipped by the runtime dispatcher's
  `timedResolveExecutionContext`, but the data (`/api/v1/data/*`) and metadata
  (`/api/v1/meta/*`) routes on `os serve`/`dev` are served by `@objectstack/rest`'s
  `RestServer` (which shadows the Hono plugin's own CRUD), and its identity
  resolver never opened the gate. Only global mode (`OS_SERVER_TIMING=true`) — which
  discloses to _every_ caller, not just admins — worked.

  - **observability**: the disclosure predicate `isPerfDisclosurePrincipal(ec)` now
    lives here (the home of the gate), the single definition of "who may pull
    per-request timings" shared by every HTTP entry point. `@objectstack/runtime`
    re-exports it for back-compat.
  - **rest**: `RestServer.resolveExecCtx` opens the gate for an admin/service
    principal (via the carried `posture` rung), the REST-server analog of the
    dispatcher — this is the fix that makes `os serve`/`dev` emit.
  - **plugin-hono-server**: the standalone CRUD surface's self-contained
    `resolveCtx` opens the gate too (deriving the rung for the gate decision only,
    never writing it onto the enforcement context). Adds an e2e test that boots the
    Hono app and asserts an admin gets `Server-Timing` while a member/anon does not.

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/observability@16.1.0
  - @objectstack/rest@16.1.0
  - @objectstack/metadata@16.1.0
  - @objectstack/plugin-auth@16.1.0
  - @objectstack/plugin-security@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/metadata-core@16.1.0
  - @objectstack/objectql@16.1.0
  - @objectstack/driver-memory@16.1.0
  - @objectstack/driver-sql@16.1.0
  - @objectstack/driver-sqlite-wasm@16.1.0
  - @objectstack/service-cluster@16.1.0
  - @objectstack/service-datasource@16.1.0
  - @objectstack/service-i18n@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Major Changes

- 6c270a6: **BREAKING: remove the deprecated `ctx.session.tenantId` / `ctx.user.tenantId` alias from the hook & action authoring surface — converge on `organizationId` (#3290).**

  #3280 made `organizationId` the blessed developer-facing name for the caller's active org across the JS authoring surface and kept `tenantId` as a `@deprecated` alias carrying the identical value. That alias is now **removed** from the hook `ctx.session`, the action-body `ctx.session`, and the action-body `ctx.user`. Read the caller's active org under the single blessed name:

  ```diff
  - const org = ctx.session.tenantId;   // hook or action body
  + const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
  ```

  **FROM → TO migration** (in any `*.hook.ts` / `*.action.ts` body):

  - `ctx.session.tenantId` → `ctx.session.organizationId`
  - `ctx.user.tenantId` (action body) → `ctx.user.organizationId`

  The value is unchanged — `organizationId` is the same active-org id, matching the `organization_id` column and `current_user.organizationId` in RLS/sharing. `ctx.user` is `undefined` for system / unauthenticated writes, so read `ctx.session?.organizationId` when a hook or action must work regardless of a resolved user.

  What changed internally:

  - **`@objectstack/spec`** — `HookContextSchema.session` drops the `tenantId` field (only `organizationId` remains). A stray `tenantId` on a constructed session is now stripped by the schema.
  - **`@objectstack/objectql`** — the engine's `buildSession()` no longer emits `session.tenantId`; the audit-stamp plugin sources the `tenant_id` column from `session.organizationId`.
  - **`@objectstack/runtime`** — `buildActionSession()` and the REST action `ctx.user` no longer emit `tenantId`.
  - **`@objectstack/trigger-record-change`** — reads `session.organizationId` (was `session.tenantId`) when forwarding the writer's org to a `runAs:'user'` flow; behavior is identical.

  **Explicit non-goal (unchanged):** the generic **driver-layer** tenancy abstraction is _not_ touched — `ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope` / `TenancyConfig.tenantField`, and `ExecutionLog.tenantId`. That isolation column is configurable and legitimately carries an _environment_ id in database-per-tenant kernels; it is a distinct axis from the developer-facing org. The build-time `check:org-identifier` guard now also covers `packages/**` to keep reference bodies off the removed name.

### Minor Changes

- 2049b6a: feat(observability): admin-gated per-request `Server-Timing` via `X-OS-Debug-Timing` (#2408)

  Perf-tuning mode was previously global-only (`serverTiming` option /
  `OS_SERVER_TIMING`), which discloses internal phase durations — a mild
  backend-fingerprinting surface — to every caller. This adds the per-request
  gating path from the design so an operator can pull a single request's
  `Server-Timing` breakdown on a live environment without turning the header on
  for everyone.

  - **observability**: a request-scoped disclosure gate (`runWithPerfDisclosure`,
    `allowPerfDisclosure`, `isPerfDisclosureAllowed`, `PerfDisclosureGate`) kept
    separate from the pure `PerfTiming` collector and pinned to its own
    `Symbol.for` store so the middleware and dispatcher share it across module
    copies.
  - **plugin-hono-server**: the Server-Timing middleware is registered by default
    (unless `serverTiming: false`). It runs the collector when timing is global
    **or** the request sends `X-OS-Debug-Timing: 1`, and emits the header only
    when the gate is open. `OS_PERF_TIMING=1` now also enables global mode.
  - **runtime**: after resolving the execution context, the dispatcher opens the
    gate for admin/service/system principals, so ordinary callers never receive
    the header even if they send the debug header.

  Existing global-mode behavior is unchanged.

- 92f5f19: feat(runtime): sandbox budget is script CPU-time, not wall clock (ADR-0102 D1, #3295)

  The QuickJS sandbox now meters each hook/action invocation against how much
  **VM-active (CPU) time** the body burns, not wall clock. Idle host-await time and
  a nested hook's own execution (which runs host-side while the caller's VM is
  parked) are no longer charged to the caller — so a slow/loaded host or a deep
  nested-write chain can't trip the budget while a script is merely waiting (the
  root cause of the #3259 CI flake). A separate, generous **wall-clock ceiling**
  (default 30s, `max(ceiling, cpuBudget)`) remains as the backstop for a body stuck
  on a host call that never settles.

  What changes for consumers (behaviour, not API signatures):

  - **Meaning of the timeout knobs.** `body.timeoutMs`, the `hookTimeoutMs` /
    `actionTimeoutMs` runner options, and `OS_SANDBOX_HOOK_TIMEOUT_MS` /
    `OS_SANDBOX_ACTION_TIMEOUT_MS` keep their **names, defaults (250ms / 5000ms),
    and precedence** — but now bound CPU-time instead of wall-clock. In practice
    this only _loosens_ legitimate slow/nested work; a runaway synchronous script
    is still cut at the same budget.
  - **Error messages.** `exceeded timeout of Nms` → either `exceeded CPU budget of
Nms` (script burned its CPU budget) or `exceeded wall-clock ceiling of Nms
while awaiting host calls` (stuck on a never-settling host call). Update any
    code/tests matching the old string.

  New knobs (additive):

  - `QuickJSScriptRunner` option `wallCeilingMs` and env `OS_SANDBOX_WALL_CEILING_MS`
    — tune the wall ceiling (explicit option › env › 30s).
  - `resolveSandboxTimeoutMs` (`@objectstack/types`) gains a `'wallCeiling'` kind.

  Also fixes a latent init bug in the new accounting where the interrupt handler
  could fire during `installCtx` and corrupt ctx marshalling. The nested-write
  integration suites now run at the stock 250ms budget (previously forced to 10s),
  which is itself the regression guard for the nested-charging fix.

- 32899e6: feat(runtime): env-overridable sandbox hook/action timeout default (#3259)

  The QuickJS sandbox enforces a wall-clock deadline on every hook/action
  invocation (250ms hooks / 5000ms actions). Each invocation compiles a fresh
  WASM module, and a nested hook compiles ANOTHER one inside the parent's budget,
  so on a heavily loaded or slow host — an oversubscribed CI runner, constrained
  production hardware — that fixed VM-creation cost alone can trip the hook
  default even while the VM is still making progress. On CI this surfaced as an
  intermittent `hook '…' exceeded timeout of 250ms` flake on PRs that never
  touched the sandbox path.

  The per-invocation timeout DEFAULT is now resolvable from the environment via
  `resolveSandboxTimeoutMs` (`@objectstack/types`), which `QuickJSScriptRunner`
  consults, so an operator can raise the floor once, deployment-wide, instead of
  re-tuning every call site:

  - `OS_SANDBOX_HOOK_TIMEOUT_MS` — default hook budget (ms)
  - `OS_SANDBOX_ACTION_TIMEOUT_MS` — default action budget (ms)

  Precedence is unchanged: an explicit `hookTimeoutMs` / `actionTimeoutMs` passed
  to the runner still wins over the env var, and a body's own declared `timeoutMs`
  still wins over the resolved default (the smaller of the explicit values). Only
  a positive integer is honored; unset / empty / non-numeric / non-positive keeps
  the built-in 250ms / 5000ms defaults, so behaviour is byte-for-byte unchanged
  when the vars are absent — production is unaffected unless it opts in.

  CI's Test Core now sets `OS_SANDBOX_HOOK_TIMEOUT_MS=10000` so the shared-runner
  load flake can't recur; genuine hangs stay bounded by each test's own timeout.

### Patch Changes

- b39c65d: **Extend the blessed `organizationId` org name to the action-body surface (follow-up to #3280).** Hooks now teach `ctx.user.organizationId` / `ctx.session.organizationId` as the blessed name for the caller's active org; action bodies — the sibling authoring surface that shares the same sandbox runner — were left behind: the REST dispatch path exposed only `ctx.user.tenantId` (the deprecated name) and no `ctx.session` at all, and the MCP `run_action` path exposed neither.

  Both action-dispatch sites (`handleActions`, MCP `runAction`) now populate:

  - **`ctx.user.organizationId`** — the blessed name (matches the `organization_id` column and `current_user.organizationId` in RLS); `ctx.user.tenantId` is kept as a deprecated alias with the identical value on the REST path.
  - **`ctx.session`** (`{ userId, organizationId, tenantId, roles? }`) — mirrors the hook `ctx.session` shape, `undefined` for a context-less / self-invoked call.

  Action bodies execute trusted (the `ctx.engine` / `ctx.api` facade bypasses RLS/FLS), so a body that must scope by org has to read it from `ctx` — now under the same name a hook author uses. Additive and behavior-preserving; the objectstack-ui skill documents the action-body `ctx` and the `organizationId` read.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- d1d1c40: fix(runtime): honor a hook body's declared `timeoutMs` so nested cross-object writes aren't clamped to 250ms (#1867)

  Hook bodies run in the QuickJS sandbox with a default 250ms timeout. The runner
  folded that engine default straight into `Math.min(...)` when resolving the
  effective timeout, so it _always_ dominated for hooks: a body that declared a
  larger `timeoutMs` (the spec permits up to 30_000ms — `ScriptBody.timeoutMs`) to
  give a legitimate nested write — "when a child changes, update the parent" —
  room to settle was silently clamped back to 250ms and killed mid-flight. The
  declared knob was never enforced.

  The engine default is now a FALLBACK used only when no explicit timeout is
  supplied, not a hard ceiling. An explicit `body.timeoutMs` (and/or an enclosing
  hook/action timeout) is honored; when both are present the smaller wins. Bodies
  that declare nothing still get the 250ms hook / 5000ms action default, and a
  body may still LOWER its own timeout below the default.

  This clears the last reliability blocker for nested cross-object writes from
  hooks — the sandbox crash itself (`memory access out of bounds`) was already
  fixed by the deferred-promise host-call model — so header/rollup fields no
  longer need denormalized, hand-maintained workarounds.

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

- a2d6555: perf(runtime): drop asyncify — sandbox runs on the sync QuickJS variant (ADR-0102 D2, #3296)

  Phase 2 of #3275. The QuickJS sandbox switches from the asyncify build
  (`newAsyncContext`) to the already-installed sync release variant
  (`newQuickJSWASMModule().newContext()`), keeping one physically isolated WASM
  module per invocation (ADR-0102 D2/D4). Asyncify's only justification — suspending
  the WASM stack across a host call — disappeared with the #1867 deferred-promise +
  pump redesign, so nothing depended on it. Wins: smaller binary, faster
  compile/instantiate, faster per-instruction, and removal of an entire class of
  suspended-stack failure modes.

  Also fixes a latent resource leak surfaced by the stricter sync teardown: host
  `ctx.api` calls hand the VM a `vm.newPromise()` deferred that was never
  `dispose()`d (the newPromise contract requires it). The asyncify build tolerated
  the leak; the sync build's `JS_FreeRuntime` aborted (`Assertion failed:
list_empty`) when a context was torn down with a pending, never-settled host call
  (the timeout path). Deferreds are now tracked and disposed before context
  teardown.

  Memory: the sync `QuickJSWASMModule` has no `dispose()`; its WebAssembly instance

  - linear memory are GC-reclaimed when the reference is dropped. A new RSS soak
    test guards that per-invocation modules don't ratchet RSS.

- 3a6310c: perf(runtime): stop the sandbox pump loop from idle-spinning while awaiting a host call (#3233)

  The QuickJS hook/action runner drives a script's async continuations with a
  pump loop that, on every iteration, yielded via `setImmediate` and then drained
  the VM job queue. While the body was only _waiting_ on an in-flight host promise
  (a slow `ctx.api` read/write, or one call that settles after many event-loop
  turns), that queue was empty every iteration, so the loop woke ~200k times/sec
  doing nothing — a ~50,000-iteration burn for a 250ms wait.

  The yield is now adaptive: it stays on `setImmediate` (near-zero latency) while
  the script is making progress, and once a pump executes zero VM jobs it ramps up
  to a small capped `setTimeout` (≤8ms). Any executed job — a settled host call, a
  resumed continuation — resets it to the fast path, so sequential host calls and
  multi-turn work keep their low latency; only a genuinely idle wait backs off.
  Deadline enforcement and every existing pump-budget/timeout/transaction
  guarantee are unchanged.

- 515f11a: fix(seed): replaying seeds no longer corrupts lookup natural keys on the upsert update path

  Every dev-server restart replayed package seeds in upsert mode, and any record whose
  lookup/master_detail was authored as a natural key could have that reference overwritten
  with NULL on the update path (`NOT NULL constraint failed` on required columns; silent
  link loss on nullable ones). Four fixes:

  - An unresolved reference now leaves the column untouched (deferred to pass 2) or drops
    the record loudly — it is never written as NULL over an existing row.
  - DB-side reference resolution probes the target dataset's declared `externalId` (e.g.
    `email`) before falling back to `name` and `id`, matching how in-memory resolution
    already keyed records.
  - A rejected update (e.g. a `state_machine` rule vetoing the replay) no longer severs
    natural-key resolution for downstream child datasets.
  - Replays are idempotent: an upsert/update whose declared fields already match the
    existing row is skipped instead of rewritten (no more `updated_at` churn or lifecycle
    re-validation on every boot).

- 4174a07: feat(runtime): seed-replayer reports `skipped` so hosts can stamp seed-once on progress

  The `seed-replayer` kernel service returned `{ inserted, updated, errors }` but
  not `skipped`. A cloud host therefore could not tell an **all-skip replay**
  (the env's seed data is already present — a no-op) apart from the
  zero-summary early-returns that never ran the loader (no organization, no
  metadata service, no datasets). Both looked like `inserted = updated = 0`, so
  the host could not safely stamp its seed-once record for the all-skip case and
  re-ran the full remote replay on every cold boot.

  Add `skipped: result.summary.totalSkipped` to the replayer's return; the
  early-returns report `skipped: 0`. This lets a host (cloud#853's
  `decideSeedStamp`) stamp on progress — including an all-skip replay — while
  still declining to stamp a genuine no-loader zero-summary. Additive and
  backward compatible; existing consumers ignore the new field.

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [deb7e7e]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [47d923c]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [7125007]
- Updated dependencies [616e839]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
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
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/plugin-security@16.0.0
  - @objectstack/objectql@16.0.0
  - @objectstack/rest@16.0.0
  - @objectstack/plugin-auth@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0
  - @objectstack/metadata@16.0.0
  - @objectstack/driver-sql@16.0.0
  - @objectstack/metadata-core@16.0.0
  - @objectstack/types@16.0.0
  - @objectstack/observability@16.0.0
  - @objectstack/driver-memory@16.0.0
  - @objectstack/driver-sqlite-wasm@16.0.0
  - @objectstack/service-cluster@16.0.0
  - @objectstack/service-datasource@16.0.0
  - @objectstack/service-i18n@16.0.0

## 16.0.0-rc.1

### Patch Changes

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [674457a]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/rest@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/plugin-security@16.0.0-rc.1
  - @objectstack/metadata-core@16.0.0-rc.1
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/metadata@16.0.0-rc.1
  - @objectstack/observability@16.0.0-rc.1
  - @objectstack/driver-memory@16.0.0-rc.1
  - @objectstack/driver-sql@16.0.0-rc.1
  - @objectstack/driver-sqlite-wasm@16.0.0-rc.1
  - @objectstack/plugin-auth@16.0.0-rc.1
  - @objectstack/service-cluster@16.0.0-rc.1
  - @objectstack/service-datasource@16.0.0-rc.1
  - @objectstack/service-i18n@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Major Changes

- 6c270a6: **BREAKING: remove the deprecated `ctx.session.tenantId` / `ctx.user.tenantId` alias from the hook & action authoring surface — converge on `organizationId` (#3290).**

  #3280 made `organizationId` the blessed developer-facing name for the caller's active org across the JS authoring surface and kept `tenantId` as a `@deprecated` alias carrying the identical value. That alias is now **removed** from the hook `ctx.session`, the action-body `ctx.session`, and the action-body `ctx.user`. Read the caller's active org under the single blessed name:

  ```diff
  - const org = ctx.session.tenantId;   // hook or action body
  + const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
  ```

  **FROM → TO migration** (in any `*.hook.ts` / `*.action.ts` body):

  - `ctx.session.tenantId` → `ctx.session.organizationId`
  - `ctx.user.tenantId` (action body) → `ctx.user.organizationId`

  The value is unchanged — `organizationId` is the same active-org id, matching the `organization_id` column and `current_user.organizationId` in RLS/sharing. `ctx.user` is `undefined` for system / unauthenticated writes, so read `ctx.session?.organizationId` when a hook or action must work regardless of a resolved user.

  What changed internally:

  - **`@objectstack/spec`** — `HookContextSchema.session` drops the `tenantId` field (only `organizationId` remains). A stray `tenantId` on a constructed session is now stripped by the schema.
  - **`@objectstack/objectql`** — the engine's `buildSession()` no longer emits `session.tenantId`; the audit-stamp plugin sources the `tenant_id` column from `session.organizationId`.
  - **`@objectstack/runtime`** — `buildActionSession()` and the REST action `ctx.user` no longer emit `tenantId`.
  - **`@objectstack/trigger-record-change`** — reads `session.organizationId` (was `session.tenantId`) when forwarding the writer's org to a `runAs:'user'` flow; behavior is identical.

  **Explicit non-goal (unchanged):** the generic **driver-layer** tenancy abstraction is _not_ touched — `ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope` / `TenancyConfig.tenantField`, and `ExecutionLog.tenantId`. That isolation column is configurable and legitimately carries an _environment_ id in database-per-tenant kernels; it is a distinct axis from the developer-facing org. The build-time `check:org-identifier` guard now also covers `packages/**` to keep reference bodies off the removed name.

### Minor Changes

- 2049b6a: feat(observability): admin-gated per-request `Server-Timing` via `X-OS-Debug-Timing` (#2408)

  Perf-tuning mode was previously global-only (`serverTiming` option /
  `OS_SERVER_TIMING`), which discloses internal phase durations — a mild
  backend-fingerprinting surface — to every caller. This adds the per-request
  gating path from the design so an operator can pull a single request's
  `Server-Timing` breakdown on a live environment without turning the header on
  for everyone.

  - **observability**: a request-scoped disclosure gate (`runWithPerfDisclosure`,
    `allowPerfDisclosure`, `isPerfDisclosureAllowed`, `PerfDisclosureGate`) kept
    separate from the pure `PerfTiming` collector and pinned to its own
    `Symbol.for` store so the middleware and dispatcher share it across module
    copies.
  - **plugin-hono-server**: the Server-Timing middleware is registered by default
    (unless `serverTiming: false`). It runs the collector when timing is global
    **or** the request sends `X-OS-Debug-Timing: 1`, and emits the header only
    when the gate is open. `OS_PERF_TIMING=1` now also enables global mode.
  - **runtime**: after resolving the execution context, the dispatcher opens the
    gate for admin/service/system principals, so ordinary callers never receive
    the header even if they send the debug header.

  Existing global-mode behavior is unchanged.

- 92f5f19: feat(runtime): sandbox budget is script CPU-time, not wall clock (ADR-0102 D1, #3295)

  The QuickJS sandbox now meters each hook/action invocation against how much
  **VM-active (CPU) time** the body burns, not wall clock. Idle host-await time and
  a nested hook's own execution (which runs host-side while the caller's VM is
  parked) are no longer charged to the caller — so a slow/loaded host or a deep
  nested-write chain can't trip the budget while a script is merely waiting (the
  root cause of the #3259 CI flake). A separate, generous **wall-clock ceiling**
  (default 30s, `max(ceiling, cpuBudget)`) remains as the backstop for a body stuck
  on a host call that never settles.

  What changes for consumers (behaviour, not API signatures):

  - **Meaning of the timeout knobs.** `body.timeoutMs`, the `hookTimeoutMs` /
    `actionTimeoutMs` runner options, and `OS_SANDBOX_HOOK_TIMEOUT_MS` /
    `OS_SANDBOX_ACTION_TIMEOUT_MS` keep their **names, defaults (250ms / 5000ms),
    and precedence** — but now bound CPU-time instead of wall-clock. In practice
    this only _loosens_ legitimate slow/nested work; a runaway synchronous script
    is still cut at the same budget.
  - **Error messages.** `exceeded timeout of Nms` → either `exceeded CPU budget of
Nms` (script burned its CPU budget) or `exceeded wall-clock ceiling of Nms
while awaiting host calls` (stuck on a never-settling host call). Update any
    code/tests matching the old string.

  New knobs (additive):

  - `QuickJSScriptRunner` option `wallCeilingMs` and env `OS_SANDBOX_WALL_CEILING_MS`
    — tune the wall ceiling (explicit option › env › 30s).
  - `resolveSandboxTimeoutMs` (`@objectstack/types`) gains a `'wallCeiling'` kind.

  Also fixes a latent init bug in the new accounting where the interrupt handler
  could fire during `installCtx` and corrupt ctx marshalling. The nested-write
  integration suites now run at the stock 250ms budget (previously forced to 10s),
  which is itself the regression guard for the nested-charging fix.

- 32899e6: feat(runtime): env-overridable sandbox hook/action timeout default (#3259)

  The QuickJS sandbox enforces a wall-clock deadline on every hook/action
  invocation (250ms hooks / 5000ms actions). Each invocation compiles a fresh
  WASM module, and a nested hook compiles ANOTHER one inside the parent's budget,
  so on a heavily loaded or slow host — an oversubscribed CI runner, constrained
  production hardware — that fixed VM-creation cost alone can trip the hook
  default even while the VM is still making progress. On CI this surfaced as an
  intermittent `hook '…' exceeded timeout of 250ms` flake on PRs that never
  touched the sandbox path.

  The per-invocation timeout DEFAULT is now resolvable from the environment via
  `resolveSandboxTimeoutMs` (`@objectstack/types`), which `QuickJSScriptRunner`
  consults, so an operator can raise the floor once, deployment-wide, instead of
  re-tuning every call site:

  - `OS_SANDBOX_HOOK_TIMEOUT_MS` — default hook budget (ms)
  - `OS_SANDBOX_ACTION_TIMEOUT_MS` — default action budget (ms)

  Precedence is unchanged: an explicit `hookTimeoutMs` / `actionTimeoutMs` passed
  to the runner still wins over the env var, and a body's own declared `timeoutMs`
  still wins over the resolved default (the smaller of the explicit values). Only
  a positive integer is honored; unset / empty / non-numeric / non-positive keeps
  the built-in 250ms / 5000ms defaults, so behaviour is byte-for-byte unchanged
  when the vars are absent — production is unaffected unless it opts in.

  CI's Test Core now sets `OS_SANDBOX_HOOK_TIMEOUT_MS=10000` so the shared-runner
  load flake can't recur; genuine hangs stay bounded by each test's own timeout.

### Patch Changes

- b39c65d: **Extend the blessed `organizationId` org name to the action-body surface (follow-up to #3280).** Hooks now teach `ctx.user.organizationId` / `ctx.session.organizationId` as the blessed name for the caller's active org; action bodies — the sibling authoring surface that shares the same sandbox runner — were left behind: the REST dispatch path exposed only `ctx.user.tenantId` (the deprecated name) and no `ctx.session` at all, and the MCP `run_action` path exposed neither.

  Both action-dispatch sites (`handleActions`, MCP `runAction`) now populate:

  - **`ctx.user.organizationId`** — the blessed name (matches the `organization_id` column and `current_user.organizationId` in RLS); `ctx.user.tenantId` is kept as a deprecated alias with the identical value on the REST path.
  - **`ctx.session`** (`{ userId, organizationId, tenantId, roles? }`) — mirrors the hook `ctx.session` shape, `undefined` for a context-less / self-invoked call.

  Action bodies execute trusted (the `ctx.engine` / `ctx.api` facade bypasses RLS/FLS), so a body that must scope by org has to read it from `ctx` — now under the same name a hook author uses. Additive and behavior-preserving; the objectstack-ui skill documents the action-body `ctx` and the `organizationId` read.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- d1d1c40: fix(runtime): honor a hook body's declared `timeoutMs` so nested cross-object writes aren't clamped to 250ms (#1867)

  Hook bodies run in the QuickJS sandbox with a default 250ms timeout. The runner
  folded that engine default straight into `Math.min(...)` when resolving the
  effective timeout, so it _always_ dominated for hooks: a body that declared a
  larger `timeoutMs` (the spec permits up to 30_000ms — `ScriptBody.timeoutMs`) to
  give a legitimate nested write — "when a child changes, update the parent" —
  room to settle was silently clamped back to 250ms and killed mid-flight. The
  declared knob was never enforced.

  The engine default is now a FALLBACK used only when no explicit timeout is
  supplied, not a hard ceiling. An explicit `body.timeoutMs` (and/or an enclosing
  hook/action timeout) is honored; when both are present the smaller wins. Bodies
  that declare nothing still get the 250ms hook / 5000ms action default, and a
  body may still LOWER its own timeout below the default.

  This clears the last reliability blocker for nested cross-object writes from
  hooks — the sandbox crash itself (`memory access out of bounds`) was already
  fixed by the deferred-promise host-call model — so header/rollup fields no
  longer need denormalized, hand-maintained workarounds.

- a2d6555: perf(runtime): drop asyncify — sandbox runs on the sync QuickJS variant (ADR-0102 D2, #3296)

  Phase 2 of #3275. The QuickJS sandbox switches from the asyncify build
  (`newAsyncContext`) to the already-installed sync release variant
  (`newQuickJSWASMModule().newContext()`), keeping one physically isolated WASM
  module per invocation (ADR-0102 D2/D4). Asyncify's only justification — suspending
  the WASM stack across a host call — disappeared with the #1867 deferred-promise +
  pump redesign, so nothing depended on it. Wins: smaller binary, faster
  compile/instantiate, faster per-instruction, and removal of an entire class of
  suspended-stack failure modes.

  Also fixes a latent resource leak surfaced by the stricter sync teardown: host
  `ctx.api` calls hand the VM a `vm.newPromise()` deferred that was never
  `dispose()`d (the newPromise contract requires it). The asyncify build tolerated
  the leak; the sync build's `JS_FreeRuntime` aborted (`Assertion failed:
list_empty`) when a context was torn down with a pending, never-settled host call
  (the timeout path). Deferreds are now tracked and disposed before context
  teardown.

  Memory: the sync `QuickJSWASMModule` has no `dispose()`; its WebAssembly instance

  - linear memory are GC-reclaimed when the reference is dropped. A new RSS soak
    test guards that per-invocation modules don't ratchet RSS.

- 3a6310c: perf(runtime): stop the sandbox pump loop from idle-spinning while awaiting a host call (#3233)

  The QuickJS hook/action runner drives a script's async continuations with a
  pump loop that, on every iteration, yielded via `setImmediate` and then drained
  the VM job queue. While the body was only _waiting_ on an in-flight host promise
  (a slow `ctx.api` read/write, or one call that settles after many event-loop
  turns), that queue was empty every iteration, so the loop woke ~200k times/sec
  doing nothing — a ~50,000-iteration burn for a 250ms wait.

  The yield is now adaptive: it stays on `setImmediate` (near-zero latency) while
  the script is making progress, and once a pump executes zero VM jobs it ramps up
  to a small capped `setTimeout` (≤8ms). Any executed job — a settled host call, a
  resumed continuation — resets it to the fast path, so sequential host calls and
  multi-turn work keep their low latency; only a genuinely idle wait backs off.
  Deadline enforcement and every existing pump-budget/timeout/transaction
  guarantee are unchanged.

- 515f11a: fix(seed): replaying seeds no longer corrupts lookup natural keys on the upsert update path

  Every dev-server restart replayed package seeds in upsert mode, and any record whose
  lookup/master_detail was authored as a natural key could have that reference overwritten
  with NULL on the update path (`NOT NULL constraint failed` on required columns; silent
  link loss on nullable ones). Four fixes:

  - An unresolved reference now leaves the column untouched (deferred to pass 2) or drops
    the record loudly — it is never written as NULL over an existing row.
  - DB-side reference resolution probes the target dataset's declared `externalId` (e.g.
    `email`) before falling back to `name` and `id`, matching how in-memory resolution
    already keyed records.
  - A rejected update (e.g. a `state_machine` rule vetoing the replay) no longer severs
    natural-key resolution for downstream child datasets.
  - Replays are idempotent: an upsert/update whose declared fields already match the
    existing row is skipped instead of rewritten (no more `updated_at` churn or lifecycle
    re-validation on every boot).

- 4174a07: feat(runtime): seed-replayer reports `skipped` so hosts can stamp seed-once on progress

  The `seed-replayer` kernel service returned `{ inserted, updated, errors }` but
  not `skipped`. A cloud host therefore could not tell an **all-skip replay**
  (the env's seed data is already present — a no-op) apart from the
  zero-summary early-returns that never ran the loader (no organization, no
  metadata service, no datasets). Both looked like `inserted = updated = 0`, so
  the host could not safely stamp its seed-once record for the all-skip case and
  re-ran the full remote replay on every cold boot.

  Add `skipped: result.summary.totalSkipped` to the replayer's return; the
  early-returns report `skipped: 0`. This lets a host (cloud#853's
  `decideSeedStamp`) stamp on progress — including an all-skip replay — while
  still declining to stamp a genuine no-loader zero-summary. Additive and
  backward compatible; existing consumers ignore the new field.

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- Updated dependencies [f972574]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [deb7e7e]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [47d923c]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [616e839]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
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
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/plugin-security@16.0.0-rc.0
  - @objectstack/objectql@16.0.0-rc.0
  - @objectstack/rest@16.0.0-rc.0
  - @objectstack/plugin-auth@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0
  - @objectstack/metadata@16.0.0-rc.0
  - @objectstack/driver-sql@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/observability@16.0.0-rc.0
  - @objectstack/metadata-core@16.0.0-rc.0
  - @objectstack/driver-memory@16.0.0-rc.0
  - @objectstack/driver-sqlite-wasm@16.0.0-rc.0
  - @objectstack/service-cluster@16.0.0-rc.0
  - @objectstack/service-datasource@16.0.0-rc.0
  - @objectstack/service-i18n@16.0.0-rc.0

## 15.1.1

### Patch Changes

- Updated dependencies [9dbb883]
- Updated dependencies [01ba3b3]
  - @objectstack/plugin-auth@15.1.1
  - @objectstack/spec@15.1.1
  - @objectstack/core@15.1.1
  - @objectstack/types@15.1.1
  - @objectstack/metadata@15.1.1
  - @objectstack/metadata-core@15.1.1
  - @objectstack/objectql@15.1.1
  - @objectstack/observability@15.1.1
  - @objectstack/formula@15.1.1
  - @objectstack/rest@15.1.1
  - @objectstack/driver-memory@15.1.1
  - @objectstack/driver-sql@15.1.1
  - @objectstack/driver-sqlite-wasm@15.1.1
  - @objectstack/plugin-security@15.1.1
  - @objectstack/service-cluster@15.1.1
  - @objectstack/service-datasource@15.1.1
  - @objectstack/service-i18n@15.1.1

## 15.1.0

### Minor Changes

- f531a26: feat(discovery): honest capabilities — standardized stub/fallback marker + realtime route honesty (ADR-0076 D12/A1.5 framework slice, #2462)

  **Spec** — new service self-description marker for honest discovery
  (ADR-0076 D12): `SERVICE_SELF_INFO_KEY` (`__serviceInfo`),
  `ServiceSelfInfoSchema` / `ServiceSelfInfo`, and `readServiceSelfInfo()`,
  which also normalizes plugin-dev's legacy `_dev: true` flag to
  `{ status: 'stub', handlerReady: false }`. A registered service that is a
  stub / dev fake / degraded fallback self-identifies via this marker; a fully
  real service carries no marker.

  **Runtime + metadata-protocol** — both discovery builders
  (`HttpDispatcher.getDiscoveryInfo` and the protocol shim's `getDiscovery`)
  now honor the marker instead of hardcoding `status: 'available',
handlerReady: true` for every registered service. Dev stubs report `stub`,
  the ObjectQL analytics fallback reports `degraded` (it keeps serving — no
  `/analytics` 404), and consumers can finally trust
  `status === 'available'` / `handlerReady === true`.

  **Realtime honesty fix** — discovery no longer advertises a
  `/realtime` route or `websockets: true`: `service-realtime` is an
  in-process pub/sub bus, no dispatcher branch or plugin mounts any
  `/realtime` HTTP surface, so the advertised route always 404'd. The
  registered service now reports `status: 'degraded', handlerReady: false`
  with no route (clients using the SDK are unaffected — it falls back to the
  conventional path, which behaves exactly as before). Also corrects the
  advertised realtime provider from the nonexistent `plugin-realtime` to
  `service-realtime`.

  **REST (A1.5)** — the REST layer's protocol dependency is narrowed from the
  `ObjectStackProtocol` god-union to the new `RestProtocol =
DataProtocol & MetadataProtocol` slice (exported from
  `@objectstack/rest`), per the ADR-0076 D9 incremental narrowing guidance.
  Type-level only; no runtime change.

- f531a26: feat(protocol): complete ADR-0087 — load-seam handshake, chain backfill 12–15, release artifacts (#2643)

  Closes the remaining ADR-0087 gaps (see the ADR's as-built Addendum):

  - **P0 load seams (D1).** The protocol handshake now runs on the boot-time
    durable-package rehydration path (`@objectstack/service-package` refuses an
    incompatible `sys_packages` row with the structured `OS_PROTOCOL_INCOMPATIBLE`
    diagnostic and keeps booting) and on `AppPlugin` for code-defined stacks
    (fail-fast before the manifest is decomposed). `objectstack lint` gains
    `protocol/missing-engines-range` (warning + fix-it) and the
    `create-objectstack` blank template stamps `engines: { protocol: '^<major>' }`
    (re-stamped at version time by `scripts/sync-template-versions.mjs`) — the
    two ends of the grandfathering ratchet.
  - **Chain backfill (D2/D3).** `MetadataConversion.retiredFromLoadPath`
    implements the load-window's second half (retired entries replay only via
    `migrate meta` / fixture CI). Steps 12–15 land: the `api.requireAuth` flip
    (semantic), the ADR-0090 wave (3 retired conversions + 5 semantic TODOs), the
    `BookAudience` rename (retired conversion), and the ADR-0089 visibility
    unification (`visibleOn`/`visibility` → `visibleWhen` as LIVE load-window
    conversions) + the `.strict()` flip (semantic). The protocol-11
    `compactLayout` → `highlightFields` rename is backfilled as a retired step-11
    conversion. `migrate meta --from 10` now reaches protocol 15.
  - **Release artifacts (D4).** `spec-changes.json` is generated from the
    registries (`gen:spec-changes`, CI drift-checked), ships in the npm artifact
    together with `api-surface.json`, and is attached to each `@objectstack/spec`
    GitHub Release with `added[]`/`removed[]` filled from the api-surface diff
    against the previously published release. The upgrade guide
    (`docs/protocol-upgrade-guide.md`) is generated from the same registries and
    CI drift-checked — a projection that cannot drift.

- f531a26: fix(security): enforce the anonymous-deny posture uniformly across HTTP surfaces (#2567)

  The ADR-0056 D2 `requireAuth` flip made REST `/data/*` deny-anonymous by
  default, but three sibling surfaces reached ObjectQL without passing through the
  gate — so the platform's anonymous posture was **inconsistent by surface**: an
  anonymous caller denied on `/data` could read the same object data through a
  different door. This closes the remaining two gaps (the `/meta` gate had already
  landed) and pins every surface with a conformance row.

  - **Dispatcher GraphQL** (`runtime/http-dispatcher.ts`, `dispatcher-plugin.ts`):
    `POST /graphql` reached `kernel.graphql`, whose security middleware falls
    **open** for an anonymous context. `handleGraphQL` now applies the same
    `requireAuth` gate as `/data` and `/meta`, resolving identity for the direct
    route that does not flow through `dispatch()`. The dispatcher's `requireAuth`
    default is aligned with the REST plugin's (`?? true`) so a bare host no longer
    denies anonymous `/data` while serving the same rows over `/graphql`; an
    explicit `requireAuth: false` opt-out is honoured and logs a boot warning.

  - **Raw-hono standard `/data` routes** (`plugin-hono-server/hono-plugin.ts`):
    these delegate straight to ObjectQL and were only _shadowed_ when the REST
    plugin registered the same paths first — so secure-by-default depended on
    plugin registration order. Each route now consults `requireAuth` (secure by
    default, mirroring `rest-server.ts`), making the deny decision a property of
    this entry point too. Order no longer affects the anonymous posture.

  **Behaviour change:** on a `requireAuth` deployment (the secure default),
  anonymous `POST /graphql` and anonymous raw-hono `/data` now return 401.
  Deployments that intentionally serve these surfaces publicly set
  `requireAuth: false` (a boot warning is logged). Proven end-to-end on the
  platform default in `showcase-anonymous-deny-surfaces.dogfood.test.ts`, with
  handler-level regression coverage in `http-dispatcher.requireauth.test.ts` and
  `hono-anonymous-deny.test.ts`, and pinned by three new authz-conformance rows.

- f531a26: feat(mcp): `aggregate_records` tool — GROUP BY aggregation over the engine read path

  New MCP tool `aggregate_records` (count/sum/avg/min/max/count_distinct, optional
  groupBy incl. date bucketing, where filter, IANA timezone) in the `data:read`
  family. Execution routes through the ObjectQL ENGINE (`callData('aggregate')`
  deliberately never uses the raw per-env driver), so RLS/tenant scoping and the
  D10 delegator intersection apply exactly as on find.

  Security hardening shipped with it:

  - plugin-security: new FLS aggregate-INPUT gate — result masking never runs for
    `aggregate` (output rows carry only aliases), so any groupBy / aggregation
    reference to an FLS-unreadable field is now rejected fail-closed with the
    offending field names (mirrors the FLS write gate).
  - runtime: `aggregate` maps to the `list` ApiMethod in the object exposure gate
    (an object whose `apiMethods` whitelist excludes `list` cannot leak row
    statistics through GROUP BY), and the aggregate action requires at least one
    aggregation (the engine's in-memory path would otherwise degrade to raw rows
    that the FLS masker does not cover).

  The bridge seam is optional: a runtime that does not implement
  `McpDataBridge.aggregate` simply does not register the tool (graceful
  degradation, same contract as the action tools).

### Patch Changes

- f531a26: refactor(security): migrate the handleSecurity admin gate to shouldDenyAnonymous (#2567 follow-up)

  The dispatcher's `/security/suggested-bindings` admin surface was the last HTTP
  seam still hand-rolling the `!userId && !isSystem → 401` check. It now delegates
  to the shared `shouldDenyAnonymous` decision like every other seam — with
  `requireAuth: true` hardcoded, preserving its UNCONDITIONAL semantics (an admin
  surface denies anonymous callers even on a `requireAuth: false` demo deployment).
  The 401 body adopts the shared shape (`code: 'unauthenticated'`).

  Deliberately NOT migrated: `handleNotification`'s `!userId` check — that is a
  "needs a user identity" predicate (the inbox is keyed by userId; a system
  context has no inbox), not an anonymous-posture decision; migrating it would
  change semantics.

- f531a26: refactor(security): converge the anonymous-deny decision into one shared function + a source-enumerating ratchet (#2567 Phase 2)

  Phase 1 gated every HTTP surface (REST `/data`, dispatcher `/graphql` + `/meta`,
  raw-hono `/data`) against the secure-by-default `requireAuth` posture, but each
  seam hand-rolled the same `!userId && !isSystem → 401` check. Phase 2 removes
  that duplication and pins the surfaces so a new ungated entry point fails CI.

  - **New `shouldDenyAnonymous` in `@objectstack/core`** (`security/anonymous-deny.ts`)
    — the single anonymous-deny decision + shared 401 body/constants, mirroring the
    `auth-gate.ts` pattern (pure function so the seams can never drift). All five
    seams — REST `enforceAuth`, dispatcher `handleGraphQL` / `handleMetadata` /
    `handleAI`, hono `denyAnonymous` — now delegate to it. **Pure refactor: no
    runtime behavior change** (verified by the unchanged Phase-1 handler + e2e
    proofs). Identity resolution and the dynamic exemptions (public-form grants,
    share-link tokens) are untouched — they run upstream and only ever hand the
    seam an already-resolved context.
  - **A `discover()` ratchet on the authz-conformance matrix** — it statically
    enumerates the data/meta/graphql HTTP entry points from source (curated
    per-file probes, control-plane routes excluded) and asserts each is classified
    by a matrix `covers` key. A new `/data`/`/meta`/`/graphql` route (or a
    removed/stale `covers`) now fails CI as UNCLASSIFIED / STALE, not in review. A
    companion negative test proves the ratchet bites.

  A design trap is guarded: `isAuthGateAllowlisted(undefined)` returns `true`, so a
  body-routed seam (GraphQL, which has no request path) must pass no path — the
  shared function's non-empty-path guard denies anonymous unconditionally there,
  never falling through to the control-plane allowlist.

- f531a26: fix(authz): carry the derived posture rung on ExecutionContext (#2947)

  The ADR-0095 D2 posture ladder (`PLATFORM_ADMIN > TENANT_ADMIN > MEMBER >
EXTERNAL`) is derived once by the shared authz resolver from capability grants,
  but both HTTP/MCP entry points that build the `ExecutionContext` dropped it —
  so any enforcement-side reader of `context.posture` always saw `undefined`
  (the same drop that forced the explain layer to re-derive it, #2949).

  `ExecutionContextSchema` now carries an optional `posture` field, and both
  `rest-server` and the runtime `resolveExecutionContext` plumb the resolver's
  value through. Additive and **behavior-preserving**: no enforcement decision
  consumes `posture` yet — whether the hot path evaluates _by_ posture remains a
  larger ADR-level decision — this only stops the already-computed value from
  being discarded, so enforcement and explain read the same derived rung.

- f531a26: fix(security): pre-wiring identity admission for the GraphQL and realtime surfaces (#2992, ADR-0096 D4)

  Two latent execution surfaces — neither reachable by a client today — would
  have fallen open the instant a real transport was wired, because both drop or
  lack the caller's identity. Per ADR-0096, the identity story is fixed and
  pinned in CI _before_ wiring, not after an adversarial review:

  - **GraphQL (surface 1 — latent context-drop, now threaded).**
    `handleGraphQL` passed only `{ request }` to `kernel.graphql`, dropping the
    resolved `ExecutionContext` — the moment a real engine resolved objects
    through ObjectQL it would have run context-less (security middleware falls
    OPEN on a missing principal = full authority). The entry point now resolves
    the caller identity even on the direct dispatcher-plugin route and even when
    `requireAuth` is off, and threads it as `options.context`;
    `IGraphQLService.execute` documents that implementations MUST forward it to
    every data-engine call. Unit-proven; the authz conformance matrix pins the
    threading (`graphql-identity-thread` row) so removing it goes STALE and
    fails CI.

  - **realtime (surface 2 — no per-recipient authz seam, posture registered).**
    Delivery is a pure fan-out (subscriptions carry no principal,
    `matchesSubscription` filters only by object+eventTypes, the engine
    publishes the full `after` row), safe only while every subscriber is
    server-internal. The posture is now registered as an `experimental` matrix
    row (`realtime-delivery-authz`) stating the admission requirement
    (per-recipient RLS/FLS/tenant re-check on delivery, or id-only payload +
    client re-fetch), and transport TRIPWIRE probes turn any newly wired
    WebSocket/SSE/subscribe/client transport into an UNCLASSIFIED surface → red
    CI until the identity story ships with it. The `service-realtime` README —
    which advertised `authorizeChannel`/`broadcastToUser`/presence auth that do
    not exist — is rewritten to describe the real, trusted-internal-only
    surface, and the contract docs carry the admission requirement at the seam.

- f531a26: Surface standalone authored `action` metadata rows on the MCP action bridge (#3010). `list_actions` and `run_action` now resolve declarations from `object.actions` unioned with standalone `action` items, keyed the same way the engine registers their handlers (`objectName` → legacy `object` → `'global'`), with object-embedded declarations winning on a key clash. Previously a Studio-authored standalone action executed via REST but was invisible and uninvokable on the MCP/AI surface, even with `ai.exposed: true`. All invoke-time gates (`ai.exposed` fail-closed, ADR-0066 D4 capability gate, sys\_\* fail-closed) are unchanged.
- f531a26: fix(plugin-auth): re-run membership backfill when app seeding settles (#2996)

  The ADR-0093 D6 membership backfill — the only safety net for users created
  by app seeds (raw `engine.insert` into `sys_user` bypasses better-auth's
  `user.create.after` reconciler) — ran only once on `kernel:ready`. When a seed
  bundle overruns its inline budget (`OS_INLINE_SEED_BUDGET_MS`, default 8s) it
  finishes in the background _after_ `kernel:ready`, so its users stayed
  member-less in single-org `auto` mode until the next restart re-ran the backfill.

  `AppPlugin` now emits a new **`app:seeded`** lifecycle event when an app's inline
  seed settles (success, partial, or fallback) — carrying `{ appId, overBudget }`,
  where `overBudget: true` marks the post-`kernel:ready` background case. plugin-auth
  subscribes and re-runs the (idempotent, self-guarding, opt-out-able)
  `backfillMemberships` on that signal, closing the window without waiting for a
  restart. No behavior change when a seed completes within budget, in multi-tenant
  mode, or under `invite-only` policy; `OS_SKIP_MEMBERSHIP_BACKFILL=1` still opts out.

- f531a26: fix(security): enforce the `ai.exposed` opt-in on the MCP action surface (#2849)

  Business-action bodies execute as trusted code: their engine facade carries no
  `ExecutionContext`, so a body's internal reads/writes bypass RLS/FLS/CRUD and
  tenant scoping — the caller's permissions and an agent's ADR-0090 D10 data
  ceiling do NOT bound what an invoked action does. The MCP `run_action` bridge
  nevertheless allowed invoking ANY headless action, ignoring the spec's
  `ai.exposed` governance gate (ADR-0011) entirely.

  The MCP bridge now fail-closes on `ai.exposed`: `list_actions` only enumerates
  — and `run_action` only dispatches — actions the app author explicitly opted
  into the AI surface with `ai: { exposed: true, description }`. Flow-type
  actions additionally receive the caller's identity (`userId` / `positions` /
  `permissions` / `tenantId`) as a proper `AutomationContext` (replacing the
  former `triggerData` envelope the engine never read), so a `runAs: 'user'`
  flow enforces RLS as the invoker instead of running unscoped (ADR-0049).
  Trusted body dispatches are now audit-logged on both the MCP and REST action
  paths, and the MCP tool/README/docs wording no longer claims action bodies run
  under the caller's RLS.

  Migration: actions that should stay invokable by AI agents through MCP must
  declare `ai: { exposed: true, description: '…' }` (≥40-char description). All
  other invocation surfaces (UI, REST `/actions/...`) are unchanged.

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
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/objectql@15.1.0
  - @objectstack/rest@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/plugin-security@15.1.0
  - @objectstack/plugin-auth@15.1.0
  - @objectstack/types@15.1.0
  - @objectstack/formula@15.1.0
  - @objectstack/metadata@15.1.0
  - @objectstack/metadata-core@15.1.0
  - @objectstack/observability@15.1.0
  - @objectstack/driver-memory@15.1.0
  - @objectstack/driver-sql@15.1.0
  - @objectstack/driver-sqlite-wasm@15.1.0
  - @objectstack/service-cluster@15.1.0
  - @objectstack/service-datasource@15.1.0
  - @objectstack/service-i18n@15.1.0

## 15.0.0

### Minor Changes

- e62c233: feat(spec,plugin-security): package-level capability declaration API (ADR-0066 D1)

  Packages can now DEFINE their own authorization capabilities explicitly via the
  new `defineCapability` factory and a stack's `capabilities` array, instead of
  relying on the implicit "derive an untitled capability from whatever a permission
  set references in `systemPermissions[]`" back-door.

  - `@objectstack/spec`: new `defineCapability` / `CapabilityDeclarationSchema`
    (`{ name, label?, description?, scope, packageId? }`) and a `capabilities`
    field on the stack definition.
  - `@objectstack/plugin-security`: new `bootstrapDeclaredCapabilities` seeds
    declared capabilities into `sys_capability` with `managed_by:'package'` +
    `package_id` provenance (new `package_id` field on the object). Idempotent,
    upgrade-aware; refuses to hijack curated platform capabilities or another
    package's rows, never clobbers admin-authored rows, and CLAIMS a pre-existing
    derived placeholder (upgrading it to package provenance). The implicit
    derive-from-`systemPermissions` path still runs for back-compat but now skips
    any explicitly-declared name so it can't clobber authored metadata.
  - `@objectstack/runtime`: stack-declared `capabilities` are registered into the
    metadata registry (type `capability`) so the boot seeder can read them.
  - `@objectstack/lint`: `validateCapabilityReferences` treats
    `stack.capabilities` names as a known capability source.

  A capability is not a contract: DEFINE it (`defineCapability`), GRANT it
  (`systemPermissions`), REQUIRE it (`requiredPermissions`) — no `inputs`.
  Aligns with ADR-0094 D5 (retire implicit `managed_by`-guessing back-doors).

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [0fcef9b]
- Updated dependencies [13749ec]
- Updated dependencies [ca2b2f6]
- Updated dependencies [2ae78c6]
- Updated dependencies [5febe3f]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [698454e]
- Updated dependencies [29a4c90]
- Updated dependencies [ef70521]
- Updated dependencies [a581a65]
- Updated dependencies [31d04d4]
- Updated dependencies [5774a75]
  - @objectstack/spec@15.0.0
  - @objectstack/plugin-security@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/rest@15.0.0
  - @objectstack/objectql@15.0.0
  - @objectstack/metadata@15.0.0
  - @objectstack/plugin-auth@15.0.0
  - @objectstack/formula@15.0.0
  - @objectstack/observability@15.0.0
  - @objectstack/driver-memory@15.0.0
  - @objectstack/driver-sql@15.0.0
  - @objectstack/driver-sqlite-wasm@15.0.0
  - @objectstack/service-cluster@15.0.0
  - @objectstack/service-datasource@15.0.0
  - @objectstack/service-i18n@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [a199626]
- Updated dependencies [84650c5]
- Updated dependencies [607aaf4]
- Updated dependencies [e46169c]
- Updated dependencies [f0acf25]
- Updated dependencies [712328a]
- Updated dependencies [1dede32]
- Updated dependencies [bb71321]
- Updated dependencies [a199626]
  - @objectstack/spec@14.8.0
  - @objectstack/plugin-security@14.8.0
  - @objectstack/driver-sql@14.8.0
  - @objectstack/rest@14.8.0
  - @objectstack/driver-sqlite-wasm@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/metadata@14.8.0
  - @objectstack/objectql@14.8.0
  - @objectstack/observability@14.8.0
  - @objectstack/driver-memory@14.8.0
  - @objectstack/plugin-auth@14.8.0
  - @objectstack/service-cluster@14.8.0
  - @objectstack/service-datasource@14.8.0
  - @objectstack/service-i18n@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [da5e686]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/plugin-auth@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/plugin-security@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/metadata@14.7.0
  - @objectstack/objectql@14.7.0
  - @objectstack/observability@14.7.0
  - @objectstack/driver-memory@14.7.0
  - @objectstack/driver-sql@14.7.0
  - @objectstack/driver-sqlite-wasm@14.7.0
  - @objectstack/rest@14.7.0
  - @objectstack/service-cluster@14.7.0
  - @objectstack/service-datasource@14.7.0
  - @objectstack/service-i18n@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [160d565]
- Updated dependencies [e4cf774]
- Updated dependencies [ce6d151]
- Updated dependencies [8f4a261]
- Updated dependencies [6e2b8ae]
  - @objectstack/spec@14.6.0
  - @objectstack/plugin-auth@14.6.0
  - @objectstack/driver-sql@14.6.0
  - @objectstack/objectql@14.6.0
  - @objectstack/plugin-security@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0
  - @objectstack/metadata@14.6.0
  - @objectstack/observability@14.6.0
  - @objectstack/driver-memory@14.6.0
  - @objectstack/driver-sqlite-wasm@14.6.0
  - @objectstack/rest@14.6.0
  - @objectstack/service-cluster@14.6.0
  - @objectstack/service-datasource@14.6.0
  - @objectstack/service-i18n@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Minor Changes

- 261aff5: ADR-0090 D10 (follow-up) — an MCP agent may now invoke the business **actions** its delegating user can run, gated by the `actions:execute` scope. Previously an agent principal carried no system capabilities, so any capability-gated action (`requiredPermissions`) was denied even when the user was entitled to it.

  `resolve-execution-context` now keeps the delegating user's `systemPermissions` on the agent context **only when the token carries `actions:execute`** (otherwise none — and the MCP tool surface already hides the action tools). The `actions:execute` scope is the user's explicit consent to let the agent act on their behalf, so the capability gate (`actionPermissionError`) is delegated accordingly.

  This never widens the agent's **data** reach: what an action reads or writes still flows through the object CRUD/FLS/RLS ceiling ∩ user intersection. A `data:read` agent that invokes a writing action is still blocked at the write; even a `data:write` agent cannot touch better-auth-managed tables; and capability-gated **object** access stays denied to the agent (that gate is driven by the resolved ceiling sets, which carry no capabilities). The residual is a capability-gated action whose effect is purely external (email, webhook) — exactly what `actions:execute` consents to. Tighter per-action agent scoping is the per-client-grants follow-up.

- d79ca07: ADR-0090 D10 — activate the agent principal (OAuth → `principalKind:'agent'` + scope-derived ceiling). This wires the _producer_ side of the D10 intersection that shipped in #2838, so it stops being dormant: an MCP request authenticated with an OAuth access token is now resolved as an AI **agent acting on behalf of** the human `sub`, and its effective permission is the intersection of a scope-derived capability ceiling AND the user's own grants.

  - **`resolve-execution-context` (producer)**: when a verified MCP OAuth token names an authorized client (`azp`), the request resolves to `principalKind:'agent'` with `onBehalfOf:{ userId }` (the human), and the agent's OWN grants are replaced by the scope-derived ceiling — `data:read` → read-only, `data:write` → full CRUD, neither → no data access. `userId` stays the human so owner-stamping and `current_user.*` RLS resolve to them; the user-derived `systemPermissions` are cleared so a cap-gated action can't ride the user's capabilities. A token without a client stays a `human` principal.
  - **`plugin-security`**: three built-in ceiling sets (`mcp_agent_data_read` / `mcp_agent_data_write` / `mcp_agent_restricted`) — pure CRUD bits, no row-level security (all row/owner/tenant narrowing comes from the delegating user on the other side of the intersection). An `agent` principal skips the additive human baseline (`member_default`) — its grants are exactly its ceiling — and its fallback is the restricted (no-object-access) set, so a mis-resolved agent fails CLOSED, never open.
  - **`spec`**: `MCP_AGENT_PERMISSION_SET_*` names + `scopesToAgentPermissionSets()`, single-sourced next to the OAuth scope constants.

  **Behaviour change (a security tightening).** Previously an MCP OAuth request executed with the FULL authority of the logged-in user, and scopes narrowed only the tool surface. Now the scope is also a real data-layer ceiling: a `data:read` token can never write ANY record, even via a crafted call, no matter what the user could do. This is strictly consistent with the existing contract that "a scope can never grant more than the user could do" — the intersection only ever narrows — and closes the gap where a compromised or confused agent could act with the user's full reach.

  Verified end-to-end: a `data:read` agent acting for a member who owns a record can read it but cannot edit or create; a `data:write` agent for the same user can. Producer mapping unit-tested in `@objectstack/runtime`; enforcement dogfooded against the served engine (`showcase-agent-scope-ceiling`).

### Patch Changes

- 5f43f88: **Security fix (#2852): `/analytics/query` and `/analytics/sql` now run scoped to the caller.**

  `handleAnalytics` dropped the request's execution context — `analyticsService.query(body)` was called with no context, so the analytics service's per-object read-scope provider (`getReadScope` → security `getReadFilter`) received `undefined` and applied **no tenant/RLS filter**. An authenticated caller could query analytics datasets and receive rows their row-level security would otherwise hide.

  Fix: thread `context.executionContext` into `analyticsService.query(…)` and `generateSql(…)` (both already accept it), so each object in the query is scoped by its per-object read filter.

  Note: the analytics read-scope provider (`getReadFilter`) does not yet apply the ADR-0090 D10 agent delegator intersection — latent today because analytics is not reachable over the OAuth `/mcp` surface; tracked in #2852 for when it is.

- Updated dependencies [526805e]
- Updated dependencies [f70eb2c]
- Updated dependencies [d79ca07]
- Updated dependencies [a348394]
- Updated dependencies [4d9dd7b]
- Updated dependencies [5bced2f]
- Updated dependencies [3fd87b2]
- Updated dependencies [33ebd34]
- Updated dependencies [e2c05d6]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/plugin-security@14.5.0
  - @objectstack/plugin-auth@14.5.0
  - @objectstack/rest@14.5.0
  - @objectstack/objectql@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0
  - @objectstack/metadata@14.5.0
  - @objectstack/observability@14.5.0
  - @objectstack/driver-memory@14.5.0
  - @objectstack/driver-sql@14.5.0
  - @objectstack/driver-sqlite-wasm@14.5.0
  - @objectstack/service-cluster@14.5.0
  - @objectstack/service-datasource@14.5.0
  - @objectstack/service-i18n@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [9887465]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/objectql@14.4.0
  - @objectstack/driver-sql@14.4.0
  - @objectstack/driver-sqlite-wasm@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/plugin-security@14.4.0
  - @objectstack/plugin-auth@14.4.0
  - @objectstack/formula@14.4.0
  - @objectstack/metadata@14.4.0
  - @objectstack/observability@14.4.0
  - @objectstack/driver-memory@14.4.0
  - @objectstack/rest@14.4.0
  - @objectstack/service-cluster@14.4.0
  - @objectstack/service-datasource@14.4.0
  - @objectstack/service-i18n@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [8f0b9df]
- Updated dependencies [ff648ad]
- Updated dependencies [c1064f1]
- Updated dependencies [bea4b92]
  - @objectstack/plugin-auth@14.3.0
  - @objectstack/rest@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/plugin-security@14.3.0
  - @objectstack/metadata@14.3.0
  - @objectstack/objectql@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0
  - @objectstack/observability@14.3.0
  - @objectstack/driver-memory@14.3.0
  - @objectstack/driver-sql@14.3.0
  - @objectstack/driver-sqlite-wasm@14.3.0
  - @objectstack/service-cluster@14.3.0
  - @objectstack/service-datasource@14.3.0
  - @objectstack/service-i18n@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/plugin-security@14.2.0
  - @objectstack/spec@14.2.0
  - @objectstack/service-datasource@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/metadata@14.2.0
  - @objectstack/objectql@14.2.0
  - @objectstack/observability@14.2.0
  - @objectstack/driver-memory@14.2.0
  - @objectstack/driver-sql@14.2.0
  - @objectstack/driver-sqlite-wasm@14.2.0
  - @objectstack/plugin-auth@14.2.0
  - @objectstack/rest@14.2.0
  - @objectstack/service-cluster@14.2.0
  - @objectstack/service-i18n@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/metadata@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/observability@14.1.0
  - @objectstack/driver-memory@14.1.0
  - @objectstack/driver-sql@14.1.0
  - @objectstack/driver-sqlite-wasm@14.1.0
  - @objectstack/plugin-auth@14.1.0
  - @objectstack/plugin-security@14.1.0
  - @objectstack/rest@14.1.0
  - @objectstack/service-cluster@14.1.0
  - @objectstack/service-datasource@14.1.0
  - @objectstack/service-i18n@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Minor Changes

- bc26360: feat(mcp): `GET /api/v1/mcp/skill` — download the environment-customized Agent Skill

  `renderSkillMarkdown()` was export-only; nothing served it over HTTP, so the
  "one generic skill" distributable (ADR-0036 Amendment C) had no self-serve
  outlet. The runtime dispatcher now serves it at `GET /api/v1/mcp/skill` as
  `text/markdown` — public like `/discovery` (generic agent instructions plus a
  URL the caller already knows; no schema, no tenant data), gated on the same
  default-on MCP switch (404 when opted out), 501 when the MCP plugin isn't
  loaded. The environment URL comes from the auth service's canonical
  `getMcpResourceUrl()` with a request-host fallback. `MCPServerRuntime` gains
  `renderSkill()` so hosts reach the renderer via the registered `'mcp'`
  service without a package dependency. Feeds the Setup "Connect an agent"
  page (objectui#2363) and the distribution shells (#2714).

- bd39dc5: ADR-0090 D5/D9 — suggested audience bindings become a queryable, confirmable surface.

  A package permission set declaring `isDefault: true` is an install-time
  SUGGESTION to bind the set to the built-in `everyone` position — never
  auto-bound. Until now the flag was only read at bootstrap as the fallback-set
  name; after an install there was no way to see or act on the suggestion.

  **`@objectstack/plugin-security`**: new `sys_audience_binding_suggestion`
  system object (read-only over the data API; unique per
  package × set × anchor) plus a convergent reconciler
  (`syncAudienceBindingSuggestions`) that reads every declared `isDefault` set —
  boot-declared stack metadata AND installed package manifests, so a runtime
  `POST /api/v1/packages` install is visible immediately — and keeps the table
  honest: undeclared → pending row pruned, bound out-of-band → marked
  `confirmed` (observed). The `security` service gains
  `listAudienceBindingSuggestions` / `confirmAudienceBindingSuggestion` /
  `dismissAudienceBindingSuggestion`, all pre-gated on tenant-level admin
  (ADR-0066 superuser wildcard — anchors stay tenant-level only per D12).
  Confirm writes the `sys_position_permission_set` row **with the caller's
  execution context**, so the D5/D9 audience-anchor gate (no high-privilege
  set on `everyone`/`guest`) and the D12 delegated-admin gate enforce the
  binding; a set not yet materialized (installed this session) is first
  seeded through the same provenance-checked upsert as the boot seeder
  (ADR-0086 D4).

  **`@objectstack/rest`** and **`@objectstack/runtime`**: the HTTP surface,
  registered on both API layers (the RestServer that `objectstack dev`/hono
  serves, and the runtime HttpDispatcher used by the adapters) —
  `GET /api/v1/security/suggested-bindings?status=&packageId=`,
  `POST /api/v1/security/suggested-bindings/:id/confirm`,
  `POST /api/v1/security/suggested-bindings/:id/dismiss` (401 unauthenticated,
  403/404/409 mapped from the service's typed errors, 501/503 without
  plugin-security).

### Patch Changes

- 57b8fe0: fix(runtime): action body `ctx.user` now reflects the session operator, not `system`

  The `POST /actions/:object/:action` route called `handleActions` directly,
  bypassing `dispatcher.dispatch()` — so `resolveExecutionContext` never ran and
  the action handler's `ctx.user` was hard-coded to `{ id: 'system' }`. Handlers
  could not branch on the operator's identity or business roles, nor enforce
  server-side ownership. (#2701)

  - The action routes now dispatch through `dispatch()` like the automation/AI
    routes, so the per-request pipeline resolves the session identity (and swaps
    to the per-project kernel) before the action body runs.
  - `handleActions` builds `ctx.user` from the resolved `ExecutionContext`,
    exposing `id`, `email`, `roles`/`positions` (ADR-0090 business roles),
    `permissions`, and `tenantId` — matching the MCP `runAction` and
    record-change trigger paths. It falls back to a `system` principal only for a
    genuinely anonymous / self-invoked call.

  No authoring change is required: action handlers that previously always saw
  `ctx.user.id === 'system'` will now see the real caller.

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [ac08698]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
- Updated dependencies [bd39dc5]
- Updated dependencies [1056c5f]
  - @objectstack/spec@14.0.0
  - @objectstack/plugin-security@14.0.0
  - @objectstack/rest@14.0.0
  - @objectstack/driver-sql@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/formula@14.0.0
  - @objectstack/metadata@14.0.0
  - @objectstack/observability@14.0.0
  - @objectstack/driver-memory@14.0.0
  - @objectstack/driver-sqlite-wasm@14.0.0
  - @objectstack/plugin-auth@14.0.0
  - @objectstack/service-cluster@14.0.0
  - @objectstack/service-datasource@14.0.0
  - @objectstack/service-i18n@14.0.0
  - @objectstack/types@14.0.0

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

- 01917c2: ADR-0090 P2 — audience anchors: `everyone`/`guest` builtin positions.

  - `EVERYONE_POSITION` / `GUEST_POSITION` constants in `@objectstack/spec`;
    both anchors seeded (system-managed) alongside the builtin identity names.
  - Every authenticated principal implicitly holds `everyone` in
    `ctx.positions`, so sets bound to it resolve as ordinary position-bound
    grants — ADDITIVE. The fallback CLIFF is abolished: the configured
    baseline (`fallbackPermissionSet`, default `member_default`) now applies
    in addition to explicit grants instead of only when the user had none,
    and is also seeded as an `everyone` binding (same table/audit/explain
    path as admin-authored defaults).
  - Sessionless HTTP principals resolve as `principalKind: 'guest'` holding
    exactly `['guest']`; internal bare contexts are untouched.
  - Audience-anchor binding gate: `sys_position_permission_set` writes that
    would bind a high-privilege set (VAMA, delete/purge/transfer, system
    permissions, `'*'` wildcard) to `everyone`/`guest` are rejected at the
    data layer, unconditionally (`describeHighPrivilegeBits` predicate is
    exported and shared with the seed-time validation).

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

- 5be00c3: feat(mcp): spec-compliant OAuth 2.1 authorization for `/api/v1/mcp` (#2698)

  Any OAuth-capable MCP client (claude.ai custom connectors, Claude Desktop,
  Claude Code) can now connect to a deployment **self-serve**: no admin-minted
  API key, no central registry — you sign in through the browser as yourself and
  every tool call runs under your own permissions and row-level security.

  **Each deployment is its own authorization server**, backed by the embedded
  better-auth instance (`@better-auth/oauth-provider`). Rationale for the design
  decisions lives in #2698; the moving parts:

  - **Discovery**: `/.well-known/oauth-protected-resource` (RFC 9728, incl. the
    path-inserted variant for `/api/v1/mcp`) and
    `/.well-known/oauth-authorization-server` (RFC 8414, incl. the path-inserted
    variant for the `/api/v1/auth` issuer) are served from the deployment origin.
    401s from `/api/v1/mcp` advertise the resource metadata via
    `WWW-Authenticate`, so clients bootstrap the flow automatically.
  - **Dynamic Client Registration (RFC 7591)** is enabled (unauthenticated, as
    the MCP spec requires) whenever the MCP surface is on — every deployment is a
    distinct AS, so clients cannot ship pre-registered IDs. Force it either way
    with `OS_OIDC_DCR_ENABLED` or the new `plugins.dynamicClientRegistration`
    auth-config field. The embedded AS itself auto-enables whenever the MCP
    surface is on — which is now the default (explicit
    `OS_OIDC_PROVIDER_ENABLED=false` still wins).
  - **Authorization-code + PKCE** flow with RFC 8707 resource binding: access
    tokens are minted with `aud=<origin>/api/v1/mcp` and verified locally
    (signature/issuer/audience/expiry) against the deployment's own JWKS —
    fail-closed parity with API keys: unknown/expired/wrong-audience tokens,
    sub-less M2M tokens, or a presented-but-invalid bearer never fall back to an
    ambient session, they 401.
  - **Token → ExecutionContext**: a valid access token resolves to the same
    principal-bound `ExecutionContext` as every other credential, single-sourced
    through `resolveAuthzContext` — OAuth adds a second _provenance_ for the
    principal, not a second authz model. `ExecutionContext` gains an optional
    `oauthScopes` field carrying the token's granted scopes.
  - **Coarse scopes → tool families**, enforced at tool dispatch: `data:read`
    (list/describe/query/get), `data:write` (create/update/delete),
    `actions:execute` (list_actions/run_action). Constants live in
    `@objectstack/spec/ai` (`MCP_OAUTH_SCOPES`). Tools outside the grant are not
    registered — and therefore rejected — for that request. API-key and session
    principals are unaffected (not scope-limited).
  - **TLS required, localhost exempt** (OAuth 2.1): on a plain-HTTP non-loopback
    origin the OAuth track stays dark (no metadata, no bearer acceptance) and the
    endpoint remains API-key-only. Local clients reach intranet deployments;
    claude.ai web connectors additionally need public HTTPS reachability.

  **API keys are unchanged** (dual-track): `x-api-key` / `Authorization: ApiKey` /
  `Authorization: Bearer osk_…` keep working exactly as before for CI and
  headless agents — covered by new regression tests.

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [799b285]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/rest@13.0.0
  - @objectstack/plugin-security@13.0.0
  - @objectstack/plugin-auth@13.0.0
  - @objectstack/metadata@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/observability@13.0.0
  - @objectstack/driver-memory@13.0.0
  - @objectstack/driver-sql@13.0.0
  - @objectstack/driver-sqlite-wasm@13.0.0
  - @objectstack/service-cluster@13.0.0
  - @objectstack/service-datasource@13.0.0
  - @objectstack/service-i18n@13.0.0

## 12.6.0

### Patch Changes

- b5a87eb: Sandbox: stop `QuickJSScriptRunner` from crashing when a hook context holds a non-serialisable host object.

  `installCtx` marshalled `ctx` into the QuickJS sandbox with a bare `JSON.stringify`. If the context (or anything reachable from it) held a live `setTimeout`/`setInterval` handle, `JSON.stringify` threw `TypeError: Converting circular structure to JSON` (`Timeout._idlePrev -> TimersList._idleNext -> …`) and took the whole hook down (#2674). Marshalling now goes through a shared `safeJsonStringify` that drops circular back-edges via a path `WeakSet` and coerces `BigInt` to a string, so only JSON-safe leaves cross the boundary and the body still runs.

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/rest@12.6.0
  - @objectstack/driver-sql@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/metadata@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/observability@12.6.0
  - @objectstack/driver-memory@12.6.0
  - @objectstack/driver-sqlite-wasm@12.6.0
  - @objectstack/plugin-auth@12.6.0
  - @objectstack/plugin-org-scoping@12.6.0
  - @objectstack/plugin-security@12.6.0
  - @objectstack/service-cluster@12.6.0
  - @objectstack/service-datasource@12.6.0
  - @objectstack/service-i18n@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/metadata@12.5.0
  - @objectstack/observability@12.5.0
  - @objectstack/driver-memory@12.5.0
  - @objectstack/driver-sql@12.5.0
  - @objectstack/driver-sqlite-wasm@12.5.0
  - @objectstack/plugin-auth@12.5.0
  - @objectstack/plugin-org-scoping@12.5.0
  - @objectstack/plugin-security@12.5.0
  - @objectstack/rest@12.5.0
  - @objectstack/service-cluster@12.5.0
  - @objectstack/service-datasource@12.5.0
  - @objectstack/service-i18n@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Minor Changes

- 1dd5dfd: feat(packages): edit a package manifest via `PATCH /packages/:id`

  Adds an editable path for a package's `name` / `description` / `version` after
  creation: `SchemaRegistry.updatePackageManifest` (merges in-memory, preserving
  lifecycle state), `protocol.updatePackage` (re-persists to `sys_packages`), and
  the `PATCH /packages/:id` route in the HTTP dispatcher. `id` / `scope` / `type`
  remain immutable.

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/metadata@12.4.0
  - @objectstack/observability@12.4.0
  - @objectstack/driver-memory@12.4.0
  - @objectstack/driver-sql@12.4.0
  - @objectstack/driver-sqlite-wasm@12.4.0
  - @objectstack/plugin-auth@12.4.0
  - @objectstack/plugin-org-scoping@12.4.0
  - @objectstack/plugin-security@12.4.0
  - @objectstack/rest@12.4.0
  - @objectstack/service-cluster@12.4.0
  - @objectstack/service-datasource@12.4.0
  - @objectstack/service-i18n@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/rest@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/metadata@12.3.0
  - @objectstack/observability@12.3.0
  - @objectstack/driver-memory@12.3.0
  - @objectstack/driver-sql@12.3.0
  - @objectstack/driver-sqlite-wasm@12.3.0
  - @objectstack/plugin-auth@12.3.0
  - @objectstack/plugin-org-scoping@12.3.0
  - @objectstack/plugin-security@12.3.0
  - @objectstack/service-cluster@12.3.0
  - @objectstack/service-datasource@12.3.0
  - @objectstack/service-i18n@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- 4f5b791: Wire three more Studio-authored metadata surfaces at runtime (#2605 — the
  "declared but never wired" family, following the #2596 hooks template).

  **Authored actions now execute (#2605 item 1).** `engine.executeAction`'s map
  was only ever populated from the app bundle at boot, so a published `action`
  row (standalone or embedded in an authored object's `actions[]`) was stored
  and listed but never executable — before OR after a restart. Now:

  - `AppPlugin` installs a QuickJS-sandboxed default action runner at boot
    (`engine.setDefaultActionRunner`), the action-path twin of the #2596 hook
    body runner. Opt out with `OS_DISABLE_AUTHORED_ACTIONS=1`.
  - `ObjectQLPlugin` re-registers runtime-authored actions from their
    `sys_metadata` rows under `packageId: 'metadata-service'` at
    `kernel:ready`, on `metadata:reloaded`, and on `action`/`object` protocol
    mutations — saves, publishes, edits, and deletes take effect live.
    Package-artifact actions are excluded (AppPlugin owns those; re-registering
    would clobber their handlers).

  **Authored translations reach the i18n runtime (#2591).** `translation`
  metadata items (single-locale `AppTranslationBundle` payloads; locale from
  `_meta.locale`, a top-level `locale`, or a BCP-47-shaped item name) now load
  into the i18n service as a separate authored layer that overlays static
  bundles. Both adapters carry the layer — service-i18n's `FileI18nAdapter`
  AND the kernel's in-memory fallback (`createMemoryI18n`), which is what dev
  and standalone stacks actually run. The shared sync
  (`wireAuthoredTranslationSync`, exported from `@objectstack/core`, wired by
  the runtime's AppPlugin and by I18nServicePlugin with single-owner
  semantics) runs at `kernel:ready`, on `metadata:reloaded`, and on
  `translation` protocol mutations, with clear-then-reload semantics so
  deleted items/keys stop resolving instead of lingering in the deep-merged
  map.

  **Sharing rules created at runtime bind without a restart (#2592).**
  `bindRuleHooks` was boot-only, so the first rule authored at runtime for an
  object with no boot-time rule silently never evaluated (rule authoring is a
  data insert — `metadata:reloaded` never fires). The sharing plugin now binds
  afterInsert/afterUpdate/afterDelete triggers on `sys_sharing_rule` that
  unbind + re-bind the rule-hook package from a fresh `listRules()`, serialized
  so overlapping writes can't leave a stale snapshot bound, and fail-safe so a
  rebind failure never fails the rule write.

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
  - @objectstack/core@12.2.0
  - @objectstack/service-i18n@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/metadata@12.2.0
  - @objectstack/observability@12.2.0
  - @objectstack/driver-memory@12.2.0
  - @objectstack/driver-sql@12.2.0
  - @objectstack/driver-sqlite-wasm@12.2.0
  - @objectstack/plugin-auth@12.2.0
  - @objectstack/plugin-org-scoping@12.2.0
  - @objectstack/service-cluster@12.2.0
  - @objectstack/service-datasource@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Minor Changes

- 497bda8: feat(automation): honor flow deployment status for enable/disable + expose runtime enable/bound state

  The engine bound and ran **every** registered flow, ignoring the flow's
  persisted `status` — so an author had no way to turn an automation off (short of
  deleting it) and no way to see whether one was actually live. This is the engine
  half of the Studio's "clear on/off switch + visible enabled/bound status".

  - **`registerFlow` now honors `status`:** a flow whose deployment `status` is
    `obsolete` or `invalid` is treated as **disabled** — its trigger is not bound
    and `execute()` refuses it. `draft` / `active` — and any legacy flow with no
    explicit status — stay enabled, so **existing flows are unaffected** (zero
    regression; this is the on/off switch persisting via the existing `status`
    field, applied on the next publish rebind). A status flip back OUT of a
    disabled state re-enables on re-register even if the flow had been turned off;
    a runtime `toggleFlow()` override on a still-enabled flow is preserved.

  - **New `getFlowRuntimeStates()` + `GET /api/v1/automation/_status`:** returns
    `[{ name, enabled, bound }]` for every registered flow — the truth behind the
    Studio's status badges (persisted `status` is metadata; whether a flow is
    actually enabled and wired to its trigger is engine state). Underscore-prefixed
    so no flow name can shadow the route; degrades to an empty list on an older
    service.

  Tests cover: draft/active flows bind + enable (unchanged), an `obsolete` flow is
  neither bound nor enabled and `execute()` refuses it, a status flip
  obsolete→active re-enables + re-binds, and the `_status` route shape.

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/metadata@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/observability@12.1.0
  - @objectstack/driver-memory@12.1.0
  - @objectstack/driver-sql@12.1.0
  - @objectstack/driver-sqlite-wasm@12.1.0
  - @objectstack/plugin-auth@12.1.0
  - @objectstack/plugin-org-scoping@12.1.0
  - @objectstack/plugin-security@12.1.0
  - @objectstack/rest@12.1.0
  - @objectstack/service-cluster@12.1.0
  - @objectstack/service-datasource@12.1.0
  - @objectstack/service-i18n@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- 9693a36: fix(automation): bind a flow published while the server runs, without a restart

  Follow-up to #2560 (cold-boot flow binding). A flow **published while the server
  is running** — the Studio online-authoring journey: author a record-triggered
  automation, publish it, immediately update a matching record — did **not** fire.
  Its trigger only bound on the next process restart.

  Two gaps, both fixed:

  1. **The publish path fired no rebind signal.** `POST /packages/:id/publish-drafts`
     → `protocol.publishPackageDrafts` promotes the drafts to active but emitted no
     event the automation service listens to. The runtime dispatcher now announces
     `metadata:reloaded` after a successful publish — the same signal a dev artifact
     reload fires (`MetadataPlugin._reloadAndAnnounce`) — so boot-cached consumers
     re-sync without a restart.

  2. **The runtime re-sync read the wrong source.** The automation service's
     `metadata:reloaded` re-sync pulled `metadata.list('flow')`, which returns 0 in a
     real running server (it does not surface inline app flows), so even when the
     hook fired it bound nothing. It now reads `protocol.getMetaItems({ type: 'flow' })`
     — the same flattened flow view #2560's cold-boot bind and `GET /meta/flow` use —
     while keeping the teardown of flows removed from the artifact. A failed or
     unavailable protocol read is a no-op and never tears down live flows.

  Production is largely unaffected (a deploy reboots the process, so #2560's
  cold-boot bind covers it); this closes the gap for dev and single-instance
  Studio authoring.

  Verified end-to-end on a clean instance: authored a record-triggered flow in a
  package, published it via `POST /packages/:id/publish-drafts` **without
  restarting**, then updated a matching record and observed the flow fire (before
  the fix it did not). New regression tests boot a kernel whose protocol serves a
  flow only after boot and assert `metadata:reloaded` binds it — and that the
  re-sync reads the protocol, not `metadata.list` — both failing on the pre-fix code.

- 2d567cb: Runtime-authored (Studio) hooks now execute their `body` (#2588).

  Previously a hook authored at runtime (saved via `protocol.saveMetaItem` /
  `publish-drafts`) loaded into the registry but its L1/L2 `body` never ran — the
  metadata-service bind path passed no `bodyRunner` and the engine's
  `_defaultBodyRunner` fallback was never installed, so the binder silently
  skipped the body. Now:

  - `AppPlugin` installs the QuickJS-sandboxed hook body runner as the engine
    default at boot (`engine.setDefaultBodyRunner`), so bind paths without an
    explicit runner can execute bodies. Opt out with
    `OS_DISABLE_AUTHORED_HOOKS=1` to keep runtime-authored hook bodies inert.
  - `ObjectQLPlugin` re-binds runtime-authored hooks from their `sys_metadata`
    rows at `kernel:ready` (cold boot — env-scoped kernels never surfaced these
    rows before), on `metadata:reloaded`, and on every hook mutation through the
    new `protocol.onMetadataMutation` listener — so saves, publishes, edits, and
    deletes take effect live, without a restart. Package-artifact hooks are
    excluded from this bind path (AppPlugin already binds them with an explicit
    runner) so they no longer risk double execution.
  - `@objectstack/metadata-protocol` gains a server-side
    `onMetadataMutation(listener)` API: `saveMetaItem` / `publishMetaItem` /
    `deleteMetaItem` notify subscribers after persistence succeeds.

- e3498fb: fix(runtime): carry spec-validation issues (and the 422 status) through metadata save/publish errors

  `protocol.saveMetaItem` already validates a metadata draft against its spec Zod
  schema and, on failure, throws a rich error: HTTP `status: 422`, `code:
'invalid_metadata'`, and a structured `issues: [{ path, message, code }]` array
  (field-anchored, `superRefine` issues included). But the HTTP dispatcher's catch
  blocks collapsed all of that to a single message — the save path even hardcoded
  `400` — so a client could only show a generic "failed validation" banner with no
  way to point at the offending field. The publish path was worse: the per-draft
  catch in `publishPackageDrafts` flattened each failure into `{ type, name, error
}` and **dropped `issues` entirely**.

  Now:

  - A new `errorFromThrown(e, fallbackStatus)` dispatcher helper preserves the
    error's own `status` (so validation surfaces as **422**, not a downgraded 400)
    and attaches `{ code, issues }` under `error.details` when present. Errors that
    carry neither behave exactly as before. Used by the metadata **save** (`PUT
/meta/:type/:name`) and **publish** (`POST /packages/:id/publish-drafts`)
    catch sites.
  - `publishPackageDrafts` now carries `issues` into each `failed[]` entry, so a
    validation failure during publish is field-anchored too (it previously kept
    only the message).

  This is the server half of "surface validation at the save/publish moment, on
  the field" — the Studio can now map each issue back to its input instead of
  showing a wall-of-text banner. Purely additive to the error payload; the only
  behavior change is the more-correct 422 (was 400) for a failed metadata save.

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [1b1b34e]
- Updated dependencies [9796e7c]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [48ad533]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/plugin-auth@12.0.0
  - @objectstack/plugin-security@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/rest@12.0.0
  - @objectstack/metadata@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0
  - @objectstack/observability@12.0.0
  - @objectstack/driver-memory@12.0.0
  - @objectstack/driver-sql@12.0.0
  - @objectstack/driver-sqlite-wasm@12.0.0
  - @objectstack/plugin-org-scoping@12.0.0
  - @objectstack/service-cluster@12.0.0
  - @objectstack/service-datasource@12.0.0
  - @objectstack/service-i18n@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/plugin-security@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/metadata@11.10.0
  - @objectstack/objectql@11.10.0
  - @objectstack/observability@11.10.0
  - @objectstack/driver-memory@11.10.0
  - @objectstack/driver-sql@11.10.0
  - @objectstack/driver-sqlite-wasm@11.10.0
  - @objectstack/plugin-auth@11.10.0
  - @objectstack/plugin-org-scoping@11.10.0
  - @objectstack/rest@11.10.0
  - @objectstack/service-cluster@11.10.0
  - @objectstack/service-datasource@11.10.0
  - @objectstack/service-i18n@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- 852bc8e: fix(runtime): surface the clean business message from a failed action, not the sandbox debug wrapper

  A user throw inside a script/action body is wrapped by the sandbox as
  `<kind> '<name>' threw: <msg>` for server logs, but the action HTTP endpoint
  returned that whole wrapper as the client-facing `error` — so an action's error
  toast leaked the debug prefix to end users (e.g. `action 'lead_apply_convert'
threw: Error: 线索信息不完整…` instead of just `线索信息不完整…`).

  `SandboxError` now also carries `innerMessage`: the plain business message with
  no `<kind> '<name>' threw:` wrapper and no default `Error: ` name prefix. The
  action route surfaces `innerMessage` to the client and keeps the full wrapper in
  the server log.

- Updated dependencies [d3595d9]
- Updated dependencies [8d87930]
  - @objectstack/spec@11.9.0
  - @objectstack/driver-sql@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/metadata@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/observability@11.9.0
  - @objectstack/driver-memory@11.9.0
  - @objectstack/driver-sqlite-wasm@11.9.0
  - @objectstack/plugin-auth@11.9.0
  - @objectstack/plugin-org-scoping@11.9.0
  - @objectstack/plugin-security@11.9.0
  - @objectstack/rest@11.9.0
  - @objectstack/service-cluster@11.9.0
  - @objectstack/service-datasource@11.9.0
  - @objectstack/service-i18n@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/metadata@11.8.0
- @objectstack/plugin-auth@11.8.0
- @objectstack/plugin-org-scoping@11.8.0
- @objectstack/plugin-security@11.8.0
- @objectstack/rest@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0
- @objectstack/objectql@11.8.0
- @objectstack/observability@11.8.0
- @objectstack/formula@11.8.0
- @objectstack/driver-memory@11.8.0
- @objectstack/driver-sql@11.8.0
- @objectstack/driver-sqlite-wasm@11.8.0
- @objectstack/service-cluster@11.8.0
- @objectstack/service-datasource@11.8.0
- @objectstack/service-i18n@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/metadata@11.7.0
  - @objectstack/objectql@11.7.0
  - @objectstack/observability@11.7.0
  - @objectstack/driver-memory@11.7.0
  - @objectstack/driver-sql@11.7.0
  - @objectstack/driver-sqlite-wasm@11.7.0
  - @objectstack/plugin-auth@11.7.0
  - @objectstack/plugin-org-scoping@11.7.0
  - @objectstack/plugin-security@11.7.0
  - @objectstack/rest@11.7.0
  - @objectstack/service-cluster@11.7.0
  - @objectstack/service-datasource@11.7.0
  - @objectstack/service-i18n@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/metadata@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/observability@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/rest@11.6.0
- @objectstack/driver-memory@11.6.0
- @objectstack/driver-sql@11.6.0
- @objectstack/driver-sqlite-wasm@11.6.0
- @objectstack/plugin-auth@11.6.0
- @objectstack/plugin-org-scoping@11.6.0
- @objectstack/plugin-security@11.6.0
- @objectstack/service-cluster@11.6.0
- @objectstack/service-datasource@11.6.0
- @objectstack/service-i18n@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/metadata@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/observability@11.5.0
  - @objectstack/driver-memory@11.5.0
  - @objectstack/driver-sql@11.5.0
  - @objectstack/driver-sqlite-wasm@11.5.0
  - @objectstack/plugin-auth@11.5.0
  - @objectstack/plugin-org-scoping@11.5.0
  - @objectstack/plugin-security@11.5.0
  - @objectstack/rest@11.5.0
  - @objectstack/service-cluster@11.5.0
  - @objectstack/service-datasource@11.5.0
  - @objectstack/service-i18n@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/metadata@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/observability@11.4.0
  - @objectstack/driver-memory@11.4.0
  - @objectstack/driver-sql@11.4.0
  - @objectstack/driver-sqlite-wasm@11.4.0
  - @objectstack/plugin-auth@11.4.0
  - @objectstack/plugin-org-scoping@11.4.0
  - @objectstack/plugin-security@11.4.0
  - @objectstack/rest@11.4.0
  - @objectstack/service-cluster@11.4.0
  - @objectstack/service-datasource@11.4.0
  - @objectstack/service-i18n@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
- Updated dependencies [59576d0]
  - @objectstack/spec@11.3.0
  - @objectstack/plugin-auth@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/metadata@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/observability@11.3.0
  - @objectstack/driver-memory@11.3.0
  - @objectstack/driver-sql@11.3.0
  - @objectstack/driver-sqlite-wasm@11.3.0
  - @objectstack/plugin-org-scoping@11.3.0
  - @objectstack/plugin-security@11.3.0
  - @objectstack/rest@11.3.0
  - @objectstack/service-cluster@11.3.0
  - @objectstack/service-datasource@11.3.0
  - @objectstack/service-i18n@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/metadata@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/observability@11.2.0
  - @objectstack/driver-memory@11.2.0
  - @objectstack/driver-sql@11.2.0
  - @objectstack/driver-sqlite-wasm@11.2.0
  - @objectstack/plugin-auth@11.2.0
  - @objectstack/plugin-org-scoping@11.2.0
  - @objectstack/plugin-security@11.2.0
  - @objectstack/rest@11.2.0
  - @objectstack/service-cluster@11.2.0
  - @objectstack/service-datasource@11.2.0
  - @objectstack/service-i18n@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- e011d42: Auth: per-org MFA + dispatcher/MCP gate — complete the ADR-0069 enforced-MFA story

  Two follow-ups that make enforced MFA total:

  - **Per-org `sys_organization.require_mfa`** — an org may require MFA above the global floor. `computeAuthGate` now treats the active org's `require_mfa` as an effective MFA requirement even when the global `mfa_required` is off; `isAuthGateActive()` stays cheap via a 60s-TTL "any org requires MFA" cache (lazy background refresh), so a brand-new per-org requirement activates the gate on the next request without per-request org queries.
  - **Dispatcher/MCP gate** — the auth-policy gate now also runs in the runtime dispatcher (after `resolveExecutionContext`), so MCP / GraphQL / embedded data paths enforce `PASSWORD_EXPIRED` / `MFA_REQUIRED` consistently with the REST seam (reusing the shared `evaluateAuthGate` allow-list). Previously only the REST surface (the Console) was gated.

  Default-off / additive. Per ADR-0049 each setting ships with its enforcement.

### Patch Changes

- 7087cfe: Remove the unused HTTP framework adapters and the MSW plugin — the open edition ships the **Hono** adapter only.

  The `express` / `fastify` / `nextjs` / `nestjs` / `nuxt` / `sveltekit` adapters and
  `@objectstack/plugin-msw` had **zero internal consumers** and were not dogfooded —
  pure release/maintenance surface (and an untested-integration liability). They are
  removed; `@objectstack/hono` (the adapter actually used, via `@objectstack/client`)
  is kept.

  - Deleted packages: `@objectstack/express`, `@objectstack/fastify`,
    `@objectstack/nextjs`, `@objectstack/nestjs`, `@objectstack/nuxt`,
    `@objectstack/sveltekit`, `@objectstack/plugin-msw` (fixed group 73 → 66).
  - `@objectstack/client`: dropped the `plugin-msw` / `msw` dev usage (MSW test removed).
  - `HttpDispatcher` (the dispatch engine) is now used only by the Hono adapter +
    the internal dispatcher-plugin, so its misleading `@deprecated → createDispatcherPlugin`
    note (createDispatcherPlugin is a kernel plugin, not a drop-in) is corrected.

  Anyone needing another framework adapter can build one on the public
  `HttpDispatcher` / `createDispatcherPlugin` API or maintain it out-of-tree.

- 69ae136: docs: align hardening / driver docs with the Hono-only adapter surface (12.0)

  Follow-up to the adapter trim (#2391): the hardening guide's rate-limit/CORS
  recipes are rewritten from Fastify to **Hono** (the shipped adapter; the old
  `@objectstack/fastify` import was broken), CSRF guidance points at `hono/csrf`,
  and stale `@objectstack/plugin-msw` references are dropped from the driver-memory
  and driver-turso docs. README framework lists narrowed to Hono.

- Updated dependencies [574e7a3]
- Updated dependencies [cbc8c02]
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
- Updated dependencies [69ae136]
  - @objectstack/plugin-security@11.1.0
  - @objectstack/plugin-auth@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/rest@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/observability@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/driver-memory@11.1.0
  - @objectstack/metadata@11.1.0
  - @objectstack/plugin-org-scoping@11.1.0
  - @objectstack/driver-sql@11.1.0
  - @objectstack/driver-sqlite-wasm@11.1.0
  - @objectstack/service-cluster@11.1.0
  - @objectstack/service-datasource@11.1.0
  - @objectstack/service-i18n@11.1.0
  - @objectstack/formula@11.1.0

## 11.0.0

### Minor Changes

- 4d99a5c: Package-scoped commit history & rollback for AI authoring (ADR-0067)

  Each authoring apply now lands as one revertible **commit** on a package timeline, on top of `sys_metadata_history`:

  - New `sys_metadata_commit` object groups a turn's metadata changes (by `event_seq` range).
  - `publishPackageDrafts` records each publish as one commit (best-effort) with a per-artifact revert plan and an optional `message` / `aiModel`.
  - New protocol methods `listCommits`, `revertCommit`, `rollbackToPackageCommit` (reusing `restoreVersion` + delete; a revert is itself an append-only commit).
  - New REST routes: `GET /packages/:id/commits`, `POST /packages/:id/commits/:commitId/revert`, `POST /packages/:id/rollback`.

- 6c4fbd9: fix(security): enforce flow `runAs` execution identity (#1888)

  The `service-automation` engine now honors `flow.runAs` instead of ignoring it.
  Previously the CRUD nodes passed **no identity** to ObjectQL, so the security
  middleware was skipped entirely — every flow ran effectively elevated regardless
  of `runAs`. A `runAs:'user'` flow did **not** de-elevate (a privilege-boundary
  surprise), and `runAs:'system'` did not _explicitly_ elevate.

  The engine now establishes the run's data-layer identity at setup and restores
  the caller's context afterward:

  - **`runAs:'system'`** → an elevated, RLS-bypassing system principal
    (`{ isSystem: true }`): the run can read/write records the triggering user
    cannot.
  - **`runAs:'user'`** (default) → the **triggering user's** identity
    (`{ userId, roles, permissions, tenantId }`): CRUD nodes' ObjectQL reads/writes
    respect that user's row-level security, and the run can never exceed the
    triggering user's grants.

  To keep `runAs:'user'` faithful to a direct request by that user, the REST
  trigger route (`@objectstack/runtime`) and the record-change trigger
  (`@objectstack/trigger-record-change`) now forward the caller's resolved
  `roles`/`tenantId` into the `AutomationContext` (new optional fields), not just
  `userId`. The new `resolveRunDataContext` helper is the single place that maps a
  run's effective `runAs` to the ObjectQL context, shared by every data node.

  The `[EXPERIMENTAL — not enforced]` marker is removed from `FlowSchema.runAs`.

  **Behavior change / migration.** Flows that previously relied on the implicit
  elevation (the default `runAs:'user'` ran unscoped) now run as the triggering
  user and are subject to their RLS. **Declare `runAs:'system'` on any flow that
  must read or write beyond the triggering user's access** (e.g. system
  automations, cross-owner roll-ups). Schedule-triggered runs have no trigger user;
  under `user` they stay unscoped (there is no identity to scope to) — declare
  `system` to make elevation explicit.

  Proven both directions by the dogfood regression gate
  (`flow-runas.dogfood.test.ts` — a restricted member triggers system vs user
  flows against an owner-scoped record) and service-automation unit + regression
  tests (`crud-runas.test.ts`).

### Patch Changes

- 61d441f: feat(objectql): duplicate a writable base — ADR-0070 D4 ("duplicate base")

  `protocol.duplicatePackage` clones every ACTIVE item a base owns into a NEW
  package, **re-namespacing** object names (the blueprint prefixes a base's object
  names with its namespace, e.g. `iojn_repair_ticket`, and `sys_metadata` keys on
  `(type,name,org)` so a same-name copy would collide with the source) and
  **rewriting every intra-package reference** (lookup `reference`, view `object`,
  expressions, …) to the new names via a longest-first, identifier-boundary
  replace. Exposed as `POST /packages/:id/duplicate` (body
  `{ targetPackageId, targetName?, targetNamespace? }`).

  Completes ADR-0070 D4 (package = lifecycle unit): delete-cascade and export
  already shipped; this adds the duplicate gesture.

- c224e18: feat(objectql): adopt orphaned metadata into a base — ADR-0070 D5 migration

  `protocol.reassignOrphanedMetadata` bulk-rebinds every package-less orphan
  (`package_id` null / `""` / the `sys_metadata` sentinel left by the pre-
  package-first stopgaps) onto a target base, leaving already-owned rows
  untouched. Exposed as `POST /packages/:id/adopt-orphans`. This is the migration
  affordance behind retiring the "Local / Custom" scope (D5): once an env has no
  orphans, that scope can be dropped from the selector. Pairs with the kernel's
  `writable_package_required` (D1) so no NEW orphans are created.

- aa33b02: fix(security): single-source the request authorization resolver — REST no longer drops sys_user_position

  The REST server and the runtime dispatcher each carried their own copy of the request → ExecutionContext identity/role resolver, and they drifted on a security path. The REST copy silently omitted `sys_user_position` (so custom roles granted via the ADR-0057 D4 platform-RBAC path did not apply over REST), `sys_position_permission_set`, the `owner→org_owner` membership normalization, the platform-admin derivation, and the `ai_seat` synthesis — fail-closed (legitimate access denied), not an escalation.

  Both entry points now delegate to a single shared resolver, `resolveAuthzContext` in `@objectstack/core/security` (joining the API-key verifier that already lived there). A contract test locks every authorization source and a lint gate (`check:authz-resolver`) prevents a future duplicate resolver or a dropped delegation.

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
- Updated dependencies [1e8a813]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [4b5ec6e]
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
- Updated dependencies [a619a3a]
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
  - @objectstack/spec@11.0.0
  - @objectstack/metadata@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/rest@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/driver-sql@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/plugin-org-scoping@11.0.0
  - @objectstack/plugin-security@11.0.0
  - @objectstack/observability@11.0.0
  - @objectstack/driver-memory@11.0.0
  - @objectstack/driver-sqlite-wasm@11.0.0
  - @objectstack/service-cluster@11.0.0
  - @objectstack/service-datasource@11.0.0
  - @objectstack/service-i18n@11.0.0

## 10.3.0

### Patch Changes

- 8cf4f7c: fix(runtime): mount `GET /ready` so the readiness probe is reachable over HTTP

  The dispatcher's `/ready` branch (seam #2) was only reachable when calling
  `dispatch()` directly — no `server.get('${prefix}/ready')` registration existed,
  so a real server returned the Hono not-found 404 before the handler ran (the same
  class of bug as `/mcp` and `/keys`). `/ready` is now mounted alongside `/health`,
  returning 200 while the kernel is `running` and 503 while it is booting or
  draining — the contract the EE multi-node rolling-restart drain gate polls
  (cloud ADR-0018). Adds a registration assertion plus an integration test that
  hits the endpoint through a real HTTP server.

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

- Updated dependencies [2b355d5]
- Updated dependencies [5ba52b0]
- Updated dependencies [211425e]
- Updated dependencies [f2063f3]
  - @objectstack/service-cluster@10.3.0
  - @objectstack/driver-sql@10.3.0
  - @objectstack/objectql@10.3.0
  - @objectstack/service-datasource@10.3.0
  - @objectstack/driver-sqlite-wasm@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/metadata@10.3.0
  - @objectstack/observability@10.3.0
  - @objectstack/formula@10.3.0
  - @objectstack/rest@10.3.0
  - @objectstack/driver-memory@10.3.0
  - @objectstack/plugin-auth@10.3.0
  - @objectstack/plugin-org-scoping@10.3.0
  - @objectstack/plugin-security@10.3.0
  - @objectstack/service-i18n@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0
  - @objectstack/metadata@10.2.0
  - @objectstack/objectql@10.2.0
  - @objectstack/observability@10.2.0
  - @objectstack/driver-memory@10.2.0
  - @objectstack/driver-sql@10.2.0
  - @objectstack/driver-sqlite-wasm@10.2.0
  - @objectstack/plugin-auth@10.2.0
  - @objectstack/plugin-org-scoping@10.2.0
  - @objectstack/plugin-security@10.2.0
  - @objectstack/rest@10.2.0
  - @objectstack/service-cluster@10.2.0
  - @objectstack/service-datasource@10.2.0
  - @objectstack/service-i18n@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Minor Changes

- ac79f16: feat(datasource): auto-connect declared external datasources (ADR-0062 Phase 1, D1/D2/D5)

  A declared external datasource is now connected to a live ObjectQL driver and its
  federated objects are queryable **with zero app code** — no `onEnable` driver
  wiring. Implements ADR-0062 Phase 1.

  - **D1 — one connect path.** New `DatasourceConnectionService` in
    `@objectstack/service-datasource` owns the single "definition → live driver"
    path: build via the injected driver factory → resolve `external.credentialsRef`
    via the `SecretBinder` → connect → `engine.registerDriver` under the datasource
    name → register the datasource def → sync each bound federated object's read
    metadata (DDL-free). Both origins converge on it: the runtime-admin
    `registerPool` now delegates here, and `AppPlugin` auto-connects code-defined
    datasources. Exposed as the `'datasource-connection'` kernel service.
  - **D2 — opt-in-safe gate.** A declared datasource auto-connects only when it is
    `external`, an object **explicitly** binds to it via `object.datasource`, or it
    sets the new `autoConnect: true` flag. A managed datasource that nothing
    explicitly binds (incl. ones referenced only by a `datasourceMapping` rule, e.g.
    `examples/app-crm`'s `:memory:` datasources) stays metadata-only — existing apps
    are byte-for-byte unchanged. See the ADR-0062 D2 implementation note.
  - **D5 — lifecycle, ordering & policy.** Connect happens in `AppPlugin.start()`
    (before the `kernel:ready` validation gate, relying on the kernel's
    init-all-then-start-all ordering). Fail-fast for a declared `external` datasource
    with `validation.onMismatch: 'fail'`; degrade-with-warning otherwise (and always
    for runtime-admin/rehydrate, so a UI action or replica blip never bricks the
    server). Adds a host-injectable `DatasourceConnectPolicy` (open-core default
    allows; a multi-tenant host binds a stricter fail-closed policy for egress
    isolation) consulted before every connect — one connect path, no cloud fork.

  Adds `datasource.autoConnect` to the spec. The legacy `onEnable` +
  `ctx.drivers.register` bridge remains supported as an escape hatch (idempotent vs.
  auto-connect). No behavior change for managed apps.

### Patch Changes

- 94d2161: refactor(runtime): build the standalone default driver via the shared datasource factory (ADR-0062 follow-up)

  `createStandaloneStack` now constructs its `default` driver for the user-facing
  kinds (memory / better-sqlite3 / postgres / mongodb) through the **same**
  `createDefaultDatasourceDriverFactory` used for declared and runtime-admin
  datasources — one "driver kind → instance" construction path instead of two
  hand-mirrored ones. Adding a dialect or changing connection/pool defaults now
  happens in a single place. URL→config translation, filesystem prep (`mkdir`),
  and pre-engine `DriverPlugin` registration stay in the stack (unchanged); the
  factory only constructs the driver. The pure-JS WASM sqlite driver stays bespoke
  in the stack — it's the standalone-specific, CI-safe default and not a
  user-creatable datasource type, so it has a single construction site already.

  No behavior change: the same driver instances are built for the same inputs
  (verified by a per-kind connect + CRUD round-trip test and a real `os dev` boot).
  Adds `@objectstack/service-datasource` as a runtime dependency (no cycle — that
  package depends only on core/spec).

- Updated dependencies [49da36e]
- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [517dad9]
  - @objectstack/spec@10.1.0
  - @objectstack/service-datasource@10.1.0
  - @objectstack/driver-sql@10.1.0
  - @objectstack/rest@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/metadata@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/observability@10.1.0
  - @objectstack/driver-memory@10.1.0
  - @objectstack/driver-sqlite-wasm@10.1.0
  - @objectstack/plugin-auth@10.1.0
  - @objectstack/plugin-org-scoping@10.1.0
  - @objectstack/plugin-security@10.1.0
  - @objectstack/service-cluster@10.1.0
  - @objectstack/service-i18n@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Minor Changes

- e16f2a8: **BREAKING:** the system object `sys_department` is renamed to `sys_business_unit`
  — object + member table (`sys_department_member` → `sys_business_unit_member`),
  fields, and i18n — with **no compatibility alias**. Any deployment holding
  `sys_department` rows, or metadata that references the object by name (lookups,
  list views, queries, sharing/approval scopes), must migrate to `sys_business_unit`.
  A renamed shipped system object is a breaking change to the platform's public
  data surface, so this lands as a **major**. Verified per ADR-0059's pre-publish
  hotcrm gate: no published downstream consumer references the old name.

  ADR-0057 — ERP authorization core. Adds permission-grant access DEPTH
  (`own`/`own_and_reports`/`unit`/`unit_and_below`/`org`), renames `sys_department`
  → `sys_business_unit` (no aliases — see BREAKING above), introduces the platform-owned
  `sys_user_position` assignment, and seeds stack-declared `roles`/`sharingRules` into
  `sys_position`/`sys_sharing_rule` at boot (closes #2077). Hierarchy-relative scopes are
  delegated to a pluggable `IHierarchyScopeResolver` (open edition fails closed to
  owner-only; `defineStack` errors without `requires: ['hierarchy-security']`). Also
  fixes a latent over-grant where `engine.find({ filter })` was ignored (driver reads
  `where`) — normalized `filter`→`where` in the engine.

- 220ce5b: Resolve the tenant default currency onto ExecutionContext.

  Adds `ExecutionContext.currency` (ISO 4217) and resolves it from the
  `localization.currency` setting alongside `timezone`/`locale` — in both the
  runtime `resolveExecutionContext` and the REST mirror. This is the foundation
  for the documented "applied when a currency field omits its own" fallback: the
  tenant default is now carried on every request context, so analytics enrichment,
  formatters, and renderers can resolve a measure/field currency down to the org
  default instead of hard-coding it. Undefined when no tenant default is
  configured (consumers then render a plain number).

### Patch Changes

- 47d978a: Fix: the artifact-serve path now honors an app-declared default permission-set
  profile (`isProfile: true, isDefault: true`) under `objectstack dev`/`serve`/`start`.

  `createStandaloneStack` (the boot path used when serving a compiled
  `dist/objectstack.json` with no host `objectstack.config.ts`) surfaced
  `objects`/`requires`/`manifest` from the artifact bundle but dropped
  `permissions[]` and `roles[]`. As a result the CLI's
  `appDefaultProfileName(config.permissions)` saw `undefined` and the SecurityPlugin
  fell back to the built-in owner-only `member_default` — so an app whose default
  profile carries e.g. `readScope: 'unit_and_below'` (ADR-0056 D7 / ADR-0057 D1)
  was silently ignored. The config-load path was unaffected because the app's
  `permissions` survived via the original stack object.

  `createStandaloneStack` now surfaces `permissions[]` and `roles[]` from the
  artifact bundle, mirroring the existing `objects`/`requires`/`manifest` handling,
  so the artifact-serve path applies the app default profile exactly like the
  config-load path.

- Updated dependencies [d7ff626]
- Updated dependencies [92db3e5]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [3754f80]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
  - @objectstack/spec@10.0.0
  - @objectstack/driver-sql@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/rest@10.0.0
  - @objectstack/plugin-security@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/metadata@10.0.0
  - @objectstack/observability@10.0.0
  - @objectstack/driver-memory@10.0.0
  - @objectstack/driver-sqlite-wasm@10.0.0
  - @objectstack/plugin-auth@10.0.0
  - @objectstack/plugin-org-scoping@10.0.0
  - @objectstack/service-cluster@10.0.0
  - @objectstack/service-i18n@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

### Patch Changes

- 2afb612: feat(security): resolve `current_user.email` in RLS owner policies

  RLS `using` predicates can now reference **`current_user.email`** — a unique,
  human-readable, _seedable_ owner anchor (`owner = current_user.email`). Previously
  the RLS compiler resolved only `current_user.id` / `organization_id` / `roles` /
  `org_user_ids`, so any owner-by-name/email predicate silently compiled to the
  deny sentinel (fail-closed → the user saw nothing). Email is sourced for free
  from the auth session (with a bounded `sys_user` fallback for the API-key path)
  and threaded onto the `ExecutionContext` in both identity resolvers — the REST
  data path (`rest-server`) and the dispatcher path (`resolve-execution-context`).

  Display `name` is deliberately **not** exposed to RLS: names collide, and a
  collision on an ownership predicate is an access-control leak. Only unique
  identifiers (`id`, `email`) are resolvable.

  This makes owner-scoped row-level security work with seed data (no per-user ids
  needed) and, combined with `controlled_by_parent` (ADR-0055), lets a master's
  owner scoping flow to its detail records. The example-showcase demonstrates it:
  `showcase_invoice` carries an `owner` email + an owner RLS policy, its lines are
  controlled-by-parent, and invoices/lines are seeded per owner. It also fixes the
  showcase's previously inert owner predicates (they used `==` and `current_user.name`,
  neither of which the compiler accepts) to `= current_user.email`.

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
  - @objectstack/spec@9.11.0
  - @objectstack/rest@9.11.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/driver-sql@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/formula@9.11.0
  - @objectstack/metadata@9.11.0
  - @objectstack/observability@9.11.0
  - @objectstack/driver-memory@9.11.0
  - @objectstack/driver-sqlite-wasm@9.11.0
  - @objectstack/plugin-auth@9.11.0
  - @objectstack/plugin-org-scoping@9.11.0
  - @objectstack/service-cluster@9.11.0
  - @objectstack/service-i18n@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Minor Changes

- 1f88fd9: Add a transaction boundary to sandboxed hook/action bodies: `ctx.api.transaction(async () => { … })`. Every `ctx.api` read/write inside the callback runs in one driver transaction — committed when the callback returns, rolled back if it throws (or if the body leaves the transaction open at timeout). Guarded by the new `api.transaction` capability.

  - **spec**: new `api.transaction` capability token on `HookBodyCapability`.
  - **objectql**: `ScopedContext` gains discrete `beginTransaction()` / `commitTransaction(handle)` / `rollbackTransaction(handle)` primitives. The handle is threaded **explicitly** through a child context (`resolveTx` honors it ahead of the ambient `txStore`), because the sandbox drives the body across many host event-loop turns where AsyncLocalStorage context does not survive. Degrades to non-transactional execution when the driver has no transaction support.
  - **runtime**: the QuickJS runner wires `ctx.api.transaction` over three deferred-promise host leaves (begin/commit/rollback), routes in-transaction ops through the tx-scoped context, and rolls back a transaction the body left open before disposing the VM.

- e2b5324: feat(ownership): auto-provision a canonical `owner_id` and hand seeded records to the first admin

  Ownership is now correct-by-default instead of opt-in — closing the gap where
  seeded demo data ended up owned by nobody a human can log in as (so "My" views,
  owner reports and owner notifications were empty out of the box) and where
  author-written objects silently shipped with no working ownership at all.

  - **`applySystemFields` (objectql)** now auto-injects a canonical, reassignable
    `owner_id` lookup (→ `sys_user`) on user-authored business objects, alongside
    the existing tenant/audit fields. Unlike the audit `*_by` lookups it is NOT
    readonly — ownership transfers. Withheld for `managedBy` / `sys_*` tables and
    for objects that opt out via `ownership: 'org' | 'none'` (Dataverse-style). The
    safe default direction: forgetting the opt-out leaves a harmless spare column,
    whereas the old opt-IN model let authors ship objects with broken ownership.
    Once present, the existing machinery engages automatically (insert auto-stamp,
    owner-scoped RLS, owner-keyed views/reports).

  - **`claimSeedOwnership` (plugin-security)**, invoked from `bootstrapPlatformAdmin`
    right after the first human is promoted to platform admin, transfers ownership
    of seeded rows (`owner_id` NULL or `usr_system`) to that admin. The ownership
    twin of org-scoping's `claimOrphanOrgRows`. Idempotent; skips `managedBy` /
    `sys_*`. Authors write plain seed records (no `owner_id`) and the platform —
    not the author — performs the handoff, so there is nothing to remember or
    mistype.

  - **`usr_system` is never minted (runtime + objectql).** The seed loader binds
    `os.user` to a NULL identity, so `cel`os.user.id``resolves to NULL at seed
time (the owning admin does not exist yet) and the row seeds NULL-owned — then
the handoff above fills it. The runtime's`ensureSeedIdentity`(the only code
that inserted a`usr_system`row) is removed.`SystemUserId.SYSTEM`survives
only as a reserved id so legacy DBs' exclusion guards / ownership handoff still
recognize a pre-existing row.`os.org`is unaffected (derived from`organizationId`).

  Also hardens `bootstrapPlatformAdmin` against a latent dts typecheck error
  (defensive read of the untyped `description` on seed permission sets).

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [d9508d1]
- Updated dependencies [1d352d3]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [f169558]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/driver-sql@9.10.0
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/plugin-org-scoping@9.10.0
  - @objectstack/plugin-security@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/rest@9.10.0
  - @objectstack/driver-sqlite-wasm@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/metadata@9.10.0
  - @objectstack/observability@9.10.0
  - @objectstack/driver-memory@9.10.0
  - @objectstack/plugin-auth@9.10.0
  - @objectstack/service-cluster@9.10.0
  - @objectstack/service-i18n@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/metadata@9.9.1
- @objectstack/objectql@9.9.1
- @objectstack/observability@9.9.1
- @objectstack/formula@9.9.1
- @objectstack/rest@9.9.1
- @objectstack/driver-memory@9.9.1
- @objectstack/driver-sql@9.9.1
- @objectstack/driver-sqlite-wasm@9.9.1
- @objectstack/plugin-auth@9.9.1
- @objectstack/plugin-org-scoping@9.9.1
- @objectstack/plugin-security@9.9.1
- @objectstack/service-cluster@9.9.1
- @objectstack/service-i18n@9.9.1

## 9.9.0

### Minor Changes

- 11af299: feat(runtime): resolve a reference timezone onto ExecutionContext (ADR-0053 Phase 2 foundation)

  Adds `ExecutionContext.timezone` (optional IANA zone) and resolves it once per request in `resolveExecutionContext`, with precedence **user preference → org default → `UTC`**:

  - User override: `sys_user_preference` row `(user_id, key='timezone')`.
  - Org default: the tenant-scoped `sys_setting` `(namespace='localization', key='timezone', scope='tenant')` — one org per physical tenant (ADR-0002), so no tenant_id filter is needed.
  - An invalid IANA zone is ignored and resolution falls through; every read is defensive and never blocks auth.

  This is **pure plumbing with no behavior change**: nothing reads `ctx.timezone` yet, and an absent value resolves to `UTC` (today's behavior). It is the foundation the rest of ADR-0053 Phase 2 consumes — tz-aware `today()`/`daysFromNow()` (#1980), datetime rendering (#1981), and analytics bucketing (#1982). A discoverable `localization` settings manifest for the org default is a follow-up; the resolver already reads the row if present.

  Part of #1978.

- 9afeb2d: feat(settings): `localization` settings — platform default timezone, language & formats (ADR-0053 Phase 2)

  Adds a `localization` SettingsManifest, the missing keystone that makes the Phase 2 reference-timezone actually configurable end-to-end. One declaration gives the full settings stack for free: platform built-in default → `global` → `tenant` cascade, a permission-gated settings page, and i18n.

  **Keys** (organization-level; per-user overrides intentionally out of scope for v1): `timezone` (UTC), `locale` (en-US), `default_country`, `date_format`, `time_format`, `number_format`, `first_day_of_week`, `currency` (USD), `fiscal_year_start`. Benchmarked against Salesforce/Workday "Company Information + Locale".

  **Resolver 收编** — `resolveExecutionContext` now resolves `timezone` **and** `locale` from the `localization` settings via the `settings` service (canonical 4-tier cascade), falling back to a direct tenant-scoped `sys_setting` read, then `UTC` / `en-US`. This replaces the hand-rolled `sys_user_preference` + tenant-only `sys_setting` path from #1978 (which bypassed the settings abstraction and is dropped along with the per-user tier). New `ExecutionContext.locale`.

  **Consumer wiring** — analytics date bucketing now picks up the resolved org timezone: `DatasetExecutor` threads `ExecutionContext.timezone` into the query (precedence: explicit selection tz → request tz → UTC), so #1982's tz-aware buckets fire for a configured org without callers passing a zone. Formula `today()`/`datetime` were already wired (#1979/#1980).

  Email `datetime` rendering (`SendTemplateInput.timezone`, shipped in #1981) is intentionally **not** wired here: the only current `sendTemplate` callers are pre-session auth emails with no org context; business-notification callers can pass the zone when they appear.

### Patch Changes

- 83fd318: fix(runtime): drive sandbox host calls with deferred promises and a deadline-bounded pump

  The QuickJS sandbox exposed `ctx.api.object(x).find/update/...` via `newAsyncifiedFunction`, which unwinds the WASM stack per host call and forbids a second call while the first is unwound. A script awaiting two host calls in sequence (e.g. an action doing `findOne()` then `update()`) drove the second call from a continuation resumed inside `executePendingJobs`, corrupting the wasm heap (`memory access out of bounds` / `p->ref_count == 0`) or exhausting the fixed 1000-iteration pump budget — surfacing as `action '…' did not resolve after 1000 pump iterations`.

  Host API methods are now exposed as deferred QuickJS promises (`vm.newPromise()`), so sequential `await`s compose with no stack unwinding, and the pump loop is bounded by the configured `timeoutMs` instead of a fixed iteration cap. Host **method** calls now require `await` (the `.object(name)` proxy getter stays synchronous); a stuck/never-settling host call is cut off with a clear timeout error.

- Updated dependencies [84249a4]
- Updated dependencies [0d4e3f3]
- Updated dependencies [44c5348]
- Updated dependencies [796f0d6]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [92d75ca]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/plugin-auth@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/rest@9.9.0
  - @objectstack/driver-sql@9.9.0
  - @objectstack/plugin-security@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/formula@9.9.0
  - @objectstack/metadata@9.9.0
  - @objectstack/observability@9.9.0
  - @objectstack/driver-memory@9.9.0
  - @objectstack/driver-sqlite-wasm@9.9.0
  - @objectstack/plugin-org-scoping@9.9.0
  - @objectstack/service-cluster@9.9.0
  - @objectstack/service-i18n@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

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
  - @objectstack/core@9.8.0
  - @objectstack/metadata@9.8.0
  - @objectstack/observability@9.8.0
  - @objectstack/driver-memory@9.8.0
  - @objectstack/driver-sql@9.8.0
  - @objectstack/driver-sqlite-wasm@9.8.0
  - @objectstack/plugin-auth@9.8.0
  - @objectstack/plugin-org-scoping@9.8.0
  - @objectstack/plugin-security@9.8.0
  - @objectstack/service-cluster@9.8.0
  - @objectstack/service-i18n@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- Updated dependencies [82c7438]
- Updated dependencies [417b6ac]
- Updated dependencies [ff0a87a]
  - @objectstack/formula@9.7.0
  - @objectstack/objectql@9.7.0
  - @objectstack/spec@9.7.0
  - @objectstack/core@9.7.0
  - @objectstack/types@9.7.0
  - @objectstack/metadata@9.7.0
  - @objectstack/observability@9.7.0
  - @objectstack/rest@9.7.0
  - @objectstack/driver-memory@9.7.0
  - @objectstack/driver-sql@9.7.0
  - @objectstack/driver-sqlite-wasm@9.7.0
  - @objectstack/plugin-auth@9.7.0
  - @objectstack/plugin-org-scoping@9.7.0
  - @objectstack/plugin-security@9.7.0
  - @objectstack/service-cluster@9.7.0
  - @objectstack/service-i18n@9.7.0

## 9.6.0

### Patch Changes

- 71578f2: feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

  Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

  - `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
  - Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
  - REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).

- Updated dependencies [d1e930a]
- Updated dependencies [1b82b64]
- Updated dependencies [71578f2]
- Updated dependencies [bb00a50]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/plugin-auth@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/rest@9.6.0
  - @objectstack/formula@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/metadata@9.6.0
  - @objectstack/observability@9.6.0
  - @objectstack/driver-memory@9.6.0
  - @objectstack/driver-sql@9.6.0
  - @objectstack/driver-sqlite-wasm@9.6.0
  - @objectstack/plugin-org-scoping@9.6.0
  - @objectstack/plugin-security@9.6.0
  - @objectstack/service-cluster@9.6.0
  - @objectstack/service-i18n@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/formula@9.5.1
  - @objectstack/metadata@9.5.1
  - @objectstack/objectql@9.5.1
  - @objectstack/observability@9.5.1
  - @objectstack/driver-memory@9.5.1
  - @objectstack/driver-sql@9.5.1
  - @objectstack/driver-sqlite-wasm@9.5.1
  - @objectstack/plugin-auth@9.5.1
  - @objectstack/plugin-org-scoping@9.5.1
  - @objectstack/plugin-security@9.5.1
  - @objectstack/rest@9.5.1
  - @objectstack/service-cluster@9.5.1
  - @objectstack/service-i18n@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/rest@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/formula@9.5.0
  - @objectstack/metadata@9.5.0
  - @objectstack/objectql@9.5.0
  - @objectstack/observability@9.5.0
  - @objectstack/driver-memory@9.5.0
  - @objectstack/driver-sql@9.5.0
  - @objectstack/driver-sqlite-wasm@9.5.0
  - @objectstack/plugin-auth@9.5.0
  - @objectstack/plugin-org-scoping@9.5.0
  - @objectstack/plugin-security@9.5.0
  - @objectstack/service-cluster@9.5.0
  - @objectstack/service-i18n@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Minor Changes

- 0856476: feat(metadata): package-scoped single-item resolution via `?package=` (ADR-0048)

  A single-item metadata GET (`/meta/:type/:name?package=<id>`) now resolves
  package-scoped (prefer-local): when two installed packages ship an item of the
  same `type`/`name`, the requester's own package wins. Previously only the _list_
  endpoint was package-aware; a single-item fetch was context-free, so a
  cross-package collision always resolved to whichever package registered first.

  The fix threads `packageId` end-to-end:

  - `@objectstack/rest` — the cacheable single-item path called `getMetaItemCached`
    (ETag keyed on type+name only) and dropped `?package=`. A `?package=` read now
    bypasses that cache and takes the disambiguating `getMetaItem(type, name,
packageId)` path, so two same-named items never share one cache entry.
  - `@objectstack/objectql` — `protocol.getMetaItem` forwards `packageId` to the
    overlay query (`sys_metadata.package_id`), `MetadataFacade.get`, and
    `registry.getItem`; `MetadataFacade.get` gained an optional `currentPackageId`.
  - `@objectstack/runtime` — the parallel HTTP dispatcher threads `?package=` too.

  This lets the doc viewer (`/apps/:packageId/docs/:name`) resolve one doc scoped
  to its app, so `doc` names no longer need a namespace prefix for uniqueness (the
  prefix becomes a recommended convention, like `page`/`dashboard`/`report`);
  `doc.zod` doc-comments updated accordingly.

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [2c8e607]
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/metadata@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/rest@9.4.0
  - @objectstack/driver-sql@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0
  - @objectstack/observability@9.4.0
  - @objectstack/driver-memory@9.4.0
  - @objectstack/driver-sqlite-wasm@9.4.0
  - @objectstack/plugin-auth@9.4.0
  - @objectstack/plugin-org-scoping@9.4.0
  - @objectstack/plugin-security@9.4.0
  - @objectstack/service-cluster@9.4.0
  - @objectstack/service-i18n@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Patch Changes

- 1ada658: ADR-0046 P1: package documentation as metadata. New `doc` metadata element — flat Markdown files under `src/docs/*.md` compile into `docs: DocSchema[]` on the stack and register like any other metadata.

  - spec: `DocSchema` ({ name, label?, content }) in `system/`, `StackDefinition.docs`, `doc` in `MetadataTypeSchema` + type registry (inert data, runtime-creatable) + canonical schema map, `docs → doc` plural mapping.
  - cli: `os build` collects flat `src/docs/*.md` (frontmatter `title:`/first `#` heading → label) and enforces the ADR lint — flat directory, namespace-prefixed snake_case names, namespace required when docs ship, MDX/image ban, same-package relative-link resolution. Same rules surface in `os lint`.
  - objectql: `docs` joins the generic metadata registration loop (manifest + nested plugins).
  - runtime: docs count as app payload; `GET /metadata/doc` list responses omit `content` by default (`?include=content` opts in) so unbounded manuals stay off hot paths.

- Updated dependencies [1ada658]
- Updated dependencies [b08d08d]
- Updated dependencies [6259882]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/rest@9.3.0
  - @objectstack/metadata@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/formula@9.3.0
  - @objectstack/observability@9.3.0
  - @objectstack/driver-memory@9.3.0
  - @objectstack/driver-sql@9.3.0
  - @objectstack/driver-sqlite-wasm@9.3.0
  - @objectstack/plugin-auth@9.3.0
  - @objectstack/plugin-org-scoping@9.3.0
  - @objectstack/plugin-security@9.3.0
  - @objectstack/service-cluster@9.3.0
  - @objectstack/service-i18n@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0
  - @objectstack/metadata@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/observability@9.2.0
  - @objectstack/driver-memory@9.2.0
  - @objectstack/driver-sql@9.2.0
  - @objectstack/driver-sqlite-wasm@9.2.0
  - @objectstack/plugin-auth@9.2.0
  - @objectstack/plugin-org-scoping@9.2.0
  - @objectstack/plugin-security@9.2.0
  - @objectstack/rest@9.2.0
  - @objectstack/service-cluster@9.2.0
  - @objectstack/service-i18n@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0
  - @objectstack/metadata@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/observability@9.1.0
  - @objectstack/driver-memory@9.1.0
  - @objectstack/driver-sql@9.1.0
  - @objectstack/driver-sqlite-wasm@9.1.0
  - @objectstack/plugin-auth@9.1.0
  - @objectstack/plugin-org-scoping@9.1.0
  - @objectstack/plugin-security@9.1.0
  - @objectstack/rest@9.1.0
  - @objectstack/service-cluster@9.1.0
  - @objectstack/service-i18n@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1
  - @objectstack/metadata@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/observability@9.0.1
  - @objectstack/driver-memory@9.0.1
  - @objectstack/driver-sql@9.0.1
  - @objectstack/driver-sqlite-wasm@9.0.1
  - @objectstack/plugin-auth@9.0.1
  - @objectstack/plugin-org-scoping@9.0.1
  - @objectstack/plugin-security@9.0.1
  - @objectstack/rest@9.0.1
  - @objectstack/service-cluster@9.0.1
  - @objectstack/service-i18n@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/plugin-auth@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0
  - @objectstack/metadata@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/observability@9.0.0
  - @objectstack/driver-memory@9.0.0
  - @objectstack/driver-sql@9.0.0
  - @objectstack/driver-sqlite-wasm@9.0.0
  - @objectstack/plugin-org-scoping@9.0.0
  - @objectstack/plugin-security@9.0.0
  - @objectstack/rest@9.0.0
  - @objectstack/service-cluster@9.0.0
  - @objectstack/service-i18n@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/metadata@8.0.1
- @objectstack/objectql@8.0.1
- @objectstack/observability@8.0.1
- @objectstack/formula@8.0.1
- @objectstack/rest@8.0.1
- @objectstack/driver-memory@8.0.1
- @objectstack/driver-sql@8.0.1
- @objectstack/driver-sqlite-wasm@8.0.1
- @objectstack/plugin-auth@8.0.1
- @objectstack/plugin-org-scoping@8.0.1
- @objectstack/plugin-security@8.0.1
- @objectstack/service-cluster@8.0.1
- @objectstack/service-i18n@8.0.1

## 8.0.0

### Minor Changes

- f68be58: feat(runtime): API-key generation endpoint — show-once `sys_api_key` (ADR-0036, closes framework#1629)

  Adds `POST /api/v1/keys` — the only path that mints a `sys_api_key`. Phase 1a
  shipped key _verification_ and the `generateApiKey()` primitive; this is the
  missing _generation_ half that unblocks the self-serve connect flow.

  - Requires an authenticated principal; returns the **raw secret exactly once**
    (`{ id, name, prefix, key }`). Only the sha256 **hash** is persisted — the raw
    key is never stored, logged, or re-displayable.
  - **Security (zero-tolerance):** `user_id` is pinned to the caller and never read
    from the body (no impersonation); the body is whitelisted to `name` (+ optional
    validated future `expires_at`) — any `key`/`id`/`user_id`/`revoked` in the body
    is ignored, so a caller cannot forge a known-secret or escalate. The row is
    written with an elevated `{ isSystem: true }` context (sys_api_key is
    protection-locked) with server-controlled contents. Anonymous → 401;
    non-POST → 405; past/unparseable `expires_at` → 400.
  - `scopes` are intentionally NOT accepted from the body in v1 (the verify path
    adds scopes to permissions, so honouring arbitrary body scopes would be an
    escalation vector); a generated key acts exactly AS the caller via `user_id`
    resolution. Scoped/narrowing keys need subset-enforcement — deferred.

  11 security tests (show-once, hash-not-raw persisted, round-trip auth via the
  verify path, impersonation blocked, forgery blocked, 401/405/400, expiry
  end-to-end). Full runtime suite green (376).

- bc0d85b: feat(mcp): Streamable HTTP transport — every app is a network-reachable MCP server (ADR-0036 Phase 2)

  The MCP server plugin spoke **stdio only**, so a remote agent (Claude Desktop /
  Cursor) could not connect to a hosted env. This adds the **Streamable HTTP**
  transport and wires it into the runtime's request path, building on the Phase 1a
  `sys_api_key` auth foundation.

  - **`@objectstack/mcp`** (renamed from `@objectstack/plugin-mcp-server` — see the rename changeset)

    - `MCPServerRuntime.handleHttpRequest(request, { bridge, parsedBody })` —
      serves one MCP request over the Web-standard `WebStandardStreamableHTTPServerTransport`
      (runs on Node 18+, Workers, Deno, Bun). **Stateless**: a fresh, isolated
      `McpServer` + transport is built per request (the SDK-recommended pattern),
      in JSON-response mode so the response is fully buffered — no streaming
      pass-through concerns over the Worker→container hop.
    - New `registerObjectTools` + `McpDataBridge` (`mcp-http-tools.ts`): the
      object-CRUD tool set (`list_objects`, `describe_object`, `query_records`,
      `get_record`, `create_record`, `update_record`, `delete_record`). All
      execution is delegated to an injected, **principal-bound** bridge — the tool
      layer never touches the data engine directly. System (`sys_*`) objects are
      **not exposed** by default (fail-closed guard on every object-scoped tool).
      The internal AI/authoring toolRegistry is deliberately NOT bridged onto the
      external surface.

  - **`@objectstack/runtime`**
    - `HttpDispatcher` serves `/mcp`: **opt-in** via `OS_MCP_SERVER_ENABLED=true`
      (404 when off, so the surface isn't advertised); **fail-closed auth**
      (anonymous → 401 — requires the principal resolved by Phase 1a's API-key
      path or a session). It builds an `McpDataBridge` that runs every operation
      through the existing `callData` path bound to the request's
      `ExecutionContext`, so external agents run under the key's permissions + RLS,
      never a parallel or escalated path. The discovery endpoint advertises `mcp`
      only when enabled.

  Security: every external MCP entry runs as the scoped `sys_api_key` principal
  under existing object permissions + RLS; MCP is opt-in per env; no raw keys or
  secrets cross the wire. Fully unit-tested (transport handshake/tools, gate,
  auth, principal binding).

### Patch Changes

- 2537e28: fix(runtime): adapt node/Hono req → Web Request for the MCP transport (ADR-0036)

  The MCP Streamable HTTP transport needs a Web-standard `Request`, but the
  runtime HTTP adapter hands the dispatcher a node/Hono-style req (plain `headers`
  object, path-only `url`). `handleMcp` rejected it with 400 ("MCP transport
  requires a standard HTTP request") — so the live endpoint was unusable even
  once routed + registered. Unit tests passed a real `Request`, hiding it; caught
  in staging e2e on `initialize`.

  `handleMcp` now reconstructs a Web `Request` (method, absolute URL from
  host+path, normalised headers, JSON body from the parsed body) when the inbound
  req isn't already Web-standard. Regression tests cover a POST and a GET
  node-style req.

- 0ec7717: fix(runtime): mount /mcp and /keys HTTP routes (ADR-0036) — were unreachable

  The dispatcher mounts routes EXPLICITLY on the HTTP server (no catch-all). The
  MCP transport (#1626) and key-generation (#1630) added branches inside
  `dispatch()` but never registered the corresponding `server.<verb>()` routes, so
  `/api/v1/mcp` and `/api/v1/keys` 404'd at the HTTP layer before ever reaching
  the dispatcher. Unit tests called the handlers directly, hiding the gap; it only
  showed up in live staging e2e.

  - Register `/mcp` (GET/POST/DELETE → dispatch, transport reads the method) and
    `/keys` (POST) in the dispatcher plugin, routed through `dispatch()` so the
    host's project-aware kernel swap + executionContext resolution run first.
  - Add `dispatcher-plugin.routes.test.ts` asserting the routes are registered
    (the regression that would have caught this).

- c262301: fix(rest): REST data API honors sys_api_key — one shared verifier with MCP (closes #1633)

  Staging e2e found the MCP surface authenticated a `sys_api_key` but the REST data
  API (`@objectstack/rest`) returned 401 for the same key — its `resolveExecCtx`
  only checked the better-auth session, never the API key.

  Converged both surfaces onto ONE verifier so they can't drift:

  - **`@objectstack/core/security`** now owns the shared `sys_api_key` primitives
    (`hashApiKey`, `generateApiKey`, `extractApiKey`, `parseScopes`, `isExpired`)
    plus a new `resolveApiKeyPrincipal(ql, headers, nowMs?)` that hashes the
    inbound key, looks it up by the indexed at-rest hash, and rejects unknown /
    revoked / expired / owner-less keys (fail-closed). `core` is the natural home:
    both `rest` and `runtime` depend on it, it depends on neither (no cycle), and
    it's server-side (already uses `node:crypto`).
  - **`@objectstack/runtime`** — `security/api-key.ts` re-exports the primitives
    from core (stable import surface) and `resolveExecutionContext` now delegates
    its API-key branch to `resolveApiKeyPrincipal`.
  - **`@objectstack/rest`** — `resolveExecCtx` resolves the data engine once and
    tries `resolveApiKeyPrincipal` (x-api-key / `Authorization: ApiKey`) BEFORE the
    session, so `/api/v1/data` + `/api/v1/meta` now authenticate an API key under
    the key's permissions + RLS, exactly like the dispatcher/MCP path.

  Tests: core `api-key.test.ts` (primitives + verifier: valid / revoked / expired /
  unknown / owner-less / plaintext-not-matched / fail-closed-ql). runtime + rest
  suites green.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [e6374b5]
- Updated dependencies [1e8b680]
- Updated dependencies [0a6438e]
- Updated dependencies [3306d2f]
- Updated dependencies [ae7fb3f]
- Updated dependencies [c262301]
- Updated dependencies [e1478fe]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/driver-sql@8.0.0
  - @objectstack/plugin-auth@8.0.0
  - @objectstack/plugin-security@8.0.0
  - @objectstack/rest@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/formula@8.0.0
  - @objectstack/metadata@8.0.0
  - @objectstack/observability@8.0.0
  - @objectstack/driver-memory@8.0.0
  - @objectstack/driver-sqlite-wasm@8.0.0
  - @objectstack/plugin-org-scoping@8.0.0
  - @objectstack/service-cluster@8.0.0
  - @objectstack/service-i18n@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- ac1fc4c: feat(metadata): draft-overlay reads so an admin can render the console off pending drafts before publish

  ADR-0033's loop is `build (draft) → review → publish`, but "review" was only a JSON diff — the one thing that actually confirms an AI/hand-authored change (the rendered object page / kanban / form / nav) only existed _after_ publish. That forces publishing unreviewed metadata just to look at it, defeating the draft gate.

  This adds a request-scoped **draft-overlay read mode** to the metadata resolution layer:

  - `getMetaItems({ …, previewDrafts })` — after the active overlay, overlays `state='draft'` rows on top (draft WINS on name collision; draft-only items surface too). Drafts are never hydrated into the process-wide SchemaRegistry.
  - `getMetaItem({ …, previewDrafts })` — non-strict: prefers a draft row if one exists, else falls back to the active value (unlike the strict `state:'draft'` mode, which 404s `no_draft`).
  - Every overlaid item is tagged `_draft: true` so the UI can badge it and show a "preview" banner.
  - The runtime HTTP dispatcher threads `?preview=draft` on `GET /metadata/:type` and `GET /metadata/:type/:name` into these reads.

  The same overlay also unblocks the AI authoring agent referencing its own just-drafted objects (a follow-up will point `list_metadata` at it). Admin gating of the `?preview=draft` flag is a deliberate follow-up step.

  Note: a brand-new draft object has no physical table until publish, so preview renders its _shape_ (form/view/kanban/nav) but shows no data; field-additions to existing objects preview fully.

- ac1fc4c: feat(packages): one-click discard-drafts and full delete for a package

  Two distinct package-level lifecycle operations, both built on the per-item delete primitive:

  - **`discardPackageDrafts(packageId)`** — drop every pending DRAFT bound to the package, reverting it to its last published baseline. NON-destructive: active/published metadata and physical tables are untouched. Use case: "I edited this app for a while and it turned out worse than before — abandon all my changes." Routes through the sys_metadata path (no metadata-service dependency, unlike the existing `POST /packages/:id/revert`, which 503s without a metadata service). REST: `POST /packages/:id/discard-drafts`.

  - **`deletePackage(packageId)`** — remove the ENTIRE package: every `sys_metadata` row (active + draft) and, by default, the physical table of each object it defined (DESTRUCTIVE). `keepData: true` removes metadata but preserves tables; the `sys_`-table guard still applies. Use case: "I don't want this package anymore." `DELETE /packages/:id` now performs this persisted removal in addition to the in-memory registry unregister it already did (previously it left AI/runtime packages' rows and tables behind); `?keepData=true` opts out of teardown.

  Drafts are deleted before active rows so each object's table is torn down exactly once. Per-item failures are collected without aborting the rest.

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/objectql@7.9.0
  - @objectstack/rest@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/types@7.9.0
  - @objectstack/metadata@7.9.0
  - @objectstack/observability@7.9.0
  - @objectstack/formula@7.9.0
  - @objectstack/driver-memory@7.9.0
  - @objectstack/driver-sql@7.9.0
  - @objectstack/driver-sqlite-wasm@7.9.0
  - @objectstack/plugin-auth@7.9.0
  - @objectstack/plugin-org-scoping@7.9.0
  - @objectstack/plugin-security@7.9.0
  - @objectstack/service-cluster@7.9.0
  - @objectstack/service-i18n@7.9.0

## 7.8.0

### Patch Changes

- a75823a: feat(metadata): expose pending DRAFT metadata (ADR-0033 draft discoverability)

  AI-authored metadata lands as drafts (`sys_metadata` rows with `state='draft'`, bound to an app package), but the only list path — `getMetaItems` — reads the active registry, so drafts were invisible: a just-built app package looked empty and there was no "pending changes" surface.

  - `SysMetadataRepository.listDrafts({type?, packageId?})` lists draft rows (mirrors `list()` but scoped to `state='draft'`, optionally narrowed by package), returning a light header projection (no body) with `packageId`.
  - `protocol.listDrafts({packageId?, type?, organizationId?})` exposes it over the overlay repo.
  - `GET /api/v1/meta/_drafts?packageId=&type=` surfaces it to the console. Registered in the REST server before the greedy `/meta/:type` route (and mirrored in the dispatcher) so `_drafts` is never captured as a metadata type name.

  Read-only; no behavior change to existing list/publish paths. Powers the upcoming Studio "drafts/pending changes" view and draft-aware package contents.

- 4fbb86a: feat(packages): consolidate the package subsystem so AI-built app packages surface in Studio

  The package subsystem was split across two stores that never met: the in-memory
  `SchemaRegistry` (what the dispatcher's `/api/v1/packages` list/detail and
  `getMetaItems({type:'package'})` read — i.e. Studio's package selector) and the durable
  `sys_packages` table (where the AI's auto app package, and any `package`-service publish,
  were written). Nothing reconciled the two, so an AI-created `app.<name>` package never
  appeared in Studio.

  This unifies them around one write primitive and one read source:

  - **`protocol.installPackage`** is now implemented (it was declared-but-missing). It is the
    single canonical write path: it registers the package in the in-memory registry **and**
    best-effort persists it to `sys_packages` via the `package` service. Non-fatal when no
    `package` service is wired (registry write still succeeds).
  - **Dispatcher `POST /api/v1/packages`** routes through `protocol.installPackage` (falling
    back to the bare registry write when the protocol is unavailable), so HTTP installs are
    durable too.
  - **`@objectstack/service-package`** reconciles `sys_packages` back into the registry on
    boot, without clobbering filesystem-registered packages — so persisted packages survive a
    restart and stay visible in the registry-backed read paths.
  - **`@objectstack/service-ai`** `apply_blueprint` now homes an app via
    `protocol.installPackage` (falling back to the legacy `package`-service publish), so the
    app package lands where Studio reads it.

  Still the _legacy_ `package_id` plane — sealed `sys_package_version` versioning and
  cross-environment promotion remain ADR-0027 follow-ups.

- e631f1e: feat(metadata): publish a whole app's drafts in one shot (ADR-0033)

  After an AI builds an app, its metadata is drafted (bound to an app package) and
  had to be published one item at a time. The package-level `POST /packages/:id/publish`
  needs the `metadata` service (503 when absent, e.g. the showcase) and reads the
  in-memory registry, not the drafts.

  - `protocol.publishPackageDrafts({ packageId })` promotes every `sys_metadata`
    draft row bound to the package to active by reusing the per-item
    `publishMetaItem` primitive (overridable/lock guards + runtime registry
    refresh). Per-item failures are collected, not fatal. No `metadata`-service
    dependency.
  - `POST /api/v1/packages/:id/publish-drafts` exposes it (distinct from the
    registry-based `/publish`), returning `{ success, publishedCount, failedCount, published, failed }`.

  Verified live: an AI-built `app.asset_management` (4 drafts) published in one call —
  all 4 promoted to active, drafts cleared, draft objects became queryable.

- 424ab26: fix(seed): reject object-wrapped relationship references and constrain them at compile time

  Seed datasets resolve `lookup` / `master_detail` references by matching the value
  against the target record's externalId — so the value must be the plain natural-key
  string (e.g. `account: 'Acme Corp'`), never a wrapper object like
  `account: { externalId: 'Acme Corp' }`. The wrapper was silently skipped by the
  loader, fell through unresolved, and reached the SQL driver as a non-bindable value —
  masked on an always-empty `:memory:` DB but crashing on a persistent one with
  "SQLite3 can only bind numbers, strings, bigints, buffers, and null" once seeds re-ran
  as updates.

  - `defineDataset` now constrains reference fields to `string | null` at compile time
    (derived from each field's `type`), so the object form is a type error.
  - `SeedLoaderService` now fails loudly with an actionable message (and drops the value
    instead of handing it to the driver) when a reference is an object — consistent
    behavior across all drivers, no longer silently masked.

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [f01f9fa]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
  - @objectstack/rest@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/metadata@7.8.0
  - @objectstack/observability@7.8.0
  - @objectstack/driver-memory@7.8.0
  - @objectstack/driver-sql@7.8.0
  - @objectstack/driver-sqlite-wasm@7.8.0
  - @objectstack/plugin-auth@7.8.0
  - @objectstack/plugin-org-scoping@7.8.0
  - @objectstack/plugin-security@7.8.0
  - @objectstack/service-cluster@7.8.0
  - @objectstack/service-i18n@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/metadata@7.7.0
  - @objectstack/objectql@7.7.0
  - @objectstack/driver-sql@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/observability@7.7.0
  - @objectstack/driver-memory@7.7.0
  - @objectstack/driver-sqlite-wasm@7.7.0
  - @objectstack/plugin-auth@7.7.0
  - @objectstack/plugin-org-scoping@7.7.0
  - @objectstack/plugin-security@7.7.0
  - @objectstack/rest@7.7.0
  - @objectstack/service-cluster@7.7.0
  - @objectstack/service-i18n@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Minor Changes

- 8e539cc: Implement the `/api/v1/notifications` REST surface (ADR-0030)

  The notification REST routes (`GET /notifications`, `POST /notifications/read`,
  `POST /notifications/read/all`) were declared in the spec but never had a
  server-side handler — no plugin registered the `notification` core service, so
  the routes were never advertised in discovery and `client.notifications.*`
  calls 404'd. (The Console bell works today only because it bypasses these
  endpoints and reads the inbox via the generic data API.)

  This wires the surface end-to-end against the ADR-0030 L5 model:

  - **`MessagingService`** gains an inbox read API: `listInbox(userId, opts)`
    reads `sys_inbox_message` joined with `sys_notification_receipt` for
    read-state (a message is unread until its event has a `read`/`clicked`/
    `dismissed` receipt); `markRead(userId, ids)` and `markAllRead(userId)`
    upsert the receipt to `read`, keyed `(notification_id, user_id,
channel:'inbox')` — updating the existing `delivered` receipt in place,
    inserting only when absent. No reliance on the re-modeled `sys_notification`
    L2 event (which carries no recipient/read columns).
  - **`MessagingServicePlugin`** now also registers the messaging service under
    the `notification` core service slot, so the dispatcher resolves + advertises
    the routes. The legacy `INotificationService.send()` abstraction is unused and
    unconsumed.
  - **`HttpDispatcher`** gains `handleNotification` + a `/notifications` dispatch
    branch: it takes the authenticated user from the execution context and maps
    list / mark-read / mark-all-read to the service. Responses match the spec
    schemas (`{ notifications, unreadCount }`, `{ success, readCount }`).

  Pairs with the objectui SDK consumer repoint (`useClientNotifications` →
  `markRead`/`registerDevice` signatures). Device registration and preference
  endpoints remain out of scope (unimplemented as before).

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8c01eea]
- Updated dependencies [8fa1e7f]
- Updated dependencies [be20aa4]
- Updated dependencies [55866f5]
- Updated dependencies [b7a4f14]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/formula@7.6.0
  - @objectstack/objectql@7.6.0
  - @objectstack/plugin-auth@7.6.0
  - @objectstack/driver-sqlite-wasm@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/metadata@7.6.0
  - @objectstack/observability@7.6.0
  - @objectstack/driver-memory@7.6.0
  - @objectstack/driver-sql@7.6.0
  - @objectstack/plugin-org-scoping@7.6.0
  - @objectstack/plugin-security@7.6.0
  - @objectstack/rest@7.6.0
  - @objectstack/service-cluster@7.6.0
  - @objectstack/service-i18n@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/metadata@7.5.0
- @objectstack/objectql@7.5.0
- @objectstack/observability@7.5.0
- @objectstack/formula@7.5.0
- @objectstack/rest@7.5.0
- @objectstack/driver-memory@7.5.0
- @objectstack/driver-sql@7.5.0
- @objectstack/driver-sqlite-wasm@7.5.0
- @objectstack/plugin-auth@7.5.0
- @objectstack/plugin-org-scoping@7.5.0
- @objectstack/plugin-security@7.5.0
- @objectstack/service-cluster@7.5.0
- @objectstack/service-i18n@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/metadata@7.4.1
- @objectstack/objectql@7.4.1
- @objectstack/observability@7.4.1
- @objectstack/formula@7.4.1
- @objectstack/rest@7.4.1
- @objectstack/driver-memory@7.4.1
- @objectstack/driver-sql@7.4.1
- @objectstack/driver-sqlite-wasm@7.4.1
- @objectstack/plugin-auth@7.4.1
- @objectstack/plugin-org-scoping@7.4.1
- @objectstack/plugin-security@7.4.1
- @objectstack/service-cluster@7.4.1
- @objectstack/service-i18n@7.4.1

## 7.4.0

### Minor Changes

- 2faf9f2: External Datasource Federation (ADR-0015) — boot-validation gate (Gate 2).

  Adds `ExternalValidationPlugin` (`createExternalValidationPlugin`) which, on
  `kernel:ready`, validates every federated object against its remote table via
  the `external-datasource` service and applies the datasource's
  `external.validation.onMismatch` policy: `fail` (throws
  `ExternalSchemaMismatchError`, aborting boot — the default), `warn` (logs the
  diff), or `ignore`. No-op when federation is unused.

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

- ff3d006: Screen-flow runtime — interactive `screen` nodes (suspend → render → resume).

  A `screen` node that declares input fields now suspends the run on entry
  (reusing the ADR-0019 durable pause), surfaces a `ScreenSpec` describing the
  form, and resumes with the collected values applied as **bare** flow variables
  so downstream nodes read them via `{var}`. (`waitForInput: false` forces the
  old server pass-through.)

  - **spec**: `AutomationResult.screen?: ScreenSpec`, `ResumeSignal.variables?`
    (bare vars), `IAutomationService.getSuspendedScreen?(runId)`.
  - **service-automation**: the `screen` executor builds the `ScreenSpec` and
    suspends when fields are present; the suspend/resume plumbing threads the
    screen through `FlowSuspendSignal` → `SuspendedRun` → the paused result;
    `resume()` sets `signal.variables` as bare flow variables; `getSuspendedScreen`.
  - **runtime**: `POST /api/v1/automation/:name/runs/:runId/resume` (body
    `{ inputs }`) and `GET …/runs/:runId/screen`, wired through both the
    dispatcher route table and `handleAutomation`.

  Verified end-to-end headlessly: the showcase Reassign Wizard launches → pauses
  at the "New Assignee" screen → resumes with the input → the task is reassigned.
  The objectui `FlowRunner` UI that renders these screens ships separately.

- 5e831de: Seed data: first-class identity binding + loud failures (fixes #1389)

  Records seeded via `defineDataset` / `defineStack({ data })` can now bind to a
  platform user with `cel\`os.user.id\``(and to the org with`cel\`os.org.id\``),
  which previously never resolved at boot.

  - **`os.user` / `os.org` now actually resolve.** The runtime provisions a
    deterministic, non-loginable system user (`usr_system`, role `system`)
    _before_ any seed runs and binds it to `os.user`, so identity-derived seed
    values resolve even on a fresh boot — before the first human sign-up. The
    human login admin remains a separate better-auth identity and need not own
    seed data. Exposed as the canonical `SystemUserId.SYSTEM` constant.
  - **New `SeedLoaderConfig.identity`** carries the `os.user` / `os.org` subject
    into CEL evaluation (`@objectstack/spec`).
  - **Failures are loud, not silent.** A record whose CEL value can't resolve
    (e.g. a required `cel\`os.user.id\`` with no identity) — or that fails to
    write — is now counted as an error, marks the load unsuccessful, and logs an
    actionable message, instead of being silently dropped.

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

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [24c9013]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [a6d4cbb]
- Updated dependencies [08fbbb4]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/objectql@7.4.0
  - @objectstack/plugin-auth@7.4.0
  - @objectstack/plugin-security@7.4.0
  - @objectstack/metadata@7.4.0
  - @objectstack/driver-sql@7.4.0
  - @objectstack/rest@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/formula@7.4.0
  - @objectstack/observability@7.4.0
  - @objectstack/driver-memory@7.4.0
  - @objectstack/driver-sqlite-wasm@7.4.0
  - @objectstack/plugin-org-scoping@7.4.0
  - @objectstack/service-cluster@7.4.0
  - @objectstack/service-i18n@7.4.0
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/formula@7.3.0
  - @objectstack/metadata@7.3.0
  - @objectstack/objectql@7.3.0
  - @objectstack/observability@7.3.0
  - @objectstack/driver-memory@7.3.0
  - @objectstack/driver-sql@7.3.0
  - @objectstack/driver-sqlite-wasm@7.3.0
  - @objectstack/plugin-auth@7.3.0
  - @objectstack/plugin-org-scoping@7.3.0
  - @objectstack/plugin-security@7.3.0
  - @objectstack/rest@7.3.0
  - @objectstack/service-cluster@7.3.0
  - @objectstack/service-i18n@7.3.0
  - @objectstack/types@7.3.0

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
  - @objectstack/objectql@7.2.1
  - @objectstack/plugin-auth@7.2.1
  - @objectstack/metadata@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/observability@7.2.1
  - @objectstack/formula@7.2.1
  - @objectstack/rest@7.2.1
  - @objectstack/driver-memory@7.2.1
  - @objectstack/driver-sql@7.2.1
  - @objectstack/driver-sqlite-wasm@7.2.1
  - @objectstack/plugin-org-scoping@7.2.1
  - @objectstack/plugin-security@7.2.1
  - @objectstack/service-cluster@7.2.1
  - @objectstack/service-i18n@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/types@7.2.0
- @objectstack/metadata@7.2.0
- @objectstack/objectql@7.2.0
- @objectstack/observability@7.2.0
- @objectstack/formula@7.2.0
- @objectstack/rest@7.2.0
- @objectstack/driver-memory@7.2.0
- @objectstack/driver-sql@7.2.0
- @objectstack/driver-sqlite-wasm@7.2.0
- @objectstack/plugin-auth@7.2.0
- @objectstack/plugin-org-scoping@7.2.0
- @objectstack/plugin-security@7.2.0
- @objectstack/service-cluster@7.2.0
- @objectstack/service-i18n@7.2.0

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

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/objectql@7.1.0
  - @objectstack/metadata@7.1.0
  - @objectstack/plugin-auth@7.1.0
  - @objectstack/plugin-org-scoping@7.1.0
  - @objectstack/plugin-security@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/formula@7.1.0
  - @objectstack/observability@7.1.0
  - @objectstack/driver-memory@7.1.0
  - @objectstack/driver-sql@7.1.0
  - @objectstack/driver-sqlite-wasm@7.1.0
  - @objectstack/rest@7.1.0
  - @objectstack/service-cluster@7.1.0
  - @objectstack/service-i18n@7.1.0
  - @objectstack/types@7.1.0

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

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/plugin-auth@7.0.0
  - @objectstack/plugin-security@7.0.0
  - @objectstack/plugin-org-scoping@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/formula@7.0.0
  - @objectstack/metadata@7.0.0
  - @objectstack/objectql@7.0.0
  - @objectstack/observability@7.0.0
  - @objectstack/driver-memory@7.0.0
  - @objectstack/driver-sql@7.0.0
  - @objectstack/driver-sqlite-wasm@7.0.0
  - @objectstack/rest@7.0.0
  - @objectstack/service-cluster@7.0.0
  - @objectstack/service-i18n@7.0.0
  - @objectstack/types@7.0.0

## 6.9.0

### Patch Changes

- bac7ae5: Fix: AI HTTP routes now see the authenticated user

  `HttpDispatcher.handleAI()` was invoking AI route handlers with only
  `{ body, params, query }` — `req.user` was always `undefined`. This
  silently broke every identity-aware feature that flows through
  `/api/v1/ai/*`:

  - LLM-titled conversations never fired (no actor → `autoCreateConversation`
    early-returned → no message persistence → `summarizeConversation`
    gated on `msgs.length >= 2` never tripped).
  - Permission-aware tool execution fell back to system context (RLS bypass).
  - HITL conversation linkage lost the operator's identity.

  Two root causes were fixed:

  1. `resolve-execution-context.ts` only checked `authService.api.getSession`.
     Modern auth plugins expose the better-auth handle lazily via
     `await authService.getApi()`. Now tries both.
  2. `handleAI()` now threads the resolved `ExecutionContext` into
     `req.user` (`{ userId, displayName, email, roles, permissions,
organizationId }`) before invoking the route handler, mirroring
     the shape the dispatcher-plugin already promises.

  End-to-end browser verification: authenticated chat → message persisted
  → `summarizeConversation` fires → fake-OpenAI receives the title
  prompt → `ai_conversations.title` updated. No code changes required
  in `@objectstack/service-ai`, `assistant-routes.ts`, or
  `agent-routes.ts` — they already consumed `req.user` correctly.

  - @objectstack/spec@6.9.0
  - @objectstack/core@6.9.0
  - @objectstack/types@6.9.0
  - @objectstack/metadata@6.9.0
  - @objectstack/objectql@6.9.0
  - @objectstack/observability@6.9.0
  - @objectstack/formula@6.9.0
  - @objectstack/rest@6.9.0
  - @objectstack/driver-memory@6.9.0
  - @objectstack/driver-sql@6.9.0
  - @objectstack/driver-sqlite-wasm@6.9.0
  - @objectstack/plugin-auth@6.9.0
  - @objectstack/plugin-security@6.9.0
  - @objectstack/service-cluster@6.9.0
  - @objectstack/service-i18n@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/types@6.8.1
- @objectstack/metadata@6.8.1
- @objectstack/objectql@6.8.1
- @objectstack/observability@6.8.1
- @objectstack/formula@6.8.1
- @objectstack/rest@6.8.1
- @objectstack/driver-memory@6.8.1
- @objectstack/driver-sql@6.8.1
- @objectstack/driver-sqlite-wasm@6.8.1
- @objectstack/plugin-auth@6.8.1
- @objectstack/plugin-security@6.8.1
- @objectstack/service-cluster@6.8.1
- @objectstack/service-i18n@6.8.1

## 6.8.0

### Patch Changes

- 50ccd9c: Fix peer-dependency version range from `workspace:*` to `workspace:^` to avoid
  forced major bumps in fixed-group releases. `workspace:*` expands to an exact
  version on publish; any minor bump of the peer then falls out of range and
  triggers a semver-major bump on the dependent. `workspace:^` expands to `^x.y.z`
  which correctly accepts minor bumps.

  Affects:

  - `service-ai` peer on `@objectstack/embedder-openai`
  - `runtime` peer on `@objectstack/driver-turso`

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/rest@6.8.0
  - @objectstack/objectql@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/formula@6.8.0
  - @objectstack/metadata@6.8.0
  - @objectstack/observability@6.8.0
  - @objectstack/driver-memory@6.8.0
  - @objectstack/driver-sql@6.8.0
  - @objectstack/driver-sqlite-wasm@6.8.0
  - @objectstack/plugin-auth@6.8.0
  - @objectstack/plugin-security@6.8.0
  - @objectstack/service-cluster@6.8.0
  - @objectstack/service-i18n@6.8.0
  - @objectstack/types@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/types@6.7.1
- @objectstack/metadata@6.7.1
- @objectstack/objectql@6.7.1
- @objectstack/observability@6.7.1
- @objectstack/formula@6.7.1
- @objectstack/rest@6.7.1
- @objectstack/driver-memory@6.7.1
- @objectstack/driver-sql@6.7.1
- @objectstack/driver-sqlite-wasm@6.7.1
- @objectstack/plugin-auth@6.7.1
- @objectstack/plugin-security@6.7.1
- @objectstack/service-cluster@6.7.1
- @objectstack/service-i18n@6.7.1

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
  - @objectstack/driver-sql@6.7.0
  - @objectstack/spec@6.7.0
  - @objectstack/driver-sqlite-wasm@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/formula@6.7.0
  - @objectstack/metadata@6.7.0
  - @objectstack/objectql@6.7.0
  - @objectstack/observability@6.7.0
  - @objectstack/driver-memory@6.7.0
  - @objectstack/plugin-auth@6.7.0
  - @objectstack/plugin-security@6.7.0
  - @objectstack/rest@6.7.0
  - @objectstack/service-cluster@6.7.0
  - @objectstack/service-i18n@6.7.0
  - @objectstack/types@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/formula@6.6.0
  - @objectstack/observability@6.6.0
  - @objectstack/plugin-auth@6.6.0
  - @objectstack/plugin-security@6.6.0
  - @objectstack/rest@6.6.0
  - @objectstack/service-cluster@6.6.0
  - @objectstack/service-i18n@6.6.0
  - @objectstack/types@6.6.0

## 6.5.1

### Patch Changes

- Updated dependencies [de239ef]
  - @objectstack/plugin-auth@6.5.1
  - @objectstack/spec@6.5.1
  - @objectstack/core@6.5.1
  - @objectstack/types@6.5.1
  - @objectstack/observability@6.5.1
  - @objectstack/formula@6.5.1
  - @objectstack/rest@6.5.1
  - @objectstack/plugin-security@6.5.1
  - @objectstack/service-cluster@6.5.1
  - @objectstack/service-i18n@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/types@6.5.0
- @objectstack/observability@6.5.0
- @objectstack/formula@6.5.0
- @objectstack/rest@6.5.0
- @objectstack/plugin-auth@6.5.0
- @objectstack/plugin-security@6.5.0
- @objectstack/service-i18n@6.5.0
- @objectstack/service-cluster@5.1.8

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/plugin-auth@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/formula@6.4.0
  - @objectstack/observability@6.4.0
  - @objectstack/plugin-security@6.4.0
  - @objectstack/rest@6.4.0
  - @objectstack/service-cluster@5.1.7
  - @objectstack/service-i18n@6.4.0
  - @objectstack/types@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/types@6.3.0
- @objectstack/observability@6.3.0
- @objectstack/formula@6.3.0
- @objectstack/rest@6.3.0
- @objectstack/plugin-auth@6.3.0
- @objectstack/plugin-security@6.3.0
- @objectstack/service-i18n@6.3.0
- @objectstack/service-cluster@5.1.6

## 6.2.0

### Patch Changes

- dbb54e1: Fix: AI streaming endpoints (e.g. `POST /api/v1/ai/assistant/chat`) now
  actually stream Server-Sent Events instead of returning the stream
  descriptor JSON-serialized.

  The shared `sendResultBase()` in `dispatcher-plugin.ts` previously had a
  `// pass through as JSON for now` TODO, so any dispatcher route whose
  `result.result` was a stream descriptor (`{ type: 'stream', events,
headers, ... }`) would respond with a literal `{"type":"stream",
"events":{},"vercelDataStream":true,...}` body — breaking
  `@object-ui/plugin-chatbot` and any other Vercel-AI-SDK consumer.

  The dispatcher now:

  - Detects `{ type: 'stream' | stream: true, events, headers? }` shapes.
  - Applies the route-provided headers (defaults to
    `text/event-stream`/`no-cache`/`keep-alive` when none are supplied).
  - Performs an empty `res.write('')` synchronously so the Hono adapter's
    `isStreaming` flag flips before the route handler resolves (the adapter
    would otherwise close the body before the first async chunk lands).
  - Drains the `AsyncIterable<string>` of pre-encoded SSE chunks in the
    background, calling `res.end()` when the iterator finishes or errors.

  Non-stream `result.result` payloads keep the existing JSON behaviour.

- Updated dependencies [b4c74a9]
- Updated dependencies [b4c74a9]
  - @objectstack/plugin-auth@6.2.0
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/formula@6.2.0
  - @objectstack/observability@6.2.0
  - @objectstack/plugin-security@6.2.0
  - @objectstack/rest@6.2.0
  - @objectstack/service-cluster@5.1.5
  - @objectstack/service-i18n@6.2.0
  - @objectstack/types@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/types@6.1.1
- @objectstack/observability@6.1.1
- @objectstack/formula@6.1.1
- @objectstack/rest@6.1.1
- @objectstack/plugin-auth@6.1.1
- @objectstack/plugin-security@6.1.1
- @objectstack/service-i18n@6.1.1
- @objectstack/service-cluster@5.1.4

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/formula@6.1.0
  - @objectstack/observability@6.1.0
  - @objectstack/plugin-auth@6.1.0
  - @objectstack/plugin-security@6.1.0
  - @objectstack/rest@6.1.0
  - @objectstack/service-cluster@5.1.3
  - @objectstack/service-i18n@6.1.0
  - @objectstack/types@6.1.0

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
  - @objectstack/rest@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/formula@6.0.0
  - @objectstack/observability@6.0.0
  - @objectstack/plugin-auth@6.0.0
  - @objectstack/plugin-security@6.0.0
  - @objectstack/service-cluster@5.1.2
  - @objectstack/service-i18n@6.0.0
  - @objectstack/types@6.0.0

## 5.2.0

### Patch Changes

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/plugin-security@5.2.0
  - @objectstack/rest@5.2.0
  - @objectstack/plugin-auth@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0
  - @objectstack/observability@5.2.0
  - @objectstack/service-cluster@5.1.1
  - @objectstack/service-i18n@5.2.0
  - @objectstack/types@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0
  - @objectstack/observability@5.1.0
  - @objectstack/plugin-auth@5.1.0
  - @objectstack/plugin-security@5.1.0
  - @objectstack/rest@5.1.0
  - @objectstack/service-i18n@5.1.0
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

- Updated dependencies [5cfdc85]
- Updated dependencies [2f9073a]
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0
  - @objectstack/observability@5.0.0
  - @objectstack/service-i18n@5.0.0
  - @objectstack/types@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/rest@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0
  - @objectstack/plugin-auth@4.2.0
  - @objectstack/plugin-security@4.2.0
  - @objectstack/service-i18n@4.2.0
  - @objectstack/types@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/types@4.1.1
- @objectstack/formula@4.1.1
- @objectstack/rest@4.1.1
- @objectstack/plugin-auth@4.1.1
- @objectstack/plugin-security@4.1.1
- @objectstack/service-i18n@4.1.1

## 4.1.0

### Minor Changes

- 96fb108: Artifact-first boot: `objectstack start` (and `objectstack serve`) now boot directly from a compiled `dist/objectstack.json` when no `objectstack.config.ts` is present.

  - `@objectstack/runtime` exports `createDefaultHostConfig()` and `resolveDefaultArtifactPath()` — a standalone-only default host that wraps `createStandaloneStack()` and surfaces the artifact's `requires` / `objects` / `manifest`. No dependency on `@objectstack/service-cloud`.
  - `objectstack start` accepts `OS_ARTIFACT_PATH` as a file path **or** an `http(s)://` URL. New flags `--artifact`, `--database`, `--database-driver`, `--database-auth-token`, `--auth-secret`, `--project-id`, `--port` let you specify all runtime conditions on the command line (each overrides the matching env var).
  - `objectstack dev` accepts the same runtime-override flags. When `--artifact` is supplied, the auto-compile step is skipped and the dev server boots the supplied artifact directly — no `objectstack.config.ts` required in cwd.
  - `objectstack start` no longer mounts Studio / Account / Console by default — those are dev/admin surfaces. Pass `--ui` to opt back in.
  - `objectstack serve` falls back to the default host config when the config file is missing but an artifact is resolvable.
  - `apps/objectos` (cloud / multi-project) is unchanged.

- 70db902: Add production observability primitives. `createDispatcherPlugin` now
  exposes an `observability` config that auto-instruments every mounted
  route with:

  - Request-id propagation: `X-Request-Id` echo + `req.requestId` (honors
    incoming header when well-formed, mints `req_<uuid>` otherwise).
  - `http_requests_total{method,route,status}` counter.
  - `http_request_duration_ms{method,route}` histogram.
  - `http_request_errors_total{method,route}` counter.
  - Error reporter call for 5xx (4xx are intentionally tracked via
    metrics only, not reported, to keep APM signal:noise high).

  All defaults are no-op (zero overhead). Hosts plug their own
  `MetricsRegistry` (Prometheus / OTel) and `ErrorReporter` (Sentry /
  Datadog) — see `docs/OBSERVABILITY.md` for adapter recipes and the
  go-live checklist.

  Standalone primitives also exported for adapter-layer use:
  `extractRequestId`, `resolveRequestId`, `parseTraceparent`,
  `formatTraceparent`, `InMemoryMetricsRegistry`,
  `InMemoryErrorReporter`, `instrumentRouteHandler`.

- 70db902: Add production HTTP hardening primitives. `createDispatcherPlugin` now
  sends conservative security response headers by default
  (CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy /
  Permissions-Policy / Cross-Origin-Resource-Policy). HSTS is opt-in.

  Caller can disable with `securityHeaders: false` (e.g., when an upstream
  reverse proxy already injects them) or customize per-header via
  `SecurityHeadersOptions`.

  Also exports a standalone token-bucket `RateLimiter` with a pluggable
  `RateLimitStore` interface (in-memory default; trivially backed by
  Redis) and curated `DEFAULT_RATE_LIMITS` for auth / write / read buckets.
  The limiter is NOT auto-wired into the dispatcher — adapter-layer
  wire-up (Fastify / Hono / Express) is recommended for proper IP/key
  extraction; see `docs/HARDENING.md` for recipes.

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
- Updated dependencies [d3b455f]
  - @objectstack/spec@4.1.0
  - @objectstack/plugin-security@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0
  - @objectstack/plugin-auth@4.1.0
  - @objectstack/rest@4.1.0
  - @objectstack/service-i18n@4.1.0
  - @objectstack/types@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/types@4.0.5
  - @objectstack/formula@4.0.5
  - @objectstack/rest@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/types@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/types@4.0.3
- @objectstack/rest@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/types@4.0.2

## 4.0.0

### Patch Changes

- f08ffc3: Fix discovery API endpoint routing and protocol consistency.

  **Discovery route standardization:**

  - All adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) now mount the discovery endpoint at `{prefix}/discovery` instead of `{prefix}` root.
  - `.well-known/objectstack` redirects now point to `{prefix}/discovery`.
  - Client `connect()` fallback URL changed from `/api/v1` to `/api/v1/discovery`.
  - Runtime dispatcher handles both `/discovery` (standard) and `/` (legacy) for backward compatibility.

  **Schema & route alignment:**

  - Added `storage` (service: `file-storage`) and `feed` (service: `data`) routes to `DEFAULT_DISPATCHER_ROUTES`.
  - Added `feed` and `discovery` fields to `ApiRoutesSchema`.
  - Unified `GetDiscoveryResponseSchema` with `DiscoverySchema` as single source of truth.
  - Client `getRoute('feed')` fallback updated from `/api/v1/data` to `/api/v1/feed`.

  **Type safety:**

  - Extracted `ApiRouteType` from `ApiRoutes` keys for type-safe client route resolution.
  - Removed `as any` type casting in client route access.

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/rest@4.0.0
  - @objectstack/types@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/types@3.3.1
- @objectstack/rest@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/types@3.3.0
- @objectstack/rest@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9
- @objectstack/types@3.2.9
- @objectstack/rest@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/types@3.2.8
- @objectstack/rest@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/types@3.2.7
- @objectstack/rest@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/types@3.2.6
- @objectstack/rest@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/types@3.2.5
- @objectstack/rest@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/types@3.2.4
- @objectstack/rest@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/types@3.2.3
- @objectstack/rest@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/types@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/types@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/types@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/types@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/types@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/types@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/types@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/types@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/types@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/types@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/types@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/types@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/types@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/types@3.0.3
  - @objectstack/rest@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/types@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/types@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/types@3.0.0
  - @objectstack/rest@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/types@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/types@2.0.6
  - @objectstack/rest@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/rest@2.0.5
  - @objectstack/types@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/types@2.0.4
  - @objectstack/rest@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/types@2.0.3
  - @objectstack/rest@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/rest@2.0.2
  - @objectstack/types@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/types@2.0.1
  - @objectstack/rest@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/rest@2.0.0
  - @objectstack/types@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
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

- ebdf787: feat: implement standard service discovery via `/.well-known/objectstack`
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
- 877b864: fix: add SPA fallback to hono, fix msw context binding, improve runtime resilience, and fix client-react build types
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

- fb2eabd: fix: resolve "process is not defined" runtime error in browser environments by adding safe environment detection and polyfills
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

- Fix TypeScript error in http-dispatcher tests to resolve CI build failures.
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

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/types@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/types@0.7.1
  - @objectstack/core@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1
  - @objectstack/types@0.6.1
  - @objectstack/core@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
  - @objectstack/objectql@0.6.0
  - @objectstack/types@0.6.0
  - @objectstack/core@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2
  - @objectstack/objectql@0.4.2
  - @objectstack/types@0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1
  - @objectstack/types@0.4.1
  - @objectstack/objectql@0.4.1

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

- Updated dependencies
  - @objectstack/spec@0.3.3
  - @objectstack/objectql@0.3.3
  - @objectstack/types@0.3.3

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/objectql@0.3.2
  - @objectstack/spec@0.3.2
  - @objectstack/types@0.3.2

## 0.3.1

### Patch Changes

- Organize zod schema files by folder structure and improve project documentation
  - @objectstack/spec@0.3.1
  - @objectstack/objectql@0.3.1
  - @objectstack/types@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/objectql@1.0.0
  - @objectstack/types@1.0.0

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0
  - @objectstack/types@0.2.0
  - @objectstack/objectql@0.2.0

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
  - @objectstack/objectql@0.1.1
  - @objectstack/types@0.1.1
