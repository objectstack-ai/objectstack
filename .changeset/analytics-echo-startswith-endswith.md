---
"@objectstack/service-analytics": patch
---

fix(service-analytics): `/analytics/sql` 回显补上 `$startsWith` / `$endsWith` 谓词(#5333)

`ObjectQLStrategy.generateSql` 是同一棵过滤树的**第三个**编译器 —— 输出给浏览器的
展示 SQL。它的 `buildFilterClauseSql` 显式处理 `set`/`notSet`/`in`/`notIn`/
`contains`/`notContains`,其余落到只有六个条目的 `SCALAR_SQL_OPS` 查表;
`startsWith` / `endsWith` 两处都不在,于是走到 `return null`,而**这棵树的每个编译器
都把 `null` 读成「本节点没有约束」**。结果:

| `where` | 实际执行(`NativeSQLStrategy`) | 修复前的回显 | 修复后的回显 |
|---|---|---|---|
| `{stage: {$startsWith: 'w'}}` | `WHERE stage LIKE $1` / `['w%']` | **没有 WHERE**,`params` 为空 | `WHERE stage LIKE $1` / `['w%']` |
| `{stage: {$endsWith: 'n'}}` | `WHERE stage LIKE $1` / `['%n']` | **没有 WHERE**,`params` 为空 | `WHERE stage LIKE $1` / `['%n']` |
| `{stage: {$contains: 'w'}}` | `WHERE stage LIKE $1` | `WHERE stage LIKE $1`(本来就对) | 不变 |

回显比实际执行的查询**更宽**。这个字符串存在的唯一理由就是复现执行 —— 文件自己在渲染
块顶上写着 “a rendering that contradicts execution is worse than no rendering” ——
所以一个带着「为什么这张图少了几行」来看回显的作者,拿到的是一条**没有该筛选条件**的
语句:跑一遍返回更多行,于是结论是「筛选器没生效」,而实际执行是生效的。与
#3601 / #3602 / #3650 同一类「回显与执行不一致」,只是这次是从**算子表**这一侧到达的。

不涉及越权或错行:该字符串从不执行(`execute()` 的 echo 会丢弃 `params`),损害限于
可调试性。

**两处修改:**

1. **LIKE 家族收进一张表。** 新增 `LIKE_SQL_OPS`,四个算子(`contains` /
   `notContains` / `startsWith` / `endsWith`)的 SQL 拼写与 pattern 并排放在一起,
   与 `NativeSQLStrategy.buildFilterClause` 的 `opMap` / `likePattern` 逐条对应 ——
   回显描述的正是那个编译器产出的语句,两张表并列摆着,漂移才看得见。
   `contains` / `notContains` 的产物一字未变。

2. **「渲染不了就静默丢」的出口改为 THROW。** `return null` 在这里与「无约束」同形,
   所以下一个新增算子会以同样的方式再丢一次。之所以**可以**抛错:上游算子词汇表是
   **封闭**的 —— `filter-normalizer.ts` 的 `fieldLeaves` 是叶节点的唯一生产者,它对
   `MONGO_TO_CUBE_OP` 之外的算子在建叶之前就以 `INVALID_FILTER` / 400 拒绝。因此任何
   调用方写出的过滤器都到不了这个出口;真到了,只能意味着 normalizer 的表新增了这里
   没有分支的算子,那是我们自己两张表漂移,而对此**唯一不能给的答案就是悄悄放宽作者的
   查询**。与 `convertFilter` 的 `default:` 分支在 #4128 做出的是同一个选择;刻意**不**用
   `invalidFilterError` 的 400 信封 —— 这不是调用方形状的错误。

**该 throw 出口今天从公共入口不可达,这一点是测过的、也是刻意报告的**:把它改回
`return null`(保留第 1 项修改)只会让它自己那一条断言变红,枚举断言和回显对照表
全部保持绿色。它是一个漂移探针,不是行为修复 —— 行为修复是第 1 项。

新增 `objectql-echo-operator-coverage.test.ts`:issue 那张对照表按**行结果**钉住
(回显语句在同一份 fixture 上真的被执行,行 id 与查询实际返回的行 id 比对 —— 丢掉的
谓词藏不住,它返回的正是筛选器排除掉的行),再按 `filter.zod.ts` 的
`FILTER_OPERATORS` 枚举全部 15 个可编写算子,逐个断言回显渲染出谓词、且
placeholder 与 `params` 对齐。只断言 SQL 字符串会放过下一个未映射的算子 —— #4128 里
`$between` 就藏在 `$startsWith` 后面。
