---
"@objectstack/driver-sql": minor
"@objectstack/driver-memory": minor
"@objectstack/formula": minor
---

fix(driver-sql,driver-memory,formula)!: `{ field: {} }` 一律拒收 —— 零个操作符的字段约束不再在四个后端有三个答案 (#5240)

`{ a: {} }`(一个字段,后面跟零个操作符)是 `FilterConditionSchema` 今天**声明合法**的形状,
而同一个 filter 在同仓四条路径上有三个答案:

| 路径 | 改前 | 改后 |
|---|---|---|
| `driver-sql`,顶层 plain map | 抛 `INVALID_FILTER`(#5041 的比较数闸门) | 抛 `INVALID_FILTER`(专用消息) |
| `driver-sql`,`$and`/`$or`/`$not` 内 | 遍历零个操作符 → 不产出任何 SQL → **TRUE(匹配全表)** | 抛 `INVALID_FILTER` |
| `driver-memory` | 实时路径经 mingo 变成「字段深等于空文档」;参考匹配器落到 `JSON.stringify` 结构相等 → 顺带 FALSE | 抛 `INVALID_FILTER` |
| `@objectstack/formula` | `keys.length === 0` 显式 fail-closed → FALSE | 抛 `INVALID_FILTER` |

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

| `check` 策略 | 改前 | 改后 |
|---|---|---|
| `{ a: {} }` | FALSE → 写入被拒(403) | 抛出 → 该次写入失败(400) |
| `{ $or: [ { a: {} }, { owner: '{userId}' } ] }` | FALSE 被另一析取项吸收 → 写入**放行** | 抛出 → 该次写入失败 |
| `{ $not: { a: {} } }` | `!false` → 写入**放行** | 抛出 → 该次写入失败 |

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
