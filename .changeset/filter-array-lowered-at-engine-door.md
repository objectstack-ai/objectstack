---
"@objectstack/objectql": minor
"@objectstack/driver-sql": minor
"@objectstack/driver-memory": minor
"@objectstack/driver-mongodb": minor
---

fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

`FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

## 改了什么

进入运行时的门有两扇,过去只有一扇按契约读:

| 门 | 改前 | 改后 |
|---|---|---|
| **Door 1** —— 协议/HTTP 面(`metadata-protocol`) | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER` | 不变 |
| **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动 | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
| 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`) | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400 |

一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
`RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
删掉方言后两侧自然合流。

## 授权面:零变化

`FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
`filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

## ⚠️ 可观察的行为变更

1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
   声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
   照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
   `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
   返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
   变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
   导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
   注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
   挡住这个输入,所以拒收必须在运行时。
5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
   (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
   AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

## 删除的代码面

- `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
- `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
- `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
- `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

`[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。
