# @objectstack/driver-turso

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
  - @objectstack/driver-sql@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

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

- 05bb200: feat(driver-turso): remote 模式补上 canonical 时间列 backfill 通道(分批、可恢复、完成标记) (#5770)

  `SqlDriver.backfillCanonicalDatetimes` / `backfillCanonicalTimes` 是 Knex 路径,
  remote 模式的 DDL 与 CRUD 全部走 `@libsql/client`,永远到不了它们。于是
  `canonicalDatetimeFields` / `canonicalTimeFields` 在 remote 恒空,
  `needsLegacyDatetimeRepair` 恒为 true。在 `origin/main`(`d82b85fee`)上实测:

  ```
  canonicalDatetimeFields['probe']            -> undefined
  needsLegacyDatetimeRepair('probe','at')     -> true
  temporalFilterColumnSql('probe','at','"at"')
    -> (case when typeof("at") in ('integer','real')
          then strftime('%Y-%m-%dT%H:%M:%fZ', "at"/1000.0, 'unixepoch')
          else coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', "at"), "at") end)
  ```

  每一次对 `Field.datetime` / `Field.time` 的 filter 都编译成这个表达式 —— 正确,但
  **不可索引**。local 跑完 backfill 能退回 `col >= ?`,remote 此前没有这个出口,
  代价是永久的(cloud#1005 后果 A)。

  **后果 B 实测比原单描述更尖锐。** `RemoteTransport.mapFieldTypeToSQL` 把时间列声明为
  TEXT,#942 之前的 remote 写路径原样透传数字,于是 epoch 毫秒落盘成
  `'1753660800000.0'`。共享修复表达式按 `typeof(col) in ('integer','real')` 分派,
  TEXT 亲和列永不命中该支;`strftime` 也解析不了这串数字,`coalesce` 把原值还回来 ——
  该行是修复表达式的**不动点**,永远转不过来,并且按 TEXT 比较。原单记为「任何 filter
  都匹配不到」;实测是**更坏**的形态 —— `'1753660800000.0'` 字典序排在所有 `'2…'`
  之前,所以该行既被自己所属的窗口漏掉,又被并不包含它的窗口命中:

  ```
  where at between '2025-07-01T…' and '2025-08-01T…'  -> ['ok']            (legacy 行丢失)
  where at <= '2030-01-01T…'                          -> ['legacy','ok']   (不该命中却命中)
  ```

  ## 本次落地(维护者 2026-08-03 裁定的方案 1)

  新增 `remote-canonical-backfill.ts` 与
  `TursoDriver.backfillRemoteCanonicalTemporal()`,在 remote 的 `initObjects` /
  `syncSchema` 之后自动运行 —— 与 local 在 `initObjects` 里调用 backfill 的位置对应:

  - **分批**:每条 `UPDATE` 至多改 `batchSize` 行,借
    `rowid IN (SELECT … LIMIT ?)` 子查询限量(`UPDATE … LIMIT` 需要 libSQL 不保证的
    编译选项)。
  - **可恢复**:不需要任何断点状态。WHERE 守卫本身就是断点 —— 它选中的正是尚未
    canonical 的行,中断在任何位置都不回滚已转换的行,下次从余量继续;已收敛的列
    重跑只花一条语句、零写入。
  - **完成标记**:只有在收尾探针测到「两个阶段都无事可做」时才标 canonical,写进
    `canonicalDatetimeFields` / `canonicalTimeFields` —— 与 local 完全相同的消费点
    (`needsLegacyDatetimeRepair`),因此两种 transport 靠同一条规则拿回可索引形态。
    被批次预算截断或报错的列**不标记**,保留读侧修复。
  - **后果 B 的可解部分**:对元数据声明为 `Field.datetime` / `Field.time` 的列,把
    纯数字文本按 `cast(col as real)` 喂回**驱动自己的**表达式(typeof 变成 'real',
    于是走它原本的 integer/real 分支)。因此本仓不新增第二套 epoch 转换规则。
  - **不可解残留如实记录**:只解释 1e12 ≤ v < 4102444800000(2001-09-09 ~ 2100-01-01)
    的值。下界是为了让 epoch **秒**永不入界 —— 2100 年前的秒值最大约 4.1e9,若按毫秒
    解释会把 `'1753660800'`(2025-07-28)静默改写成 1970-01-21,实测确认。界外的行
    原样留在盘上并计入 `unresolvedEpochTextRows`,不猜。

  方案 2(DDL 亲和性对齐)按裁定等 staging 存量探针另议,不在本次范围;方案 3(在
  `@objectstack/driver-sql` 公共表达式里加启发式)维护者已否决 —— 上面的恢复限于
  一次性迁移、且只作用于元数据声明为时间类型的列,与那条被否决的读路径启发式不是
  一回事。

  ## 正确性姿态不变(ADR-0053 D-B3 / cloud#1003)

  backfill 是**性能出口,不是正确性前提**。读写路径不依赖它跑过:任何失败(远端不可
  达、标识符非法、预算耗尽)都只导致该列不被标记、读侧继续带修复、答案照旧正确,
  且不会让 boot 失败。新增 20 条用例覆盖两个后果、分批/断点续跑/失败中断、完成标记
  的三个门、不可解残留、以及「标记与不标记答案一致」的 D-B3 断言。

  `turso-remote-temporal-conformance.test.ts` 的两条 legacy sweep 现在显式清除
  canonical 标记(与 driver-sql 的 `LegacyStorageDriver.forgetCanonical` 同一做法),
  并断言修复确实仍在生效 —— 此前 remote 「未 backfill」是因为压根没有 backfill 而
  **碰巧**成立,现在它是 fixture 必须自己声明的状态。

### Patch Changes

- d82b85f: fix(driver-turso): remote 模式拒收条件层的 `$`-算子键 —— 不再编译成静默空集/全表写 (#5769)

  `RemoteTransport.buildWhereSQL` 只认 `$and` / `$or` / `$not` 三个组合算子;条件
  层其余任何 `$` 开头的键都掉进**字段路径**,被双引号引成一个**列名**。在
  `origin/main`(`5c94f833c`)上用捕获客户端 + 三行 fixture 实测:

  ```
  { $eq: 'won' }                 → SELECT * FROM "deal" WHERE "$eq" = ?         → []
  { $gt: 5 }                     → SELECT * FROM "deal" WHERE "$gt" = ?         → []
  { $where: 'return true' }      → SELECT * FROM "deal" WHERE "$where" = ?      → []
  { $and: 'x' }                  → SELECT * FROM "deal" WHERE "$and" = ?        → []
  { $or: [{}, { $where: 'x' }] } → SELECT * FROM "deal"(整句没有 WHERE)        → 全部三行
  ```

  前四行是**静默空结果集**:SQLite 的向后兼容规则把「解析不到列的双引号标识符」
  降级成字符串字面量,于是语句编得出、跑得通、一行不匹配 —— 和「确实没有匹配的
  行」在调用侧完全无法区分(在关掉该规则的构建上,`find()` 自己的 `no such column`
  兜底也会把它吞成 `[]`,两条路一个答案)。

  第五行不依赖任何方言怪癖,也是代价最大的一种:`{}` 是 `$or` 的 TRUE 单位元,
  整组被吸收,连同它那个畸形兄弟已经编出来的子句一起被丢掉,语句**整个丢掉了
  WHERE**。读路径上这是把过滤器本要排除的行原样交还;`deleteMany` / `updateMany`
  上这是**全表写** —— 实测三行全部被一个一行都没点名的过滤器改写。

  现在:条件层任何非 `$and`/`$or`/`$not` 的 `$` 键,在 find / findOne / count /
  aggregate / deleteMany / updateMany 六个建 WHERE 的入口上一律以
  `INVALID_FILTER` / 400 响亮拒收,且**不发出任何语句**。消息分两种 —— 是字段算子
  写高了一层(`$eq`/`$gt`/…)就指路 `{ <字段名>: { <算子>: <值> } }`;协议根本没
  声明的键(`$where`/`$nor`/`$expr`/`$elemMatch`)就点名拒收。声明正确但值不是数组
  的 `$and` / `$or`(`{ $and: 'x' }`)同样落在这个闸里,按「需要条件数组」拒收 ——
  它此前从两个 `Array.isArray` 判断底下漏进同一条字段路径,结局一模一样。

  这条规则本来就是 objectstack#5348 的裁定,PR #5368 已在 `SqlDriver` 的校验遍历
  (`reduceFilterKey`)落地,`driver-sqlite-wasm` 与 Turso **local** 继承。
  `RemoteTransport` 是独立的过滤器编译器,什么都继承不到,所以同一个
  `TursoDriver`、同一个过滤器,只因 `url` 不同就给两个答案,而且方向是反的:local
  严、remote 松。本次补的正是这最后一面,新增的 local/remote 一致性用例把这条叉
  钉死。

  合法过滤器一个字节都没变:三个组合算子的嵌套、`$and: []` / `$or: []` / `$not: {}`
  的布尔单位元、字段层算子、隐式相等、`IS NULL`,以及既有的六种拒收(未知字段算子、
  不可绑定比较值、空算子映射、非节点子过滤器、非节点顶层 `where`、非布尔 `$null`)
  各自的措辞,全部照旧。

- 8a2ea6c: driver-turso: remote mode answers the NULL / no-value family the way local mode does

  `TursoDriver` compiles filters two different ways: local (and replica) mode
  inherits `SqlDriver.applyFilterCondition`, remote mode uses
  `RemoteTransport.buildWhereSQL`, an independent emitter. The NULL rulings landed
  only on the first, so ONE driver gave one filter two answers depending on the
  `url` it was constructed with. Measured against a fixture with two valued rows
  and two no-value rows:

  | filter                          | local            | remote (before) |
  | ------------------------------- | ---------------- | --------------- |
  | `{ d: { $ne: 'v1' } }`          | rows 2,3,4       | row 2           |
  | `{ d: { $nin: ['v1'] } }`       | rows 2,3,4       | row 2           |
  | `{ d: { $notContains: 'v1' } }` | rows 2,3,4       | row 2           |
  | `{ $not: { d: 'v1' } }`         | rows 2,3,4       | row 2           |
  | `{ d: { $exists: 'yes' } }`     | `INVALID_FILTER` | rows 1,2        |

  Remote mode now matches local on all five:

  - **`$not` is NULL-safe** (#5146). Each leaf of the negated condition is made
    total before the negation, so `NOT (…)` is TRUE or FALSE for every row instead
    of vanishing into SQL's UNKNOWN. A row whose column has no value does not
    satisfy the negated condition, so it IS returned.
  - **`$ne`, `$nin` and `$notContains` are NULL-safe** (#5298), emitted as
    `(col IS NULL OR <test>)`. `$ne: null` is unchanged and still compiles to
    `IS NOT NULL` — polarity follows the comparand, not the operator's name — and
    no positive comparison changes shape.
  - **A non-boolean `$exists` comparand is refused** with `INVALID_FILTER` / 400
    (#5369), as `$null` already was. `@objectstack/spec`'s `FieldOperatorsSchema`
    declares `$exists` as a boolean, and the emitter's `=== false` test sent every
    other value — including the truthy string `"false"` — to the `IS NOT NULL`
    side. `$exists: true` / `$exists: false` are unchanged.

  Why it matters beyond a row count: a CEL `!expr` in a permission rule lowers to
  `{ $not: {…} }`, so this was one RLS read scope admitting different row sets per
  connection mode. The `$ne` and `$not` cases are now enrolled in the shared
  `FILTER_LOGIC_CASES` conformance table, which all eleven filter backends run.

  **Upgrade note:** a query that relied on remote mode silently dropping no-value
  rows from a negative filter will now see them. Spell that intent explicitly —
  `{ $and: [{ d: { $ne: 'v1' } }, { d: { $null: false } }] }` — which is what it
  already had to be on every other backend.

- a58c0b5: fix(driver-turso): remote 分页读补齐确定性排序，与 local 面共用同一条规则

  `TursoDriver` 在 remote 传输(`libsql://` / `https://` 等 URL)下的分页读不满足
  `IDataDriver.find` 的确定性分页 MUST：`RemoteTransport.buildSelectSQL` 把调用方的
  `orderBy` 原样拼进 SQL 后直接接 `LIMIT` / `OFFSET`，不追加任何唯一列，无序分页读
  更是完全不排序。SQLite 不承诺并列行在两条语句之间排布一致，所以表一大、计划一变，
  `ORDER BY status LIMIT 50 OFFSET 50` 翻页时就会有记录出现两次、另一条永远不出现 ——
  每一页都是满的、每一行都合法，从任何单个响应里都看不出来。

  同一个驱动的 local 面早已按 #4363 办事，于是一个驱动的两条传输对同一个分页查询给出
  不同的排序保证，而传输模式只由 URL 决定。

  修法是**复用**而不是复制：`TursoDriver.find` / `findOne` 现在通过继承来的
  `SqlDriver.orderKeysFor()` 解析出完整排序键再交给传输层，三态规则只有一份实现 ——

  | `orderBy` | 分页                | 结果                                       |
  | --------- | ------------------- | ------------------------------------------ |
  | 非空      | 任意                | 调用方的键 + `id`                          |
  | 空        | 有 `limit`/`offset` | 单独 `id`                                  |
  | 空        | 都没有              | 不加 ORDER BY（#4363 carve-out，原样保留） |

  `findOne` 的语义一并保住：它的 `limit: 1` 由传输层自己注入，若在 `buildSelectSQL`
  里判定就会被误读成「页大小为 1 的第一页」，从而给系统里最热的读加上
  `ORDER BY id LIMIT 1` —— 正是让计划器放弃谓词自身索引的形状。

  唯一列的判定沿用 local 面同样保守的前提：只有本驱动自己建的表才追加 `id`
  (`RemoteTransport` 建表时无条件写入 `"id" TEXT PRIMARY KEY`)；不是自己建的表保持
  原样并告警一次，绝不凭空发明排序列。

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
- Updated dependencies [06ba036]
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
- Updated dependencies [c7406b0]
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
- Updated dependencies [4addd9d]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [9c5abf4]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [f98fa65]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [193cd5c]
- Updated dependencies [5aae790]
- Updated dependencies [07f1822]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
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
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/driver-sql@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/driver-sql@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/driver-sql@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/driver-sql@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/driver-sql@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [4944f3a]
- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/driver-sql@6.7.0
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/driver-sql@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/driver-sql@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/driver-sql@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/driver-sql@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/driver-sql@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/driver-sql@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/driver-sql@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/driver-sql@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/driver-sql@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/driver-sql@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/driver-sql@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-sql@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/driver-sql@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/driver-sql@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [0cc0374]
- Updated dependencies [5b878d9]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/driver-sql@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/driver-sql@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/driver-sql@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/driver-sql@4.0.3

## 4.0.3

### Patch Changes

- fix: implement lazy connect in RemoteTransport to self-heal from serverless cold-start failures, transient network errors, or missed `connect()` calls. The transport now accepts a connect factory and auto-initializes the @libsql/client on first operation when the client is not yet available. Concurrent reconnection attempts are de-duplicated.

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/driver-sql@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 3.3.2

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/driver-sql@3.3.2

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/driver-sql@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- Updated dependencies [814a6c4]
  - @objectstack/driver-sql@3.3.0
  - @objectstack/spec@3.3.0
  - @objectstack/core@3.3.0
