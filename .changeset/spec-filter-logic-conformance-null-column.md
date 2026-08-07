---
"@objectstack/spec": patch
---

feat(spec): `FILTER_LOGIC_ROWS` 新增可空列 `d`,`FILTER_LOGIC_CASES` 收入 `$null` 用例

跨后端 filter conformance 表此前**刻意不含**任何空值处理,自陈理由是「三值 SQL 引擎
与两值 JS 匹配器无法被同一个答案约束」。#5146(`$not`)与 #5298
(`$ne`/`$nin`/`$notContains`)两次裁定取消了这个前提:「该列没有值」现在有唯一的
跨后端答案,于是它和其他语义一样属于这张标准表。

**给第三方驱动作者的迁移要点。** `FilterLogicRow` 新增 `d: string | null`
(第 1-2 行有值,第 3-4 行为 NULL)。用这张表校验自建后端时:

- DDL / schema 声明里必须把 `d` 声明为**可空**。`NOT NULL` 列,或把 `null` 替换成
  `''` 的 seed,会让新用例因为**错误的原因**变绿 —— 这两条用例要测的恰恰就是
  「一行没有值」时发生什么,fixture 里没有这样的行就什么都没测到。
- 新增两条用例:`{d: {$null: true}}` → `['3','4']`,`{d: {$null: false}}` → `['1','2']`。
  互补的两条一起入表,是为了把 `$null` 钉成对整表的**划分**,而不是其中一半 ——
  这样一个 `NOT NULL` 的 fixture 列会响亮地失败,而不是安静地全绿。

单独开一列而不是把 `a` / `b` 挖空:`(a, b)` 的 2x2 真值表是「一对谓词被错误 OR 起来
必然多出 id」的依据,在它上面开洞会为了空值用例削弱每一条组合子用例。

同批订正了模块文档的两处事实错误:独立实现的计数由「五个」改为**七个**(补上
`driver-turso` 的 `RemoteTransport.buildWhereSQL` 与 `service-analytics` 的
`filter-normalizer` —— 两者都是手写发射器,#5298 实测它们对空值族的答案与其余五个
不同),以及原先「#5146 一族 every surface answers the same way」的说法(它漏掉了
turso remote,该分叉由 #5903 跟踪)。

`$ne` / `$not` 两条对应用例**尚未入表**:实测 `driver-turso` remote(#5903)与
`filter-normalizer`(本裁决第二批)还答不出来,而一条已知会红的用例不能强制任何裁决,
只会把别的车道的未完成工作变成这张表的失败。它们随各自的修复 PR 入表 —— 模块文档的
「RULED but not yet enrolled」小节里写好了实测矩阵与两个 blocker。
