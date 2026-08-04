---
"@objectstack/service-analytics": patch
---

fix(service-analytics): 分析查询的 RLS read scope 不再被 `{ $not: {} }` 整表放行,`$not` 改为 NULL-safe

**这是一次安全相关的行为变更,涉及分析查询的可见行集合。请读完再升级。**

### 变更一(要害):`{ $not: {} }` 的 read scope 以前**完全不加 WHERE**,整表可见;现在是零行

`read-scope-sql.ts` 是 RLS / 租户 read scope 降解成 SQL 的**唯一**通道(ADR-0021 D-C),
被 `NativeSQLStrategy.applyReadScope` 与 `ObjectQLStrategy` 用来给分析查询加可见性约束。
它以空字符串表示「无约束」(布尔常量 TRUE)。`compileNode({})` 返回空串,于是:

```
compileNode({}) → ''  →  if (inner) 为假  →  $not 不产出任何子句
                      →  compileScopedFilterToSql 返回 ''
                      →  applyReadScope 的 `if (!sql) return;` 接手
                      →  生成的 SQL 里没有 WHERE
```

一条语义为 `NOT TRUE ≡ FALSE`(**什么都不给看**)的 read scope,实际效果是**整张表都给看**。
同一段循环里 `$and` / `$or` 的空数组一直是 fail-closed 抛错的,只漏了 `$not` 这一格。

修复后 `{ $not: {} }` 编译为恒假子句 `1 = 0`,`applyReadScope` 照常拼进 WHERE,返回零行 ——
与 driver-sql 在 #5134 / PR #5243 上的口径一致。

**升级影响:** 如果你的 RLS 策略(或 `cel-to-filter.ts` 降解出的 CEL 规则)在某条路径上
产出过 `{ $not: {} }`,该对象的分析查询此前是**无边界**的,现在会返回零行。行数从「全部」
掉到「零」不是本次引入的收紧,而是那条策略本来就该有的答案 —— 请核对策略本身。

同源、方向相反的一处一并修正:`$or` 的空析取项 `{}` 以前被 `.filter(s => s.length > 0)`
丢掉,`{ $or: [{}, { a: 1 }] }` 收紧成 `a = 1`。`{}` 是 TRUE 析取项,TRUE 吸收整个析取,
所以现在整条 `$or` 为 TRUE(无约束)。被丢弃分支的绑定值同时被丢弃 —— 否则 `params` 里
会留下没有 `?` 消费的值,把后面每一个占位符都错位到别人的值上。

### 变更二:`$not` 改为 NULL-safe

SQL 是三值逻辑,`WHERE` 只保留 TRUE,所以裸 `NOT ("t"."stage" = ?)` 会把 `stage IS NULL`
的行整批丢掉;`driver-memory`、`formula` 以及 #5296 之后的 `driver-sql` 都**返回**这些行。
同一条 read scope,普通查询与分析查询给出不同的可见集合。#5146 已由维护者判定以 JS 家族的
答案为准,本次把这个编译器对齐过去 —— 它是仓内最后一个按三值逻辑回答 `$not` 的 SQL 家族实现。

`$not` 的操作数在取反前先被改写成**全域(total)谓词**:

```sql
-- 之前
NOT ("t"."stage" = ?)
-- 现在
NOT (("t"."stage" IS NOT NULL AND "t"."stage" = ?))
```

守卫**下推到每个叶子**而不是挂在 `NOT` 旁边:操作数一旦嵌套(`$not` 里套 `$or`),顶层的
`OR col IS NULL` 会把 JS 家族排除的行重新放进来。守卫方向**逐算子**判定,不是一刀切 ——
`{ $not: { a: { $ne: 5 } } }` 语义是「a 就是 5」,无条件加 `OR a IS NULL` 会把 scope 排除的
行交回去,正是本次要避免的静默放松。所以 `$ne` / `$nin` / `$notContains` 用
`col IS NULL OR (…)`,`$eq` / `$in` / `$gt` / `$between` / `$contains` 一族用
`col IS NOT NULL AND (…)`,而 `$null` / `$exists` / `$eq: null` / `$ne: null` 本就是全域谓词,
一个字节都不加。

**升级影响:** 形如 `{ $not: { stage: 'won' } }` 的 read scope,以前**不返回** `stage` 为
NULL 的行,现在**返回**它们 —— 分析查询的行数与图表数值会随之变化。这是把分析侧对齐到其余
后端,不是新增的放宽。

### 不变的部分

`$not` 路径以外一个字符都没动:普通比较仍然编译成原样的 SQL。fail-closed 的全部保证原封不动
——未知算子、嵌套关系值、裸数组、不安全标识符、非 filter 节点的 `$not` 操作数,以及
`$and: []` / `$or: []` 的空组合子(那一格是 #5322 的独立裁定)统统照旧抛错。
