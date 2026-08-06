---
"@objectstack/service-analytics": patch
---

fix(service-analytics): read scope 的 `$ne` / `$nin` / `$notContains` 改为 NULL-safe,与写侧 `check` 对齐

**这是一次安全相关的行为变更,涉及分析查询的可见行集合。**
read scope 里的 `{ stage: { $ne: 'won' } }` 以前**不返回** `stage IS NULL` 的行,
现在**返回**它们。`$nin` / `$notContains` 同理。

`read-scope-sql.ts` 是 RLS / 租户 read scope 降解成 SQL 的唯一通道(ADR-0021 D-C)。
它此前把这三个算子编译成裸的 `col <> ?` / `col NOT IN (…)` / `col NOT LIKE ?`,
而 SQL 是三值逻辑:被比较列为 NULL 时谓词是 UNKNOWN,`WHERE` 只保留 TRUE,于是
「该列没有值」的行被整批丢掉。

**为什么必须与 `driver-sql` 同一个 PR 落地,而不是排到下一批。** 同一条 RLS 规则被
写一次、在**两侧**求值:读路径由本文件降解成 SQL,写路径由 `formula` 的
`matchesFilterCondition` 逐记录求值。`formula` 一直用两值 JS(`undefined !== 'won'`
为真)返回这些行。只对齐其中一侧,得到的不是「更小的修复」,而正是那个缺陷本身 ——
一条权限规则准入两个不同的行集,写侧允许的记录读侧看不见。

```sql
-- 之前
"t"."stage" <> ?
"t"."stage" NOT IN (?)
"t"."stage" NOT LIKE ? ESCAPE ?
-- 现在
("t"."stage" IS NULL OR "t"."stage" <> ?)
("t"."stage" IS NULL OR "t"."stage" NOT IN (?))
("t"."stage" IS NULL OR "t"."stage" NOT LIKE ? ESCAPE ?)
```

括号不是排版:`compileField` 用裸 ` AND ` 连接同一字段的多个算子,不加括号的
`col IS NULL OR …` 会比那个 AND 结合得更松,从而**静默放宽整条 scope**。

与 `driver-sql` 一样统一用 OR 展开而非方言等价物(`NOT LIKE` 没有对应形式;SQLite
写法依赖本仓不锁定的引擎版本;实测执行计划相同)。正向比较逐字符不变,
`$ne: null` 仍是 `IS NOT NULL`(空值谓词,不是比较)。

`$not` 路径的逐叶守卫(#5146 / #5326)按原样保留,两条路径读同一张极性表。
`filter-normalizer`(Cube 面)不在本次范围内,归本裁决第二批。
