# @objectstack/driver-sql

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
  - @objectstack/observability@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- 0f17114: fix(driver-sql,driver-memory,formula)!: `{ field: {} }` 一律拒收 —— 零个操作符的字段约束不再在四个后端有三个答案 (#5240)

  `{ a: {} }`(一个字段,后面跟零个操作符)是 `FilterConditionSchema` 今天**声明合法**的形状,
  而同一个 filter 在同仓四条路径上有三个答案:

  | 路径                                | 改前                                                                                            | 改后                          |
  | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
  | `driver-sql`,顶层 plain map         | 抛 `INVALID_FILTER`(#5041 的比较数闸门)                                                         | 抛 `INVALID_FILTER`(专用消息) |
  | `driver-sql`,`$and`/`$or`/`$not` 内 | 遍历零个操作符 → 不产出任何 SQL → **TRUE(匹配全表)**                                            | 抛 `INVALID_FILTER`           |
  | `driver-memory`                     | 实时路径经 mingo 变成「字段深等于空文档」;参考匹配器落到 `JSON.stringify` 结构相等 → 顺带 FALSE | 抛 `INVALID_FILTER`           |
  | `@objectstack/formula`              | `keys.length === 0` 显式 fail-closed → FALSE                                                    | 抛 `INVALID_FILTER`           |

  于是 `{ $or: [ { a: {} }, { b: 2 } ] }` 在 SQL 上编译成 `(b = 2)` —— 既不是「零约束即 TRUE」
  该给的全表,也不是两个 JS 后端给的 FALSE,而是**子句被 knex 连同空分组一起丢掉**的结果;
  而 `driver-sql` 自己内部就不自洽:同一个 `{ a: {} }` 写在顶层被响亮拒收,包进一层 `$or`
  就变成静默的 TRUE。

  维护者拍板取**拒收**(不取 TRUE、不取 FALSE):这个形状几乎必然是编写期事故 ——
  筛选器记下了字段却没记下操作符,或生成的元数据把操作符弄丢了 —— 让它在编写期就炸,
  好过在某个后端上安静地多返回或少返回几行。与 #5041 已在 driver-sql 顶层建立的先例一致,
  本次只是把同一道闸门补进组合子内部。四个后端(第四个是继承 `SqlDriver` 的
  `driver-sqlite-wasm`)现在给出同一个 `INVALID_FILTER` / 400,消息里指名出事的位置
  (如 `filter.$or[0].stage`)。

  **⚠️ 可观察的行为变更 —— RLS `check` 求值路径。** `@objectstack/formula` 的
  `matchesFilterCondition` 是 `plugin-security` 对 insert/update **后像**执行行级 `check`
  的那条路径(没有查询可下推,这个求值器就是执行本身)。它改为抛出后,落在 #4775
  「求不出值 = 该次操作失败」的既定姿态上。这不只是「拒绝得更响」——有一类结果直接翻转:

  | `check` 策略                                    | 改前                                  | 改后                     |
  | ----------------------------------------------- | ------------------------------------- | ------------------------ |
  | `{ a: {} }`                                     | FALSE → 写入被拒(403)                 | 抛出 → 该次写入失败(400) |
  | `{ $or: [ { a: {} }, { owner: '{userId}' } ] }` | FALSE 被另一析取项吸收 → 写入**放行** | 抛出 → 该次写入失败      |
  | `{ $not: { a: {} } }`                           | `!false` → 写入**放行**               | 抛出 → 该次写入失败      |

  后两行是**原本能成功、现在会失败**的写入。这是拍板的目的而非副作用:一条含
  `{ field: {} }` 的权限规则,是一条作者弄丢了操作符的规则,它的含义不该取决于四个后端里
  哪一个在求值。升级后请检查 `check`/`using` 策略里是否存在零操作符的字段约束——
  错误消息会指名位置。

  同一条改动也让 `@objectstack/driver-memory` 的两个过滤面(经 mingo 的实时查询路径,
  与跨后端一致性套件所用的 `memory-matcher` 参考匹配器)第一次对这个形状给出同一个答案。

  非空形状**逐字符不变**:普通比较、`$in`、`$or`/`$and` 组合、`$not` 的 #5146 NULL-safe 改写,
  编译出的 SQL 文本与匹配结果都与改前相同;`{}`(零个键的**节点**,#5134 的布尔单位元)
  与 `{ field: {} }` 是两个不同形状,前者的语义不受本次影响。

  注:本次收紧的是**实现**。`packages/spec` 的 `FilterConditionSchema` 仍然声明这个形状合法
  (非递归半边是 `z.record(z.string(), z.unknown())`),即实现现在比已声明的契约更严;
  契约收窄与 `FILTER_LOGIC_CASES` 补条归 spec 车道另行处理。

- c7406b0: fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

  `FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
  授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
  钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

  ## 改了什么

  进入运行时的门有两扇,过去只有一扇按契约读:

  | 门                                                                                                | 改前                                                                                                                               | 改后                                                                                            |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | **Door 1** —— 协议/HTTP 面(`metadata-protocol`)                                                   | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER`                                                             | 不变                                                                                            |
  | **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动                                                                                                             | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
  | 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`)            | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400                                              |

  一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
  `RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
  删掉方言后两侧自然合流。

  ## 授权面:零变化

  `FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
  `filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
  这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

  ## ⚠️ 可观察的行为变更

  1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
     声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
  2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
     照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
     `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
     返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
  3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
     变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
  4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
     导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
     注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
     挡住这个输入,所以拒收必须在运行时。
  5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
     (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
     AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

  ## 删除的代码面

  - `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
  - `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
  - `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
  - `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

  `[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。

- 4addd9d: feat(driver-sql)!: organization-scoped uniques are NULL-safe — `COALESCE(organization_id, '__global__')` key part + `unique: 'organization'` on declared indexes (ADR-0120 D3/D4, #5030)

  SQL UNIQUE is NULL-distinct, so the `(organization_id, field)` composite #3696
  introduced enforced **nothing** on rows whose organization is NULL — which on a
  single-tenant stack (where the kernel injects the column and never fills it) is
  **every row**: field-level `unique: true` was a silent no-op there, measured in
  #5030. Per ADR-0120 D3, every organization-scoped unique now materializes its
  organization key part as `COALESCE(organization_id, '__global__')`: NULL-organization
  rows collapse into one platform bucket, unique among themselves; non-NULL rows
  are untouched. Storage stays NULL — the sentinel exists only inside the index
  key, and it is the same word the autonumber sequence table already uses
  (`GLOBAL_TENANT`), so a constraint-violation error reads as "the platform
  bucket collided", not as corrupt data.

  What changes, concretely:

  - **Field-level `unique: true`** (and the new explicit synonym
    `'organization'`) on a tenant-scoped object → composite
    `(COALESCE(tenantField, '__global__'), field)`. `unique: 'global'` and
    tenant-less objects are unchanged.
  - **Declared indexes gain the ADR-0120 D1 scope vocabulary at the driver**:
    `unique: 'organization'` prepends the NULL-safe organization key part to the
    listed columns (degrading to the listed columns on a tenant-less object; a
    listed tenant column is made NULL-safe in place instead — the S6 respelling).
    `unique: true` / `'global'` on a declared index stays **verbatim** — the
    #3696 contract, now the `'global'` arm; the nine engine dedup/idempotency
    keys keep their exact physical shape. (The spec/lint side of the vocabulary
    lands separately via #4986; the driver deliberately merges first.)
  - **Drift detection reads both sides through one normalization**
    (the #4884 discipline, extended to the tenant key part): the physical
    `COALESCE(organization_id, <literal>)` form is attributed to the column,
    compared **literal-agnostically**, and recognised as the sync's own
    vocabulary — a healthy database reports zero drift on every dialect.
  - **Existing bare composites migrate through the ceremony (ADR-0120 D4)**:
    `(organization_id, X) → (COALESCE(organization_id, '__global__'), X)`
    surfaces as a `recreate_index` drift op — a pure tightening — gated by a
    **duplicate pre-flight probe**. Clean probe → the op grades `safe` and dev
    `autoMigrate: 'safe'` / a plain `os migrate apply` applies it. Duplicates
    (data the void constraint wrongly admitted) → the op is **blocked** with a
    per-group row report, the old index stays in place, and apply re-probes so
    even `--allow-destructive` cannot drop a constraint whose replacement is not
    creatable. Deduplicate, re-plan, apply.
  - **`'__global__'` is reserved at the organization-minting seam**
    (plugin-auth): an organization whose id or slug equals the sentinel is
    rejected at creation with a prescriptive error (ADR-0120 D3 guardrail).

  Migration note for operators: on databases with pre-existing
  organization-composite uniques, the first `os migrate plan` after upgrading
  shows one `recreate_index` per affected index. On healthy data it auto-applies
  in dev and is a no-op content-wise; a blocked op means the #5030 defect
  admitted real duplicate rows — resolve the listed rows first. MySQL < 8.0.13 /
  MariaDB cannot express the functional key part: the driver degrades to the
  bare composite, says exactly what is not enforced at `error` level, and keeps
  reporting the tightening as drift for after the server upgrade.

### Patch Changes

- 28ad90e: feat(types,cloud-connection,lint,cli): ADR-0120 17.x 收尾 —— `isolated` 安装期姿态硬门(D5e)、D5c 重拼写 advisory、成文契约扫荡与三姿态 conformance (#5081)

  ADR-0120 17.x 波的第三块,也是最后一块。前两块已在 main 上:#5212(driver 侧
  D3+D4 —— `COALESCE(organization_id, '__global__')` 物化、drift 两侧同步、重复预检)
  与 #5208(spec 词汇 `'organization'` + D5a/D5b lint)。本次补齐三件事:安装期的
  姿态决策点、剩余的成文契约、以及把「一个 app 包跑遍三种姿态」从假设变成测试。

  **D5e —— 装进 `isolated` 环境时的硬门。** 词汇本身是姿态无关的:作者说的是业务
  边界(`'organization'` 一个组织一份 / `'global'` 整个安装一份),没有任何索引形状
  读姿态。唯一的残留在一个方向上:`isolated` 下组织就是**不同客户**,此时 app 业务
  对象上的 `'global'` 唯一既跨客户过度约束,又变成跨客户的存在性预言机(S10/S14)。
  维护者裁定这是**硬门而非 advisory**:把带 `'global'` 唯一(非 `sys` 对象)的 app
  装进 `isolated` 环境会**停下来并逐索引列出**,安装者(通常是 AI agent)要么确认它
  确实是平台级的,要么改写为 `'organization'`;确认按 ADR-0104 attestation 风格
  留痕在安装清单里(`InstalledManifestEntry.globalUniqueAttestation` —— 确认了什么、
  谁确认的、何时、在哪个姿态下问的),**之后不复问**。

  - 停下的安装**什么都不留**:先于 hot-register 和任何 ledger 写入,所以作者改完
    元数据可以直接重试,不需要先卸载。
  - 逐索引确认是有牙齿的:`confirmGlobalUniques` 收 `true` 或明确的 id 数组,只确认
    其中一条仍会在剩下的那条上停住。
  - 升级引入的**新**约束会被问,老的答案继续算数。
  - 另一个姿态下给出的确认**不算同意** —— `isolated` 那个问题在 `single` 下从未被
    问过,所以按「未确认」处理(唯一不会静默放行跨客户约束的方向)。
  - ⛔ **永不做成启动期告警**(#4884 纪律)。boot 时的 rehydrate 不评估此门;门够不到
    的两类存量 —— 门禁上线前的安装、装后姿态变更的环境 —— 由 `os doctor` 与
    `os migrate plan` 的 advisory 形态覆盖。

  判定里有三条是承重的,别「简化」掉:声明索引上的裸 `unique: true` **算**(D1 说它
  就是 `'global'` 的位置式拼写,排除它等于让整个 17.x 可以靠拼写绕过);字段级
  `true` **不算**(它是 `'organization'`,永久合法);`sys_`/`base_` 对象**不算**
  (S5 那批引擎幂等键天然就是平台级的,每次安装都问一遍就是 #4884 的误报类)。

  CLI: `os package install` 新增 `--confirm-global-uniques`,并把 409 渲染成可读的
  逐条清单而不是一句 "Install failed (409)"。

  **D5c —— 遗留手写组织复合索引的 advisory。** 新规则
  `unique/legacy-organization-composite`:声明的唯一索引自己列出了组织列
  (`{ fields: ['name','organization_id'], unique: true }`)—— 这是词汇出现之前手写
  per-organization 的写法。它读起来像「每组织唯一」,物化出来却是普通复合索引,而
  SQL UNIQUE 是 NULL-distinct 的:组织列为 NULL 的行上它**什么都不约束**(#5030),
  在单组织部署上那就是每一行。改写成 `unique: 'organization'`(`fields` 原样保留,
  driver 会把已列出的组织列**就地**变成 NULL-safe 形式)正是补上这个洞的动作。
  **永远只是 advisory,永远不自动修**:老拼写永久合法、零强制 drift,而 opt-in 是
  真实的物理收紧,要走 D4 的 `recreate_index` + 重复预检。

  **D6 —— 成文契约扫荡。** `content/docs/data-modeling/indexing.mdx` 的
  §Two ways to say "unique" 全节按新词汇重写(含 `os:check` 代码块);
  `content/docs/protocol/objectql/schema.mdx` 的 §Uniqueness and tenancy 重写为
  §Uniqueness and scope —— 其中那句「单租户部署不受影响,租户列是常量,复合索引
  退化为单列索引」是 #5030 **证伪过的原话**,现已替换为 D3 的 NULL-safe 事实;
  `content/docs/deployment/cli.mdx` 的 `replace_unique_index` / `recreate_index`
  条目补上 NULL-safe 形状与重复预检;`content/docs/references/**` 经
  `gen:schema && gen:docs` 再生成,未手改。

  按 ADR-0120 Resolved #2 的非规范性引导(官方示例/脚手架/生成器在新代码中输出
  显式拼写),`skills/objectstack-data/**` 的索引与校验规则整体扫过:声明索引一律
  说清 scope,并新增一节完整讲 `'organization'` 的 NULL-safe 语义与「永远不写姿态」。
  顺带修掉那里长期使用的 `tenant_id` —— 平台的列叫 `organization_id`。
  `examples/**`、`create-objectstack` 模板与 `os generate` 经核查**根本没有声明任何
  唯一约束**,故无可扫;这是核查结论,不是遗漏。

  **三姿态 conformance(ADR §Acceptance tests)。** 同一个 fixture app 在
  `single | group | isolated` 三姿态下启动,逐 S 行用**真实的违规插入**断言 enforcement
  (S1/S2/S3/S4/S5/S6/S7/S8/S9/S11/S12),并逐姿态捕获物化出的索引键,断言三者
  **逐字节相同** —— 「没有任何索引形状读姿态」这句话一旦有两者不同就是假的。相同性
  断言配了一条正向断言(对着期望的键形状),这样「三次都什么都没建」不会读成「一致」。
  外加 ADR 只要的那一条 transition smoke:在 `single` 下建库、`isolated` 下重新打开,
  drift op 为零。

  对既有部署的影响:除新增的安装期确认外,本次不改变任何已有物化行为。字段级
  `unique: true` 一如既往合法。

- 06ba036: feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

  `TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
  `objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
  公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
  的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
  `fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
  在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

  **新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
  带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
  `RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
  驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
  不要凭据（remote 面走包内的 sqlite stub）。

  **留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
  `vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
  `MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
  一部分，只是曾经同包而已。

  **目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
  `driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
  `knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
  `repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

  这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
  迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
  filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
  `LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
  补齐工作跟踪在 #5590。

- d9971d3: fix(driver-sql): `$field` 跨字段比较改为按 ADR-0112 响亮拒绝,不再抛裸 TypeError

  `{ amount: { $gt: { $field: 'budget' } } }`(spec `FieldReferenceSchema`,由 `compileCelToFilter` 在转译含字段间比较的 CEL 权限/RLS 规则时产出)此前被 SqlDriver 当作**绑定值**交给驱动,sqlite 抛出无 `code`、无 `status` 的裸 `TypeError` —— 落在 `INVALID_FILTER` 信封之外,到客户端表现为不透明的服务端错误。更隐蔽的是列表位置:`$in` / `$between` 里的 `$field` 成员连报错都没有,直接静默返回零行。

  现在两者都以完整信封拒绝(`error.code = INVALID_FILTER`、HTTP 400、无 `[sql-driver]` 前缀),报错点名字段、运算符与被引用字段,并说明跨字段比较**当前仅内存求值路径(`matchesFilter`)支持**。三个比较发射点统一处理,Filter Protocol 与数组三元组两种写法得到同一答案。

  同一处闸门补上了 issue 指出的通用臂:**已知运算符 + 无法绑定的值形态**(标量比较位上的普通对象 / 数组)此前同样是裸 `TypeError`,现在也返回 `INVALID_FILTER`。`$in` / `$nin` / `$between` 的正常数组绑定不受影响。

  `FieldReferenceSchema` 声明保留,JSDoc 补注执行支持面(内存求值 ✅ / SQL 下推 ❌ 响亮拒绝);SQL 列对列编译实现见 #5222。

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

- 9c5abf4: fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

  Two shapes the Filter Protocol never declared were reaching the drivers, and
  every driver ANSWERED them — with a different answer. Both are now refused with
  `INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
  already speaks.

  ## `$null` with a non-boolean comparand — a behaviour change you can observe

  `FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
  default branches hung on opposite sides, so one filter meant opposite things per
  backend. Measured against one row with `stage: 'won'` (id 1) and one with
  `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

  | backend                                     | read as                           | rows        |
  | ------------------------------------------- | --------------------------------- | ----------- |
  | driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`)    | `["2"]`     |
  | driver-memory query path, driver-mongodb    | IS NOT NULL (anything but `true`) | `["1"]`     |
  | driver-memory reference matcher             | no constraint at all              | `["1","2"]` |

  **What changes for you:** a caller that today gets rows back for
  `{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
  operator, the field and the position. That includes calls working by truthy /
  falsy coincidence — and the sharpest case is the STRING `"false"`, which is
  truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
  the opposite of what its author wrote it to mean, on at least one of them
  whichever they meant. A JSON round-trip or generated metadata produces it
  readily.

  **The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
  `{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
  backends, and so is every other operator. `$exists` is deliberately NOT tightened
  here — it diverges on its own axis (what "exists" means for a null-valued key)
  and is tracked separately.

  ## An undeclared `$op` in a document position — silent empty set becomes a 400

  `FilterConditionSchema` declares exactly three `$`-keys at a node
  (`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
  compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
  `{ $expr: … }` produced a predicate that matched nothing and reported nothing —
  a caller could not tell "no rows matched" from "the filter never compiled". The
  FIELD position had refused the same class of input since v16, so one driver gave
  two answers depending on depth.

  **What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
  returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
  (and `driver-sqlite-wasm`, which inherits it) into line. The three declared
  combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
  and every legal filter compile byte-identically.

  Both refusals are raised on the driver's validating walk rather than in its SQL
  emitter, so a malformed node is refused regardless of whether a sibling
  disjunct would have short-circuited the compile.

- f98fa65: fix(driver-sql): a fresh database no longer boots "drifted", and the drift
  detector never points `--allow-destructive` at an index the framework created
  (#4884)

  Booting `examples/app-showcase` on a brand-new empty SQLite file printed two
  `[schema-drift]` warnings before the server was even ready, both about the
  ADR-0048 overlay indexes the same boot had just created. Both were false, and
  one of them was dangerous:

  > `[schema-drift] sys_metadata: index 'idx_sys_metadata_overlay_draft' UNIQUE
(type, name, organization_id) carries ObjectStack's generated naming but
matches no declared index (orphaned) — "os migrate apply --allow-destructive"
to drop it.`

  `idx_sys_metadata_overlay_draft` is the unique index enforcing **draft-overlay
  uniqueness**. An operator following our own boot advice would have dropped a
  live data-integrity guarantee to fix a problem that did not exist — and, worse,
  learned to treat `--allow-destructive` as routine boot hygiene, which is exactly
  what makes the _next_, real drift warning dangerous.

  Three fixes, in the driver's detector only (no metadata declaration changed —
  `sys-metadata.object.ts` documents its four-column `indexes[]` entry as _the
  fallback shape for drivers without the runtime migration_, and that contract
  still holds for the drivers that rely on it):

  - **The index key is now read as written.** Introspection took the key from each
    dialect's per-column catalogue view (`PRAGMA index_info`, `pg_attribute`,
    `STATISTICS.COLUMN_NAME`), which describes an expression key as a NULL column
    and nothing else. The canonical
    `(type, name, organization_id, COALESCE(package_id,''))` overlay index
    therefore arrived as three columns and was reported as a mismatch against its
    own four-column declaration. SQLite and Postgres now parse the index
    definition (`sqlite_master.sql` / `pg_get_indexdef`), MySQL reads
    `STATISTICS.EXPRESSION` where the server has it, and `COALESCE(col, <literal>)`
    is recognised as keying on `col` — which is what ADR-0048 uses it for: a plain
    UNIQUE index treats NULLs as distinct, so package-less globals would not be
    unique among themselves.
  - **Partial predicates are captured.** A `WHERE`-restricted index is something
    `syncDeclaredIndexes` can neither create nor rebuild, so the detector no
    longer claims authorship of one, no longer calls it orphaned, and never
    proposes a remedy it could not undo.
  - **The driver keeps a ledger of the index DDL it executed.** An index this
    process created through raw `execute()` — how `metadata-protocol`'s
    `ensureOverlayIndex` issues its migration — is the framework's to manage. This
    also covers the plain-index fallback the same migration takes on dialects that
    reject partial indexes.

  Genuine drift is unaffected: an orphaned generated index, a redefined declared
  index and the #3696 legacy-unique replacement are all still detected, still
  categorised exactly as before, and still remediable through `os migrate`.

- 193cd5c: fix(driver-sql): 空 `$and`/`$or`/`$not` 按布尔单位元编译 —— `$or: []` 不再返回全表

  **这是一处查询行为变更,且直接关系到 RLS。** `{ $or: [] }` 以前返回**整张表**,
  现在返回**零行**。如果你的代码依赖了旧行为,它依赖的是一个 filter 旁路。

  `applyFilterCondition` 把每个组合子都编译成一个 knex 分组回调,而 knex 对「一个子句
  都没加进去的分组」不产出任何 SQL。于是「这个组是空的」和「这个组已被满足」编译成了
  同一条查询。**丢弃子句不等于套用单位元**,而两个单位元的方向是相反的:

  | 写法                 | 布尔代数                      | 旧编译    | 错的方向     |
  | -------------------- | ----------------------------- | --------- | ------------ |
  | `{ $and: [] }`       | TRUE → 全部行                 | 全表      | 碰巧正确     |
  | `{ $or: [] }`        | FALSE → **零行**              | 全表      | **静默放松** |
  | `{ $or: [{a}, {}] }` | `{}` 是 TRUE 析取项 → 全部行  | `(a = ?)` | 静默收紧     |
  | `{ $not: {} }`       | `NOT TRUE ≡ FALSE` → **零行** | 全表      | **静默放松** |

  `$and: []` 恰好正确的理由不是代码理解了单位元,而是「丢掉」在 AND 侧碰巧等价于
  TRUE —— 同一段代码在 OR 与 NOT 侧就必然错。放松的那两格是安全相关的:`$or: []`
  最常见的来源正是「本该有条件、但循环一个析取项都没填进去」的 RLS read scope,
  把它当成全表意味着**本该看不到任何行的人拿到了整表**。

  同仓另外两个后端(`formula` 的 `matchesFilterCondition`、`driver-memory`)三条
  本来就都是对的,`driver-sql` 是唯一的例外;现在四个答案统一。

  **配套的形状拒收(否则修复会变得更糟)。** 套用单位元的前提是「编译成空」只剩一个
  成因。在此之前 `$or: [null]`、`$or: ['x']`、`$or: [[…]]`、`$or: [new Date()]`
  同样会无痕消失;不先拦掉它们就上单位元,会把它们从「被静默忽略」**升级成「匹配所有
  行」**,比原 bug 更坏。因此 `$and`/`$or` 的元素与 `$not` 的操作数现在必须是
  **plain object** 的 filter 节点,否则按 ADR-0112 响亮拒收
  (`INVALID_FILTER` / 400,报错指明出错位置,如 `filter.$or[1]`)。原型检查是关键
  的一半:`Date`/`RegExp`/class 实例都满足 `typeof x === 'object'` 却枚举为空,
  若被接受就会被读成 TRUE。同理 `$and: 'x'` 这类非数组操作数也不再被当成一个名为
  `$and` 的字段列。

  判定是**结构性**的(编译前先归约整棵树),而不是「编译完再问 knex 有没有产出」——
  原缺陷本身就是后者那种观察,而观察分不清「因为本来就是空」和「因为有东西没编译
  出来」。结构判定没有这个盲区,并且保证编译器打开的每个分组都至少收到一条子句,
  knex 再没有机会静默丢弃一个组。

  非空的 `$and`/`$or`/`$not` 编译方式完全未变。

- 5aae790: fix(driver-sql): `$not` 改为 NULL-safe —— 被比较列为 NULL 的行不再被否定条件静默排除

  **这是一处可观察的查询行为变更,且直接关系到 RLS 的可见集合。**
  `{ $not: { stage: 'won' } }` 以前**不返回** `stage IS NULL` 的行,现在**返回**它们。
  如果你的规则依赖了旧行为,它依赖的是「同一条规则在不同后端给出不同可见集合」。

  SQL 是三值逻辑:`NULL = 'won'` 是 UNKNOWN,`NOT UNKNOWN` 仍是 UNKNOWN,而 `WHERE`
  只保留 TRUE。于是 `applyFilterCondition` 编译出的裸 `NOT (stage = 'won')` 会把
  「该列没有值」的行整批丢掉;同一条 filter 在 `driver-memory` 与 `formula` 的
  `matchesFilterCondition` 上是普通的两值 JS 求值(`undefined !== 'won'` → 行匹配),
  两边把这些行**都返回**。一个 spec 声明的算子,答案取决于跑它的是哪个驱动。

  这不是「数目对不上」而已:权限规则里的 CEL `!expr` 经 `cel-to-filter.ts` 正是降解成
  `{ $not: {…} }`,所以同一条 read scope 在 SQL 数据源与内存数据源上准入的行集不同。
  #5146 判定以 JS 家族的答案为准(2:1 的多数派;写 `!(stage == 'won')` 的人不会预期
  「stage 为空的行被隐藏」),本次把 SQL 侧对齐过去。

  **编译出来的形状。** `$not` 的操作数在取反之前先被改写成**全域(total)谓词** ——
  永远是 TRUE 或 FALSE,不会是 UNKNOWN:

  ```sql
  -- 之前
  not (`stage` = 'won')
  -- 现在
  not ((`stage` is not null) and (`stage` = 'won'))
  ```

  对 issue 里给出的扁平形状,这与 `NOT (…) OR col IS NULL` 完全等价。把守卫下推到
  **每个叶子**而不是挂在 `NOT` 旁边,是为了在操作数嵌套时仍然正确:`$not` 里套一个
  `$or` 时,顶层的 `OR col IS NULL` 会把 JS 家族排除的行重新放进来(某一列为 NULL、
  但另一个析取分支成立的行)。

  **守卫方向按算子逐个判定,不是一刀切。** `{ $not: { a: { $ne: 5 } } }` 的语义是
  「a 就是 5」,两个 JS 后端都把 NULL 行排除在外;无条件加 `OR a IS NULL` 会把这些行
  交回去 —— 正是本驱动反复付过学费的静默放松(#2704 / #5134)。因此
  `$ne` / `$nin` / `$notContains` 用的是 `col IS NULL OR (…)`,`$eq` / `$in` /
  `$gt` / `$contains` 一族用 `col IS NOT NULL AND (…)`,而 `$null` / `$exists` /
  `$eq: null` / `$ne: null` 本来就是全域谓词,一个字节都不加。

  **只有 `$not` 路径被改写。** 普通比较的 SQL 逐字符不变(`{ a: 1 }` 仍然是
  `a = 1`),因此没有任何非否定谓词因此失去索引;`$not` 路径上的 `IS NOT NULL` 守卫
  本身处在一个原本就不可 sargable 的 `NOT (…)` 里。

  `#5134` / PR #5243 定下的布尔单位元(`{ $not: {} }` → 零行、`$not` of FALSE →
  全部行、非 filter 节点的操作数按 ADR-0112 响亮拒收)全部保持不变;`{ field: {} }`
  (#5240)也刻意不在此裁定 —— 它编译出的 SQL 与之前完全一致。

  `driver-memory` 与 `formula` 无需改动,本次为三家各补了一组 pin 测试,把「值缺失
  行在 `$not` 下的去留」钉在一起。跨驱动 conformance case(`FILTER_LOGIC_CASES`)与
  契约 TSDoc 归 spec 车道,随 #5239 落地。

- 07f1822: fix(driver-sql): `$ne` / `$nin` / `$notContains` 改为 NULL-safe;`$exists` 的非布尔比较值改为拒收

  **这是一处可观察的查询行为变更,且直接关系到 RLS 的可见集合。**
  `{ stage: { $ne: 'won' } }` 以前**不返回** `stage IS NULL` 的行,现在**返回**它们。
  `$nin` 与 `$notContains` 同理。

  ### 变更一:三个否定算子在 `$not` 之外也 NULL-safe(#5298)

  #5146 已经把 `$not` 判定为 NULL-safe(PR #5296),但**只改了 `$not` 内部**;算子自身
  携带否定的三个 —— `$ne` / `$nin` / `$notContains` —— 逐字符未变。于是留下一个使用者
  可见的裂缝:`{ $not: { stage: 'won' } }` 三家一致,`{ stage: { $ne: 'won' } }` 仍然
  分叉。

  成因与 #5146 同源:SQL 是三值逻辑,`NULL <> 'won'` 是 UNKNOWN 而不是 TRUE,`WHERE`
  只保留 TRUE;`driver-memory` 与 `formula` 的 `matchesFilterCondition` 用两值 JS 求值
  (`undefined !== 'won'` 直接为真),把这些行**都返回**。2026-08-06 裁定取「包含无值行」
  方向(与 #5146 同向),本次把 SQL 侧对齐过去。

  ```sql
  -- 之前
  `stage` <> 'won'
  `stage` not in ('won')
  `stage` NOT LIKE '%won%' ESCAPE '\'
  -- 现在
  (`stage` is null or `stage` <> 'won')
  (`stage` is null or `stage` not in ('won'))
  (`stage` is null or `stage` NOT LIKE '%won%' ESCAPE '\')
  ```

  **统一用 OR 展开,不走方言等价物**(`IS DISTINCT FROM` / `IS NOT` / `<=>`),三条理由:
  `NOT LIKE` 根本没有对应形式,走方言就必然要维护两种形状;SQLite 的写法依赖本仓并不
  锁定的引擎版本(sql.js 与 libSQL 各自演进);实测 `EXPLAIN QUERY PLAN` 两种写法计划
  完全相同 —— `<>` / `NOT IN` / `NOT LIKE` 改动前**本来就是全表扫描**,没有索引可失去,
  也没有索引可赢回。

  **正向比较一个字节都没动。** `{ a: 1 }` 仍然是 `a = 1`,`$in` 仍然是 `in (…)`,
  `$gt` / `$contains` 一族同理,所以绝大多数普通查询的 SQL 形状不变。
  `$ne: null` 也不变 —— 它是空值**谓词**(`IS NOT NULL`)而不是比较,「有任何值」对
  一个没有值的行本来就是假。

  **`$not` 路径不受影响。** `nullSafeNegationOperand` 的逐叶守卫按原样保留:它必须能在
  操作数任意嵌套时通过 De Morgan 组合,这与叶子发射器自身是否全域是两个独立的正确性
  来源,把它们耦合起来会让其中一个的回退静默破坏另一个。

  ### 变更二:`$exists` 的非布尔比较值改为拒收(#5369,套用 #5347 裁定 A)

  `FieldOperatorsSchema` 声明 `$exists: z.boolean()`,而从 `where` 到驱动之间没有任何
  环节按它校验,所以非布尔值真的会到达发射器。到达之后各后端分叉方向相反:本驱动的
  `opValue === false` 恒等判断把「除 false 以外的一切」读成 `IS NOT NULL`,`=== true`
  的写法则把「除 true 以外的一切」读成 `IS NULL`。注意字符串 `"false"` 是**真值**,
  所以它落在与作者本意**相反**的一侧 —— JSON 往返或 AI 生成的 scope 很容易产出它。

  现在与 `$null` 的闸门并排,在 `reduceFilterKey` 的校验遍历里拒收,`INVALID_FILTER` /
  400,信封与措辞同款。`{ $exists: true }` / `{ $exists: false }` 行为一字未变。

  **发射器与极性表刻意不动。** 闸门落地后只有两个布尔值能到达它们,`opValue === false`
  与 `value === false` 已经是穷尽的二选一。#5369 正文建议的「收紧为 `value === true`」
  方向写反了:极性表回答的是「NULL 列是否**满足**该算子」,而 NULL 列恰恰在调用方要求
  `$exists: false` 时满足它 —— `$null: true` 与 `$exists: false` 是同一个问题,两条
  分支正确地互为镜像,而不是互为副本。

  ### 相关

  `driver-memory` / `driver-mongodb` 的对应半边按 #5499 冻结,本次零改动、既有一致性
  断言全绿;`driver-turso` 的 remote transport 是独立编译器,归 #5903;
  `service-analytics` 的 `filter-normalizer`(Cube 面)归本裁决第二批。

- acf34e3: fix(drivers): refuse an `undefined` filter comparand instead of crashing (SQL) or silently answering `IS NULL` (Turso remote) (#6050)

  **⚠️ 行为变更(升级说明在最后一节)。** 比较数位置上的 `undefined` 从「静默/崩溃」变为 `INVALID_FILTER` / 400 拒收。作者侧的修法是显式判空,或改用 `null` / `$null`。

  ## 实测到的毛病

  同一个 `TursoDriver`,同一条过滤器,答案取决于它是用哪个 `url` 构造的 —— 四行 fixture(`d` 在 1-2 有值、3-4 为 NULL),`origin/main` @ `cba7454df`:

  | filter                                | LOCAL(继承 `SqlDriver`)          | REMOTE(`RemoteTransport`) |
  | ------------------------------------- | -------------------------------- | ------------------------- |
  | `{ d: undefined }`                    | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ d: { $eq: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ $not: { d: undefined } }`          | 抛裸 knex `Undefined binding(s)` | `['1','2']`               |
  | `{ d: { $ne: undefined } }`           | `['1','2']`                      | `['1','2']`               |
  | `{ $not: { d: { $ne: undefined } } }` | `[]`                             | `['3','4']`               |
  | `{ d: { $in: [undefined] } }`         | 抛裸 knex `Undefined binding(s)` | `[]`                      |
  | `{ d: { $gt: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `[]`                      |

  两个可分开的毛病:

  **A —— 抛出的那几格没有 ADR-0112 信封。** knex 的 `Undefined binding(s) detected when compiling SELECT` 既没有 `code` 也没有 `status`,`mapDataError` 落默认分支,于是一条「调用方把 filter 写坏了」的错误以不透明 500 的形态到达客户端。#1116 / #4436 为这条通路清点过同类形态,唯独漏了这一格。

  **B —— 守卫与它自己的发射器分裂。** `$ne` 发射器读 `coerced == null`(宽松,所以 `undefined` 编译成 `IS NOT NULL` —— 一条 TOTAL 谓词),而必须钉住这个发射器的两张极性表 `operatorIsNullTotal` / `nullValueSatisfiesOperator` 读 `=== null`(严格,于是判它「不 total」且「NULL 行满足它」)。`nullGuardForFieldSpec` 因此把一条已经 total 的谓词包成 `d IS NULL OR d IS NOT NULL` —— 恒真 —— 取反后恒假,答 `[]`。这正是 #5298 立的不变量(每张极性表钉的是它自己发射器的拼写)在它自己的定义处被破坏。

  ## 修法

  一道闸,落在比较数进入**任何**发射器或守卫之前,两个毛病同闸消灭:knex 再也见不到 undefined 绑定,守卫与发射器对 undefined 的分歧变成**不可达**而不是「被修好」。

  - `driver-sql`:闸落在 `reduceFilterKey` 的校验走查上(与 `$null` / `$exists` 的拒收并排),外加 `applyFilters` 的平铺映射分支 —— `{ d: undefined }` 进不了走查(`typeof undefined` 不是 `'object'`,构不成 `hasMongoOperators`),而它恰恰是这个 bug 最常见的拼写。两处共用一个函数。
  - `driver-turso`:`buildWhereSQL` 入口做一次整棵子树的前置走查。必须前置,否则 `{ $not: { d: undefined } }` 会先把操作数交给 `nullSafeNegationOperand`(一个守卫)。
  - 顺带把两侧的 `== null` / `|| === undefined` 拼写统一收严成 `=== null`(#5347 收紧 `$null` 臂时给的理由:宽松拼写在闸被挪走后会悄悄恢复回答一个没人裁决过的取值)。

  拒收的位置逐个清点:直接比较数、单值算子的比较数(`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族)、列表算子数组的**成员**(`$in`/`$nin`/`$between`)、以及嵌在 `$and`/`$or`/`$not` 里的以上各位。`$null` / `$exists` 的 `undefined` 保持它们**自己**的拒收措辞(比较数是声明的布尔量,那条消息更贴切 —— #5240「一个条件一种措辞」两个方向都适用)。两个驱动的拒收句子逐字一致。

  ## ⛔ `null` 一字未动

  `{ f: null }`、`{ $eq: null }` → `IS NULL`;`{ $ne: null }` → `IS NOT NULL`;`$null: true/false` 不变;`null` 仍是合法的 `$in` 成员。`null` 是声明过的比较数,拒的只是 JS 里与「没有这个键」不可区分的那个值。

  ## 升级说明

  如果你的进程内代码这样拼过 filter:

  ```ts
  // 之前:id 缺失时 —— 本地崩、远端静默匹配全环境行
  await ql.find("deal", { where: { owner_id: ctx.user?.id } });
  ```

  现在会收到 `INVALID_FILTER` / 400,消息里带修法。两种正确写法:

  ```ts
  // 1) 显式判空 —— 键不存在就是「不约束」
  const where: Record<string, unknown> = {};
  if (ctx.user?.id !== undefined) where.owner_id = ctx.user.id;

  // 2) 真的想要空值谓词 —— 写出来
  await ql.find("deal", { where: { owner_id: null } }); // 或
  await ql.find("deal", { where: { owner_id: { $null: true } } });
  ```

  `where` 整体缺席仍然是「没有过滤器」(`query?.where` 为 `undefined` 是它唯一合法的位置),不受影响。

  ⚠️ 本次只覆盖 `driver-sql` 与 `driver-turso`(含 remote)。`driver-memory` / `driver-mongodb` 是 #5499 的投入冻结面,按裁决只测不改;`@objectstack/formula` 与 `service-analytics` 的 `read-scope-sql.ts` 对同一形状各有一种不同读法,实测记录在 #6125,留待单独裁决。

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
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/observability@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- c6d1cb4: refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

  `findStream` was a **required** method on the driver contract — every driver and
  every test double had to implement it — documented as the read

  > Optimized for large datasets to avoid memory overflow.

  Three things were true about it at once, and each is worse in the light of the
  others.

  **Nothing called it.** Not the query engine (there is no `stream` entry on it),
  not REST export, not import, not any bulk-read path. Repo-wide, outside the
  contract declaration and the three driver implementations, every single hit was
  a test double — and roughly twenty of those satisfied the required method like
  this:

  ```ts
  findStream() { throw new Error('not implemented'); }
  ```

  Twenty stubs that throw, across four packages, for years, and no test ever went
  red. That is not an anecdote about test hygiene; it is the proof of absence. A
  method whose every double throws is a method nothing reaches.

  **Two of the three implementations inverted its one guarantee.** `SqlDriver` and
  `InMemoryDriver` both did this:

  ```ts
  const results = await this.find(object, query, options); // ← the entire result set
  for (const row of results) yield row;
  ```

  The whole table is resident in memory before the first `yield`. A caller who
  believed the doc comment and reached for `findStream` precisely because a result
  set was too large would have hit the overflow it existed to prevent, at exactly
  the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
  admitting it.

  **The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
  did walk a cursor — but it was the only read in that driver never routed through
  `buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
  discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
  and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
  that divergence rather than fixing it — there is nothing left to fix it for.)

  Rather than manufacture a caller to justify three implementations, the method is
  retired. If a cursor-based read is wanted, it should arrive **with** the caller
  that needs it, so the contract can be shaped by a real requirement instead of
  being reverse-engineered from a doc comment nobody could test.

  **Migration.**

  | Wrote                                                      | Write instead                                              |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
  | `findStream(…) { … }` on your own driver                   | delete the method (see below)                              |
  | `findStream() { throw new Error('ni'); }` in a test double | delete the line                                            |

  Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
  and memory it is strictly better (bounded pages instead of one full
  materialisation), and the paged read is the one with an **enforced** guarantee —
  `IDataDriver.find` requires a total order across the whole walk, checked by the
  shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
  `data/pagination-conformance.ts`. `findStream` never had a conformance case at
  all.

  **Driver authors: nothing breaks on you.** An implementation left in place still
  compiles — an extra method is not an error on a class or a widened object — it is
  simply never reached, so deleting it is cleanup you can do whenever. The break is
  on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
  were no callers.

  **No tombstone, deliberately.** The other v17 retirements tombstone their key so
  authoring it fails loudly with a prescription. That would be noise here.
  `DriverInterfaceSchema` describes a contract that code _implements_; nothing in
  either repository ever ran a driver object through `.parse()`, so a
  `retiredKey()` there would carry its prescription to no one. The channel that can
  carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
  The key is removed from the schema and from `IDataDriver`, and the retirement is
  registered as the `data-driver-find-stream-retired` semantic entry in the
  protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool all carry it. There is no
  `os migrate meta` step: a driver is code, never stack metadata, so the chain has
  no source to rewrite.

  **Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
  whose only referent was this method. It has no readers either (and the values
  written into it were already wrong — `SqlDriver` declared `streaming: false`
  while implementing `findStream`, `InMemoryDriver` declared `true` for the
  copy-everything version), but removing a key from the capabilities literal breaks
  every driver that writes it, third-party included, and the same audit should
  cover the other ~30 flags in one pass rather than one at a time. Tracked as
  #4634.

- d9fa683: refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

  The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
  described a contract method that no longer exists — and a full liveness audit of
  the record (#4634, across objectstack + cloud, objectui confirmed clean) found
  `streaming` was not the exception but the rule. Of 34 declared bits, **three**
  have a decision-making reader and **thirty-one** were written by every driver
  and consulted by no engine, planner, REST layer or renderer:

  - Their `.describe()` strings promised engine adaptation that was never built
    ("If false, ObjectQL will fetch all records and filter in memory" — no such
    fallback ever keyed off the bit).
  - Zero readers let values go WRONG unnoticed: `SqlDriver` declared
    `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
    `streaming: true` over a full-table read — the exact inverse of the guarantee.
  - The real mechanism everywhere else is **method presence**: transactions gate
    on `driver.beginTransaction`, aggregate pushdown on
    `typeof driver.aggregate === 'function'`, schema sync on
    `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
    are called unconditionally.

  Survivors (each with a named reader — the bits method presence cannot carry):

  | bit                    | reader                                                                                   |
  | ---------------------- | ---------------------------------------------------------------------------------------- |
  | `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
  | `autonumber`           | engine defers autonumber generation to the driver (`engine.ts`)                          |
  | `batchSchemaSync`      | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`)              |

  Migration (FROM → TO):

  - Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
    `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
    `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
    `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
    `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
    `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
    `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
    literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
    tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
    error against `IDataDriver.supports` and a parse error carrying the per-key
    prescription, which names the mechanism that actually decides the behaviour.
  - `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
    already meant `false` at both readers, so `supports: {}` is now a valid,
    minimal advertisement. If you read `capabilities.batchSchemaSync` from a
    _parsed_ config and relied on the materialised `false`, treat absence as
    `false` (both engine readers always did).
  - Driver packages: `InMemoryDriver.supports` is now `{}`,
    `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
    is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
    Reading a removed bit off these literals no longer type-checks — and no code
    in any repository did.
  - A future capability (streaming reads, vector search, …) returns **with its
    caller and its reader in the same change** — the enforce route of ADR-0049 —
    never as a dangling boolean.

  The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
  (parse + `tsc` both audible; the schema IS parsed via
  `DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
  semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
  never stack metadata — `supports` lives in driver classes and `DriverConfig`
  is plugin TS configuration, so there is no stored row or stack source for a D2
  conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
  retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
  lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
  asserting every retired bit is unwritable (`undefined`) and every live bit is
  not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
  resurrection).

  No runtime behaviour changes — that impossibility is the point: every removed
  bit had zero readers, and the three live bits keep theirs.

### Minor Changes

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

### Patch Changes

- a52e2ef: fix(driver-sql,spec,objectql): a `defaultValue` runtime token never becomes a column DEFAULT (#4560)

  `Field.user({ defaultValue: 'current_user' })` is resolved by the **engine**, at
  insert time, from the request's `ExecutionContext` — and with no authenticated
  user (system / anonymous writes: seed replay, package install, boot
  provisioning) `applyFieldDefaults` deliberately leaves the field **unset**
  rather than stamp a bogus owner.

  The SQL DDL had never heard of the token. `createColumn` passed any non-object
  `defaultValue` straight through to `col.defaultTo(dv)`, so the column was
  created as `DEFAULT 'current_user'` and the **database** overrode the engine's
  decision: every insert that omitted the field stored the literal string
  `current_user` in a `lookup('sys_user')` column — a value that is not any user's
  id. `?expand` resolves it to nothing, and on an owner / approver field it is a
  silent mis-attribution. Found by #4551's dangling-reference audit on its first
  run against a real boot; #4441's referential check could never have caught it,
  because it inspects the values a **caller** supplied and here nobody supplied
  one.

  **The token vocabulary is now declared once, in `@objectstack/spec/data`**
  (`DEFAULT_VALUE_TOKENS`, `isRuntimeDefaultToken`, `isNowDefaultToken`,
  `isCurrentUserDefaultToken`, `isAppResolvedDefaultToken`). The engine's
  insert-time resolution and the driver's DDL read the same set, which is the
  actual defect: `'NOW()'` was special-cased in the branch immediately above for
  precisely this reason, and `current_user` — the same convention family — simply
  had no entry anywhere the DDL could see. A token added to the set tomorrow is
  excluded from literal column DEFAULTs automatically, rather than leaking its own
  spelling into the database the way this one did.

  **DDL, in one place** (`applyDeclaredColumnDefault`, shared by column creation
  and the SQLite table rebuild):

  - `'NOW()'` → the driver-native canonical default, exactly as before;
  - any other runtime token → **no column default at all** (the engine owns it);
  - Expression envelopes (`{ dialect, source }`) → unchanged, no default;
  - a real literal → emitted verbatim, unchanged.

  **Existing databases carry the wrong DEFAULT**, so it is corrected through the
  managed schema-drift path (#2186) rather than a bespoke migration: a new
  `default_mismatch` finding with a `drop_column_default` op, categorised `safe`
  (the statement cannot fail and touches no rows). Dev boots with
  `autoMigrate: 'safe'` reconcile it automatically; everywhere else it is reported
  with an actionable hint and applied by `os migrate apply`. Postgres/MySQL use
  `ALTER COLUMN … DROP DEFAULT`; SQLite, which cannot alter a default in place,
  goes through the existing table rebuild — which now re-materialises every
  column's default from **metadata**, so a sibling `defaultValue: 'NOW()'` column
  keeps the default it always had instead of losing it to the rebuild.

  **Rows already holding the bogus value are NOT rewritten.** That is #4551's
  standing rule — report, never rewrite — so they stay visible to the
  dangling-reference audit for operators to resolve deliberately.

- ec975f1: fix(objectql,driver-mongodb)!: `findOne` must say which record it wants, and executes every option it declares (#4419)

  `findOne` reads a single row, which makes its predicate the only thing between
  the caller and _an arbitrary record_. When the predicate is missing the result is
  not `null` — it is the object's **first row**: a real, plausible-looking record
  with nothing to do with the request, which the `if (!row)` check every call site
  already has cannot catch, and which then propagates into whatever is computed
  next. Reported downstream: line items defaulting their price from the first
  product in the catalog rather than the selected one, and "is this deal already
  closed?" answered against an unrelated record while the write that followed
  correctly targeted the intended id. A throw would have been caught in
  development; a `null` would have been caught by the null-check. A valid-looking
  wrong record defeats both.

  **Breaking — `findOne` now refuses a query that selects nothing in particular.**

  FROM → TO:

  | Was                                                         | Now write                                                           | Meaning                                          |
  | ----------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
  | `findOne(o)`, `findOne(o, {})`, `findOne(o, { where: {} })` | `findOne(o, { where: … })`                                          | the record matching this predicate               |
  |                                                             | `findOne(o, { search: 'Acme' })`                                    | the record this search finds                     |
  |                                                             | `findOne(o, { orderBy: [{ field: 'created_at', order: 'desc' }] })` | the FIRST record in this order — the newest      |
  |                                                             | `find(o, { limit: 1 })`                                             | any row will genuinely do, said at the call site |

  One-line fix: add the `where` you meant, or `orderBy` if you meant "the newest
  one", or switch to `find(o, { limit: 1 })` if any row will do. The error names
  all four. `find` and `count` are unchanged — returning or counting every row is
  an honest answer; only `findOne`'s implicit "just one of them" turns a missing
  predicate into a confidently wrong record. The guard reads the CALLER's
  predicate, before RLS/sharing middleware injects its own: a tenant filter
  narrows which rows are visible, it does not make "whichever comes first"
  something the caller asked for.

  **Two silent drops that produced the same wrong record are fixed with it.**

  - **`findOne({ search })` applies the search.** The ADR-0061 `search` →
    cross-field `$contains` expansion lived inline in `find` and nowhere else,
    while `find` and `findOne` are checked against the SAME legal-key set — so
    `search` passed the gate, rode onto the AST, and reached a driver. No driver
    reads `ast.search`. The read therefore ran with no predicate at all and
    `limit: 1` did the rest. The expansion is now one method both call.
  - **`MongoDBDriver.findOne` applies `orderBy`, `fields` and `offset`.** It
    translated `query.where` and dropped the rest, so `findOne({ orderBy })` did
    not return the newest record — it returned whichever document the scan reached
    first. `find` and `_findStream` in the same driver had always handled all
    three. This one matters beyond Mongo: the guard above tells an unpredicated
    caller to reach for `orderBy`, and an escape hatch one backend ignores is not
    an escape hatch. No ordering is IMPOSED when the caller supplies none — both
    drivers keep that carve-out (#4363), and `SqlDriver`'s comment about Mongo
    "never sorting" is corrected, since it cited the dropped parameter as
    agreement.

  **And a gate so the class does not come back.** A drift pin walks
  `ENGINE_OPTION_KEY_SETS.findOne` and requires each declared key to have an
  observable effect — on the AST the driver receives, on the driver options, or in
  an explicit "not executed, and here is why" entry (only `limit`, which the
  contract's `limit: 1` overrides). `search` sat declared-but-unexecuted through
  two rounds of hardening because nothing asked that question.

  Together with #4346 (`filter` → `where` folds on every entry point) and #4400
  (unknown option keys throw), a read parameter the engine does not execute now
  fails at the call site instead of quietly changing the answer.

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
- Updated dependencies [ff17642]
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
  - @objectstack/observability@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- 2d3e255: feat!: ADR-0113 — `required` is a write contract; the column constraint becomes the explicit `storage.notNull`

  `field.required` bound three meanings to one knob (write check, `NOT NULL` DDL,
  drift expectation), so tightening any invariant on a deployed object was a
  destructive migration blocked by the very legacy nulls that motivated it — the
  reason `criteria_json`'s mandatory-in-substance contract lived in three
  imperative guards instead of one declaration.

  Split, with the **non-regression invariant** as the unifying rule — _a write
  may not take a record from compliant to violating; a pre-existing violation
  does not block writes that leave it in place_:

  - `required: true` = the write contract, uniformly on new and deployed objects:
    insert must provide; **an update PATCHing `null` into a required field is now
    rejected** (it silently passed before); omitted fields never block, so legacy
    null rows rest. The column stays nullable.
  - `storage: { notNull: true }` = the explicit physical constraint, owning the
    DDL (`sql-driver` `createColumn`) and the destructive drift ceremony.
    Orthogonal to `required` — all four combinations are legitimate, including
    the engine-populated column (`storage.notNull` without `required`).
  - `requiredWhen` inherits the same invariant: flipping the condition true
    without providing the field is rejected (the write _creates_ the violation);
    a row violating since before the rule tightened no longer locks out
    unrelated edits (#3929's objection, cured). `storage.notNull` ×
    `requiredWhen` rejects at parse (`FieldSchema.superRefine`).
  - **Pre-17 sources keep their exact meaning** via the migration-chain-only
    `field-required-notnull-explicit` conversion: `os migrate meta` stamps
    `storage.notNull` onto every previously-required field — writing down what
    the old text already meant. The loader never infers semantics from the
    physical column.
  - Drift compares nullability against `storage.notNull`; a column stricter than
    its declaration is `needs_confirm` (never auto-applied — dev auto-reconcile
    no longer silently strips a stray `NOT NULL`), and silent when the field is
    write-gated by `required`.

### Minor Changes

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- c8124e5: fix(driver-sql): give `Field.datetime` one UTC storage form per dialect (#3912, #3942)

  Any window filter on a `Field.datetime` column returned an empty set on SQLite —
  a dashboard `dateRange: last_30_days` on `created_date` read 0 while 29 matching
  rows existed.

  There was never a storage _convention_, only a description of what better-sqlite3
  happened to do with a bound JS `Date`. Nothing enforced it — `formatInput`
  deliberately left `datetime` untouched — so the form was decided by whichever
  writer got there first: a JS `Date` landed as INTEGER epoch ms, while a REST/JSON
  write (JSON has no `Date` type), a `defaultValue: 'NOW()'` slot, and the
  platform's own `created_at` / `updated_at` all landed as ISO **TEXT**. One column
  held both forms while the read path coerced comparands to epoch ms purely from
  the _declared_ type. On SQLite's type ordering (`INTEGER < TEXT`) a two-sided
  window collapsed to zero rows, and a one-sided `>=` matched every TEXT row
  regardless of the bound.

  `Field.datetime` now has one canonical instant per dialect, produced by one
  function applied on write **and** to every filter comparand, so the two sides of
  a comparison cannot disagree about shape:

  - **SQLite** — `YYYY-MM-DDTHH:MM:SS.sssZ` text. Lexicographic order _is_
    chronological order, so range filters and `ORDER BY` read the column directly
    and can use an index; `strftime` parses it, so the date-bucket expression needs
    no CASE.
  - **Postgres** — `timestamptz`, unchanged. The fix here is on the write and
    comparand side: a zone-naive write was previously resolved against the
    _server's_ timezone (measured 8 hours off on `Asia/Shanghai`), and an
    un-anchored `YYYY-MM-DD` comparand meant the server's local midnight, so the
    identical query over the identical instant landed a row on a different calendar
    day than SQLite did.
  - **MySQL** — `DATETIME(3)` instead of `TIMESTAMP`, a connection pinned to UTC on
    both the mysql2 and the server layer, and a MySQL-spelled bind carrying the
    same UTC wall clock. MySQL accepts neither the `T` separator nor the `Z` suffix
    in a datetime literal, so datetime writes over REST had always failed outright;
    `TIMESTAMP` additionally truncated milliseconds and could not store an instant
    outside 1970..2038.

  Existing rows converge at schema sync. Both migrations are allowed to fail: they
  log, mark nothing, and the read paths keep a repair expression, so an un-migrated
  column still compares and buckets **correctly** — just unindexed. Neither can
  repair instants the old timezone-ambiguous write path recorded wrongly; they
  preserve what is on disk.

  Also closes #3928 (datetime `ORDER BY` mis-sorted on mixed storage) by
  construction. Rationale is recorded as ADR-0053 addendum D-B1..D-B4.

  The analytics change is additive: a `coerceTemporalFilterColumn` companion to the
  existing `coerceTemporalFilterValue` hook, so a raw-SQL strategy can normalise the
  column side too. Absent hook → byte-identical SQL.

- 9774b78: fix(driver-sql): `Field.time` gets a canonical storage form — `HH:MM:SS[.fff]` wall-clock text on every dialect (#3994)

  `Field.time` repeated the pre-#3912 `Field.datetime` pattern: writes were never
  normalised and only reads were repaired, so one SQLite column accumulated bare
  time-of-day TEXT, full-timestamp TEXT and INTEGER epoch ms side by side.
  `find()` looked right; everything that compared the STORED form was wrong —
  measured: a business-hours window filter silently dropped 4 of 7 rows, ORDER BY
  sorted 14:30 before 08:00, a full-ISO write failed the statement outright on
  both Postgres and MySQL, a bound `Date` stored a process-timezone wall clock on
  pg, MySQL's bare `TIME` rounded `…00.500` up to `…01`, and a `NOW()` default
  resolved against three different clocks on the three dialects.

  The #3912→#3942→#3954 construction, transplanted (ADR-0053 D-C1..D-C3):

  - One `canonicalTimeOfDay` — `HH:MM:SS`, `.fff` only when non-zero; `Date`/
    epoch/full-timestamp fold to the UTC time-of-day — applied on write
    (`formatInput`), to filter comparands (`coerceFilterValue`, and thereby the
    `temporalFilterValue` contract hook) and on read (`toTimeOnly`).
  - SQLite: legacy columns converge at schema sync (`backfillCanonicalTimes`,
    same `IS NOT`-guarded UPDATE, same log-and-swallow policy); until then the
    filter paths wrap the column in the repair expression — correct, just
    unindexed. `os migrate plan` lists the work as `normalize_time_storage` with
    a row count.
  - MySQL: new time columns are `TIME(3)`; legacy `TIME(0)` columns widen at
    schema sync (`migrateMysqlTimeColumns`, plan kind `widen_time_columns`),
    since zero-precision TIME _rounds_ fractional writes.
  - `NOW()` defaults read the UTC clock on every dialect (Postgres previously
    used the server zone, MySQL the inserting session's zone — and MySQL 8.0
    rejects a plain `CURRENT_TIMESTAMP` default on TIME entirely).
  - `distinct()`/`aggregate()` present time columns exactly as `find()` does.

  `HH:MM:SS` writes round-trip byte-identically (the field-zoo `f_time`
  contract); a minutes-only `HH:MM` now completes to `HH:MM:00`, and uninterpretable
  values still pass through untouched.

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

- 9e01213: fix(cli,driver-sql): `os migrate plan` lists the datetime storage convergence (#3954)

  The datetime canonicalisation (#3912/#3942) added two steps to `initObjects`'
  physical path: a row-rewriting backfill on SQLite and a `TIMESTAMP` →
  `DATETIME(3)` column rebuild on MySQL. Both already respected the DDL deferral,
  so `plan` performed neither and `apply` performed both — the behaviour was never
  wrong. The reporting was.

  `PendingSchemaWork` could only express `create_table` / `add_columns`, so an
  operator saw a plan listing two added columns, confirmed it, and `apply`
  additionally rewrote every row of a datetime column — or took a metadata lock to
  rebuild one on a large table. The plan promises to show what apply will do.

  - `PendingSchemaWork.kind` gains `normalize_datetime_storage` and
    `widen_datetime_columns`, plus an optional `rows` carrying how much data the
    step touches: row-writes for the backfill, the table's size for the rebuild —
    the number that decides "now" versus "in a maintenance window".
  - `previewDeferredSchemaWork()` measures both without performing either, reusing
    the exact predicate each migration uses (the backfill's whole `WHERE`, the
    widening's own `information_schema` filter) so the plan and the apply cannot
    name different sets. A probe that cannot run is swallowed to "unlisted", never
    to a failed plan.
  - The CLI renders them under their own heading rather than folding them into the
    additive section, whose "created when you apply" framing carries an implicit
    promise that the work is never data-losing. `summarizePendingSchemaWork` — the
    line read just before typing `y` — never omits in-place work.

- c53aa53: File-backed SQLite now runs `journal_mode = WAL` (#3941).

  `SqlDriver.connect()` set `auto_vacuum` and left the journal mode alone, so
  every ObjectStack SQLite database ran SQLite's built-in default — a rollback
  journal. That is the worst mode for the shape this platform actually has, which
  is **several processes on one file**: a dev server, `os migrate`,
  `os meta resync`, a test run. Measured, on the same file:

  |                                                | rollback journal                                   | WAL                                                               |
  | :--------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------- |
  | writer while another process holds a read open | `SQLITE_BUSY` — committing needs an exclusive lock | proceeds                                                          |
  | idle attached connection visible to SQL        | no — a lock lasts only as long as its transaction  | yes (`locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` reports busy) |

  The second row is why the `os migrate` occupancy check had to inspect file
  descriptors to see a live server at all (#3940): under a rollback journal there
  was nothing in the database to see. That signal stays — it names the process,
  which WAL's lock probe cannot — but the SQL probe is now authoritative for
  databases ObjectStack created rather than a fallback that was blind in practice.
  Concurrent _writers_ still serialize; SQLite allows one at a time in any mode.

  Journal mode is a persistent property of the file, so an existing database is
  converted in place on the next connect (a header change — no rows are touched)
  and stays converted. Two consequences to plan for:

  - `app.db-wal` / `app.db-shm` exist beside the database while a connection is
    attached, and `app.db-wal` can hold committed transactions. A clean shutdown
    checkpoints them away; a naive copy of `app.db` alone while a server runs does
    not. Use `sqlite3 app.db ".backup …"`.
  - **WAL does not work on network filesystems** (NFS/SMB). Opt out with
    `OS_DATABASE_SQLITE_JOURNAL_MODE=delete`, or per datasource with
    `sqliteJournalMode: 'delete'` in the driver config (which outranks the env
    var). Either form _applies_ `delete`, so it also converts a database that
    already adopted WAL back — skipping would have stranded it.

  Nothing here fails a boot, and nothing is assumed: `PRAGMA journal_mode = X`
  answers with the mode actually in force rather than raising on refusal, so the
  reply is read back; and because a filesystem can accept WAL and then fail the
  first read _through_ it, the mode is proven with a read and rolled back to
  `delete` if that fails — with a warning naming the file and the escape hatch.
  `synchronous` is untouched, so durability is exactly what it was. `:memory:`
  databases are left alone, as is `auto_vacuum = INCREMENTAL`, which keeps
  reclaiming under WAL (ADR-0057).

  `os db clean` now counts `-wal` / `-shm` as part of the database when it measures
  what a `VACUUM` reclaimed, so bytes that were sitting in the log do not read as a
  reclaim of zero.

  `@objectstack/driver-sqlite-wasm` deliberately stays out of WAL. Its live
  database is in the WASM heap and what reaches disk is a byte image it exports, so
  nothing reads the database across processes and the pragma buys it nothing —
  while still being a persistent header change in the operator's file. sql.js
  _accepts_ the pragma (its VFS is memory-backed), so this had to be declared
  rather than discovered.

  It also now parks a `-wal` left behind by an unclean native-driver exit rather
  than loading the image beside it: wasm SQLite cannot read that log, and leaving
  it next to a freshly rewritten image would let a later real SQLite replay frames
  that no longer belong to it. The warning names the file it parked and how to
  recover what was in it.

### Patch Changes

- 0af50a3: fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

  A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
  lower bound and was silently wrong for an upper one: the dashboard date-range
  filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
  `datetime` column every row created after 00:00 of the `to` day vanished from
  the result — no error, the chart renders, the numbers are just smaller. The
  default configuration hit it: the filter's default field is `created_at`
  (a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

  The translation is operator-sensitive and half-open, applied at every
  comparison emitter:

  - `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
    bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
    in the column's storage form; `$between [min, max]` with a bare-day max
    decomposes to `>= min AND < next-day(max)`. Both the plain and the
    legacy-repair (mixed-storage) column paths, both `where` spellings.
  - `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
    instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
  - The `/analytics/sql` rendering and the dataset preview evaluator apply the
    same rule, so the echoed SQL and drafted numbers reproduce execution.

  `@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
  the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
  `Date`s and impossible days are never widened).

  Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
  (`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
  (instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
  those). No authored metadata changes: a dashboard's existing
  `{ $gte, $lte }` window now simply includes its final day.

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

- 42e3b01: fix(driver-sql): `Field.date` + `defaultValue: 'NOW()'` records the UTC calendar day on Postgres/MySQL (#4022)

  The bare `CURRENT_TIMESTAMP` default resolved the calendar day in the SERVER's
  timezone on Postgres — measured: a UTC-12 server recorded yesterday; an
  Asia/Shanghai server records tomorrow for every default after 16:00 UTC — and
  MySQL 8.0 rejects it on a DATE column outright (MariaDB is merely permissive,
  and the driver's UTC-pinned session masked the semantic half there).
  `nowColumnDefault` now emits a UTC expression default on both dialects, the
  #3994 D-C3 construction one type over. Defaults only govern newly created
  columns; existing columns keep their legacy default, per the standing D-B3
  policy.

- 39eb01b: fix(driver-sql): a currently-declared unique index is never legacy debt — index drift no longer ping-pongs (#3955)

  An object may declare both a tenant-scoped field-level `unique: true` and an
  object-level single-column unique index on the same column:

  ```ts
  email: Field.email({ unique: true }),
  indexes: [{ fields: ['email'], unique: true }],
  ```

  The declared index materializes under `buildIndexName` as
  `uniq_<table>_<column>` — which is also one of the two spellings
  `legacyUniqueIndexNames` looks for when hunting pre-#3696 platform-wide
  uniques. The detector therefore read an index the current metadata declares
  as legacy debt and proposed replacing it with the tenant composite (which
  the same sync had already created).

  The resulting plan never converged: `apply` dropped the declared index, the
  next `plan` reported it missing and recreated it, and the one after that
  called it legacy again — an unbounded drop/create cycle on a live unique
  index, every round rendered as a "safe" change.

  `legacyUniqueReplacements` now takes the object's `declaredIndexes` and
  filters their normalized names out of the legacy candidate set, so an index
  metadata declares today is never mistaken for debt. Genuinely legacy indexes
  are still retired, including the knex-spelled `<table>_<column>_unique` when
  only the `uniq_…` spelling is declared.

- 4384921: fix(spec,drivers): `bypassTenantAudit` becomes a declared driver option, and `findOne` stops accepting a bare id (#4311)

  Three drivers built with `tsup` and tested with `vitest`, so no `tsc` had ever
  read them. Onboarding them to the #4311 type-check ratchet surfaced 292 errors,
  and most of what looked like sloppy test fixtures was the types being wrong.

  **`DriverOptions.bypassTenantAudit` is now declared.** It has been live for a
  long time without being on the schema: `SqlDriver.auditMissingTenant` reads it
  to suppress the "tenant-scoped write without `tenantId`" warning, the driver's
  own warning text tells callers to set it, `ObjectQLEngine` sets it for
  system-context calls, and `service-settings` / `service-datasource` pass it on
  every global-scope write. Because the schema never had it, the driver read it
  through `(options as any)` and no caller was type-checked. The declaration
  states the limit as well: it silences a diagnostic and MUST NOT change which
  rows a write touches — suppressing an audit warning is not a permission.

  The same cast covered `timezone`, `tenantId`, `tenantIds` and `preserveAudit`,
  all long since declared. Those reads now go through `DriverOptions`, so the next
  undeclared option fails the build instead of hiding behind an existing cast.

  **`SqlDriver.findOne(object, id)` is removed.** An undeclared
  `typeof query === 'string' | 'number'` branch accepted a bare id. It was on no
  contract, nothing outside that package's own tests used it, and the other two
  drivers answered the identical call differently — `MemoryDriver` spreads the
  string into `{0:'t',1:'1'}`, `MongoDBDriver` reads `query.where` as `undefined`
  and returns an arbitrary row. It also bypassed the shared `findRows()` path, so
  it skipped field selection, temporal coercion, unknown-column recovery and the
  `singleRowLookup` ORDER BY decision. Spell an id lookup as the query it is:

  ```ts
  -(await driver.findOne("task", "t1"));
  +(await driver.findOne("task", { object: "task", where: { id: "t1" } }));
  ```

  **`SqlDriver.initObjects` declares the `tenancy` it consumes.** Each object is
  fed to `computeAndRecordTenantField`, which reads `obj.tenancy` to pick the
  tenant column and to set or clear the sticky explicit-opt-out — but the
  parameter type listed only `{ name, fields }`, so a caller that spelled the key
  correctly was rejected while the driver read it anyway.
  `registerExternalObject` already had it.

  **`AnalyticsQueryInput` joins `AnalyticsQuery`.** `timezone` is
  `.default('UTC')`, so the parsed type requires it and an authored literal does
  not have it — the same two-tier split `QueryInput`/`QueryAST` already names on
  the query side. `InMemoryDriver.create`/`bulkCreate` also declare their
  `IDataDriver` return types; without them TS inferred the literal the method
  builds and every other column of the created row disappeared from the caller's
  view.

  One silent runtime bug fell out of the same pass: a driver test asked for
  `orderBy: [['id', 'asc']]`, the driver reads `item.field`, a tuple has none, and
  the sort never reached SQL. The tuple spelling appears nowhere else.

- 6f98c2d: fix(driver-sql,driver-memory): an uncompilable filter now throws instead of matching everything (#3948)

  A filter the driver could not compile was **skipped**, not rejected. No predicate
  was emitted and the query returned every row — the caller asked to filter and
  silently received the unfiltered set.

  The reachable shape is a bare comparison triple. `['close_date','before','2024-01-01']`
  arrives at a driver only when `isFilterAST()` refused it — its operator is outside
  `VALID_AST_OPERATORS`, so `parseFilterAST()` never converted it and the raw array
  was assigned to `where`. `driver-sql`'s loop then saw three _strings_, matched
  neither `and` nor `or`, and `continue`d past all three. `driver-memory` was worse:
  it cast every string to a logic keyword, opening three empty groups and returning
  `{}` — a filter matching every record.

  This is reachable from ordinary authoring, not just malformed input: `before` and
  `after` are canonical `VIEW_FILTER_OPERATORS` members that `VALID_AST_OPERATORS`
  does not accept. Eight of the nineteen canonical view operators are in that
  position, including `equals`; the others were masked only because ObjectUI's
  adapter alias table happened to cover them.

  **Behaviour change.** Both drivers now throw on a filter element that is neither a
  logical keyword (`and`/`or`) nor a condition array, and `driver-memory` throws on
  an operator it cannot express rather than dropping the condition. The nested and
  `$`-object paths already threw on the same input, so this makes the three paths
  agree. A caller that was relying on the old silence was receiving wrong results;
  the error names the operator and the offending filter.

  **`driver-memory` also gains seven operators it silently ignored:** `not_in`,
  `is_null`, `is_not_null`, `isnull`, `isnotnull`, `is_empty`, `is_not_empty` — all
  members of `VALID_AST_OPERATORS`, all previously falling through to
  `default: return null`. `is_null` narrowed nothing instead of matching null rows.
  Alias sets and semantics mirror `driver-sql`'s `whereNull`/`whereNotNull` arms so
  the two backends accept one vocabulary.

  Migration: none for well-formed filters. If a query now throws, the filter was
  never being applied — fix the operator (the message names it), or lower it to an
  AST spelling. `before` → `<`, `after` → `>`, `'not in'` → `nin`.

- a13827e: fix(data): paging a sorted read is a partition of the result set, not five queries that share a WHERE clause (objectui#3106)

  `ORDER BY status LIMIT 50 OFFSET 50` names a sort key that does not identify a
  row, and no backend promises that rows with equal keys keep the same relative
  arrangement between two queries. MongoDB documents this outright — `sort` +
  `skip`/`limit` on a non-unique key "may return the same document more than
  once". So page 2 could repeat a row page 1 already showed and skip one nobody
  ever saw:

  ```
  page 1: ORDER BY status LIMIT 5 OFFSET 0   -> [r05 r07 r11 r04 …]
  page 2: ORDER BY status LIMIT 5 OFFSET 5   -> [r04 …]        r04 again; one row never served
  ```

  Every page is full, every row is real and belongs, and the duplicate sits
  several screens from the omission — which is why this is found by a user
  counting records, never by reading a response.

  `SqlDriver` and `MongoDBDriver` now append a unique tie-breaker to any non-empty
  `orderBy`, in the last requested key's direction (determinism holds either way,
  but a same-direction suffix is the one an index can still walk in one pass).
  `driver-memory` already conformed — `Array#sort` is stable over a table whose
  order does not move — and now has a suite saying so, because that property is
  implicit and easy to lose in a refactor that looks like a speed-up.

  `SqlDriver` adds it only for objects it created itself (`initObjects` records
  those). A federated table (ADR-0015) may have no `id` column, and guessing there
  would be worse than doing nothing: the unknown-column error is answered by
  #3821's ladder retrying with **no ORDER BY at all**, trading a reshuffle among
  ties for the loss of the caller's whole sort.

  The obligation is now normative on `IDataDriver.find`, with shared cases in
  `@objectstack/spec/data` (`PAGINATION_CASES`) that all three drivers run — so a
  future driver is held to it by a gate rather than by remembering.

  Not covered by this change: a paged read with **no** `orderBy`. Same defect,
  wider blast radius, so it was carved out to #4363 rather than folded in — and
  closed there, in the same release. The contract, the shared cases and both
  drivers now cover a paged read whatever its `orderBy`, including none at all.

- 3fe0ff1: fix(driver-sql): `os migrate plan` no longer promises columns the apply can never create (#3978)

  `previewDeferredSchemaWork()` listed every declared field name when computing
  pending `create_table` / `add_columns` work, but `createColumn` returns early
  for a virtual `formula` field — no column is ever created for it.

  So a formula field showed up as pending `add_columns` that `apply` reported as
  performed without doing anything, and the very next `plan` reported it again.
  A freshly-applied database looked permanently un-migrated, with no invocation
  able to clear the finding. On `examples/app-crm` that was 4 columns
  (`crm_contact.full_name`, `crm_lead.is_closed`, `crm_opportunity.expected_revenue`,
  `crm_opportunity.days_to_close`) reported forever.

  The preview now filters through `fieldHasColumn` — the same helper `createColumn`
  and the column differ already answer "does this field materialize a column?"
  with — so the plan and the flush cannot disagree. `multiple` fields are
  unaffected: they materialize as a JSON column and are still reported.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                              |
  | :---------------------------------------------------------------- | :--------------------------------------------------------------- |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`        |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                              |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | `fields: ['owner.name']` (dotted path)                           |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias` |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- 8b50cb3: fix(data): a paged read with no `orderBy` is a partition too — the shape every list view actually sends (#4363)

  objectui#3106's server half closed the **sorted** paged read: a non-empty
  `orderBy` now carries a unique tie-breaker, so `ORDER BY status LIMIT 50 OFFSET
50` can no longer serve one row twice while never serving another. It stopped
  there deliberately. This closes the half it left, which is the more common one.

  A list view whose metadata configures no `sort`, on which nobody has clicked a
  column header, sends no `$orderby` at all. `SqlDriver` and `MongoDBDriver` then
  emitted a bare `LIMIT`/`OFFSET` — and neither backend promises anything about
  the order that slices:

  - **SQL** leaves the row order of an unordered read to the plan. Small tables
    hand back insertion order in practice, which is exactly why this survives
    testing; a parallel scan, an index scan, or a `VACUUM` need not.
  - **MongoDB** returns natural order, which describes where a document currently
    sits in its extent — and moves when the document does.

  Every row ties with every other on an empty sort key, so this is the same defect
  at full strength rather than a different one: page 2 repeats a row page 1 showed
  and drops one nobody sees, with every page full and every row real.

  Both drivers now order a paged read by their unique key column when the caller
  supplied no sort keys — the same `id` the tie-breaker was already appending, now
  standing alone. `driver-memory` again needed no change: it slices its backing
  array, and two reads with no write between them see the identical sequence. The
  contract asks for a partition, not for id order.

  **Unpaged reads are untouched, deliberately.** The rule keys off `limit`/
  `offset`, not off `orderBy` being absent. A read with neither hands back the
  whole matching set, so no caller can be shown a partial view of it, and sorting
  every read in the system would change plan selection to buy nothing. `limit`
  alone does count as paged: page one of a walk is routinely `limit=50` with no
  offset, and ordering only the later pages would leave the defect fully intact.

  `SqlDriver` keeps the existing restriction to objects it created itself
  (`initObjects` records them). It matters more here than for the sorted case: on
  a federated table (ADR-0015) there is no requested sort for #3821's ladder to
  fall back to, so a wrong guess about `id` would turn a reshuffle into a failed
  read. Those tables now get a warning — once per object, behavior unchanged —
  because the contract states determinism as a MUST, and a MUST that quietly does
  not hold is the same invisible failure the rule was written against.

  `findOne` is deliberately outside all of this, and the contract now says so.
  Engines reach a driver with `limit: 1`, which is shaped exactly like page one of
  a walk, but it promises _a_ matching record rather than a position in a
  sequence — nothing for a second call to be inconsistent with. Reading it as a
  page would put `ORDER BY id LIMIT 1` on the hottest read in the system, which is
  the classic shape for a planner to abandon the predicate's own index: measured
  on Postgres 16 over 2M rows, `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms
  and swapped the `owner_id` index for the primary key. `MongoDBDriver.findOne`
  has never sorted, so this also puts the two drivers back in step.

  The obligation is normative on `IDataDriver.find` and the cases are shared —
  `PAGINATION_UNORDERED_CASES` alongside `PAGINATION_CASES` in
  `@objectstack/spec/data` — so a future driver is held to both halves by a gate
  rather than by remembering.

- 0166bd5: fix(spec,drivers): the view filter vocabulary and the AST vocabulary now agree (#3948)

  `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) is what an author may declare on a
  `ViewFilterRule`. `VALID_AST_OPERATORS` (`data/filter.zod.ts`) gates
  `isFilterAST()`, which decides whether a filter is parsed into a query at all.
  They disagreed on **8 of 19** members: `equals`, `not_equals`, `greater_than`,
  `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `before`, `after`.

  An author could declare any of them, `ViewFilterRuleSchema` validated them,
  `defineStack` accepted them — and then `isFilterAST()` refused the filter, the
  protocol passed the array through unconverted, and the driver could not apply it.
  Six of the eight were reachable only in theory because ObjectUI's adapter alias
  table happened to translate them; the safety of the query path was resting on a
  hand-written table in another repository being complete, and for `before`/`after`
  it wasn't.

  **`AST_OPERATOR_MAP` is now the single source of truth.** `VALID_AST_OPERATORS`
  is derived from its keys rather than restated, so an operator can no longer be
  accepted by the gate without also having a lowering — the two were separate
  hand-written lists that happened to agree, with nothing enforcing it. The map
  gained the eight canonical view spellings plus the squashed/short forms stored
  metadata carries (`notequals`, `greaterthanorequal`, `eq`, `gt`, …).

  **New export `canonicalAstOperator(op)`** folds every accepted spelling of one
  comparison onto a single infix form. Both drivers now call it instead of growing
  private alias lists, which is what let them accept different vocabularies.
  `like`/`ilike` are deliberately not folded onto `contains`: driver-sql passes them
  to SQL verbatim, so folding would silently wrap the value in `%…%`.

  Widening only — no spelling was removed, so no stored filter stops validating.
  A filter that previously produced an error (after #4029) or was silently dropped
  (before it) now compiles. `filter-view-operator-parity.test.ts` asserts every
  `VIEW_FILTER_OPERATORS` member and every `VIEW_FILTER_OPERATOR_ALIASES` key has a
  lowering that is a real `$`-operator rather than the `$${op}` fallback, so the
  next operator the view layer gains fails a test instead of a query.

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
  - @objectstack/observability@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 32d3800: fix(driver-sql): bound a connection attempt at 10s, and correct the "no reconnection" claim (#3769, #3759)

  Two related corrections, both from measuring what #3741/#3751/#3765 had only asserted.

  **The claim was wrong.** #3751 and #3765 shipped several statements that drivers
  never reconnect — "there is no lazy reconnection", "NOT retried and NOT
  reconnected", "stays disconnected for the process lifetime". Measured, both
  drivers recover on their own:

  - driver-mongodb: killing a real `mongod` and restarting it on the same port,
    the _same_ driver instance served the next write successfully (13ms), with no
    reconnect call from us — the official driver's topology monitor handles it.
  - driver-sql: a knex/pg pool is not poisoned by an outage. Its error tracks live
    server state (`ECONNREFUSED` while down → a handshake error once a listener is
    back → `ECONNREFUSED` again), i.e. every acquire opens a fresh connection.
    `storage-driver.ts` also configures `pool.min: 0`, so no stale idle
    connections are held.

  The original reasoning grepped this repo for `reconnect`, found nothing, and
  concluded recovery does not happen — but the recovery lives in the client
  libraries, not in our code. The claims are now corrected in `DriverConnectError`,
  the `DEGRADED BOOT` banner, `resolveAllowDriverConnectFailure`'s docs, and the
  drivers / self-hosting pages.

  **Fail-fast at boot is unchanged and still correct** — the reason is just
  different. It is not that the connection can never return; it is that the _boot
  sequence_ never re-runs. A driver that missed `init()` also missed
  `syncRegisteredSchemas()`, so its tables can simply not exist even after the
  database comes back. The banner now says that.

  **The real defect underneath.** `SqlDriver` passed its config to knex untouched,
  so a database endpoint that accepts TCP but never completes the handshake — an
  overloaded instance, a half-open firewall, a load balancer mid-failover — made
  every query wait out tarn's 30s default, then fail with `Timeout acquiring a
connection. The pool is probably full`, pointing an operator at pool sizing
  instead of the network. With a small `pool.max` a few such queries saturate the
  pool and everything else queues.

  `SqlDriver` now defaults `pool.createTimeoutMillis` to **10s**, matching
  driver-mongodb's existing `connectTimeoutMS ?? 10_000` so both drivers give up on
  an unreachable server at the same point. A host that sets its own
  `createTimeoutMillis` is left alone.

  **Migration.** None for a healthy datasource. A deployment that deliberately
  relies on connection establishment taking longer than 10s (a slow cross-region
  replica) should set `pool.createTimeoutMillis` explicitly on its `SqlDriver`
  config.

  Not fixed here, tracked in #3769: knex still reports the bounded wait as "the
  pool is probably full". An accurate message needs a dialect-specific connect
  timeout (pg's `connectionTimeoutMillis`), which changes the shape of `connection`
  and would regress the startup banner's URL display.

- 5d4de37: fix(objectql,driver-sql)!: a group key is the column's value, in the shape `find()` presents it (#3849)

  `groupBy: ['qty']` now returns `3`, not `'3'`. `groupBy: ['won']` returns `true` /
  `false`, not `'true'` / `'false'` on one path and `1` / `0` on the other. A bucket
  key is a column value, so there is one right answer for what it looks like —
  whatever that column looks like on a `find()` row — and all three paths that
  produce one now give it.

  ### What was wrong

  Three code paths produce a group key, and no two of them agreed:

  |                           | `qty` (number)   | `won` (boolean)                 |
  | ------------------------- | ---------------- | ------------------------------- |
  | `find()`                  | `3` number       | `true` boolean                  |
  | `aggregate()` pushed down | `3` number       | `0` / `1` **number**            |
  | in-memory fallback        | `'3'` **string** | `'false'` / `'true'` **string** |

  Two independent causes:

  - `applyInMemoryAggregation` ran every key through `String()`. The pushed-down
    path never did.
  - The pushed-down path returns raw builder output. #3797 taught it to present
    temporal columns the way `formatOutput` does on a `find()` row, but not the
    boolean and numeric repairs — so a SQLite boolean, which has no native type and
    is stored as `0`/`1`, surfaced as an integer from `aggregate()` and as a real
    boolean from `find()`.

  `engine.aggregate` chooses between the two aggregate paths per query — by whether
  the driver aggregates natively, whether it advertises the requested granularity,
  and whether the reference timezone is UTC — so the same column changed shape with
  no change to the data or the query.

  ### Why it mattered

  The measures were always right, which is why this went unnoticed. What broke was
  downstream code that probes a raw `Map` keyed by the value's own type. `Map`
  lookup is SameValueZero, so `'1'` never finds `1`:

  - **Select-option labels** (`dimension-labels.ts`) — the label table is keyed by
    the option's own `value`. A numeric option value never matched a stringified
    key, so the chart rendered the raw stored value instead of its label.
  - **Lookup / master-detail labels** — the id → record-name table is built by an
    inner query that always pushes down (raw ids), then probed with the outer
    query's keys, which may be in-memory (stringified). With a numeric primary key
    — routine for external/federated objects — every label missed.
  - **Cross-object rebucketing** (`cross-object-rebucket.ts`) — the FK → attribute
    map is built and probed the same way, and a miss is not a fallback but
    `RESTRICTED_BUCKET`. A numeric FK filed **every row** under `'(restricted)'`:
    one bar, correct grand total, no error.
  - **Drill-through** — the raw dimension value goes into the drill filter
    verbatim, so a boolean dimension drilled from the in-memory path sent
    `{ won: 'true' }` to SQLite, whose INTEGER column cannot equal the text
    `'true'`. Zero rows.

  ### What changed

  - `applyInMemoryAggregation` (`@objectstack/objectql`) emits the value verbatim.
    Its rows come straight from `driver.find()`, so passing the value through is
    what makes the key equal the column's own read shape.
  - The internal composite bucket id is now type-preserving, so `1` and `'1'`,
    `true` and `'true'` stay distinct groups rather than merging on the way in.
    BigInt is encoded explicitly — `JSON.stringify` throws on it, and a value that
    used to bucket under `String()` must not start crashing the aggregate.
  - `SqlDriver.aggregate` / `.distinct` (`@objectstack/driver-sql`) present group
    keys and `min`/`max` results with the same rules `formatOutput` applies on a
    `find()` row, generalizing the #3797 temporal fix to boolean and numeric
    columns. The `protected` helpers behind it are renamed accordingly
    (`temporalFieldKind` → `readPresentationKind`, `presentTemporalValue` →
    `presentReadValue`, `presentTemporalColumns` → `presentReadColumns`) and the
    kind union is exported as `ReadPresentationKind`.

  Date-bucketed `groupBy` items are unaffected: `bucketDateValue` and the dialect
  bucket expressions both produce canonical string labels, and #3839 already pinned
  their empty bucket.

  ### Gate

  `packages/qa/dogfood/test/group-key-read-shape-parity.test.ts` measures both
  aggregate paths against `find()` for a number, boolean and text column, on
  `driver-sql` and `driver-sqlite-wasm`. It asserts the runtime TYPE, not just the
  value — folding both sides through `String()` is the reflex that hid this in the
  first place and would make the check pass against the bug it exists to catch.

  Each half was confirmed to fail the gate on its own: reverting only the
  in-memory change reddens the number and boolean cases, reverting only the driver
  change reddens the boolean cases with `0<number>` against `false<boolean>`.

- dac6a08: feat(driver-sql)!: make index drift visible to `os migrate plan` — no more silent DDL at boot (#3728)

  The #3696 unique-scope migration converged **in place**: `syncTableIndexes` ran a
  `DROP` + `CREATE UNIQUE INDEX` during `initObjects`, in every environment,
  leaving one log line behind. `os migrate plan` showed nothing, because
  `detectManagedDrift` was column-only — `ManagedDriftOp` had no index dimension at
  all. An operator who wanted to review the DDL before it reached their database
  had no way to, and a managed schema was being auto-altered in production, which
  the #2186 contract explicitly forbids.

  Index drift is now a first-class dimension, reconciled through the same path as
  column drift:

  - **`syncTableIndexes` is additive only.** It creates indexes; it never drops or
    rewrites one. `dropLegacyGlobalUniques` is gone.
  - **New `DriftOp` variants** — `replace_unique_index` (safe: retire the legacy
    platform-wide unique in favour of the tenant composite), `create_index` (safe),
    `recreate_index` (needs-confirm; destructive when it tightens to `UNIQUE`), and
    `drop_index` (destructive).
  - **`detectManagedDrift` reports them**, `os migrate plan` renders them (index
    ops display as `table [index_name]`), and `os migrate apply` executes them.
    Index DDL is portable, so it applies directly on every dialect — no SQLite
    table rebuild.
  - **`replace_unique_index` creates before it drops**, so uniqueness is never
    unenforced mid-migration and a failed create leaves the schema untouched.
  - **Declared `indexes[]` drift is covered too**: an index metadata declares but
    the database lacks, and one whose definition no longer matches the declaration
    (the additive sync skips those by name, so they could never self-heal).
  - **Orphan detection is limited to ObjectStack's own generated naming**
    (`uniq_…` / `idx_…`, plus the pre-#3696 `<table>_<column>_unique` knex
    spelling). A hand-rolled operational index is never reported as drift and
    `--allow-destructive` will not delete it.

  **Behaviour change.** Boot no longer rewrites the index unconditionally. Dev
  (`autoMigrate: 'safe'`, what `os dev` / `os serve` use) still self-heals on
  restart, so local workflows are unchanged. Production now **warns** with an
  actionable `os migrate` hint and leaves the schema alone — the deployment stays
  on the legacy global unique (multi-tenant inserts still collide) until someone
  runs `os migrate apply`. That is the deliberate trade: a visible, pre-inspectable
  migration instead of an invisible one.

  Also fixed: `managedObjectIndexes` was never cleared when an object dropped its
  `indexes[]`, so drift detection kept expecting an index nobody declared.

  `SchemaDiffEntryKind` gains `index_mismatch` and `unmapped_index`.

- 7457a09: fix(driver-sql): give the bounded connection attempt an accurate error message (#3769)

  #3781 bounded a connection attempt at 10s via `pool.createTimeoutMillis`, which
  stopped the 30s hang but kept knex's own wording: `Timeout acquiring a
connection. The pool is probably full`. The pool is not full — the server never
  completed the handshake — so that message sends an operator to tune `pool.max`
  while the network is what is broken. This is the same defect class the boot
  guard in #3741 was about: an error that reads nothing like its cause.

  `SqlDriver` now also sets the **dialect's own** connect timeout, which fails with
  a message that names what happened:

  | client                                           | key                       | message             |
  | ------------------------------------------------ | ------------------------- | ------------------- |
  | `pg` / `postgres` / `postgresql` / `cockroachdb` | `connectionTimeoutMillis` | `timeout expired`   |
  | `mysql` / `mysql2`                               | `connectTimeout`          | `connect ETIMEDOUT` |

  Carrying the timeout requires `connection` to be an object, so a URL string is
  moved into the dialect's URL slot (`connectionString` for pg, `uri` for mysql2).
  Verified against a black-holing listener that both forms still reach the URL's
  own host/port and still honour `?sslmode=require`. SQLite is untouched — opening
  a file has no handshake to time out.

  **The two bounds are deliberately unequal.** They race and knex wins a tie, so
  equal values would let the pool timeout fire first and the accurate message would
  never be seen. The dialect timeout is the effective bound at **10s**; the pool
  timeout is a strictly looser backstop, raised from 10s to **15s**, reached only
  by a dialect with no connect-timeout knob or one that ignores the one we set.

  `driver.config` keeps the shape the author passed — the rewrite applies only to
  what knex receives. Two existing readers depend on that: `serve.ts`'s startup
  banner and `createDatabase()`, which parses the URL to swap in the maintenance
  database. A test pins it.

  `createDatabase()`'s own admin connection now gets the same bound; it is opened
  during boot against the very server we already suspect is unreachable, so it must
  not be the one place that still waits 30s.

  **Migration.** None for a healthy datasource. A deployment that deliberately
  needs longer than 10s to establish a connection (a slow cross-region replica)
  sets `connection.connectionTimeoutMillis` (pg) or `connection.connectTimeout`
  (mysql2) explicitly, and it is left alone.

- b90086a: fix(driver-sql)!: `unique` materializes per tenant, ending its contradiction with the per-tenant autonumber sequence (#3696)

  `unique: true` became a **single-column global index that ignored `tenancy`
  entirely**, while the autonumber sequence table is keyed by
  `(object, tenant_id, field, scope)` and hands every tenant its own counter
  starting at 1. Two subsystems of the same platform contradicted each other:
  tenant B's `PROD-00001` was rejected by an index it could not see — **no user
  did anything wrong**, the platform's left hand refused what its right hand
  issued.

  The rejection also doubled as a **cross-tenant existence oracle**: a UNIQUE
  violation told tenant B that some _other_ tenant held the value, enumerable by
  probing emails / codes / names.

  **The contract now:**

  | Declaration                      | Materializes as                                                 |
  | -------------------------------- | --------------------------------------------------------------- |
  | `unique: true` + tenant column   | composite `(tenantField, field)` — unique **within** the tenant |
  | `unique: true`, no tenant column | single-column — single-tenant DDL is byte-identical to before   |
  | `unique: 'global'`               | single-column, always platform-wide                             |

  The tenant column comes first in the composite, so the index also serves the
  `WHERE tenant = ?` prefix scans every tenant-scoped read issues.

  **Declared `indexes[]` are deliberately unchanged.** They are materialized over
  exactly the columns listed — no tenant column is injected. The author already
  spells them out, per-tenant ones have always been written explicitly
  (`fields: ['organization_id', 'code']`), and many are legitimately platform-wide
  (a DNS hostname, a reserved slug, an external provider id). `'global'` is
  accepted there as a synonym of `true` so one vocabulary covers both spellings.

  **Migration is automatic and cannot fail.** Legacy indexes
  (`<table>_<col>_unique` from knex, `uniq_<table>_<col>` from the drift-rebuild
  path) are retired inline at schema-sync time. The old global constraint is
  strictly stronger than the new per-tenant one, so existing rows satisfy the
  replacement by construction — no dedup, no cleanup, no data touched. It
  converges at sync rather than waiting for a deliberate `os migrate` run because
  a deployment that never ran migrate would otherwise stay broken.

  **Upgrading — audit your `unique: true` fields.** On a tenant-scoped object the
  constraint is now per tenant. Anything that must stay platform-wide has to say
  so:

  ```ts
  hostname: Field.text({ unique: "global" }); // no two tenants may claim it
  ```

  Note the reach: `applySystemFields` injects `organization_id` into every
  registered object unless it opts out, and the driver falls back to that column
  when no `tenancy.tenantField` is declared — so most objects are tenant-scoped.
  Typical candidates for `'global'`: DNS hostnames, reserved slugs, external
  provider ids (Stripe customer/subscription), device identities.

  Postgres materializes `col.unique()` as a table CONSTRAINT rather than a bare
  index, so the retirement tries `DROP CONSTRAINT` before `DROP INDEX` —
  `DROP INDEX` alone would have made the migration a no-op on exactly the
  deployments that matter most.

  `@objectstack/driver-mongodb` accepts the new declaration but keeps single-field
  indexes: it implements no row-level tenancy at all (no tenant predicate on read,
  no tenant stamp on write), so a `(tenant, field)` index would advertise an
  isolation it does not deliver. Tracked separately.

### Patch Changes

- fa3d0cf: feat(spec): field runtime value-shape contract — ADR-0104 phase 1 (D1)

  `@objectstack/spec/data` now owns the runtime VALUE shape of every field type
  (`field-value.zod.ts`): semantic type classes (`STRING_VALUE_TYPES`,
  `NUMERIC_VALUE_TYPES`, `REFERENCE_VALUE_TYPES`, `FILE_REFERENCE_TYPES`,
  `STRUCTURED_JSON_TYPES`, `MULTI_CAPABLE_TYPES`, …), the shared
  `isMultiValueField`, and `valueSchemaFor(field, 'stored' | 'expanded')`. The
  four consumers that each hand-copied this knowledge (objectql record-validator,
  rest import-coerce, driver-sql column classification, qa conformance) now
  derive from the spec, and the field-zoo round-trip MATRIX is asserted against
  the contract so the two cannot drift.

  **Write-path change (objectql, warn-first):** previously-unvalidated types —
  single `lookup`/`master_detail`/`user`/`tree`, `file`/`image`/`avatar`/
  `video`/`audio`, `location`, `address`, `composite`, `repeater`, `record`,
  `vector` — are now checked against the contract. A violation **logs a warning
  and passes** in this release (legacy rows must not strand their records);
  set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` to enforce as a
  `400 VALIDATION_FAILED`. The flip to strict-by-default rides a later minor
  (ADR-0104 R1/R2).

  **Deprecations (removal rides the next spec major), FROM → TO:**

  - `CurrencyValueSchema` (`{value, currency}`) → none. A `currency` field's
    value is a **bare number** everywhere in the runtime (validator, SQL `float`
    column, import coercion, field-zoo oracle); the currency code lives in field
    config. Use `valueSchemaFor({type: 'currency'})`.
  - `LocationCoordinatesSchema` (`{latitude, longitude}`) → `LocationValueSchema`
    (`{lat, lng}`) — the shape the platform actually stores.
  - `AddressSchema` is **adopted** (unchanged) as the enforced `address` value
    contract via `AddressValueSchema`.

  No stored data changes shape; the contract codifies deployed reality
  ("reality wins", ADR-0104 D1).

- c7f4417: fix(driver-sql,analytics): stop `aggregate()` / `distinct()` leaking SQLite's raw epoch storage (#3797)

  Both returned `await builder` directly, without the `formatOutput` pass every
  `find()` row gets. On SQLite — the one dialect where a `Field.datetime` is
  stored as INTEGER epoch milliseconds rather than a native timestamp — that raw
  storage form went straight to the caller:

  | call                                   | before                       | after                            |
  | -------------------------------------- | ---------------------------- | -------------------------------- |
  | `find()`                               | `"2026-01-10T09:00:00.000Z"` | unchanged                        |
  | `distinct('closed_at')`                | `[1768035600000]`            | `["2026-01-10T09:00:00.000Z"]`   |
  | `aggregate()` `max(closed_at)`         | `1768035600000`              | `"2026-01-10T09:00:00.000Z"`     |
  | `aggregate()` `groupBy: ['closed_at']` | key `1768035600000`          | key `"2026-01-10T09:00:00.000Z"` |

  Same root cause as #3773, different exit. `Field.date` was never affected — it
  is ISO TEXT on every dialect, so its storage form already equals its
  presentation.

  The visible surfaces were a `_max`/`_min` measure over a datetime (a "last
  closed" KPI tile rendered `1768035600000`) and a `groupBy` on a raw datetime
  dimension, which also disagreed with the in-memory `applyInMemoryAggregation`
  fallback — that one consumes already-formatted `find()` rows, so the same
  dataset changed key type depending on which path served it.

  Which columns hold an instant is now recorded while the statement is built,
  because that is the only point where a column name and its meaning are both
  known: a `min()` lands under its alias and never under the field name, while a
  date-BUCKETED column lands under the field name but holds a label (`'2026-01'`)
  rather than an instant. Matching on names afterwards gets both backwards.

  `distinct()` additionally re-deduplicates after presenting: SQL `DISTINCT`
  compares STORED values, and one SQLite datetime column holds both INTEGER and
  TEXT forms, so two rows recording the same instant survived as two and then
  presented identically. It has no in-repo callers today; this keeps it honest
  rather than leaving a second convention in the driver.

  **`cross-object-rebucket` was fixed alongside it, because presenting min/max
  correctly is what exposed it.** `recombine()` coerced every operand with
  `Number()`, which silently depended on receiving an epoch: handed the ISO string
  the driver now returns it produced `NaN`, and on Postgres/MySQL (where knex
  returns a `Date`) it had always flattened the value back to an epoch integer one
  layer above the driver. `min`/`max` now order by the instant and return the
  winning value in the shape it arrived in; `sum`/`count` stay numeric.

- cf5e033: fix(driver-sql): `$or` branches AND their own contents again — every `$or` filter was widened

  `applyFilterCondition` passed `logicalOp='or'` _into_ each `$or` branch's
  recursive call. That flag is meant to decide only how a branch attaches to its
  parent builder, but inside the branch it also selected `orWhere` for the
  branch's own contents. So a branch's field keys — and the operators of a single
  field — OR-ed each other instead of AND-ing:

  | Filter                        | Compiled to           | Should be                |
  | ----------------------------- | --------------------- | ------------------------ |
  | `{$or:[{a:'x', b:'y'}]}`      | `a = 'x' OR b = 'y'`  | `a = 'x' AND b = 'y'`    |
  | `{$or:[{d:{$gte:X, $lt:Y}}]}` | `d >= X OR d < Y`     | `d >= X AND d < Y`       |
  | `{$or:[{$and:[A,B]}, {c,d}]}` | `(A AND B) OR c OR d` | `(A AND B) OR (c AND d)` |

  The Filter Protocol rule this breaks is Mongo's: **everything inside one filter
  object is AND-ed, at every depth.** A `$or` array OR-s its _branches_; it does
  not change how the contents _within_ a branch combine.

  Every miscompile widens the result set, never narrows it, so affected queries
  returned **more** rows than the filter allowed. Two shapes to re-check in your
  own metadata after upgrading:

  - **Scoping filters** that pair a discriminator with an id list per branch —
    `{$or:[{parent_object, parent_id:{$in:[…]}}, …]}` and similar — were not
    holding the pairing. Where such a filter decides visibility, it was returning
    rows outside the intended scope.
  - **Sharing-rule `criteria_json`** containing a `$or` whose branches carry more
    than one key (what a "match ANY of these groups" criteria builder emits). That
    path _writes_ `sys_record_share` grants, so any over-match materialized
    durable grants that outlive this fix — **re-reconcile those rules after
    upgrading**; the driver fix alone does not retract grants already written.

  Also affected: the abutting `$gte`/`$lt` window pattern the automation docs and
  CLI flow linter recommend for scheduled flows. Each tier degenerated to
  `d >= lo OR d < hi`, which matches every row, so multi-tier reminder flows fired
  on the whole table instead of one window.

  `driver-sql` was the sole divergent backend — `driver-memory`,
  `driver-mongodb`, the analytics `read-scope-sql` compiler and the write-side
  `matchesFilterCondition` evaluator all already AND-ed per node. Conformance
  tests now pin the same shapes across the three in-repo evaluators so they cannot
  drift apart again. `driver-sqlite-wasm` inherits the fix (it extends
  `SqlDriver`); Postgres, MySQL, SQLite and sqlite-wasm were all affected.

  The `$and` arm also now honors `logicalOp`, as `$or`/`$not` already did. Nothing
  reaches it with `'or'` once the propagation above is fixed, but the two changes
  are only correct together — leaving one combinator deaf to the flag is how the
  rules drifted apart in the first place.

- 0e3a226: fix(authz): widen the driver's native tenant scope to the membership union
  under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

  The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
  under `group`, but the ObjectQL engine also propagated the active-org
  `tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
  scoping ANDed `organization_id = tenantId` under the union — collapsing every
  group read back to active-org (isolated) reach. Found by the cloud-side
  `ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
  against a real driver.

  - `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
    native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
    keeping the NULL-tenant global-row carve-out; inserts still stamp from
    `tenantId` (the active organization is the write target, D5). Absent or
    empty ⇒ equality fallback — fail toward isolation, never toward exposure.
  - ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
    `tenantIds` when the tenancy posture is `group`, reported by a new
    `setTenancyPostureProvider` seam.
  - SecurityPlugin wires that provider at start — deliberately from the
    enforcement layer, so the driver wall only widens while the Layer 0 union
    wall enforces above it. Embeddings without plugin-security keep active-org
    equality.

- 81ce41a: feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

  Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
  rows are no longer rejected by `initialStates` — but the OTHER half of a historical
  migration, preserving the original timeline, still didn't hold: an imported ticket
  that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
  importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
  fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
  sorting all came out wrong.

  Three layers were force-overwriting the timeline; all three now respect a single
  new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
  alongside `skipStateMachine`:

  - **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
    and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
  - **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
    `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
    symmetric with how `created_at` / `created_by` already behave on insert; and the
    static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
    audit/timestamp family plus author-declared business `readonly` fields — so an
    upsert refresh no longer drops them.
  - **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
    force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
    empty, mirroring the insert stamp).
  - **rest** — the import runner sets `preserveAudit` on the write context iff the
    request opts into `treatAsHistorical`.

  Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
  `system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
  columns) STAY stripped, so a historical import reinstates established facts without
  becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
  unaffected — this changes only which audit/readonly values the runtime overwrites,
  never who may write the record. Fully opt-in: a normal write still auto-stamps
  `updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
  "Import as historical data" checkbox (objectui#2815) now drives both halves — no new
  UI.

- 647ec8b: fix(driver-sql,sharing): an unsortable query loses its ORDER BY, not its rows (#3821)

  `SqlDriver.find()` already recovered from a SELECT projection naming a column
  the table lacks (retry with `select('*')`, the unknown field is simply absent
  from each row). The identical failure one clause over — an **ORDER BY** column
  the table lacks — fell through to `return []`. Because `count()` is a separate
  statement, the list endpoint answered `HTTP 200` with `records: []` and
  `total: 3`: the rows are there, none are shown, nothing is logged. Same family
  as the `$`-param footgun closed by #2926.

  It surfaced through the Console's sharing-rule **recipient picker**, which
  never listed a single candidate. The client mangled `'name asc'` into
  `0 n,1 a,2 m,…` (fixed separately in objectui) and the driver turned that into
  "no users exist", so no sharing rule could be authored from the UI at all.

  Rows now outrank their order: the retry ladder drops the projection first (the
  likelier culprit and the cheaper thing to lose), then the sort, then gives up.
  A query that cannot be sorted comes back **unordered instead of empty**. Errors
  that are not about an unknown column still propagate untouched.

  **A rule authored in Setup now actually applies — and switching it off actually
  withdraws access.** Writing a `sys_sharing_rule` rebound the per-record hooks,
  which only makes the rule reach records written FROM THEN ON. So an admin who
  created a rule and enabled it saw nothing happen: the recipient's list stayed
  empty until somebody happened to touch each record. The reverse was worse —
  switching a rule OFF, or deleting it, left every grant it had already issued in
  place, and boot backfill only reconciles ACTIVE rules, so those grants outlived
  restarts while the UI displayed the rule as disabled. The reconcile was reachable
  only through `POST /sharing/rules/:id/evaluate`, which the Console never calls.

  Each non-system write to `sys_sharing_rule` now also reconciles that rule's
  grants, chained behind the existing rebind: insert/update run the same
  diff-based `evaluateRule` the REST endpoint runs (it purges when the rule is
  inactive), and delete purges directly via the new
  `SharingRuleService.revokeRuleGrants` — `evaluateRule` can't help there because
  the row is already gone (`RULE_NOT_FOUND`), which is also why a rule deleted
  through the plain data API used to orphan its grants. Seeding and package
  bootstrap write with `isSystem` and are skipped; `kernel:bootstrapped` already
  backfills those. Reconciliation is best-effort and never fails the write.

  **The dialog's help text was engineering notes, shown to tenant admins.** The
  field descriptions on `sys_sharing_rule` render under each input in Setup, and
  they cited ADR numbers, table and column names (`parent_business_unit_id`,
  `sys_business_unit`), enum machine values the dropdown never shows
  (`business_unit`, `team`), a third-party library (better-auth), and engine
  vocabulary ("evaluation", "lifecycle"). Several were also stale: they still told
  admins to type an id or hand-write a `FilterCondition` after those inputs became
  a record picker and a visual builder. Rewritten for the reader who actually sees
  them — the implementation detail was already in the object's doc comment, which
  is where it stays. `criteria_json`'s LABEL loses its "(FilterCondition JSON)"
  suffix for the same reason, and `active` can finally say what it now does:
  turning it off withdraws the access.

  Also refreshes the `sys_sharing_rule` help text in the zh-CN / ja-JP / es-ES
  translation bundles, which still described `recipient_type` in terms of
  `department` (the enum value is `business_unit`) and told admins to enter a
  queue name for `recipient_id` (`queue` was removed in ADR-0078). The es-ES
  option labels for `position` / `unit_and_subordinates` were translated as
  "rol" — corrected to "Puesto" / "Unidad de negocio y subordinados".

- 5f0852f: fix(driver-sql): bucket a SQLite `Field.datetime` by its stored instant instead of collapsing every row into one `(null)` (#3773)

  On SQLite, any trend chart bucketed by day/week/month/year over a
  `Field.datetime` column put **every record in a single `(null)` bucket** — one
  bar, carrying the whole total. The measure was right; only the bucket key was
  wrong. `Field.date` (ISO TEXT storage) was unaffected, so the same dashboard
  could show one column working and the next one flat.

  better-sqlite3 stores a `Field.datetime` as INTEGER epoch **milliseconds** (knex
  binds a JS `Date` as `.getTime()`), and `buildDateBucketExpr` emitted a flat
  `strftime('%Y-%m', col)`. SQLite reads a bare integer as a **Julian day
  number**; an epoch-ms value is far outside the legal range, so `strftime`
  returned NULL for every row. Nothing downstream noticed: SQLite advertises
  `queryDateGranularity.month`, so `engine.aggregate` pushes the bucketing down,
  and its in-memory fallback only engages for an _unsupported_ granularity or a
  non-UTC timezone.

  The SQLite expression is now storage-aware, sharing one `isEpochStoredDatetime`
  predicate with the filter-comparand coercion added for the same root cause in
  \#2034 — a window and a bucket that disagree about storage is exactly how an
  epoch column ended up correctly filtered and then entirely bucketed as NULL.
  Postgres and MySQL are untouched: `defineColumn` maps `Field.datetime` to a
  native timestamp there, which is also why their comparands are left alone.

  Two details are load-bearing and pinned by tests:

  - The conversion dispatches on each **stored value's** type, not just the
    declared one. A SQLite `Field.datetime` column is genuinely mixed-form —
    `formatInput` passes datetime values through, so a `Date` lands as INTEGER
    while an ISO string (including an unresolved `defaultValue: 'NOW()'`) lands as
    TEXT. Dividing TEXT by 1000 coerces it to its leading year, filing live rows
    under 1970 — worse than the NULL it replaced.
  - Division is `/1000.0`, not `/1000`. Integer division truncates toward zero, so
    a pre-1970 instant (`-1` ms) would surface as 1970-01-01.

  `bucketDateValue` (the in-memory fallback in `@objectstack/objectql`) now reads a
  finite **number** as epoch milliseconds. `new Date(String(1767225600000))` is an
  Invalid Date, so a driver handing back raw storage values bucketed as `'(null)'`
  there while the pushed-down SQL bucketed correctly — fixing only the driver would
  have traded one wrong answer for two different ones, and the two paths have to
  label the same instant identically for a drill-down to survive crossing them.

  `SqliteWasmDriver` inherits `buildDateBucketExpr`, so it carried the bug and gets
  the fix.

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
  - @objectstack/observability@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/observability@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- efbcfe1: feat(observability): admin-only richer per-request timing detail via `X-OS-Debug-Timing: json` (#2408)

  Completes the optional "richer JSON" diagnostic from #2408. In addition to the
  basic `Server-Timing` header, an admin/service caller can now request a
  per-query breakdown — the slowest SQL statements and a query count — by sending
  `X-OS-Debug-Timing: json`. The detail is returned in a separate
  `X-OS-Debug-Timing-Detail` response header (compact JSON) and is **admin-only,
  even under global mode**: an ordinary caller never sees SQL shapes.

  - **observability**: `PerfTiming` gains opt-in per-event detail capture
    (`enableDetail` / `recordDetail` / `details`) plus the ambient
    `recordServerTimingDetail`. The disclosure gate gains a `privileged` level
    (set by `allowPerfDisclosure`, read via `isPerfDisclosurePrivileged`) so the
    richer detail can be gated independently of the basic header.
  - **driver-sql**: when detail capture is on, the query listener additionally
    records each query's **parametrized** statement (knex's `q.sql`, `?`
    placeholders) — never the bindings, so no literal row value ever enters the
    collector. Zero overhead when detail is off.
  - **plugin-hono-server**: `X-OS-Debug-Timing: json` enables detail capture; the
    middleware emits `X-OS-Debug-Timing-Detail` (slowest queries, capped and
    sanitized to header-safe ASCII) only when the principal is a proven admin.

  Basic and global behavior are unchanged; `json` is purely additive.

### Patch Changes

- 47d923c: fix(driver-sql): drop the vestigial `sqlite3` peerDependency — the SQLite path uses `better-sqlite3` (#3277)

  `package.json` advertised `peerDependencies.sqlite3: "^5.0.0"`, but the driver never
  loads `sqlite3` at runtime. Every first-party SQLite construction site builds a
  `client: 'better-sqlite3'` Knex driver (`resolveSqliteDriver` in
  `@objectstack/service-datasource`, the datasource driver factory, and the whole
  driver test suite), and the README already tells consumers to `pnpm add better-sqlite3`.
  `better-sqlite3` is auto-provided as an `optionalDependency` (with the native → wasm →
  memory step-down of #2229 covering a failed native build), so the SQLite requirement is
  already satisfied without the consumer installing anything.

  The stale `sqlite3` peer only misled: a consumer resolving peer deps could `pnpm add
sqlite3` (never used) while believing they'd satisfied the SQLite requirement. Removing
  it aligns the declared contract with the code and the docs. The `sqlite3` string alias
  still maps to `better-sqlite3` in the driver factory and dialect detection, so
  `driver: 'sqlite3'` config keeps working — it just resolves to `better-sqlite3` like
  everything else.

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

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
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
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
- Updated dependencies [ce468c8]
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
  - @objectstack/types@16.0.0
  - @objectstack/observability@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/observability@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- efbcfe1: feat(observability): admin-only richer per-request timing detail via `X-OS-Debug-Timing: json` (#2408)

  Completes the optional "richer JSON" diagnostic from #2408. In addition to the
  basic `Server-Timing` header, an admin/service caller can now request a
  per-query breakdown — the slowest SQL statements and a query count — by sending
  `X-OS-Debug-Timing: json`. The detail is returned in a separate
  `X-OS-Debug-Timing-Detail` response header (compact JSON) and is **admin-only,
  even under global mode**: an ordinary caller never sees SQL shapes.

  - **observability**: `PerfTiming` gains opt-in per-event detail capture
    (`enableDetail` / `recordDetail` / `details`) plus the ambient
    `recordServerTimingDetail`. The disclosure gate gains a `privileged` level
    (set by `allowPerfDisclosure`, read via `isPerfDisclosurePrivileged`) so the
    richer detail can be gated independently of the basic header.
  - **driver-sql**: when detail capture is on, the query listener additionally
    records each query's **parametrized** statement (knex's `q.sql`, `?`
    placeholders) — never the bindings, so no literal row value ever enters the
    collector. Zero overhead when detail is off.
  - **plugin-hono-server**: `X-OS-Debug-Timing: json` enables detail capture; the
    middleware emits `X-OS-Debug-Timing-Detail` (slowest queries, capped and
    sanitized to header-safe ASCII) only when the principal is a proven admin.

  Basic and global behavior are unchanged; `json` is purely additive.

### Patch Changes

- 47d923c: fix(driver-sql): drop the vestigial `sqlite3` peerDependency — the SQLite path uses `better-sqlite3` (#3277)

  `package.json` advertised `peerDependencies.sqlite3: "^5.0.0"`, but the driver never
  loads `sqlite3` at runtime. Every first-party SQLite construction site builds a
  `client: 'better-sqlite3'` Knex driver (`resolveSqliteDriver` in
  `@objectstack/service-datasource`, the datasource driver factory, and the whole
  driver test suite), and the README already tells consumers to `pnpm add better-sqlite3`.
  `better-sqlite3` is auto-provided as an `optionalDependency` (with the native → wasm →
  memory step-down of #2229 covering a failed native build), so the SQLite requirement is
  already satisfied without the consumer installing anything.

  The stale `sqlite3` peer only misled: a consumer resolving peer deps could `pnpm add
sqlite3` (never used) while believing they'd satisfied the SQLite requirement. Removing
  it aligns the declared contract with the code and the docs. The `sqlite3` string alias
  still maps to `better-sqlite3` in the driver factory and dialect detection, so
  `driver: 'sqlite3'` config keeps working — it just resolves to `better-sqlite3` like
  everything else.

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

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
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
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
- Updated dependencies [ce468c8]
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
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/observability@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1

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

- 84650c5: Log a concise one-liner instead of the full `ERR_DLOPEN_FAILED` stack trace when native `better-sqlite3` cannot load (an ABI / `NODE_MODULE_VERSION` mismatch after a Node upgrade, or the native addon was never built). The native → wasm SQLite step-down is unchanged — this only stops a handled, non-fatal fallback from reading like a fatal crash in the dev console, and points at `pnpm rebuild better-sqlite3` for native speed. Any other `PRAGMA` failure keeps its full warning.
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

- ce6d151: fix(driver-sql): fail-loud on unknown filter operators; real IS NULL / IS NOT NULL; $not support (#2704)

  The SQL driver used to forward any filter operator it didn't recognise straight
  to Knex. On a null comparand that silently compiled to a whole-table match, so a
  permission/assignment-scoped list view could leak every row (e.g. an
  `is_null` / `is_empty` operator from the client). It also had no real
  null-check: `field = null` never renders `IS NULL` in SQL.

  This change makes the driver:

  - Render null predicates as real SQL — `is_null` / `isnull` / `is_empty`
    (and the not-null variants) → `IS NULL` / `IS NOT NULL`, unified with
    `equals` + null; `!= null` → `IS NOT NULL`.
  - Support the full spec operator set plus client alias spellings across both
    filter shapes (array `[field, op, value]` and object `{field: {$op: value}}`):
    `$between`, `$startsWith`, `$endsWith`, `$notContains`, `$null`, `$exists`,
    and the logical `$not` (a negated sub-condition, matching driver-mongodb /
    driver-memory — CEL `!expr` permission scopes compile to it).
  - LIKE-escape `contains` / `startsWith` / `endsWith` values with an explicit
    `ESCAPE '\'` so `%` / `_` in user input can't widen the match.
  - **Throw on a genuinely unknown operator** in both paths instead of silently
    passing it through — no more silent whole-table results.

  `@objectstack/spec` recognises the client alias operator spellings
  (`isnull` / `is_empty` / …) in `VALID_AST_OPERATORS` and maps them to `$null`
  so the array-AST → object-filter conversion is consistent with the driver.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

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

### Patch Changes

- afa8115: Three permission-runtime fixes found dogfooding the ADR-0090 showcase zoo:

  **#2734 — driver tenant wall hid every global row.** `applyTenantScope` used
  strict `organization_id = :tenantId` equality, so any caller with an active
  org (every logged-in admin) saw ZERO rows in the org-less platform tables
  (`sys_position`, `sys_permission_set`, `sys_business_unit` — Setup → Access
  Control rendered empty on a fresh deployment) and none of the first-boot
  seeds (stamped before the default org exists). The scope is now
  `(organization_id = :tenantId OR organization_id IS NULL)`: a NULL tenant
  column marks a GLOBAL/platform row that belongs to no other tenant; rows
  stamped with a DIFFERENT org stay invisible exactly as before.

  **#2735 — bulkCreate skipped write-side marshaling.** The batch insert path
  (the common case for seeds/imports since #2678) handed raw object values
  (`location`/`json`/`array` fields) to the SQLite binder — "Wrong API use:
  tried to bind a value of an unknown type" — silently failing whole seed
  batches (showcase accounts/tasks/field-zoo seeded zero rows). `bulkCreate`
  now runs each row through the same `formatInput` + `applyWriteColumnMap` +
  timestamp-stamp sequence as `create()`, and decodes the read-back the same
  way.

  **#2737 — count()/aggregate() ignored injected read filters.** `engine.count`
  and `engine.aggregate` built a LOCAL ast inside the executor, discarding the
  RLS/OWD filters the security and sharing middlewares inject into
  `opCtx.ast.where` — `GET /data/:object` returned scoped `records` with an
  UNSCOPED `total` (a row-count oracle over invisible records, broken
  pagination). Both now carry their ast on the opCtx exactly like `find()`.

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
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Patch Changes

- 21420d9: Seed loader and data-import now route bulk writes through the engine's array-form `insert()` (one round-trip per batch, with parent-deduplicated summary recompute) instead of one `insert()`/`createData()` call per record, and both retry transient driver errors instead of silently dropping the row (#2678).

  A new shared helper, `bulkWrite` (`@objectstack/core`), batches rows through a caller-supplied batch-write function, retries a whole-batch transient failure (network blip / timeout) with exponential backoff, and degrades to per-row writes (each itself retried) when a batch fails for a non-transient reason — so one bad row can't drop the other N-1. `withTransientRetry` wraps a single write (e.g. an update) with the same retry behavior.

  - `SeedLoaderService.loadDataset()` (`@objectstack/metadata-protocol`) buffers insert-mode records and flushes them in batches of 200 via the engine's array `insert()`. Datasets with a self-referencing field (e.g. `employee.manager_id -> employee`) keep the historical per-record write path, since a later record may need an earlier one's freshly-assigned id.
  - `runImport()` (`@objectstack/rest`) buffers create-resolved rows and flushes them via `protocol.createManyData()` when the protocol supports it, falling back to the original per-row `createData()` call otherwise. `Protocol.createManyData` (`@objectstack/metadata-protocol`) now forwards `context` to `engine.insert()` like `createData` already did, so tenant-scoped bulk creates work correctly.

  Previously, a 1000-row seed or import into an object with a rollup summary issued 1000+ round-trips and up to 1000 summary recomputes; a single transient network error on any one row silently dropped it with no retry (the 2026-07-06 HotCRM first-boot incident). A `bulkCreate`-capable driver now sees roughly `ceil(N/batch)` writes, and a transient error is retried before a row is ever reported as failed.

  **Fix (`@objectstack/driver-sql`):** `SqlDriver.bulkCreate()` never generated a client-side id for a row missing one, unlike `create()` — a latent gap that this change is the first to exercise at scale (a bulk-inserted row without a driver-native id default silently landed with `id: NULL`). `bulkCreate()` now mirrors `create()`'s id/`_id` normalization per row.

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

- 8d87930: Fix a connection-pool deadlock when the first `auto_number` write after process
  start goes through a transaction (e.g. `POST /api/v1/batch`, which wraps every
  operation in one `ql.transaction(...)`).

  The sequence-counter table (`_objectstack_sequences`) was created lazily on the
  first autonumber INSERT via a bare `this.knex.schema.*` call that asks the pool
  for a second connection. On SQLite (better-sqlite3, pool max=1) the open batch
  transaction already holds the only connection, so the acquire blocked until
  `Knex: Timeout acquiring a connection`. Postgres/MySQL are exposed to the same
  pool-exhaustion deadlock under concurrent cold first-writes.

  Fixes:

  - `initObjects` now pre-creates the counter table up front, outside any data
    transaction, so the first write never runs DDL (primary fix).
  - The lazy fallback (`ensureSequencesTable`) now runs its DDL on the caller's own
    transaction on SQLite instead of grabbing a second connection. It deliberately
    does not route DDL through the caller's transaction on MySQL, where DDL would
    implicitly commit the caller's in-flight transaction.
  - Added a dev/test guard (`assertBareKnexSafe`): on SQLite, issuing a bare
    `this.knex` query while a transaction holds the single pooled connection now
    fails fast with an actionable error instead of hanging until the opaque
    `Knex: Timeout acquiring a connection`. No-op in production and on non-SQLite
    dialects, so it adds no runtime cost on the hot path — it just turns this whole
    class of "forgot to thread the transaction through" bug into an immediate,
    self-explaining failure at the call site.

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

### Minor Changes

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

### Patch Changes

- 98a1535: Fix: store SQLite `created_at`/`updated_at` in one canonical, timezone-explicit format (ADR-0074)

  The two SQLite write paths disagreed on the audit-timestamp format. INSERT fell
  back to the column default `CURRENT_TIMESTAMP` (`'YYYY-MM-DD HH:MM:SS'`) while
  UPDATE stamped `toISOString().replace('T',' ').replace('Z','')`
  (`'YYYY-MM-DD HH:MM:SS.mmm'`) — both **timezone-naive**, space-separated strings
  that `Date.parse` reads as _local_ time. On a non-UTC runtime a stored UTC
  wall-clock silently shifted by the host offset; e.g. the objectos kernel
  freshness probe compared a shifted `updated_at` against an absolute `builtAtMs`
  and never evicted (publishes/installs/config toggles didn't take effect until the
  LRU TTL expired).

  `create` / `bulkCreate` / `upsert` / `update` now stamp a single canonical
  ISO-8601 instant with an explicit `Z` (`new Date().toISOString()`) — matching the
  caller-stamped paths (`sys_metadata`, the service outboxes) and Postgres/MySQL's
  native `now()`. Because the stamp is applied app-side (not via the column
  default), **existing** tenant databases are fixed immediately, not just freshly
  created tables. `formatOutput` additionally repairs any legacy/raw zone-naive
  audit timestamp to the same format on read (idempotent), so old rows read back
  unambiguously without a data migration. `upsert` now treats `created_at` as
  insert-only — a conflicting merge never overwrites it.

  Postgres/MySQL are unaffected (they store a real zone-aware `TIMESTAMP`).

- bc22a89: Fix: present `Field.time` as a wall-clock time-of-day on read (SQLite)

  `Field.time` is a tz-naive time-of-day, not an instant (#2004). A
  `defaultValue: 'NOW()'` time column historically took the full SQLite
  `CURRENT_TIMESTAMP` default, so a defaulted/legacy row read back a full
  `'YYYY-MM-DD HH:MM:SS'` timestamp instead of a time-of-day.

  `formatOutput` now repairs a `Field.time` value to just its time portion
  (`toTimeOnly`): a legacy full timestamp — or a full ISO value that leaked into
  the column — is sliced to `HH:MM[:SS[.fff]]`, while a value already stored as a
  bare time-of-day is left untouched. This is a deliberately NARROW, read-only
  normalization with no write/filter counterpart, so it introduces no write/read
  asymmetry and preserves exact round-trips for bare time-of-day values (e.g. the
  field-zoo `f_time` guard). Runs for every dialect (a native TIME column already
  returns a time-of-day, so it is a no-op there).

  Completes the temporal-field read normalization alongside #2346: `datetime`
  folds to a canonical ISO-8601-`Z` instant, `date` to `YYYY-MM-DD`, and `time` to
  a wall-clock time-of-day.

- 8a7e9f1: Fix: canonical storage + presentation for user-declared `NOW()`-default temporal fields on SQLite (ADR-0074 follow-up)

  A user-declared `Field.datetime` (or `date`/`time`) with `defaultValue: 'NOW()'`
  took the `knex.fn.now()` → `CURRENT_TIMESTAMP` column default on SQLite, storing a
  **timezone-naive**, space-separated `'YYYY-MM-DD HH:MM:SS'` (no millis, no zone).
  `Date.parse` reads such a zone-less string as _local_ time, so the stored UTC
  wall-clock shifted by the host offset on a non-UTC runtime — the same class of bug
  ADR-0074 fixed for the builtin `created_at`/`updated_at` audit columns, but left
  scoped out for user fields. Worse, the **same** column mixed storage: an explicit
  JS `Date` is bound by better-sqlite3 as INTEGER epoch ms, while an omitted value
  took the naive TEXT default — so one column held both INTEGER ms and naive TEXT.

  This fix, SQLite-only:

  - **DDL default → canonical.** The `NOW()` default now emits a per-type canonical
    via `strftime`: datetime → ISO-8601 with explicit `Z`
    (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`, e.g. `2026-06-26T10:34:13.891Z`,
    matching `new Date().toISOString()`); date → `YYYY-MM-DD`; time → `HH:MM:SS.fff`
    time-of-day (not a full timestamp).
  - **Read → uniform instant.** `formatOutput` folds every `Field.datetime` storage
    form — INTEGER epoch ms, canonical ISO-`Z`, and legacy naive `CURRENT_TIMESTAMP`
    TEXT — to one canonical ISO-8601-`Z` instant (`normalizeSqliteDatetimeOutput`),
    interpreting a naive wall-clock as UTC. Idempotent on already-zone-explicit
    values; total on null/unparseable. This transparently repairs existing rows on
    read (a DDL default only governs newly-created columns), so no data migration is
    needed — mirroring the `Field.date`/numeric read-repairs already in place.

  Applied as DDL-default + read-normalization, NOT app-side write stamping (the
  inverse of ADR-0074's audit-column fix): the read path already repairs
  existing-table rows transparently, and an explicit `Date` is bound as INTEGER
  epoch ms regardless of any write stamp, so stamping wouldn't make on-disk storage
  uniform anyway — the INTEGER-vs-TEXT split is inherent to SQLite and resolved at
  the read boundary. This keeps the hot insert/upsert/bulk paths untouched.

  The analytics SQL-bucketing path (`strftime`, bypasses `formatOutput`) is
  unchanged: ISO-`Z` TEXT buckets identically to the old naive TEXT. Postgres/MySQL
  keep native `now()` (a real zone-aware `TIMESTAMP`) and are entirely unaffected.

  Generalizes ADR-0074's `repairNaiveUtcAuditTimestamp` by also folding the INTEGER
  epoch-ms storage form; the two read-repairs can be unified once both land.

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

- 5ba52b0: fix(driver-sql): honor `tenancy.enabled:false` in driver org-scoping

  The driver auto-detects `organization_id` as a tenant-isolation column and, when
  the caller passes `DriverOptions.tenantId`, scopes reads/updates/deletes to that
  tenant (and injects the column on inserts). The implicit column-detection
  fallback ignored an explicit `tenancy.enabled === false`, so a platform-global
  object that opts out of tenancy but carries an optional `organization_id` FK
  (e.g. `sys_license`) was still org-scoped — an authenticated caller's active-org
  `tenantId` then hid every NULL-org / cross-org row. The opt-out is now honored in
  a single shared `computeTenantField()` used by both `initObjects` and
  `registerExternalObject` (which had drifted). Covers `TursoDriver` (extends
  `SqlDriver`). Genuine org-scoped objects are unaffected.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Minor Changes

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
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- 92db3e5: feat(driver-sql): honor `external.columnMap` on federated (external) objects (ADR-0015).

  When a federated object declares `external.columnMap` ({ remoteColumn -> localField }),
  the SQL driver now translates queries to the physical remote columns: WHERE and
  ORDER BY map local fields to remote columns (value coercion stays keyed by the local
  field), `formatOutput` renames remote-column keys back to local field names on read,
  and write payloads are key-remapped. Managed objects and external objects without a
  columnMap are unchanged (the resolver falls back to the existing per-site behavior).

- 2a1b16b: fix(ADR-0015): honor `external.remoteName` / `external.remoteSchema` on the federation read path.

  The query path previously resolved an external object's physical table from the
  object name, ignoring its `external` binding — so a federated object bound to a
  differently-named remote table failed with `no such table`, and ADR-0015's own
  `wh_order` → `mart.fact_orders` example was unqueryable. The SQL driver now
  resolves the remote table (`remoteName`, plus `remoteSchema` via `.withSchema()`
  on pg/mysql) and registers external objects' read-coercion metadata without DDL
  (`SqlDriver.registerExternalObject`, routed from the engine/plugin schema-sync).
  The managed path is unchanged. See ADR-0015 §18.

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

### Minor Changes

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

- db02bd5: Fix dashboard time-series charts / "last N months" KPIs that filter or group by a `Field.datetime` column silently returning "No rows".

  The analytics `NativeSQLStrategy` compiles dashboard relative-date tokens (`{12_months_ago}`, `{today}`, …) to ISO date strings and binds them directly into raw SQL, bypassing the driver's own filter coercion. Under better-sqlite3 a `Field.datetime` column is stored as an INTEGER epoch (ms), so `assessed_at >= '2025-06-18'` became a TEXT-vs-INTEGER affinity compare that is always false — an empty result even though the rows exist. `Field.date` columns store ISO TEXT and were unaffected.

  The strategy now coerces a temporal comparand to the column's on-disk storage form via a new optional `StrategyContext.coerceTemporalFilterValue` hook, wired to the driver's public `SqlDriver.temporalFilterValue` (the single source of truth for the storage convention). Coercion is dialect-correct: SQLite `Field.datetime` → epoch ms; `Field.date` text and native-timestamp dialects (Postgres/MySQL) are left unchanged, so Postgres is never handed an epoch integer. Applied to `gte`/`lte`/`gt`/`lt`/`equals`, `in`/`notIn`, and the `dateRange`/timeDimension `BETWEEN` path.

- d9508d1: fix(driver-sql): make numeric-scalar type fidelity self-heal on legacy SQLite columns

  The #2025 fix mapped `rating`/`slider`/`progress` to numeric columns, but SQLite never alters a column's type in place and the schema reconciler only adds missing columns — so a column created before that fix keeps its TEXT affinity and would still read back `'4'` instead of `4` forever.

  A read-side numeric coercion (the new `numericFields` registry, single-sourced from `NUMERIC_SCALAR_TYPES`) now coerces numeric-looking stored strings back to numbers on read, mirroring how `dateFields` already repairs legacy timestamp-typed `Field.date` rows. The fidelity no longer depends on column affinity alone; `null` and genuinely non-numeric legacy values are left intact rather than turned into `0`/`NaN`.

- 1d352d3: fix(driver-sql): round-trip rating/slider/toggle/progress with type fidelity

  `rating`/`slider`/`toggle`/`progress` had no case in the DDL column-type switch, so they fell to `default → table.string` (TEXT affinity). SQLite then coerced the written value to a string — `rating: 4` read back `'4'`, `toggle: true` read back `'1'` — so the value persisted but the JS type leaked on read. On a low-code platform where field types are author-driven, a field that silently returns the wrong type is a runtime-fidelity trap the static gates and value-loss tests don't catch.

  - `rating`/`slider`/`progress` now map to a REAL (numeric) column.
  - `toggle` maps to a boolean column and is registered in the boolean read-coercion path, so stored `1`/`0` come back as real JS booleans.
  - The object-valued `record`/`video`/`audio` types are folded into the shared `JSON_COLUMN_TYPES` source, and the DDL `default` case now derives JSON-vs-string from that set, so the column-type switch and `isJsonField` (the read-side deserializer) can no longer drift.

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

### Minor Changes

- bfa3102: fix: array-valued field types persist, and `Field.time` accepts time-of-day — two field-type runtime gaps found driving the showcase field-zoo (which had no seed data, so neither was ever exercised).

  **Array/object fields broke every write (driver-sql).** `multiselect` / `checkboxes` / `tags` / `repeater` / `vector` were absent from the SQL driver's JSON-field classification, so their array values reached the better-sqlite3 binder un-serialized and threw _"SQLite3 can only bind numbers, strings, bigints, buffers, and null"_ — a 500 on insert/update for common field types (even `task.labels` on a normal object). The DDL column-type switch and `isJsonField` had drifted into two separate lists; they now share one `JSON_COLUMN_TYPES` source that includes the array/object types, so these columns are created as JSON and round-trip as arrays/objects. A `formatInput` safety net additionally serializes any stray array/object value so an unclassified field degrades to a stored string instead of crashing.

  **`Field.time` rejected every valid value (objectql).** The validator reused the date/datetime branch (`Date.parse`), which is `NaN` for any bare time string — so a `time` field could never accept `14:30` or `09:05:30`. `time` now validates a time-of-day (`HH:MM` / `HH:MM:SS`, optional fractional seconds and `Z`/offset) and still accepts a full ISO datetime; `date`/`datetime` are unchanged.

  Verified live on app-showcase: the full field-zoo specimen (all input-able field types) now persists and round-trips. Regression tests added for both.

### Patch Changes

- 796f0d6: fix(driver-sql): `Field.date` is now stored and returned as a tz-naive `YYYY-MM-DD` calendar day (ADR-0053 Phase 1)

  A `Field.date` ("close date", "due date", "birthday") is semantically a **timezone-naive calendar day**, but the SQL driver was treating it as an _instant_: `formatInput` wrote the value verbatim (keeping any time component, so `dev.db` held `close_date = "2026-07-15T17:24:56.533Z"`), while the filter layer (`coerceFilterValue`) already normalized the comparand to date-only `YYYY-MM-DD`. That write/filter asymmetry meant a date-equality filter — `close_date == '2026-07-15'`, `expires_on: { $in: [...] }`, or a `daysFromNow(n)`-style comparand — compared `"2026-07-15T17:24Z"` against `"2026-07-15"` and **silently matched nothing**.

  This patch aligns the write/read boundary with the date-only contract the filter already enforced:

  - **Write** (`formatInput`): every `Field.date` value (a JS `Date`, a full-ISO string, or an already date-only string) collapses to `YYYY-MM-DD` before insert/update. A `Date` collapses to its UTC calendar day, matching `coerceFilterValue`.
  - **Read** (`formatOutput`): `Field.date` values are returned as `YYYY-MM-DD`, slicing any stored time component. This transparently repairs legacy rows that were written as a full timestamp, so date-equality works **without a data migration**. Read normalization now runs on the `find` path for every dialect (previously only `findOne`), matching the new behaviour.
  - The truncation logic is shared by the filter, write and read paths via a single `toDateOnly` helper, so all three agree on what a date _is_.

  `Field.datetime` is **unchanged** — it keeps full-instant (UTC millisecond) semantics.

  Out of scope (ADR-0053 Phase 2): timezone-aware `today()`/`daysFromNow()`/`daysAgo()`, an org/user reference timezone, and `datetime` render-time TZ. See ADR-0053 and issue #1928.

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

- b678d8c: fix(driver-sql): an unknown `$select` column must not zero the result set

  `find()` swallowed any "no such column" error into an empty array. A projected
  `$select` naming a column the table lacks (e.g. a generic list view
  auto-requesting `status`/`due_date`/`image` on an object without them) then made
  the WHOLE query return zero rows — reading to the UI as "no records exist" while
  the data was actually there: a silent data-loss footgun.

  When the failure comes from the projection, retry once with `SELECT *` so the
  real rows still come back (the phantom field is simply absent from each row).
  Non-projection errors (unknown table, etc.) still surface as before. This driver
  backstop holds even when the engine's unknown-field filter cannot fire because
  the object's schema is not populated in the registry (notably the cloud
  multi-tenant runtime).

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

### Minor Changes

- b990b89: fix(autonumber): one owner for autonumber generation — the persistent driver sequence (#1603)

  Autonumber values were generated in TWO places: the SQL driver's persistent,
  atomic `_objectstack_sequences` table AND a non-persistent in-memory counter in
  the ObjectQL engine. Because the engine pre-filled the field BEFORE calling the
  driver, the driver always saw a value already set and skipped — so the
  persistent sequence was effectively dead code, and a multi-instance / post-restart
  deployment could mint duplicate numbers from the in-memory counter.

  This makes generation single-owner:

  - **`@objectstack/spec`** — `DriverCapabilities` gains an optional `autonumber`
    flag: "driver natively generates persistent autonumber/sequence values".

  - **`@objectstack/driver-sql`** — advertises `supports.autonumber = true`.
    `bulkCreate()` now fills autonumber fields too (previously only `create()` /
    `upsert()` did), so bulk inserts also draw from the persistent sequence.
    Field parsing now honors either the spec-canonical `autonumberFormat` key OR
    the `format` shorthand (both appear in metadata).

  - **`@objectstack/objectql`** — when the driver advertises native autonumber
    support, the engine NO LONGER pre-fills (it defers entirely to the persistent
    driver sequence as the single source of truth). For drivers without native
    support (memory, mongodb) the in-memory fallback is unchanged. The fallback
    also now reads either `autonumberFormat` or `format`. Record-validation
    exempts `autonumber` fields from the `required` check — the value is
    runtime-owned and assigned after validation, so a required record number is
    never rejected as "missing".

  No metadata changes required. Existing data is respected: the driver bootstraps
  each sequence from the current max numeric tail on first use.

### Patch Changes

- 1e8b680: fix(security): close four P0 launch-readiness findings

  - **plugin-auth (P0-1):** `generateSecret()` now throws (fails boot) when no
    `OS_AUTH_SECRET` is set and `NODE_ENV==='production'`, instead of silently
    falling back to a predictable `dev-secret-<timestamp>` (session forgery). The
    dev/test fallback is unchanged.
  - **plugin-security (P0-2):** the permission-resolution `catch` now **fails
    closed** — it logs at ERROR and throws `PermissionDeniedError` rather than
    `return next()`. A degraded metadata service can no longer let every
    authenticated request bypass RBAC/RLS. System operations still bypass as before.
  - **driver-sql (P0-3):** the `contains` / `$contains` operator now escapes LIKE
    metacharacters (`%` / `_` / `\`) in the user value and binds an explicit
    `ESCAPE '\'`, so a value of `%` matches literally instead of every row
    (filter bypass). Correct across SQLite/MySQL/Postgres.
  - **driver-mongodb (P0-4):** the field-operator translator now rejects unknown
    `$`-operators instead of passing them through, blocking `$where` / `$function`
    / `$expr` (server-side JS execution / query-intent bypass). All legitimate
    ObjectQL operators remain allowlisted.

  +12 regression tests across the four packages.

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

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

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

### Minor Changes

- 24c9013: fix(driver-sql): materialize declared object-level indexes (#1459)

  The SQL driver synced columns and field-level `unique`, but silently dropped
  object-level declared `indexes` (`ObjectSchema.indexes: [{ fields, unique }]`).
  As a result several documented multi-column UNIQUE / dedup guarantees were
  never enforced at the DB level — a fresh `dev --fresh` sqlite DB showed only
  primary-key autoindexes.

  `initObjects` now materializes declared indexes (`syncDeclaredIndexes`) after
  the table is created/altered:

  - single- and multi-column indexes, including `UNIQUE`
  - NULL-distinct semantics (the cross-dialect default), so multiple NULL rows
    stay insertable while non-NULL duplicates are rejected — matching the
    convergence-on-conflict pattern the messaging pipeline relies on
  - idempotent: deterministic, length-bounded index names + per-dialect
    existing-index introspection (sqlite/pg/mysql); "already exists" races are
    absorbed
  - indexes referencing a non-materialized (virtual `formula`) column are skipped
    with a warning instead of failing sync

  The `indexes` driver capability flag is now `true`.

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 1.

  Adds the spec foundation and the DDL gate for federating mature external
  databases without ObjectStack ever mutating their schema:

  - `Datasource.schemaMode` (`managed` | `external` | `validate-only`) and
    `Datasource.external` settings, with a cross-field invariant.
  - `Object.external` binding (remote table/schema, writability, column map).
  - Shared error contract: `ExternalSchemaMismatchError`,
    `ExternalWriteForbiddenError`, `ExternalSchemaModeViolationError`
    (stable `code`s) + structured `SchemaDiffEntry` rendering.
  - `driver-sql` DDL gate: schema-mutating DDL (`initObjects`/`syncSchema`/
    `dropTable`) is rejected when `schemaMode !== 'managed'`.

  All changes are additive and backward-compatible (`schemaMode` defaults to
  `'managed'`).

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

- 4944f3a: Promote native database client packages so npm consumers can boot without manual installs.

  - `better-sqlite3` is now an `optionalDependency` (prebuilt binaries cover the common case), so `npx @objectstack/cli start` boots a default SQLite database out-of-the-box.
  - `pg`, `mysql2`, `sqlite3`, and `tedious` are declared as optional `peerDependencies` (`peerDependenciesMeta.optional = true`), removing install warnings while keeping the loader-on-demand pattern.

  Fixes: `Knex: Cannot find module 'better-sqlite3'` on fresh `npm install @objectstack/cli` followed by `objectstack start`.

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

### Minor Changes

- 0cc0374: feat(driver-sql): tenant-isolated auto_number sequences backed by a persistent counter table

  **Breaking nothing; new behaviour is opt-in via object schema.**

  The SQL driver now generates auto_number / autonumber field values via a
  dedicated `_objectstack_sequences` table keyed by
  `(object, tenant_id, field)` instead of scanning the data table for the
  current MAX on every insert.

  Highlights:

  - **Tenant isolation.** Objects with an `organization_id` field get a
    separate counter per organization. Two tenants creating contracts at
    the same time both legitimately observe `CTR-0001`, `CTR-0002`, … in
    their own namespaces — they no longer interleave or skip numbers.
  - **Tenant resolution.** Source order: `row[organization_id]` →
    `DriverOptions.tenantId` → `__global__` sentinel for org-less objects
    (e.g. setup-side singletons share one counter).
  - **Bootstrap from existing data.** On the first reservation in a new
    `(object, tenant, field)` tuple, the driver seeds `last_value` from the
    current per-tenant MAX so legacy/seeded records keep their position
    and downstream inserts pick up monotonically (gaps are tolerated).
  - **Atomic increment.** Each reservation runs in a transaction with
    `SELECT … FOR UPDATE` (where the dialect supports it) and a single
    `UPDATE` of `last_value`. Tested with 25 concurrent inserts in one
    tenant producing 25 distinct sequence values.
  - **Caller overrides honoured.** A row that already has an explicit
    value for the auto_number field is left untouched, and the sequence
    bootstrap respects that value so future reservations advance past it.
  - **Dual spelling.** Both `type: 'auto_number'` (snake) and
    `type: 'autonumber'` (the spec factory output) are recognised.

  Migration notes:

  - The first time the driver handles an auto_number insert, it creates
    the `_objectstack_sequences` table automatically — no manual DDL.
  - Pre-existing data is not renumbered. Gaps introduced by older
    cross-tenant logic (where a tenant's number could "jump" because it
    inherited another tenant's MAX) remain in place; subsequent inserts
    continue from `MAX + 1` in the affected tenant.

- 5b878d9: Generate `auto_number` / `autonumber` field values on insert. The driver
  parses the field's `format` template (e.g. `CTR-{0000}`) to extract the
  prefix and pad-width, then scans existing rows with the same prefix and
  emits `prefix + padded(maxN + 1)` for any row that omits the field.

  Note: per-call MAX+1 — not atomic across concurrent writers. Fine for
  seed-data and low-write demo loads; production deployments should layer
  a dedicated sequence table.

- f0b3972: **Driver-level tenant isolation for objects with `organization_id`.**

  `SqlDriver` now auto-applies a `WHERE organization_id = :tenantId` predicate on every read/update/delete and auto-injects the column on insert when the caller passes `options.tenantId` and the object schema declares an `organization_id` field. `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `count` and `aggregate` are all scoped.

  ObjectQL's engine now threads `ExecutionContext.tenantId` into the driver options for every CRUD entry point (including `expandRelatedRecords`), so a tenant-scoped session can no longer cross tenants — even through lookup expansion or count fallbacks.

  Backward compatible: callers that omit `tenantId` (system tasks, seed scripts) keep getting unscoped behaviour. Explicit `organization_id` on an insert row always wins over the contextual `tenantId` so admin tooling can still target a specific tenant.

  13 new tests in `sql-driver-tenant-scope.test.ts` verify cross-tenant find/findOne/update/delete/count/bulkCreate/updateMany/deleteMany isolation, the unscoped admin path, and that global objects (no `organization_id`) are not scoped.

- 0e63f2f: **Declarative tenant scoping + audit warn for missing tenantId.**

  `SqlDriver` now reads `obj.tenancy.tenantField` first when picking the tenant column for an object, falling back to the implicit `organization_id` detection so legacy objects keep working without a spec migration. Set `tenancy: { enabled: true, strategy: 'shared', tenantField: 'workspace_id' }` on any object to use a custom column.

  Writes (`create`, `update`, `delete`, `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `upsert`) that target a tenant-scoped object **without** `options.tenantId` now emit one `[tenant-audit]` warning per `{object}:{op}` so missing-context bugs surface in CI/logs instead of silently writing globally. The engine auto-silences when `ExecutionContext.isSystem === true` (boot-time seeds, kernel mirrors). Callers can opt out per-call with `options.bypassTenantAudit = true` or globally with `OS_TENANT_AUDIT=0`.

  Driver README now documents the full scope/bypass matrix and the audit warning.

  Three new tests cover the declared-tenant-field path, the audit throttle, and the bypass flag.

### Patch Changes

- 5683206: Document the tenant-isolation bypass on raw `execute()` (both `SqlDriver.execute()` and `engine.execute()`). The behaviour is unchanged — `execute()` has always passed commands through verbatim — but the JSDoc now spells out the security contract so callers know they must inline `WHERE organization_id = ?` themselves or restrict raw execution to genuinely global statements (migrations, control-plane tables).
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

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 3.3.2

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
