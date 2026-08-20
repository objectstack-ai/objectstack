# @objectstack/plugin-mcp-server

## 17.1.0

### Minor Changes

- 20067c5: fix(runtime,mcp,service-datasource): the #6504 consumer sweep — three list consumers stop making claims a known-partial read cannot support (#6504)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable surface is
  added, renamed, retired or tombstoned. Two package-local host-wiring interfaces
  gain OPTIONAL members (`DatasourceAdminServiceConfig.countBoundObjectsDiagnosed`,
  `McpDataBridge.listObjectsDiagnosed`); `packages/spec` is untouched, since
  `IMetadataService.listDiagnosed` — the contract this consumes — landed in PR
  #7721. -->
  
  `IMetadataService.listDiagnosed?(type)` (PR #7721) lets a plural read say whether
  its answer can be trusted as complete. This is the consumer half: the callers
  that were restating a possibly-short listing as a fact about the environment.
  
  Each consumer was qualified individually, per PR #6051's discipline, and most
  were left alone — a caller publishing a snapshot with no count has nothing to
  mis-state. Three make a claim, and each now withholds exactly that claim while
  still serving everything it could read:
  
  - **`removeDatasource` no longer deletes on a bound-object count it could not
    take completely.** The guard `if (bound > 0) throw` is the only thing standing
    in front of an irreversible delete that also unbinds the datasource's secret,
    and its input is derived from the metadata service's object listing. During a
    loader outage that listing goes silently short, and the worst value is the
    benign one: `0` reads exactly like "nothing is bound", so the guard OPENED.
    It now refuses with `SERVICE_UNAVAILABLE` / 503 — a dependency outage the
    operator can retry, not a client error — and the record, its credential and
    its pool all survive.
  - **The MCP `list_objects` tool stops publishing `totalCount` on a known-partial
    listing.** This is the same claim PR #7721 removed from the
    `objectstack://objects` resource, on the other MCP primitive: same payload
    shape, different door, never covered. A degraded read now serves the same
    objects with `totalCount` **absent** and `partial` / `returnedCount` /
    `warning` plus the 503 envelope in its place, so a client reading the total
    gets `undefined` rather than a believable wrong integer. Both bridges
    implement it — stdio (`@objectstack/mcp`) and HTTP (`@objectstack/runtime`) —
    because a completeness claim must not depend on which transport a client
    connected over.
  - **The ADR-0015 §5.2 boot gate stops announcing an all-clear over a sweep it
    could not complete.** It validated whatever `listObjects()` returned and then
    logged *all federated objects match their remote schema*, with a count.
    Federated objects behind an unreadable loader were never validated, so
    `onMismatch: 'fail'` could not have fired for them. The gate now warns that
    the swept set was incomplete and names what it did validate. ⛔ It does **not**
    abort boot on a degraded metadata read: turning a transient outage into a
    refusal to start would be a new failure mode bought with a diagnosis fix.
  
  Every new member is optional in the same way `listDiagnosed` itself is: a host
  whose metadata service predates the verdict behaves exactly as it did before,
  and a service without it reports nothing degraded — precisely what it could
  express.

### Patch Changes

- ff4ba6a: fix(mcp): the skill prompt bridge reads the protocol's merged metadata listing, so a runtime `PUT /api/v1/meta/skill/<name>` reaches MCP prompts (#8328)
  
  The bridge read `IMetadataService.list('skill')` — one layer below where the
  `sys_metadata` overlay merge happens — so an override returned 200 and never
  reached the prompt surface while `GET /api/v1/meta/skill` served it. The
  long-lived (stdio) server's bridge now takes its items from the protocol's
  `getMetaItems` when the host can supply it, and keeps the #6504 completeness
  verdict by asking `listDiagnosed` for it alongside. A host assembled without the
  metadata protocol reads exactly as before, and a merged read that throws does not
  fall back to the un-merged listing.
- f9d7acf: docs(mcp): rewrite the published README to the shipped host-extension surface (#9579)
  
  `packages/mcp/README.md` is in the package's `files` array with `private` unset,
  so it is the page npm renders. It told the reader to extend the server
  imperatively at six call sites:
  
  ```ts
  kernel.getService('mcp').registerTool(calculateRevenueTool);
  kernel.getService('mcp').registerResource({ … });
  kernel.getService('mcp').registerPrompt({ … });
  ```
  
  `MCPServerRuntime` has never had any of those members. Measured against the
  built `dist/index.d.ts`, a consumer who copies those lines gets three
  `TS2339 Property … does not exist on type 'MCPServerRuntime'`. The receiver is a
  local variable, so `check:published-readme-exports` is structurally blind to
  them — both of its halves key on a name the fence *imported*, and this one is
  neither imported nor a bare identifier.
  
  Ruled 2026-08-18: **document the shipped surface; do not grow the API to match
  the docs.** So the imperative narrative is gone and the page now documents what
  actually ships — the bridge methods (`bridgeTools`, `bridgeDataTools`,
  `bridgeResources`, `bridgePrompts`), `handleHttpRequest` / `renderSkill`, and the
  exported `registerObjectTools` / `registerActionTools` / `registerSkillPrompts`
  helpers driving an `McpServer`. Every row is probed against the built type entry
  the `exports` map resolves, and the page's one host-extension example compiles
  clean against it.
  
  Neighbouring fabrications the audit turned up, all corrected in the same pass —
  each of them was reachable only through prose or an unimported receiver, which is
  why nothing had read them:
  
  - **A tool family that does not exist.** The page listed
    `objectstack_find` / `objectstack_findOne` / `objectstack_create` /
    `objectstack_update` / `objectstack_delete` / `objectstack_describeObject` /
    `objectstack_listObjects` / `objectstack_listFields` as "auto-registered". No
    such tool name occurs anywhere in the repo. The real names are the
    `list_objects` … `run_action` set the page listed separately, one section down.
  - **`aggregate_records` was missing** from the list that *was* correct, along
    with the fact that it registers only when the bridge implements `aggregate`.
  - **Resource URIs were wrong in both directions.** The page taught
    `objectstack://objects/{name}/records` (no such resource) and
    `objectstack://objects/{name}/{id}` (real shape is
    `…/{name}/records/{id}`), and omitted `objectstack://objects` and
    `objectstack://metadata/types` entirely.
  - **The advertised capability block was invented.** It claimed
    `tools.listChanged`, `resources.subscribe`, `resources.listChanged`,
    `prompts.listChanged` and `experimental.streaming`. The server hand-declares
    only `logging`; everything else is *derived* from what was actually registered,
    which is the ADR-0076 D12 contract the README was contradicting. The
    "Streaming Support" feature bullet and the streaming-resource example went with
    it — neither names anything that ships.
  - **The stdio transport could not be started by following the page.** Neither
    `OS_MCP_STDIO_ENABLED` nor `OS_MCP_STDIO_API_KEY` was documented, and stdio
    auto-start refuses to boot without the key (ADR-0101, fail-closed). The three
    client config blocks now carry both. The Debugging section also taught
    `OS_MCP_SERVER_ENABLED=true` as the stdio switch, which is the deprecated path
    that logs a warning.
  - **A broken relative link.** `../../spec/src/ai/` resolves above the repo root
    from `packages/mcp/`; the target is `../spec/src/ai/`.
  
  Docs only — no runtime code changed, and no API was added. `registerTool` /
  `registerResource` / `registerPrompt` remain unbuilt by ruling; a future
  imperative API is its own card on measured pull.
- cd455c8: docs: four published READMEs stop documenting symbols and call sites that do not exist (#9544)
  
  All four packages ship `README.md` in their `files` array with `private` unset, so these
  are the pages npm renders. Each finding was re-measured against the **built `.d.ts`**, not
  against source, because that is what a consumer resolves through the `exports` map.
  
  - **`@objectstack/driver-sql`** — `import type { IDriver } from '@objectstack/spec'` named
    a type that exists **nowhere in the repository** (0 hits across every package's `src`
    and `dist`). The real contract is `IDataDriver` on `@objectstack/spec/contracts` — the
    one `SqlDriver` actually declares (`export class SqlDriver implements IDataDriver`). The
    adjacent operation list was corrected too: the method is `create`, not `insert`.
  
  - **`@objectstack/mcp`** — `DriverSql` has never existed (the export is `SqlDriver`), and
    the README then called `DriverSql.configure({...})` on it. Renaming alone would have
    been wrong twice over: `SqlDriver` has **no static `configure` either**, and `driver:`
    is not a key of `defineStack` at all. The example now declares a datasource the way the
    shipped templates do. `MCPServerPlugin.configure({...})` — five call sites — becomes
    `new MCPServerPlugin({...})`, the form the class's own JSDoc and every in-repo caller
    use. The documented options block claimed `serverName`, `autoRegisterTools`,
    `autoExposeObjects`, `enableStreaming`, `port` and `debug`; the real
    `MCPServerPluginOptions` is `name`, `version`, `transport`, `autoStart`, `instructions`,
    and the env switches are named instead.
  
  - **`@objectstack/objectql`** — `registerObject` is an **instance** method, so
    `SchemaRegistry.registerObject(...)` on the class could never run. The example now
    reaches it through the engine's registry and states the real parameter order
    (`schema, packageId, namespace?`).
  
  - **`@objectstack/spec`** — the protocol package's own front page imported
    `MCPServerConfigSchema` from `@objectstack/spec/ai`, which exports `MCPServerRefSchema`.
    A rename by itself would have swapped a broken import for a broken **parse**: the
    documented payload was built for a schema that does not exist, and
    `MCPServerRefSchema.safeParse` rejects it (`transport` is an enum of
    `stdio | http | websocket`, not an object, and `endpoint` is required and was absent).
    The example is now a payload that parses green, and the page says plainly that tools,
    resources and prompts are derived from metadata at runtime rather than authored there.
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
- Updated dependencies [2d0af57]
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
- Updated dependencies [27a567d]
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
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/formula@17.1.0

## 17.0.0

### Minor Changes

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

- 3f7b4ff: `McpDataBridge.aggregate` now declares its `groupBy` / `aggregations` inputs as the engine's own `EngineAggregateOptions` slices instead of a hand-mirrored copy (#8032). The mirror had drifted in three places: `function: string` against the engine's six-name enum, `dateGranularity?: string` against the `day`/`week`/`month`/`quarter`/`year` vocabulary, and a `distinct?: boolean` the engine retired in `@objectstack/spec` 17 (#6815) — a caller passing `distinct: true` had it silently dropped, and now gets the retirement rejection at compile time instead. Delete the key; a deduplicated count is the `count_distinct` aggregation function. Runtime acceptance is unchanged on every path: the `aggregate_records` tool's zod schema already enforced exactly these shapes at the ingress, and the stdio bridge's engine call no longer needs its two casts.
- 4f3d232: docs(mcp): `diagnoseEmptyRead` 的 TSDoc 更正一句被证伪的事实 (#6724)

  `packages/mcp/src/mcp-server-runtime.ts` 里 `diagnoseEmptyRead` 的 TSDoc(#6055
  由 PR #6051 落地)为"在空答案之后再跑一次仅取结论的探针,而不是把
  `getObject` 换成 `getDiagnosed('object', name)`"这个设计选择给出了两条理由。
  其中一条是事实陈述,而它是**错的**:

  > `MetadataFacade.getObject`(objectql)返回 `registry.getObject(name)` —— a
  > different shape from its own `get()`,因此等价关系在一般情况下不成立。

  `SchemaRegistry.getItem` 对 `'object'` / `'objects'` 类型直接特判回
  `getObject`,所以 facade 的 `get('object', n)` 走的是同一次查找;其后的
  `item?.content ?? item` 解包是空操作 —— 合并后的 `ServiceObject` 根本没有
  `content` 键。实测:命中时两个成员交回**同一个对象引用**,未命中时双方都是
  `undefined`。三个已发布实现由 `packages/objectql/src/
metadata-service-getobject-equivalence.test.ts`(PR #6839)钉住,契约侧的
  `IMetadataService.getObject` 自 PR #6723(#6505)起也写明了这条等价关系。

  同一句话在 `mcp-server-runtime.metadata-outage.test.ts` 里被复述过一次,一并
  更正。

  仍然成立的那半条理由被保留:`getObject` 是 `IMetadataService` 自己的成员,
  #6055 当时它并**没有**被文档化的等价关系,在消费端擅自假定一条正是 Prime
  Directive #12 禁止的私有方言 —— 所以解析器当初没有被换掉。

  **纯注释,零行为变化。** 这次更正**不**主张把解析器换成
  `getDiagnosed('object', name)`:那是一次独立的判断,由接手的人按其自身利弊
  去做,本次改动既不作出也不预设。

- 5c2716b: mcp: a metadata outage stops being reported to MCP clients as `Agent "X" not found`

  The `agent_prompt` prompt resolved its body through `metadataService.get('agent', name)`
  and answered the resulting `undefined` with `Error: Agent "X" not found`. That `undefined`
  carries two opposite facts (#5840, ADR-0110 D3): the name was never declared, or every
  loader behind the metadata service was down. So during a metadata outage an MCP client was
  told, positively, what the author had declared — from a read that never happened. The same
  shape sat one bridge over: the `objectstack://objects/{objectName}` resource answered
  `getObject()`'s `undefined` with `Object "X" not found`.

  **Both surfaces now separate the two.** A degraded read answers `SERVICE_UNAVAILABLE` —
  the same catalogued code and the same "whether it exists is unknown, retry once it is
  reachable" sentence the `sys_metadata` half of this family already emits (#5532 / #5843) —
  and a genuine miss keeps its not-found answer, byte for byte on the prompt surface.
  MCP's `prompts/get` and `resources/read` results carry no error envelope, so the
  classification travels in the payload each surface already had: the prompt's text, and the
  resource's JSON body, which now names `code` and `status` on **both** answers
  (`SERVICE_UNAVAILABLE`/503 vs `RESOURCE_NOT_FOUND`/404) so a client can tell them apart
  without parsing prose.

  **This is a diagnosis fix, not an access change.** Both surfaces were already fail-closed:
  no instructions and no schema were served during an outage before this, and none are now.
  The defect was the description.

  Hosts whose `metadata` slot predates the optional `getDiagnosed` member report nothing
  degraded — exactly what they could express before — so their behaviour is unchanged. The
  object resource additionally keeps `getObject()` as its resolver and consults the
  diagnosed read only as a verdict probe on the miss path, because `getObject` is its own
  contract member with no documented equivalence to `get('object', name)` (and
  `MetadataFacade.getObject` is not that).

- e437471: fix(mcp): the stdio record resource honours the ADR-0049 `apiEnabled` / `apiMethods` exposure declaration (#8266)

  An object that declares `enable.apiEnabled: false` — or narrows `enable.apiMethods`
  so a single-record read is outside the whitelist — was refused by the `get_record`
  tool and **still readable** through the ADR-0101 record resource
  (`objectstack://objects/{objectName}/records/{recordId}`): same transport, same key,
  same declaration, two answers.

  **This is a surface-area declaration leak, not an authorization bypass.** The gate is
  a surface-area control by `api-exposure.ts`'s own ADR note, and this read passed the
  ObjectQL security middleware (CRUD / FLS / RLS) — under the key's `ExecutionContext`
  — before this change and after it. What was leaking is the author's _exposure
  declaration_, not the data guard.

  Why the resource was missed when the tool was fixed: the six object-CRUD verbs all
  flow through `createStdioDataBridge`, which has been gated since #8083. The record
  resource does not use that bridge — its reader is a separate closure built inline in
  the plugin that calls `ql.find` directly and is handed to `bridgeResources`. Gating
  the bridge therefore never reached it. That reader now applies the same gate, taking
  its decision from the same single source of truth every other enforcement point
  delegates to (the spec's `resolveEffectiveApiMethods` / `isApiOperationAllowed`), so
  the three-state whitelist and the derived verbs resolve identically on all surfaces.

  The gated action is `get`, matching what the HTTP path sends for a single-record
  read. Refusals carry the same machine codes the REST surface answers with —
  `OBJECT_API_DISABLED` and `OBJECT_API_METHOD_NOT_ALLOWED` — and reach an MCP client
  as the resource's `{ "error": ... }` body, which is how that resource has always
  reported a failed read. The behaviours matched to the HTTP path in #8083 are matched
  here for the same reasons: a system context bypasses, and unresolvable metadata fails
  open to the schema defaults.

  Unaffected: the object schema and object list resources stay ungated, because the
  HTTP bridge answers both straight off the metadata service — refusing a _schema_ read
  here would be a fresh divergence pointing the other way. The remaining known
  divergences between the two MCP bridges (the protocol layer's ingress `readonly`
  strip, its existence probes, its spec-shaped receipts and `expand` / `select`) are
  unchanged and still filed as follow-up work.

- e472bbe: fix(mcp): the stdio transport honours the ADR-0049 `apiEnabled` / `apiMethods` exposure declaration (#8083)

  An object that declares `enable.apiEnabled: false` — or narrows `enable.apiMethods` —
  is telling the platform which data operations it exposes over the API. That
  declaration was honoured on the MCP **HTTP** surface and ignored on the MCP
  **stdio** surface: same product, same tool names, same key, different answer.

  **This is a surface-area declaration leak, not an authorization bypass.** The gate
  is a surface-area control by `api-exposure.ts`'s own ADR note, and every stdio call
  passed the ObjectQL security middleware (CRUD / FLS / RLS) before this change and
  after it. What was leaking is the author's _exposure declaration_, not the data
  guard.

  The two MCP hosts implement the same `McpDataBridge` over different seams — HTTP
  through `callData`, which gates before dispatch; stdio straight onto the engine,
  which did not. The stdio bridge now applies the same gate, and takes its decision
  from the same single source of truth both existing enforcement points already
  delegate to (the spec's `resolveEffectiveApiMethods` / `isApiOperationAllowed`), so
  the three-state whitelist, the action-to-operation mapping and the derived verbs
  resolve identically on all three surfaces.

  Gated verbs are exactly the six the HTTP bridge routes through `callData`:
  `query_records`, `get_record`, `create_record`, `update_record`, `delete_record`
  and `aggregate_records`. `list_objects` / `describe_object` stay ungated, because
  the HTTP bridge answers both straight off the metadata service — a schema read
  refused on stdio and served on HTTP would be the same divergence pointing the
  other way.

  Refusals carry the same machine codes the REST surface answers with:
  `OBJECT_API_DISABLED` (the object is hidden) and `OBJECT_API_METHOD_NOT_ALLOWED`
  (the operation is outside the whitelist, with the effective operation set
  attached). Three behaviours are matched to the HTTP path deliberately: a system
  context bypasses the gate, unresolvable metadata **fails open** to the schema
  defaults, and the flat legacy definition shape is read when there is no nested
  `enable` block.

  Unaffected: the remaining known divergences between the two MCP bridges (the
  protocol layer's ingress `readonly` strip, its existence probes, its spec-shaped
  receipts and `expand` / `select`) are unchanged and still filed as follow-up work.

- 4810dd6: fix(mcp): stdio bridge's `update`/`remove` throw the shared `RECORD_NOT_FOUND` envelope (#8422)

  The stdio MCP bridge's `update()` and `remove()` — the two by-id write seams
  that probe for the row before mutating it — minted their own local
  `recordNotFound(object, id)`, returning a bare `Error` with neither `code`
  nor `status`. The HTTP bridge's `callData` path already throws
  `recordNotFoundError` (`code: 'RECORD_NOT_FOUND'`, `status: 404`,
  `@objectstack/core`, #4435/#5138/#7867) for the identical miss, so the same
  operation answered a missing id with two different envelopes depending on
  which MCP transport served it.

  `packages/mcp/src/stdio-data-bridge.ts` now imports `recordNotFoundError`
  from `@objectstack/core` — a dependency the package already declares — and
  throws it from both seams instead. `registerObjectTools` still turns the
  throw into a tool error exactly as before; only the thrown object's shape
  changed. No exported symbol moves and no authorable metadata is affected, so
  this ships as a `patch`.

- 7182362: fix(mcp): the stdio MCP transport answers again — resume the stdin it just took ownership of (#7645)

  `objectstack serve` with `OS_MCP_STDIO_ENABLED=true` logged
  `[MCP] Server started (transport: stdio)`, bound the transport to a real `osk_`
  identity — and then **never answered a single request**. `initialize`,
  `tools/list`, `resources/list` and `resources/read` all timed out with **zero
  bytes on stdout**; malformed input drew no error either. Every stdio MCP session
  against the CLI was unusable, and the failure was silent on both sides: the
  server looked started, the client just waited.

  The pause came from the **host**, above the plugin. oclif's argument parser
  reads stdin for any positional argument the caller did not supply (`tryStdin` →
  `createInterface({input: process.stdin})`, aborted after 10 ms), and
  `Interface.close()` calls `stdin.pause()`. `serve` declares an optional `config`
  positional, so plain `objectstack serve --dev` left `process.stdin` explicitly
  paused before the kernel ever booted. `StdioServerTransport.start()` only
  attaches a `data` listener, and Node auto-switches a stream to flowing mode on
  that listener **only while `readableFlowing` is still `null`** — never after an
  explicit `pause()`. Listener attached, `bytesRead` stuck at 0, transport deaf.

  `MCPServerRuntime.start()` now resumes `process.stdin` immediately after
  `connect()`, which is the moment the transport takes ownership of it (after, so
  the transport's reader is attached before any byte can flow). The resume lives
  in the runtime rather than in the CLI's argument definitions because the pause
  is not oclif-specific: any host that touched stdin before `start()` — a readline
  prompt, a supervisor, an embedding process — left the transport equally deaf,
  and this is the one place that knows a long-lived stdio transport was just
  attached.

  Measured, both directions: `objectstack serve --dev` (no config path, parser
  reads stdin) went from timing out to answering `initialize`, while `objectstack
serve objectstack.config.ts --dev` (parser never touches stdin) answered before
  and after. The HTTP transport at `/api/v1/mcp` is unaffected — it is served
  per-request and never touches stdin.

  Not changed, and deliberately so: the ADR-0101 fail-closed startup contract.
  stdio enabled without `OS_MCP_STDIO_API_KEY` still throws at plugin start, an
  unknown/revoked key still refuses with no anonymous-but-serving fallback, and a
  member key still binds the principal to that member.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- 214eb30: fix(cli): `os serve` writes its banner, boot progress and kernel logs to stderr, so the stdio MCP channel carries only protocol (#7915)

  With `OS_MCP_STDIO_ENABLED=true`, `objectstack serve` used `process.stdout` as
  the MCP JSON-RPC channel **and** as its ordinary human/log output. MCP stdio
  framing is newline-delimited JSON — a conforming client `JSON.parse`s every line
  it reads off the server's stdout — so every banner line and every `INFO`/`WARN`
  record reached the client as a transport error. Measured on the card's repro:
  the `initialize` result arrived on **line 517**, behind 516 lines of
  non-protocol text. It reads as "the transport is broken", which is also why it
  stayed invisible until #7645 (PR #7914) made the transport answer at all.

  **`serve`'s stdout is now the protocol's, and nothing else's.** Banners, boot
  progress and kernel logs are diagnostics, not program output, and stderr is
  where a CLI puts diagnostics — so they go there whether or not a stdio
  transport is mounted. Two halves:

  - every human line `serve` prints is written to stderr explicitly, the startup
    banner (`✓ Server is ready`, the plugin table, `Press Ctrl+C to stop`) and the
    boot-diagnostics replay included;
  - everything else the process would write to stdout — `ObjectLogger`'s
    `debug`/`info`/`warn` records, and the stray `console.log`s several packages
    emit during boot — is forwarded to stderr for the life of the process, the
    same route `--json` already takes (#6217). `LoggerConfig` has a level but no
    destination knob, so the stream itself is the only seam that covers writers
    the CLI does not own.

  **Unconditional, deliberately.** "Redirect when the stdio transport is active"
  needs a reliable signal at the moment each line prints — before the config is
  read, before the plugin is loaded — and fails silently and in the worse
  direction when that signal is wrong or late: a frame-corrupting line that shows
  up only in some boots is far harder to find than one that always does. In a
  terminal the move costs nothing, since both streams render.

  **Nothing is silenced.** Every line still appears, on stderr — including the
  boot-phase warnings #4012 rescued from the quiet window. A shell that captured
  both streams (`> log 2>&1`) sees exactly what it saw before; one that captured
  stdout alone now finds `serve`'s output on stderr.

  `@objectstack/mcp`: the stdio transport now holds its own channel to the real
  stdout instead of writing through `process.stdout` — a host that intercepts
  `process.stdout.write` to move its diagnostics (which is what `serve` does)
  would otherwise swallow the protocol frames along with them. It claims that
  channel in every host and on every construction path, so a transport's frames
  never depend on who booted the plugin.

- 026508b: Serve the object tools over the stdio MCP transport instead of only advertising them

  The stdio MCP server advertised `capabilities.tools` in its `initialize` result and then answered `-32601 Method not found` to every `tools/list` and `tools/call`, so an MCP client that connected successfully could not query or mutate a single object. The same process answered the same requests correctly over HTTP (`POST /api/v1/mcp`), which is what made the cause visible: `registerObjectTools` / `registerActionTools` were reachable only from `handleHttpRequest()`'s throwaway per-request server, and the long-lived server behind stdio received only the AI service's function-calling `ToolRegistry` — a different surface, empty on any app that registers no AI tools.

  Both transports now register through one composition (`wireBridgeTools`), and the stdio host builds a principal-bound data bridge from the `OS_MCP_STDIO_API_KEY` identity, re-resolved per call so a revoked key stops working on the next tool call (ADR-0101 D1). Permissions, RLS and FLS apply exactly as they do to the same identity over REST.

  The `tools`, `resources` and `prompts` capabilities are no longer hand-declared at construction: the MCP SDK declares each one when something is actually registered, so what a server advertises and what it serves can no longer disagree (ADR-0076 D12). A deployment with no principal to bind — or no metadata service — now advertises no tool capability instead of advertising an empty one, and says so in the boot log.

- 3556b67: fix(security): the MCP stdio bridge stops echoing `internal: true` columns from a write, and the write-response guarantee is guarded as a PROPERTY rather than per-class (#8497)

  **A live leak, found by widening a guard.** #7823 relocated the `internal: true`
  write-response strip to the generic-data-path ingress and gated the relocation on
  a tripwire that enumerates every `*Data` face on the protocol class. The card that
  produced this change observed that the guard's coverage — *"every `*Data`face on
one class"* — is narrower than the property that needs holding — *"no response body
an external caller receives from a write carries an`internal: true`value"* — and
that`@objectstack/rest`'s cross-object batch (a direct `ql.update`) was the
  standing proof the two are not the same set.

  Widening the guard to the property immediately found a second direct mouth that
  was **not** covered, and it was leaking. `@objectstack/mcp`'s stdio bridge
  (`stdio-data-bridge.ts`) is engine-only by construction — the long-lived stdio
  host cannot reuse the runtime's request-shaped `callData` builder — and its
  `create` arm handed `engine.insert`'s result straight back to the MCP caller.
  Since #7823 the engine deliberately keeps its write results whole, so the flagged
  column rode the tool response verbatim. Measured before the fix:

  ```
  {"object":"vault","id":"r1","record":{"name":"row","id":"r1","vault_secret":"<the stored secret>"}}
  ```

  The file's own header had listed its protocol-layer divergences as _"deliberate,
  filed, not security"_. One limb of that list **was** security, and the header now
  says so.

  **What changed**

  - `@objectstack/mcp` — the stdio bridge's `create` runs its response record
    through the shared strip. `update` does too: that arm discards the engine's
    write result and echoes the read-path row plus the caller's own patch, so no
    _stored_ value could reach it, but a caller who puts an `internal: true` key in
    `data` would otherwise get it echoed back — their own bytes used as an oracle
    for a column the flag says is never returned. Read verbs are untouched (the
    engine's read-path strip is unchanged).
  - `@objectstack/core` — the strip helper
    (`omitInternalFieldsFromWriteResponse` / `collectInternalWriteResponseFields`)
    moved here from `@objectstack/metadata-protocol`. It shipped beside the protocol
    class when that class was its only caller, but the generic write mouths are not
    all on it: `rest` and `mcp` both reach the engine directly and **neither depends
    on `@objectstack/metadata-protocol`**, so the old home forced each new mouth to
    choose between a duck-typed reach through a protocol instance and a private
    restatement of a security-relevant rule. `core` is the floor all three already
    depend on, and already hosts this class of shared write-path helper
    (`bulk-write.ts`). No behaviour change and no API change:
    `@objectstack/metadata-protocol` re-exports both names unchanged.

  **What guards it now.** Two new tripwires join the shipped one — which is **not**
  replaced: its runtime prototype walk and its `leakyData` negative control are
  untouched. Each is a runtime enumeration no author can dodge by adding code
  without touching it, and each fails on a surface it has no disposition for:

  - `metadata-protocol` — walks the protocol class for `*Data` faces (unchanged);
  - `rest` — walks `RestServer.getRoutes()` for HTTP write routes, drives the ten
    data-plane ones (including `POST /batch`, the direct-`ql.update` mouth) against
    a fixture whose stored rows carry a flagged sentinel, and deep-scans each
    response body;
  - `mcp` — walks the `McpDataBridge` faces the factory actually returns.

  Every driven case also asserts a control value is present, so a refusal or an
  empty body cannot satisfy "no sentinel" by returning nothing.

  Reverse-verified in both directions, the discipline #7823's own fix used: deleting
  the strip from the REST batch arm turned the REST tripwire red on exactly that
  route; adding a _second_ unstripped direct engine mouth turned it red again;
  removing the new MCP strip turned the MCP tripwire red; every restore was proven
  byte-identical with `git hash-object`.

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
- Updated dependencies [9f5cc79]
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
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
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
- Updated dependencies [e9b5265]
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
- Updated dependencies [0f17114]
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
- Updated dependencies [d5e9f6e]
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
- Updated dependencies [cafec0a]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
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
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
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
- Updated dependencies [9881074]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
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
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
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
- Updated dependencies [cc2de0e]
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
- Updated dependencies [bf1edef]
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
- Updated dependencies [d5749d7]
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
- Updated dependencies [078e28b]
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
- Updated dependencies [4965bfa]
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
  - @objectstack/types@17.0.0
  - @objectstack/formula@17.0.0

## 17.0.0-rc.6

### Patch Changes

- 4f3d232: docs(mcp): `diagnoseEmptyRead` 的 TSDoc 更正一句被证伪的事实 (#6724)

  `packages/mcp/src/mcp-server-runtime.ts` 里 `diagnoseEmptyRead` 的 TSDoc(#6055
  由 PR #6051 落地)为"在空答案之后再跑一次仅取结论的探针,而不是把
  `getObject` 换成 `getDiagnosed('object', name)`"这个设计选择给出了两条理由。
  其中一条是事实陈述,而它是**错的**:

  > `MetadataFacade.getObject`(objectql)返回 `registry.getObject(name)` —— a
  > different shape from its own `get()`,因此等价关系在一般情况下不成立。

  `SchemaRegistry.getItem` 对 `'object'` / `'objects'` 类型直接特判回
  `getObject`,所以 facade 的 `get('object', n)` 走的是同一次查找;其后的
  `item?.content ?? item` 解包是空操作 —— 合并后的 `ServiceObject` 根本没有
  `content` 键。实测:命中时两个成员交回**同一个对象引用**,未命中时双方都是
  `undefined`。三个已发布实现由 `packages/objectql/src/
metadata-service-getobject-equivalence.test.ts`(PR #6839)钉住,契约侧的
  `IMetadataService.getObject` 自 PR #6723(#6505)起也写明了这条等价关系。

  同一句话在 `mcp-server-runtime.metadata-outage.test.ts` 里被复述过一次,一并
  更正。

  仍然成立的那半条理由被保留:`getObject` 是 `IMetadataService` 自己的成员,
  #6055 当时它并**没有**被文档化的等价关系,在消费端擅自假定一条正是 Prime
  Directive #12 禁止的私有方言 —— 所以解析器当初没有被换掉。

  **纯注释,零行为变化。** 这次更正**不**主张把解析器换成
  `getDiagnosed('object', name)`:那是一次独立的判断,由接手的人按其自身利弊
  去做,本次改动既不作出也不预设。

- 5c2716b: mcp: a metadata outage stops being reported to MCP clients as `Agent "X" not found`

  The `agent_prompt` prompt resolved its body through `metadataService.get('agent', name)`
  and answered the resulting `undefined` with `Error: Agent "X" not found`. That `undefined`
  carries two opposite facts (#5840, ADR-0110 D3): the name was never declared, or every
  loader behind the metadata service was down. So during a metadata outage an MCP client was
  told, positively, what the author had declared — from a read that never happened. The same
  shape sat one bridge over: the `objectstack://objects/{objectName}` resource answered
  `getObject()`'s `undefined` with `Object "X" not found`.

  **Both surfaces now separate the two.** A degraded read answers `SERVICE_UNAVAILABLE` —
  the same catalogued code and the same "whether it exists is unknown, retry once it is
  reachable" sentence the `sys_metadata` half of this family already emits (#5532 / #5843) —
  and a genuine miss keeps its not-found answer, byte for byte on the prompt surface.
  MCP's `prompts/get` and `resources/read` results carry no error envelope, so the
  classification travels in the payload each surface already had: the prompt's text, and the
  resource's JSON body, which now names `code` and `status` on **both** answers
  (`SERVICE_UNAVAILABLE`/503 vs `RESOURCE_NOT_FOUND`/404) so a client can tell them apart
  without parsing prose.

  **This is a diagnosis fix, not an access change.** Both surfaces were already fail-closed:
  no instructions and no schema were served during an outage before this, and none are now.
  The defect was the description.

  Hosts whose `metadata` slot predates the optional `getDiagnosed` member report nothing
  degraded — exactly what they could express before — so their behaviour is unchanged. The
  object resource additionally keeps `getObject()` as its resolver and consults the
  diagnosed read only as a verdict probe on the miss path, because `getObject` is its own
  contract member with no documented equivalence to `get('object', name)` (and
  `MetadataFacade.getObject` is not that).

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
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [e0f300b]
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
- Updated dependencies [d5e9f6e]
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
- Updated dependencies [cafec0a]
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
- Updated dependencies [6965160]
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
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
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
  - @objectstack/formula@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

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

### Patch Changes

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
- Updated dependencies [0f17114]
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
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
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
- Updated dependencies [bf1edef]
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
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

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
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/formula@17.0.0-rc.2

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

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

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
- Updated dependencies [030125b]
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
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- 15dbe18: feat(mcp)!: stdio transport requires an API-key principal — fail-closed, no unscoped bridge (ADR-0101, #3246)

  The long-lived MCP **stdio** transport no longer reads data unscoped. It now runs
  under an env-supplied identity, closing the platform's last identity-less
  execution surface (the `mcp-stdio-authority` conformance row graduates
  `experimental` → `enforced`).

  - `OS_MCP_STDIO_API_KEY=osk_...` supplies the stdio identity, resolved through
    the SAME `@objectstack/core` verify + authorization chain as the HTTP/REST
    surfaces; the `record_by_id` resource reads via `ql.find(obj, { where:{id},
context })`, so RLS/FLS/tenant apply exactly as on REST `/data`. Re-resolved
    per read, so a revoked/expired key stops working on a live session.
  - **Fail-closed** — enabling stdio auto-start (`OS_MCP_STDIO_ENABLED=true` /
    `autoStart`) without a resolvable key throws and refuses to start. There is no
    unscoped fallback and deliberately no `system` bypass; full authority is a key
    minted on a platform-admin or dedicated service identity.

  **BREAKING (stdio auto-start only):** previously `OS_MCP_STDIO_ENABLED=true`
  (or the plugin `autoStart` option) started stdio with full, unscoped authority
  and no credential. It now requires `OS_MCP_STDIO_API_KEY`; without it, boot
  fails closed. The default-on HTTP surface and any deployment that never enables
  stdio auto-start are unaffected.

- 83e8f7d: feat(mcp): decouple the stdio auto-start switch from the HTTP surface + surface the MCP endpoint on `os dev` boot (#3167)

  The MCP HTTP surface (`/api/v1/mcp`) and the long-lived stdio transport used to
  share one env var: `OS_MCP_SERVER_ENABLED=true` turned the HTTP surface on **and**
  silently auto-started the stdio transport — which bridges the raw metadata service

  - data engine with no per-request principal (unscoped). An operator setting it to
    "make sure MCP is on" got an unscoped transport as a side effect.

  * **`@objectstack/types`** — new `resolveMcpStdioAutoStart()`. Stdio auto-start is
    now its own switch, `OS_MCP_STDIO_ENABLED` (default off); `OS_MCP_SERVER_ENABLED`
    governs only the HTTP surface. The legacy `OS_MCP_SERVER_ENABLED=true` trigger
    still starts stdio for one release, flagged as deprecated. `=false` is unchanged
    (it only ever gated HTTP).
  * **`@objectstack/mcp`** — `MCPServerPlugin.start()` gates stdio on the new switch
    and logs a one-time deprecation warning when started via the legacy alias.
  * **`@objectstack/cli`** — `os dev` now prints the MCP endpoint, the agent-skill
    URL, and a ready-to-paste `claude mcp add` command on boot (gated on the HTTP
    surface being on), so the "an agent operates the app it's building" loop is
    discoverable at dev time.
  * **`create-objectstack`** — the blank scaffold README documents that the app is
    itself an MCP server (the serve side), distinct from the consume-side connector.

- 230358c: feat(mcp): `validate_expression` tool — validate a CEL expression against a schema before authoring (#1928)

  Adds an agent-callable MCP tool that runs the same build-time expression checks
  as `objectstack build`, so an AI can validate a formula / predicate / flow
  condition **while authoring** instead of shipping one that silently evaluates to
  `null`. Given `{ objectName, expression, site? }` it resolves the object's real
  schema (field names + types, via the principal-bound `describeObject` bridge)
  and returns:

  - **errors** — bare field refs (`amount` → `record.amount`), unknown fields
    (with a did-you-mean), unknown functions;
  - **warnings** — text/boolean fields misused in arithmetic, date-equality
    pitfalls;
  - **inScope** — the fields, stdlib functions, and namespace roots available, so
    the model can self-correct;
  - **inferredType** for a `formula` site.

  `site` (`formula` | `validation` | `flow_condition` | `template`, default
  `formula`) maps to the validator's role + scope — `flow_condition` binds fields
  bare, the rest bind `record.<field>`. Read-only, gated by the `data:read` OAuth
  scope, and fail-closed on `sys_*` objects like the other schema tools. This is
  the authoring-time surface the guardrail series (#1928) always pointed at;
  `@objectstack/mcp` gains a `@objectstack/formula` dependency (acyclic; formula is
  a leaf).

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
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [7125007]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
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
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 15dbe18: feat(mcp)!: stdio transport requires an API-key principal — fail-closed, no unscoped bridge (ADR-0101, #3246)

  The long-lived MCP **stdio** transport no longer reads data unscoped. It now runs
  under an env-supplied identity, closing the platform's last identity-less
  execution surface (the `mcp-stdio-authority` conformance row graduates
  `experimental` → `enforced`).

  - `OS_MCP_STDIO_API_KEY=osk_...` supplies the stdio identity, resolved through
    the SAME `@objectstack/core` verify + authorization chain as the HTTP/REST
    surfaces; the `record_by_id` resource reads via `ql.find(obj, { where:{id},
context })`, so RLS/FLS/tenant apply exactly as on REST `/data`. Re-resolved
    per read, so a revoked/expired key stops working on a live session.
  - **Fail-closed** — enabling stdio auto-start (`OS_MCP_STDIO_ENABLED=true` /
    `autoStart`) without a resolvable key throws and refuses to start. There is no
    unscoped fallback and deliberately no `system` bypass; full authority is a key
    minted on a platform-admin or dedicated service identity.

  **BREAKING (stdio auto-start only):** previously `OS_MCP_STDIO_ENABLED=true`
  (or the plugin `autoStart` option) started stdio with full, unscoped authority
  and no credential. It now requires `OS_MCP_STDIO_API_KEY`; without it, boot
  fails closed. The default-on HTTP surface and any deployment that never enables
  stdio auto-start are unaffected.

- 83e8f7d: feat(mcp): decouple the stdio auto-start switch from the HTTP surface + surface the MCP endpoint on `os dev` boot (#3167)

  The MCP HTTP surface (`/api/v1/mcp`) and the long-lived stdio transport used to
  share one env var: `OS_MCP_SERVER_ENABLED=true` turned the HTTP surface on **and**
  silently auto-started the stdio transport — which bridges the raw metadata service

  - data engine with no per-request principal (unscoped). An operator setting it to
    "make sure MCP is on" got an unscoped transport as a side effect.

  * **`@objectstack/types`** — new `resolveMcpStdioAutoStart()`. Stdio auto-start is
    now its own switch, `OS_MCP_STDIO_ENABLED` (default off); `OS_MCP_SERVER_ENABLED`
    governs only the HTTP surface. The legacy `OS_MCP_SERVER_ENABLED=true` trigger
    still starts stdio for one release, flagged as deprecated. `=false` is unchanged
    (it only ever gated HTTP).
  * **`@objectstack/mcp`** — `MCPServerPlugin.start()` gates stdio on the new switch
    and logs a one-time deprecation warning when started via the legacy alias.
  * **`@objectstack/cli`** — `os dev` now prints the MCP endpoint, the agent-skill
    URL, and a ready-to-paste `claude mcp add` command on boot (gated on the HTTP
    surface being on), so the "an agent operates the app it's building" loop is
    discoverable at dev time.
  * **`create-objectstack`** — the blank scaffold README documents that the app is
    itself an MCP server (the serve side), distinct from the consume-side connector.

- 230358c: feat(mcp): `validate_expression` tool — validate a CEL expression against a schema before authoring (#1928)

  Adds an agent-callable MCP tool that runs the same build-time expression checks
  as `objectstack build`, so an AI can validate a formula / predicate / flow
  condition **while authoring** instead of shipping one that silently evaluates to
  `null`. Given `{ objectName, expression, site? }` it resolves the object's real
  schema (field names + types, via the principal-bound `describeObject` bridge)
  and returns:

  - **errors** — bare field refs (`amount` → `record.amount`), unknown fields
    (with a did-you-mean), unknown functions;
  - **warnings** — text/boolean fields misused in arithmetic, date-equality
    pitfalls;
  - **inScope** — the fields, stdlib functions, and namespace roots available, so
    the model can self-correct;
  - **inferredType** for a `formula` site.

  `site` (`formula` | `validation` | `flow_condition` | `template`, default
  `formula`) maps to the validator's role + scope — `flow_condition` binds fields
  bare, the rest bind `record.<field>`. Read-only, gated by the `data:read` OAuth
  scope, and fail-closed on `sys_*` objects like the other schema tools. This is
  the authoring-time surface the guardrail series (#1928) always pointed at;
  `@objectstack/mcp` gains a `@objectstack/formula` dependency (acyclic; formula is
  a leaf).

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
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
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
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1

## 15.1.0

### Minor Changes

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
- Updated dependencies [4109153]
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
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- e8cedec: Docs accuracy: correct how the MCP SKILL.md describes an agent's authority to match the shipped ADR-0090 D10 model. An OAuth-connected client is an **agent acting on behalf of** the signing-in user — every call is bounded by the **intersection** of the consent scopes and that user's own permissions/RLS (a `data:read` token can never write, even where the user could), not simply "runs as you". (Companion doc-only edits to `content/docs/ai/agents.mdx` and `docs/design/permission-model.md` correct the same framing and honestly mark the still-planned agent guardrails — the grant-ceiling lint, destructive-action co-sign, and double-signature audit provenance.)
- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Minor Changes

- 332b711: feat(mcp): plugin-carried "Connect an agent" Setup page (#2714 Phase 1)

  The MCP plugin now registers a Setup page (`connect_agent`) plus its
  navigation entry under Integrations — the nav lives and dies with the
  capability (cloud ADR-0009 principle) and follows the surface's default-on
  switch: an opted-out deployment (`OS_MCP_SERVER_ENABLED=false`) gets no page
  and no entry. The page body is the `mcp:connect-agent` SDUI widget provided
  by objectui (objectui#2372): env MCP URL, per-client connect cards, SKILL.md
  download, API-key minting. zh-CN nav label included.

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
  - @objectstack/types@14.0.0

## 13.0.0

### Minor Changes

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

- e097576: fix(mcp): the generated SKILL.md now documents the business-action tools

  `renderSkillMarkdown()` listed only the 7 object-CRUD tools; the MCP surface
  exposes 9 — `list_actions` / `run_action` (business actions) were missing, so
  agents installing the skill never learned they can run approvals, conversions,
  or flow triggers directly. The skill now covers the full native tool surface
  and teaches action preference: when `list_actions` offers a matching action,
  call it instead of hand-editing the records it would have touched (actions
  carry the app's validation and side effects), confirming destructive or
  confirmation-flagged actions with the user first.

  Prerequisite for the distribution shells (#2714 Phase 0): every shell repo
  copies this rendered content, so the gap had to close before fan-out.

- 148beb4: test(mcp): drift guard — SKILL.md must document every registered native tool

  The registered surface is obtained by driving the real registration path (a
  `tools/list` round-trip against `MCPServerRuntime` with a full data+action
  bridge), not a hand-maintained list, so adding a tool to `mcp-http-tools.ts`
  without teaching `skill.ts` fails the suite. Guards against a recurrence of
  the 7-of-9 gap fixed in #2715; red-proven by temporarily removing
  `run_action` from the skill.

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/types@12.3.0

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
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/types@12.1.0

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
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

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
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/types@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/types@10.1.0

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
  - @objectstack/types@10.0.0

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
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1

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
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/types@9.4.0

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
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- d8c5374: ai
  - @objectstack/spec@8.0.1
  - @objectstack/core@8.0.1
  - @objectstack/types@8.0.1

## 8.0.0

### Major Changes

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

### Minor Changes

- 87cb13c: feat(mcp): generic ObjectStack Agent Skill generator (ADR-0036 Phase 2b)

  Adds `renderSkillMarkdown({ mcpUrl, envName })` — produces a portable
  `SKILL.md` (open Agent Skills standard: Claude Code, OpenAI Codex, Gemini CLI,
  Copilot, Cursor, …) that teaches any skills-capable agent how to drive an
  ObjectStack environment over MCP.

  Per ADR-0036 Amendment C, this is ONE generic skill, not a per-app artifact:

  - the content never enumerates a tenant's schema — it instructs the agent to
    discover live via `list_objects` / `describe_object`, so one install works for
    every app the caller's key can reach and a new app needs no reinstall;
  - only the connection URL is environment-specific, slotted in by the caller;
  - it documents the object-CRUD tools, auth via `x-api-key` (Bearer is session
    auth), and the governance model (every call runs under the caller's
    permissions + RLS — fewer rows / write rejections are expected, not bugs).

  Exported: `renderSkillMarkdown`, `OBJECTSTACK_SKILL_NAME`,
  `OBJECTSTACK_SKILL_DESCRIPTION`, `RenderSkillOptions`. The objectui/cloud
  surfacing layer calls this to offer a one-click skill download alongside the
  env's remote-MCP URL and a show-once key.

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
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

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
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1

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
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
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

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
