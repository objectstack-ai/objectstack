# @objectstack/types

## 17.0.0-rc.6

### Minor Changes

- 91cefb8: refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

  Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

  正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

  **两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

  - `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
  - `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

  把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

  行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。

- 129b378: fix(types,rest): one named answer for "which column conflicted" — an index name is never returned as one (#6544)

  #6250 retired four private "is this a unique violation?" vocabularies into
  `isUniqueViolationError`. It left the harder half of the question behind: the
  import runner's `sanitizeRowError` still carried its own three-dialect regex
  chain, because it does **more** than answer yes/no — it names the offending
  column so the importer can say _"A record with this `email` already exists."_
  This lands that second answer as a shared export and migrates the last private
  copy onto it.

  **New — `uniqueViolationColumn(error)` in `@objectstack/types`** (`string |
undefined`), sibling to `isUniqueViolationError` and gated on it, reading the
  same channels one step down the same bounded `cause` chain, plus
  node-postgres' `detail` field.

  **Its contract, per the maintainer's 2026-08-08 ruling: a value comes back only
  when the identifier the driver printed is determinably a COLUMN.** When a
  dialect names an _index_ instead — MySQL's `Duplicate entry … for key
'idx_email_unique'`, Postgres' `violates unique constraint "sys_user_email_key"`,
  SQLite's `UNIQUE constraint failed: index 'x'` — the answer is `undefined`,
  never the index name. Callers render this into a form field, and an index name
  mistaken for a column points the user at a field that does not exist, whereas
  `undefined` degrades to generic copy. A **composite** key (`Key (tenant_id,
email)=(…)`) is `undefined` for the same reason: there is no single offending
  column, and naming the first is the same class of wrong answer.

  **⚠️ User-visible change on MySQL imports.** MySQL's duplicate-entry message
  names the index and never the column, so the importer no longer names a column
  there: rows that used to read _"A record with this `idx_email_unique` already
  exists."_ — or, on MySQL 8's table-qualified `for key 'sys_user.email'`, a
  plausible-looking _`email`_ that was still an index name — now read **"A record
  with this value already exists."** That is deliberate and is the accepted cost
  of the ruling. The conflict is still recognised as a conflict; only the naming
  narrowed.

  Three smaller import messages improve in the same move, all previously wrong
  rather than merely vague:

  - SQLite's expression/partial-index form used to render as _"A record with this
    **index** already exists."_
  - Postgres' expression index used to render the truncated fragment _"A record
    with this **lower(email** already exists."_
  - A Postgres conflict with no `DETAIL:` line used to fall through to the SQL
    backstop and echo the driver's own sentence — index name included — at the
    importer. It now gets the same generic conflict copy, which is also the exact
    wording `mapDataError` puts in the 409 `UNIQUE_VIOLATION` body, so the
    importer and the API say one thing about one condition.

  Not changed: the NOT NULL branch, the raw-SQL backstop, and every non-conflict
  message, which pass through exactly as before.

### Patch Changes

- 88f9d94: fix(types,rest): one named unique-violation predicate — a MySQL conflict is 409 UNIQUE_VIOLATION, not 500 (#6250)

  **On MySQL, every unique-constraint conflict came back as `500 INTERNAL_ERROR`.**
  The API contract registers `UNIQUE_VIOLATION` as a 409 code
  (`packages/spec/src/api/error-code-ledger.zod.ts`), so a front end had no way to
  tell "this email is already taken" from "the server fell over" — no retry advice,
  no field to point at, and a 5xx in the operator's dashboards for what is an
  ordinary client outcome. SQLite and Postgres deployments never saw it, which is
  why it survived: their conflict prose happens to contain the words the mapping
  looked for.

  **Cause: the conflict verdict was nested inside a leak heuristic.** REST's 409
  branch lived inside the true-branch of `looksLikeInternalErrorLeak()`, keyed on
  the substrings `unique constraint` / `unique violation`. MySQL says
  `ER_DUP_ENTRY: Duplicate entry '…' for key '…'`, which matches no limb of that
  heuristic, so the conflict never reached the `if` at all and fell out of the
  terminal `UNCLASSIFIED_FAULT`. Two unrelated questions — "is this a conflict?"
  and "would echoing this text leak internals?" — had been fused into one, and
  MySQL is where they disagree.

  Measured on the previous release, through the real error mapper:

  ```
  mysql,    bare message       500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
  mysql,    knex-wrapped SQL   500 DATABASE_ERROR  →  409 UNIQUE_VIOLATION
  postgres, SQLSTATE only      500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
  sqlite,   message            409 UNIQUE_VIOLATION   (unchanged)
  postgres, message            409 UNIQUE_VIOLATION   (unchanged)
  ```

  So the hole was never MySQL-only: the mapping read one of the two channels
  drivers use. A Postgres error carrying SQLSTATE `23505` with unremarkable prose
  was a 500 as well.

  **New: `isUniqueViolationError(error)`, exported from `@objectstack/types`.** One
  named predicate replaces the substring test, reading every channel a driver
  uses — `code` (`23505` / `ER_DUP_ENTRY` / `SQLITE_CONSTRAINT_UNIQUE`), `errno`
  (`1062`), the message, and one step down the `cause` chain that pool and
  query-builder layers wrap with. Its vocabulary is the union of the four
  hand-written copies the repo already carried, so routing REST through it cannot
  narrow any verdict clients rely on today; an unrecognised error is never a
  conflict, because a false 409 tells an SDK not to retry and points the user at a
  value that is fine.

  **The internal-leak classifier is byte-identical.** The fix hoists the conflict
  question out of it rather than widening its criteria, so nothing else it guards
  is reclassified as safe-to-expose. And the 409 body is fixed text: MySQL embeds
  the offending user data in its message (`Duplicate entry 'a@b.com' …`) and
  Postgres the index and column names, none of which reaches the client. The full
  driver text still reaches the server log.

  No action needed. Clients that already handled `409 UNIQUE_VIOLATION` on SQLite
  and Postgres now receive it on MySQL too.

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
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
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

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

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

- 02dc076: feat(types,cli,verify)!: 只解析 host app 声明过的包 —— `NODE_PATH` 不再算数,ADR-0093 D5 那道墙从此与启动方式无关 (#4719)

  **问题:契约写下了,但从没被检查过。** `@objectstack/types/node` 的
  `createHostRequire` 返回一个 CJS `createRequire`,而 CJS 解析认 `NODE_PATH`
  (`Module.globalPaths`)。pnpm 生成的 bin shim 第一件事就是
  `export NODE_PATH=<workspace>/node_modules/.pnpm/node_modules`,于是任何被工作区里
  **任意一个包**传递依赖到的包都能"从 host app 解析成功" —— 跟这个 app 声明了什么毫无关系。

  实测(cloud `apps/objectos-ee`,当时未声明 `@objectstack/organizations`):
  `pnpm start`(经 shim)boot 成功、插件表里有 `Organizations`、ADR-0093 D5 一声不吭;
  `node node_modules/@objectstack/cli/bin/run.js serve`(不经 shim)则
  `✖ FATAL: tenancy posture 'isolated' was requested…` 并 exit 1。同一个 app、同一份
  `package.json`、同一个 posture,**只因为进程是怎么被拉起来的**,走出两种结果。
  而 D5 的报错一直在教 operator "declare it in the app's package.json" —— 那正是
  CLI 从来没检查过的那件事。

  **改法:声明即执行。** 解析前先读 `<hostRoot>/package.json`;只有包名出现在
  `dependencies` / `devDependencies` / `optionalDependencies` / `peerDependencies`
  的 **键**里,才去 host 的 `node_modules` 里查它。仅仅"能被解析到"不再算数 ——
  那正是让契约失效的那个偶然。未声明的包退回到 importing package 自身的解析
  (ESM,不认 `NODE_PATH`),框架自有的包加载路径不受影响。

  **两种失败从此分开报。** 今天它们都塌成同一条 `MODULE_NOT_FOUND`,补救办法却相反:

  - **未声明** —— 指向"在 app 的 `package.json` 里声明并安装",并说明为什么
    hoisting / `NODE_PATH` 不被接受;
  - **声明了但解析不到** —— 明确说这是**安装**问题(`pnpm install`、生产 prune
    砍掉了它、dist 没构建),别再让人回去重看那份已经写对的 `package.json`。

  分类经新导出的 `hostImportFailureKind(err)` 暴露给调用方;两种错误都仍带
  `code: 'MODULE_NOT_FOUND'`,`isModuleNotFoundError` 的既有判定不变。

  **BREAKING — 哪类部署会从假绿变红,以及怎么修。**

  1. **靠 hoisting 苟着的部署。** 一个 app 请求了 walled tenancy posture
     (`OS_TENANCY_POSTURE=group` / `isolated` 或 `OS_MULTI_ORG_ENABLED=1`)、
     却没在自己的 `package.json` 里声明 `@objectstack/organizations`,过去经 pnpm
     shim 启动能正常 boot —— 现在会命中 ADR-0093 D5 并 exit 1。
     **修法:在那个 app 的 `package.json` 里声明该依赖并安装。**
     这些部署本来就在未声明状态下运行,红的是一直存在的事实,不是新引入的故障:
     同一个 app 不经 shim 启动今天就已经是 exit 1。
     (同样适用于 `@objectstack/service-ai` / `@objectstack/service-ai-studio`,以及
     `bootStack({ multiTenant: true })`、dogfood 的 enterprise 门。)

  2. **`createHostImporter` 的签名变了**,因为它现在需要 host 的**根目录**才能读到
     那份 manifest,而一个 `NodeRequire` 无法被问出它锚在哪里:

     ```diff
     - createHostImporter(createHostRequire(hostRoot))
     + createHostImporter(hostRoot)                     // 省略参数 = process.cwd(),同旧默认
     ```

     `createHostRequire` 本身保持不变,仍然导出。

  新增导出(`@objectstack/types/node`):`HOST_DECLARATION_FIELDS`、
  `HostDeclarationField`、`HostDeclaration`、`readHostDeclaration`、
  `isDeclaredByHost`、`packageNameFromSpecifier`、`HostImportFailureKind`、
  `HOST_IMPORT_FAILURE_KIND`、`hostImportFailureKind`。

### Patch Changes

- 08f93bc: fix(auth): `organization/create` gates on the authoritative `OS_TENANCY_POSTURE`, not the demoted `OS_MULTI_ORG_ENABLED` (#5233)

  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — mounted the entire organization wall and still
  answered `403 Creating additional organizations is disabled on this deployment.`
  to `POST /api/v1/auth/organization/create`. Org-less users had no way to create
  their workspace, so the guided "Create your workspace" path was a dead end.

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  Two sites in `AuthManager` kept reading the demoted boolean directly, so both
  reported "single-org" on a deployment that had asked for a wall and got one:

  - `organizationHooks.beforeCreateOrganization` — the 403 above. It now judges
    `postureEnforcesWall(resolveTenancyPosture())`, matching the knob `serve.ts`'s
    own ADR-0093 D5 boot guard keys on. Intent is unchanged (single-org still
    refuses); only the knob is corrected.
  - `/auth/config`'s `features.multiOrgEnabled` — its no-tenancy-service fallback
    read the same boolean. It now falls back to the resolved posture, so a lean
    embedding advertises the capability its own gate allows.

  **No configuration change is needed anywhere.** Deployments that set only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  workaround people used to unblock themselves stays valid. Deployments that set
  only `OS_TENANCY_POSTURE` can now drop the redundant boolean.

  `resolveMultiOrgEnabled()`'s doc comment in `@objectstack/types` — which still
  instructed "the auth manager's `/auth/config` feature flag and org-create guard
  … MUST call this", written before the demotion — now says the opposite: ask the
  posture, and never gate on this boolean. Its behaviour is unchanged.

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
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
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

## 17.0.0-rc.2

### Minor Changes

- b25a116: fix(verify): resolve the enterprise organizations package from the HOST APP (#4700)

  `bootStack(app, { multiTenant: true })` — and therefore `objectstack verify
--multi-tenant` — could never load `@objectstack/organizations`. Node ESM
  resolves a bare `import()` against the **importer's own realpath**, which for
  `packages/verify` is inside the framework workspace, while the enterprise
  package is cloud-private and only ever lives in the verified app's
  `node_modules`. Every real host app fell into the catch and was told to
  "Install/link it in this workspace" — about a package it had already installed.
  Same defect class as cloud#1013, which fixed `objectstack serve`; #4699 fixed
  that one call site and this issue tracked the two the sweep left behind.

  **New: `@objectstack/types/node`.** The host-app resolver (`createHostRequire` /
  `createHostImporter`) moved out of `packages/cli/src/utils/import-from-host.ts`
  — where `@objectstack/verify` and the dogfood suite could not import it without
  inverting the dependency direction — into a **node-only subpath export** of
  `@objectstack/types`. One behaviour, one source; the CLI now consumes it and its
  private copy is deleted.

  It is a subpath and **not** the root export because `@objectstack/types` is a
  dependency of `@objectstack/hono` ("edge-compatible REST API server for
  Cloudflare Workers, Deno, Bun, and Node") and of the plugin layer a `LiteKernel`
  boots on Workers. The root entry reaches zero `node:` builtins, and a Workers
  bundle breaks on `node:module` even when nothing calls it. `tsup` emits the two
  entries as separate self-contained bundles (`splitting: false`), and a test
  walks the root's import graph and fails on the first reachable `node:`
  specifier, so the isolation is enforced rather than merely intended. Same
  arrangement `@objectstack/metadata` already ships for its `./node` subpath.

  **New: `BootOptions.hostRoot`** (optional, defaults to `process.cwd()`) names
  the app whose `node_modules` supplies those optional packages — for a harness
  booting an app that is not the working directory.

  **The dogfood multi-org gates had never run.** Two suites probed availability
  with the same bare `import()` and so were **constant-false** — not "false
  because absent" but false by construction, in every environment including the
  cloud CI whose comment claimed it ran them. The #1994 cross-tenant RLS proof and
  the attachments cross-tenant isolation block had therefore never executed while
  the suite reported green (Prime Directive #10, test-suite edition). They now
  resolve like the runtime does, and `OS_TEST_MULTI_ORG_ENABLED=1` declares that a
  run is expected to ship the package — turning a silent skip into a loud failure,
  so a run can no longer pass by quietly not running the gates it exists for.

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
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
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

## 17.0.0-rc.1

### Minor Changes

- 2a37694: fix(plugin-dev,types): the production escape hatch stops being silent (#3900)

  `DevPlugin.init()` refuses to run under `NODE_ENV=production` (ADR-0115 D6), and
  `OS_ALLOW_DEV_PLUGIN` overrides that refusal. As shipped, the override returned
  early with **no output at all**: the process ran the development assembly while
  every log line and the ready banner read like an ordinary production start.

  That reproduces, one level up, the defect the guard exists to close. The guard's
  own precedent says so — `OS_ALLOW_DEGRADED_TENANCY` boots degraded _and brands
  it everywhere an operator looks_, and `OS_ALLOW_DRIVER_CONNECT_FAILURE`'s
  contract is "logged loudly at startup". An escape hatch that says nothing leaves
  the operator's only evidence of a degraded state in an env var they may not have
  set themselves.

  **The override now brands itself, twice.** A warning at `init()` — emitted
  before any assembly work, so it survives an assembly step that later throws —
  and a repeat on the ready banner, which is the surface an operator actually
  reads:

  ```
  ⚠ DEV ASSEMBLY UNDER NODE_ENV=production (OS_ALLOW_DEV_PLUGIN is set) — the boot
    guard was explicitly overridden. This process is running the DEVELOPMENT
    assembly, which is not hardened for production traffic (ADR-0115 D6).
      • Auth secret is the default published inside @objectstack/plugin-dev. It is
        public, so anyone can mint a session this stack accepts. Pass `authSecret`
        explicitly.
      • Data goes to the in-memory driver with persistence disabled — every record
        is lost when this process exits.
  ```

  Only hazards that are live for _that_ configuration are named: the secret line
  is suppressed when the operator passed their own `authSecret`, and the driver
  line when the `driver` toggle is off. The dev-admin seed is deliberately absent
  — `plugin-auth`'s `maybeSeedDevAdmin` is hard-gated to
  `NODE_ENV === 'development'` and cannot fire on this path, so warning about it
  would spend the attention the real hazards need.

  **New export — `resolveAllowDevPlugin()` (`@objectstack/types`).** The flag moves
  off a bare `process.env['OS_ALLOW_DEV_PLUGIN'] === '1'` and joins the
  `OS_ALLOW_*` family's shared truthy vocabulary, next to
  `resolveAllowDegradedTenancy` / `resolveAllowDriverConnectFailure`.

  FROM → TO for operators: `OS_ALLOW_DEV_PLUGIN=1` keeps working unchanged.
  `OS_ALLOW_DEV_PLUGIN=true` (and `on` / `yes`, case-insensitive, surrounding
  whitespace ignored) **now takes effect** where the strict comparison previously
  ignored it and failed the boot. That is a widening, in the direction an operator
  setting the flag already intended; falsy and unrecognised values still refuse to
  boot, and unset still means "fail fast". If you were relying on
  `OS_ALLOW_DEV_PLUGIN=true` being inert as a way to keep the guard armed, unset
  the variable instead.

  No change to the refusal path, which this issue re-verified end to end:
  `kernel.use()` only registers, `initPluginWithTimeout` does not catch,
  `bootstrap()` rethrows, and `os serve`'s outer handler prints the message and
  exits `1`. The `throw` is genuinely fatal here, so it needs none of the
  `process.exit(1)` the tenancy guard required for sitting inside a broad `catch`.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

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

- 9881074: fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

  #4363 made a single paged read a partition of its result set. It could not make
  a _walk_ one: seven background scans paged with a growing `offset` while writing
  to the very rows they were reading, and an offset counts into a set those writes
  are changing. Rows slide past the cursor and are never visited.

  That is not a slow page in any of these — it is a wrong answer wearing the shape
  of a clean run:

  - **`rebuildApproverIndex`** built its desired state by walking
    `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
    **deleted** every index row that state did not explain. A skipped request
    meant an approver silently dropped from someone's queue. (The loop beside it
    ordered by `created_at` — not unique, so its pages were never a partition
    either.)
  - **`verifyFileReferences`** decides which files nothing references. A record it
    never visits is reported as an unreferenced file.
  - **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
    each row they read, so their own writes were shifting the set out from under
    the cursor. Records were left unconverted and unsearchable by a run that
    reported success.
  - **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
    it opens a migration gate on that evidence.

  All of them now go through `keysetWalk` (`@objectstack/types`): order by a
  unique key, and seek past the last one instead of counting from the start. A
  row's key does not move when the row is updated, and cannot be shifted when
  another is deleted, so the walk is stable under exactly the mutation these
  functions perform. It is also O(n) rather than O(n²/page) — measured on
  Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

  One deliberate non-conversion: the REST **export** stream keeps its offset. It
  honors a caller-chosen sort, and a keyset walk would have to re-order the export
  by `id` to seek — changing what the user asked for to fix a cost. Its pages are
  already a partition since #4363; only the depth cost remains.

  `keysetWalk` merges the cursor with `$and` rather than spreading it into the
  caller's filter, so a walk whose own `where` constrains the key column
  (`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
  overwritten. When a `max` cap is set it reads one row beyond the cap to tell
  "the cap stopped us" from "the source ended exactly there" — without that, a
  walk that read everything still reports `truncated`, and a caller acting on it
  goes looking for rows that were never withheld.

  The storage suites' fake engines now **throw** on an `offset` instead of serving
  one, so the conversion is pinned rather than merely passing.

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
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
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

## 17.0.0-rc.0

### Minor Changes

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

- 030125b: feat(objectql)!: `init()` refuses to boot when a data driver fails to connect (#3741)

  `ObjectQLEngine.init()` wrapped every driver's `connect()` in a try/catch, logged
  one error line, and carried on. A server whose database was unreachable therefore
  "started successfully" — health endpoints could even stay green — and then failed
  every request with an error that reads nothing like _the database is down_. The
  warning it printed (`Operations may recover via lazy reconnection or fail at query
time`) was half fiction: grep the repo and no reconnection exists in `driver-sql`
  or `driver-mongodb`, so only the "fail at query time" half was ever real. The
  caller made it worse — `ObjectQLPlugin.start()` runs `syncRegisteredSchemas()`
  immediately after `init()`, issuing DDL against a driver that isn't there.

  The structural half of the bug was worse than the operational one: the catch
  removed a driver's ability to **refuse startup at all**. Any fatal startup check —
  licence, server version, incompatible configuration, missing capability, not just
  an unreachable socket — is expressed by throwing from `connect()`, and every one
  of them was silently downgraded to a runtime error. That is why driver-mongodb's
  multi-tenancy guard (#3724 / #3734) had to be hoisted into its constructor.

  - `init()` now **throws** `DriverConnectError` (`code: 'ERR_DRIVER_CONNECT'`)
    when any boot-registered driver's `connect()` rejects, aborting kernel
    bootstrap. It still attempts every driver first, so one failed boot names all
    of them. The message is self-contained — each failed driver and its cause —
    because the CLI prints `error.message` alone; the first cause is also attached
    as `error.cause`. Exported from both `@objectstack/objectql` and
    `@objectstack/objectql/core`.
  - `connect()` is now a supported place for a driver to veto boot. Startup
    validation that needs a live connection (server version, capability probes)
    no longer has to be forced into a constructor.
  - The misleading "lazy reconnection" warning is gone.
  - New escape hatch `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`
    (`resolveAllowDriverConnectFailure()` in `@objectstack/types`) restores the old
    lenient boot, but loudly: a `DEGRADED BOOT` banner names the failed drivers and
    states that they are never retried or reconnected and that every query and
    schema sync routed to them will fail for the process lifetime. The banner goes
    to stderr as well as the logger, because `os serve` swallows all of stdout
    during boot and `Logger` routes `warn` there — logger-only, the one message
    that matters would be invisible in exactly the deployment the flag is for.
    Defaults off.

  **Migration.** No code or config change is needed for a correctly configured
  deployment — a driver that connected before still connects. A deployment that was
  _silently_ booting without its database now fails the boot instead, with the
  driver name and cause in the error; fix the datasource configuration (typically
  `OS_DATABASE_URL`, credentials, or network reachability). To keep booting without
  it — deliberately, and knowing every request that touches it will fail — set
  `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.

### Patch Changes

- 87aca93: fix(datasource)!: a declared datasource that objects bind to must connect, or the boot fails (#3758)

  `DatasourceConnectionService.handleFailure()` fail-fasted only for an `external`
  datasource with `validation.onMismatch: 'fail'`. Everything else degraded to one
  `warn` line — including the case the D2 auto-connect gate itself flags as having
  **no fallback path**: a datasource that objects bind to explicitly via
  `object.datasource`. Those objects never fall through to the `default` driver;
  `engine.getDriver` throws `Datasource 'x' is not registered` for them.

  So an app declaring `datasource: 'analytics'` with 20 objects bound to it, booted
  against a wrong `ANALYTICS_URL`, started clean and exited zero — and then failed
  every read and write of those 20 objects with an error that reads nothing like
  _the analytics database is unreachable_. The rest of the app worked, which made it
  **harder** to locate than a total outage: it looks like "some pages are broken",
  not like a misconfigured datasource. This is the same decision #3741/#3751 fixed
  one layer up in `ObjectQLEngine.init()`; the boundary here was still drawn in the
  old place.

  - **Fail-fast is now keyed on "no fallback path", not on `onMismatch` alone.** At
    the `declared-auto` (boot) trigger, a connect failure aborts the boot when the
    datasource is `external` + `onMismatch: 'fail'` **or** when ≥1 object binds to
    it explicitly. `autoConnect: true` with nothing bound stays lenient — that is
    "connect it if you can", and nothing declares a dependency on it. The
    runtime-admin create/update and boot-rehydration triggers are unchanged and
    still always degrade: a UI action must never brick a running server.
  - **Every failure mode counts**, not just an unreachable socket: an unresolvable
    `external.credentialsRef` (D3) and an unsupported `driver` leave the bound
    objects exactly as dead, so they take the same verdict.
  - **The error names the bound objects** (up to 10, then `+N more`) alongside the
    underlying cause, so the message points at the real problem instead of just the
    datasource name. The service already receives the list for post-connect
    `syncObjectSchema`.
  - **`connectDeclared()` attempts every gated datasource before throwing**, and
    aggregates, so one failed boot reports all the misconfigured ones rather than
    one per restart — the same shape as `ObjectQLEngine.init()`'s
    `DriverConnectError`.
  - **The escape hatch is shared with the engine guard**:
    `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` now also covers this path (and covers
    `onMismatch: 'fail'`, which previously had no opt-out). The operator intent is
    identical — "I know the database is unreachable, boot anyway" — and two flags
    would only guarantee one of them gets missed. When set, boot continues and a
    `DEGRADED BOOT` banner goes to stderr as well as the logger, because `os serve`
    swallows stdout during boot. `emitDegradedBootBanner` moved to
    `@objectstack/types` so both call sites share one implementation;
    `@objectstack/objectql` re-exports it unchanged.

  ADR-0062 D5 is amended with the new criterion and the shared flag.

  **Migration.** No change for a correctly configured deployment — a datasource that
  connected before still connects. A deployment that was _silently_ booting with a
  dead, explicitly-bound datasource now fails the boot instead, naming the
  datasource, the cause, and the objects that depend on it; fix the datasource
  configuration. To keep booting without it — deliberately, knowing every request
  touching those objects will fail — set `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.

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

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0

## 16.0.0

### Minor Changes

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

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
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

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

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

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
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

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1

## 15.1.0

### Minor Changes

- f531a26: Generic pinyin search recall (#2486, ADR-0098): a locale-gated
  `OS_SEARCH_PINYIN_ENABLED` switch (auto-on when the stack configures any
  `zh-*` locale) provisions a hidden `__search` companion column for each
  object's display/name field at compile time, the new
  `@objectstack/plugin-pinyin-search` fills it with full pinyin + initials
  ("张伟" → "zhangwei zw") on before-save (plus boot backfill and a
  `rebuildSearchCompanion` reconcile entry), and `$search` ORs the column in at
  query time — so lookup pickers, list quick-search and ⌘K transparently match
  `zhangwei` / `zw` against CJK names. Purely additive: `resolveSearchFields`,
  `searchableFields`, drivers and non-Chinese deployments are untouched; FLS
  restricted / secret / PII fields never feed the companion.

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

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0

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

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0

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

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0

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

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0

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

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- 795b6d1: refactor: single-source the multi-org (`OS_MULTI_ORG_ENABLED`) flag resolution

  "Is this deployment multi-org?" was resolved in 10 places across 8 packages
  with three subtly different inline expressions:

  - the canonical `String(readEnvWithDeprecation('OS_MULTI_ORG_ENABLED',
'OS_MULTI_TENANT') ?? 'false').toLowerCase() !== 'false'` (objectql registry,
    plugin-dev, runtime app-plugin, cli serve/verify, cloud-connection),
  - a redundant `env.OS_MULTI_ORG_ENABLED !== undefined ? … : …` variant in
    plugin-auth (auth-manager `/auth/config` features + `beforeCreateOrganization`
    guard),
  - and a bare `process.env.OS_MULTI_ORG_ENABLED ?? process.env.OS_MULTI_TENANT`
    read in the SQL driver's `isMultiTenantMode()` — which skipped the
    `OS_MULTI_TENANT` deprecation warning every other site emits.

  Because the SQL driver computed the mode independently of the auth/security
  layer, the driver's tenant-audit gate and the rest of the system could in
  principle disagree about whether tenant isolation is active.

  Introduces `resolveMultiOrgEnabled()` in `@objectstack/types` (next to
  `readEnvWithDeprecation`, the natural leaf dependency) as the single source of
  truth, and routes all 10 sites through it. `@objectstack/driver-sql` gains a
  direct `@objectstack/types` dependency (previously it read `process.env`
  directly).

  Behaviour is unchanged everywhere except the SQL driver, which now also emits
  the one-shot `OS_MULTI_TENANT`-is-deprecated warning — consistent with every
  other site. This mirrors the `resolveAuthzContext` single-source pattern in
  `@objectstack/core`. Follow-up (not in this change): a lint gate forbidding new
  inline reads of these env vars outside the helper.

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
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0

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

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1

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

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0

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

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

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

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1

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

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0

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

  - @objectstack/spec@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11

## 1.0.10

### Patch Changes

- @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8

## 1.0.7

### Patch Changes

- @objectstack/spec@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/spec@1.0.4

## 1.0.3

### Patch Changes

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

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2

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

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1

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

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.3.2

## 0.3.1

### Patch Changes

- @objectstack/spec@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

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

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
