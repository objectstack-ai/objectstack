---
"@objectstack/service-analytics": patch
---

fix(service-analytics): `contains` 以规范算子 `$contains` 送进引擎,比较值不再落进正则位置(#5557)

`ObjectQLStrategy.convertFilter` 在同一个 `switch` 里处理 LIKE 家族的四个算子。
其中三个(`notContains` / `startsWith` / `endsWith`)自 #4128 起就是规范 spec 算子,
只有 `contains` 是 `{ $regex: values[0] }` —— 比较值**原样**放进一个正则位置,不转义。

实测(修复前 → 修复后,引擎收到的 filter):

| `where` | 修复前 | 修复后 |
|---|---|---|
| `{stage: {$contains: 'a.b'}}` | `{stage: {$regex: 'a.b'}}` | `{stage: {$contains: 'a.b'}}` |
| `{stage: {$notContains: 'a.b'}}` | `{stage: {$notContains: 'a.b'}}` | 不变 |
| `{stage: {$startsWith: 'a.b'}}` | `{stage: {$startsWith: 'a.b'}}` | 不变 |
| `{stage: {$endsWith: 'a.b'}}` | `{stage: {$endsWith: 'a.b'}}` | 不变 |

三条后果,都是作者没有要求过的行为,且都不依赖 #4706 对 `$regex` 语义的裁决:

1. **`$regex` 不在契约里。** `filter.zod.ts` 的 `FILTER_OPERATORS` 声明 15 个算子,
   没有 `$regex` —— 这是**生产方**在发送 schema 未声明的算子。按 Prime Directive #12
   修生产方(一个 `case` 标签),而不是给消费方加宽容。
2. **同一棵过滤树在同包两个消费方之间不通。** `read-scope-sql.ts` 的
   `compileScopedFilterToSql` 也是一个 `FilterCondition` 消费方,`compileOperator`
   的 `default` 是 fail-closed,于是它对本策略产出的 filter 直接抛
   `unsupported operator "$regex" … (fail-closed)`。
3. **行结果取决于哪个驱动来答。** 把 `$regex` 当真正则求值的后端(driver-memory 的
   `memory-matcher.ts` 就是,而且是有意为之 —— 服务 plugin-auth 的 ObjectQL adapter)
   把 `a.b` 读成「a、任意一个字符、b」,于是 `axb` 也被匹配上;而 `50% (+)` 作为正则
   根本编译不过(`Nothing to repeat`),`catch` 之后 `return false` —— 一个**有匹配行**
   的筛选器静默返回零行,作者那边只看到「无数据」。同一个 `$contains` widget 在
   `driver-sql` 上则被编译成子串 LIKE:同一张 dashboard,不同驱动,不同行集。

`filter-normalizer.ts` 的 `MONGO_TO_CUBE_OP` 只把 `$contains` 映到 `contains`,
别无来源,所以这里回送 `$contains` 就是作者自己那个 key 的往返。

**测试**(`objectql-contains-canonical-operator.test.ts`,新增):引擎 filter 的算子键
逐个对 `filter.zod.ts` 的 `ALL_OPERATORS` 校验(取自 spec 而非手抄一份);行结果跑在一个
复刻 `memory-matcher.ts` 各 arm 的求值面上 —— `a.b` 只命中字面行、`50% (+)` 命中它该
命中的那一行且**恰好**只有那一行(修复前分别是多一行和空集);同一个 filter 再送进
`compileScopedFilterToSql` 确认它现在编译得过。只断言 filter/SQL 字符串会漏掉「不转义」
这一半,所以两半都断言。

顺带删掉 #5558(PR for #5333)在 `objectql-echo-operator-coverage.test.ts` 的替身引擎里
留下的那处 `$regex` → `$contains` 翻译:它存在的理由就是本单,现在没有了。那也是本修复
最直接的反向证据 —— 把 `case 'contains'` 退回 `$regex`,该文件的 `$contains` 行会以
上面第 2 条的 fail-closed 报错红掉。
