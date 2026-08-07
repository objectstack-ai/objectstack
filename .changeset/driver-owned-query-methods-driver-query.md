---
"@objectstack/driver-memory": major
"@objectstack/driver-mongodb": major
---

refactor(drivers)!: memory / mongodb 的 `aggregate` / `distinct` 也收进 `DriverQuery`，契约没覆盖的方法不再要求把对象名写两遍 (#6212 批 C)

#6210 的 changeset 结尾专门留了一句：`aggregate` / `distinct` **不在**那次范围内，因为它们不是 `IDataDriver` 收窄的那六个方法。#6212 记下了这笔账，本次结清 memory 与 mongodb 这两个包的部分。

这批方法的第一个实参**已经是对象名**，query 里却仍旧要求再写一遍：

| 位置 | 收窄前 | 收窄后 |
|:--|:--|:--|
| `MongoDBDriver.aggregate` | `query: QueryAST` | `query: DriverQuery` |
| `InMemoryDriver.distinct` | `query?: QueryInput` | `query?: DriverQuery` |
| `InMemoryDriver.aggregate` | `Record<string, any>[] \| QueryAST` | `Record<string, any>[] \| DriverQuery` |
| `InMemoryDriver.performAggregation`（私有） | `Omit<QueryInput, 'object'>` | `DriverQuery` |

因为 `QueryAST` / `QueryInput` 都把 `object` 声明成**必填**，一个手上只有 `where` 的调用方根本叫不出这个类型的名字，于是伸手去拿 `as any` —— 连 `where` / `orderBy` / `limit` 的检查一起关掉。这正是 #5181 记过账的那笔代价（cloud#1053 实测 20 处，cloud#1030 的 `$like` 就是从这个口子活到运行时的）。收窄之后调用方可以直接写字面量：

```ts
// 收窄前：object 是必填，这句编译不过，于是 ... as any
// 收窄后：直接过，且 where / orderBy / aggregations 逐个受检
await driver.aggregate('order', {
  groupBy: ['region'],
  aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
});
```

同一次改动收回了 4 处已经多余的 `as any`（memory 2、mongodb 2），`check:query-options-erasure` 的测试面因此从 267 降到 263，baseline 已按门禁要求同 PR `--update`。

**`InMemoryDriver.aggregate` 的联合刻意保留。** 两条分支都有活体生产者：mongo 管线数组那支由 `memory-analytics.ts` 喂，AST 那支由 objectql 引擎与 `@objectstack/verify` 的日期分桶探针喂。退役任何一支都会打断其中一条。

**顺带把 `#6212` 正文的一处归因证伪了**：正文说 `performAggregation` 当初选 `Omit<QueryInput, 'object'>` 是被 `groupBy` 的元素类型差异逼的。实测 `QueryInput` 与 `QueryAST` 在 `groupBy` 上**逐字相同**，差异只在 `search` / `orderBy` / `expand`；直接换 `DriverQuery` 零报错。所以那不是被迫的选择，契约优先取 `DriverQuery`，不再引入第二个查询类型家族。

**零运行时改动。** 非测试改动 100% 是类型注解，无逻辑、无行为、无 emit 差异（`as` 断言在编译期即被抹除）。测试全绿：memory 532、mongodb 206（另 137 条需真实 mongod，按既有 opt-in 规则跳过）。这也是 #5499 冻结面上被允许的处置口径 —— 与 #6210 在同一批驱动上走的是同一条。

**迁移面：删掉调用字面量里的 `object:` 键**，与 #5181 / #6210 同一句话，现在覆盖到 `aggregate` / `distinct`。编译器会逐处指出来：

```
error TS2353: Object literal may only specify known properties,
              and 'object' does not exist in type 'DriverQuery'.
```

本仓实测只有一处需要改（`memory-driver.test.ts` 的 `distinct` 用例），且它写的值与第一实参逐字相等，纯冗余。

标 major 的依据与 #5181 / #6210 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。
