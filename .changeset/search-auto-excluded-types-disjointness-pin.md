---
"@objectstack/spec": patch
---

fix(spec): 把 `$search` 自动默认集三个类型词表的「互不相交」钉成受检事实 (#6934)

`packages/spec/src/data/search-fields.ts` 的 `autoDefaultFields` 先测一遍
`SEARCH_AUTO_EXCLUDED_TYPES` 的**否定**守卫，紧接着才是
`SEARCHABLE_TEXTUAL_TYPES` / `SEARCHABLE_ENUM_TYPES` 的**肯定**白名单。三个集合
今天两两不相交，所以那行否定守卫改变不了任何一次判定 —— 在完整的 56 个字段类型
域（`FieldType` 枚举 ∪ 三个词表 ∪ 域外探针）× 9 种调用形态 = 504 次解析上逐一比对，
删掉它与保留它的结果**逐字节相同**。本次改动因此**不改变任何行为**。

**保留该行，而不是退休它。** 判据是构造出来实测的，不是判断的：给
`SEARCHABLE_TEXTUAL_TYPES` 补一个已在排除集里的类型（`json`），两种形态给出的是
**方向相反、同样沉默**的两种解决 —— 有守卫时该类型被悄悄踢出扫描（fail closed），
没守卫时肯定列表获胜，该类型不仅进入自动默认集，还顺带进入上一层 #4254 的 ingress
allow-list，于是 `$searchFields=<该字段>` 从「拒绝」翻成「接受」，正是 #4483 为 `id`
关掉的那类放宽。排除集里写着 `secret` / `password` / `encrypted` / `vector`，
fail open 意味着对被脱敏或重量级列做 `$contains` 子串扫描。所以那行不是安全网
（两个方向都不出声），但它是**更安全的那个平局裁决**。

**真正堵住这一类的是钉子。** `search-fields.test.ts` 新增：三个词表两两不相交的
断言，加上两个方向的行为断言（排除集成员必被拒、白名单成员必被纳）。任一方向出现
重叠都会变红，且没有任何单点放宽能让它变成空转 —— 已用临时重叠实测两种形态各自
变红。同时补充：两个肯定列表之间也必须不相交，因为引擎侧
`fieldClausesForTerm` 先分支到 `SEARCHABLE_ENUM_TYPES`，同时命中的类型只会走
option label 映射、永远不会按原文 `$contains` 检索。

守卫处的注释如实写明它是 redundant-by-construction、不承重、以及保留它买到的是
哪个方向，避免下一位作者把它读成「新增可搜索类型时必须同步维护排除集」的规则。
