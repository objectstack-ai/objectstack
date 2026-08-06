---
"@objectstack/formula": patch
---

fix(formula): `matchesFilterCondition` 的 `$exists` 改读「有值」,与 `$null` 成严格互补

**行为变更,影响 RLS 写侧 `check` 的判定。** `{ x: { $exists: true } }` 对
`{ x: null }` 以前答 `true`(键存在),现在答 `false`(没有值)。

`matchesFilterCondition` 是 RLS `check` 子句(insert/update 的 post-image)的求值器 ——
写路径上没有查询可以下推,只能逐记录判定。它此前把 `$exists` 读成「键是否存在」
(`actual !== undefined`),而 `driver-sql` 一直把同一个算子编译成 `IS NOT NULL`。
于是同一条规则里的 `$exists`,写侧放行的记录读侧看不见。

2026-08-06 裁定取「有值」,理由是另一种读法在最要紧的地方**无法兑现**:SQL 里列
**就是** schema,一行不可能「缺一个键」,所以 `driver-sql` 除了 `IS NOT NULL` 别无
可编译的东西。字段的存在性是 **schema** 的属性,不是**记录**的属性;spec 若声明
「键是否存在」,就是在承诺两个后端永远交付不了的语义。因此 `driver-sql` 的发射器
一字未动,移动的是本求值器。

对齐之后 `$exists` 与 `$null` 在每个后端上都是严格互补:
`$exists: true` ≡ `$null: false`,`$exists: false` ≡ `$null: true`。
「键缺失」与「值为 null」在这里是同一个事实 —— 这也正是 `getPath` 对两者本来就
返回同一个 `undefined` 的原因。

`$ne` / `$nin` / `$notContains` / `$null` 四个算子本来就是本次裁定的目标语义,
一字未改。
