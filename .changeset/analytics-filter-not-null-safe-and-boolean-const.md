---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: 分析查询的 `where` —— `$not` 变 NULL-safe、`{$not:{}}` 变零行、`$or` 的 `{}` 析取项不再被丢 (#5325)

`filter-normalizer.ts` 的 `buildNode` 是这个包里**第二份**同缺陷拷贝:第一份
(`read-scope-sql.ts` 的 `compileNode`,RLS 读作用域)已由 #5297 修好,而这一份编译的是
**作者自己写的 `where`** —— dashboard widget / dataset 的筛选器。两者是各自独立的函数,
所以那一单合入后这三条仍然在。以 `driver-sql` 同一份 fixture 实测(4 行,行 3、4 的
`stage` 为 NULL,行 3 的 `amount` 为 NULL,行 4 的 `owner` 为 NULL):

| widget 的 `where` | 改前取到的行 | 改后(= driver-memory / formula / #5296 后的 driver-sql) |
|---|---|---|
| `{ $not: { stage: 'won' } }` | `2` | `2,3,4` |
| `{ $not: { stage: { $in: ['won'] } } }` | `2` | `2,3,4` |
| `{ $not: {} }` | **全表** | **零行** |
| `{ $or: [{ stage: 'won' }, {}] }` | `1` | 全表 |
| `{ $not: { $or: [{stage:'won'},{owner:'u1'}] } }` | `2` | `2,4` |

**这是可观察的行为变更,不是内部重构 —— 已有的图表数值会变:**

- **`{$not: {}}` 的 widget 此前画的是整个数据集,现在是零行。** `buildNode({})` 返回
  `null`(= 无约束 = TRUE),`$not` 分支的 `if (inner)` 因此为假,整条 `$not` 消失,
  WHERE 一个字都不发 —— 一条意思是「什么都不显示」的筛选器显示了全部。`NOT TRUE ≡ FALSE`,
  现在它编译成 `1 = 0`。
- **`$not` 下 NULL 行的去留变了,所以图上的数字会变。** SQL 是三值逻辑而 `WHERE` 只保留
  TRUE,裸 `NOT (stage = ?)` 把 `stage` 为 NULL 的行全部丢掉;`driver-memory`、`formula`
  和(#5296 之后的)`driver-sql` 都把它们算进来。同一条 widget filter,在分析查询和普通
  `find()` 上给出不同的行集,取决于哪个后端接住它。#5146 已拍板 JS 家族的答案为准,本次
  按同一口径把守卫**下推到叶子**(`{col: {$null: false}}` / `{$or: [{col:{$null:true}}, …]}`,
  极性逐算子决定)。**受影响的图表数值会上升**(负向筛选现在包含空值行)。
- **`$or` 里的 `{}` 析取项不再被丢。** TRUE 是 AND 的单位元但**吸收** OR,所以
  `{$or: [{stage:'won'}, {}]}` 整条为 TRUE;此前它被 `.filter(n => n !== null)` 丢掉,
  查询被静默**收紧**成剩余分支。
- **空集合是布尔常量,不再是「没有谓词」。** `{stage: {$in: []}}` 此前编译成空子句
  → 无约束 → 画全表,现在是零行(`1 = 0`);`{$nin: []}` 不排除任何行。
- **两处新的响亮拒收(此前静默放宽):** `$not` / `$or` / `$and` 的**非对象**操作数
  (`{$not: null}` 曾整条消失 → 等于不筛),以及**零个操作符的字段约束** `{a: {}}`
  —— 后者按 #5240 的拍板拒收,与 driver-sql / driver-memory / formula 一致;不这么做的话,
  「TRUE 吸收 OR」会把 `{$or: [{a: {}}, {b: 2}]}` 从 `b = 2` 放宽成全表。

实现落在 normalizer 而不是某个 strategy:守卫在这一层是**结构**(多一个 `$null` 合取项),
经 `filterNodeToCondition` 交给 ObjectQL 引擎后在**任何驱动上都成立**,包括本身不 NULL-safe
的那些;只加在 raw-SQL 那条路径,等于说「分析查询的 `$not` 是什么意思取决于哪个驱动接住它」。
代价是引擎路径会**双重加守卫**,已实测幂等(`NOT (c IS NOT NULL AND (c IS NOT NULL AND c = v))`
与单层等价),只是 SQL 多一层冗余谓词。

`NormalizedFilterNode` 因此新增布尔常量 kind —— 该联合此前只有 `leaf | and | or | not`,
没有 FALSE 的表示法,这正是 `{$not:{}}` 只能编译成「什么都不发」的根本原因。三个编译器
(`native-sql-strategy.compileFilterNode`、`objectql-strategy.filterNodeToCondition`、
回显给浏览器的 `renderFilterNodeSql`)各自实现它;引擎路径用的是 `{$not: {}}`,即
driver-sql / formula / driver-memory 参考匹配器早已钉住的零行写法(#5134),没有另造第二种。

`$and: []` / `$or: []` 的空组合子**不在本次范围**,仍然 fail-closed 抛错(独立裁定见 #5322),
并已加用例钉在抛错这一侧。
