---
"@objectstack/spec": minor
---

feat(spec): `$icontains` 入算子词表(ASCII 折叠域)、`$contains` 族钉死为大小写敏感、`$regex` 退役指引表(#5701)

#4706 维护者裁决 B 案的**契约半边**。本次只改声明,不改任何运行时行为:
五个后端今天怎么答,落地后还怎么答。驱动侧下译归 #5702,`$regex` 唯一活生产者的
翻转归 #5710。

## 1. 新增 `$icontains` —— 折叠域是 ASCII,不是 Unicode

`StringOperatorSchema` / `FieldOperatorsSchema` / `Filter<T>` 新增 `$icontains`:
忽略大小写的子串包含,**只折叠 `A-Z` 与 `a-z`**。

```ts
{ name: { $contains:  'acme' } }   // 大小写敏感:匹配 "acme corp",不匹配 "ACME Corp"
{ name: { $icontains: 'acme' } }   // 折叠 ASCII 大小写:两者都匹配
```

**边界必须说清楚:`café` 不匹配 `CAFÉ`。** ASCII 以外一律按字面比较。
选 ASCII 而非全 Unicode,是因为它是五个后端唯一都能真兑现的折叠域 ——
无 ICU 的 SQLite(`driver-sqlite-wasm` / `driver-turso` 跑的就是它)的
`LOWER()` 与 `LIKE` 只折叠 ASCII,承诺 Unicode 等于承诺三个后端做不到的事,
那正是 #4706 用来否决「五后端真正则」的同一条判据。

比较值一律**字面量**:`%` / `_` 不是 LIKE 通配符,`.` / `*` 不是正则元字符 ——
`{ name: { $icontains: 'a.b' } }` 匹配 `a.b`,不匹配 `axb`。

## 2. `$contains` / `$notContains` / `$startsWith` / `$endsWith` = 大小写敏感

这条**取代**了 `filter.zod.ts` 里那句已记录的声明(Prime Directive #13,
取代记录写在原处):

> Note: Case sensitivity should be handled at backend level.

那不是漏写,是写下来的「不保证」,实测代价是同一个算子三种答案:
`driver-memory` 的参考匹配器与 `formula` 大小写敏感,`driver-mongodb` 硬编码
`$options: 'i'` 全 Unicode 不敏感,SQL 家族看方言(SQLite 折叠 ASCII、
Postgres 不折叠、MySQL 看 collation)。作者无法从算子名判断自己拿到哪一种。

**迁移**:此前依赖某后端偶然大小写不敏感的 `$contains` 查询,应改写为
`$icontains`。行为在 #5702 落地前不变,所以这是一次可以提前做的改写,不是断裂。

## 3. `$regex` / `$options` 退役 —— 指引表 `RETIRED_FILTER_OPERATORS`

`$regex` 从来不在 `FILTER_OPERATORS` 里,却有一个生产者、四个消费者,而且各读各的:
`driver-sql` 编译成 LIKE 转义后的子串匹配(`a.b` 只匹配字面 `a.b`),
`driver-memory` 当真正则求值(`a.b` 还匹配 `axb`;模式非法则被 `catch` 成零行,
无声)。真正则在五后端不可实现 —— `driver-turso` 的 remote 线协议无法注册
SQLite `REGEXP` 函数。

新增 `RETIRED_FILTER_OPERATORS`(**纯数据**,不引入任何拒收行为),
给出逐条处方,供五个既有拒收点引用同一句话:

| 原写法 | 改写为 |
|:---|:---|
| `{ name: { $regex: 'acme' } }` | `{ name: { $icontains: 'acme' } }` |
| `{ name: { $regex: 'acme', $options: 'i' } }` | `{ name: { $icontains: 'acme' } }` |
| `{ name: { $regex: '^acme' } }` | `{ name: { $startsWith: 'acme' } }` |
| `{ name: { $regex: 'acme$' } }` | `{ name: { $endsWith: 'acme' } }` |

真正需要正则的查询没有 filter 层替代物:用已声明算子收窄,再在应用代码里匹配。

## 4. 新姊妹 case-set `FILTER_TEXT_CASES`

`filter-text-conformance.ts` —— 大小写折叠、字面比较值、`$regex` 拒收的共享标准,
带 `expectRejection` 判别式(`FILTER_LOGIC_CASES` 刻意没长出来的那个形状,
其表头三条章程原样保留)。五个 driver 各记一条**实测** DEBT 台账,指向 #5702。

## 什么**没有**变

`$icontains` 暂不进 `FILTER_OPERATORS`。那个数组不是词表而是运行时白名单 ——
`driver-memory` 的 `SUPPORTED_FIELD_OPERATORS` 由它派生。实测:提前把
`$icontains` 放进去,该驱动的形状门禁就不再拒收它,而匹配器没有对应分支,
`match({name:'zzz'}, {name:{$icontains:'acme'}})` 返回 `true` —— 谓词被静默丢弃,
全表命中。谓词被丢不是收窄而是**放大**,在 RLS 读作用域上是越权读(#3948)。
所以它随 #5702 的实现一起入列,`filter-operator-vocabulary.test.ts` 把这处差异
钉死为恰好 `{ $icontains }`,清偿时该断言会红,提醒作者一并删掉过渡说明。
