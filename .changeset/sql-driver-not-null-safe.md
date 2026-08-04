---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `$not` 改为 NULL-safe —— 被比较列为 NULL 的行不再被否定条件静默排除

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
