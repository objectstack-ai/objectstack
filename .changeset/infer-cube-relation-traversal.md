---
"@objectstack/service-analytics": patch
---

fix(service-analytics): 即席推断的 Cube 把 `owner.region` 当成关系穿越,不再铸成基表列 `region` (#5739)

`inferCubeFromQuery` 为「没有注册 Cube 的自由查询」即席合成一个 Cube,并从查询提
到的字段里播种 `dimensions`。每个铸造点都先把成员过一遍 `stripPrefix` —— 一个把
**任何**点号名的首段剥掉的判定。对 `<cube>.` 限定符(`crm_account.industry` →
`industry`)这是对的;对**关系穿越**则不是:`owner.region` 被铸成
`dimensions.region = { sql: 'region' }`,一个**基表列**。下游 `lookupMember` 的
「plain second-segment」那一档随即命中它,**赶在**「synthetic relation traversal」
那一档把点号路径交给 JOIN 机制之前就返回了 —— 关系穿越被基表列遮蔽。

危害分两档,而更糟的是安静的那一档。当基表**恰好有同名列**时(`crm_account` 自己
就有 `region`),四个组合全部静默通过、无任何拒收:

```
① ObjectQL,  where: {'owner.region':'NA'} → executeAggregate 收到 {"region":"NA"}
② NativeSQL, where: {'owner.region':'NA'} → … FROM "crm_account" WHERE region = $1
③ ObjectQL,  dimensions: ['owner.region'] → groupBy: ["region"]
④ NativeSQL, dimensions: ['owner.region'] → SELECT region AS "owner.region" … GROUP BY region
```

行数与图表都是错的,而没有任何错误可读 —— ④ 尤甚:响应列名标着 `owner.region`,值
却来自基表,读者无法从结果里看出来。基表**没有**同名列时则落到 `400 INVALID_FIELD`
且点名 `region`,而调用方写的是 `owner.region`。

维护者 2026-08-06 裁定(issue #5739):即席路径**支持**关系穿越。铸造改为**原样**
(`dimensions['owner.region'] = { sql: 'owner.region' }`),真正的 `<cube>.` 限定
前缀(首段 == cube 名)仍然剥。这同时收敛了一处早有的分叉:同一个过滤器写成数组
(`[['owner.region','=','NA']]`)时铸不出 dimension,于是一直走 synthetic 档、一直
编出正确的 JOIN —— 两种写法现在逐字生成同一条语句。

**Observable behaviour change —— 若你按状态码告警/重试,或消费即席 cube 的元数据,
请读这一段。**

- **对象写法的点号 member 从「静默错列」/「`INVALID_FIELD` 指错名」变为 JOIN 穿越。**
  NativeSQL 上 `where: {'owner.region': 'NA'}` 与
  `dimensions: ['owner.region']` 现在编出
  `LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id"` 并按 `"owner"."region"`
  筛选/分组;此前它们筛/分组的是基表 `region`(有同名列时),或以
  `400 INVALID_FIELD "constrains field 'region'"` 被拒(无同名列时)。**同一个请求
  现在返回的行可能与此前不同 —— 此前那些行是错的。**
- **ObjectQL 上同一个 member 改为响亮拒收或正确穿越,不再有第三种更安静的答案。**
  `where` 得到 `cannot evaluate a cross-object filter ("owner.region")` —— 与**已
  注册 cube** 上的既有答案逐字一致;`dimensions` 走 FK-expand 正确穿越,返回关联对象
  的值。带 `granularity` 的跨对象 `timeDimensions` 得到
  `cannot bucket a cross-object time dimension`。
- **即席 cube 的 `dimensions` 词汇表里现在出现点号键**(`getMeta` 上是
  `crm_account.owner.region`)。此前该穿越要么以剥掉的尾段出现(`crm_account.region`),
  要么(数组写法)完全不出现。
- **不变的部分**:真正的 `<cube>.` 限定符照旧剥除;裸列名照旧是基表列(基表自己的
  `region` 仍可作为 `region` 分组);#4437 / #5520 / #5669 三道源字段闸门的代码一行未
  动,它们对裸名拼错的 `400 INVALID_FIELD` 拒收原样保留;点号 **measure**(如
  `total.sum`)仍按 #4437 的 `400 INVALID_FIELD` 拒收 —— `lookupMember` 的 synthetic
  穿越档是 dimension-only,dotted measure 没有可收敛的穿越答案。
