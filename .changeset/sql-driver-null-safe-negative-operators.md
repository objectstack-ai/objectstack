---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `$ne` / `$nin` / `$notContains` 改为 NULL-safe;`$exists` 的非布尔比较值改为拒收

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
