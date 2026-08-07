---
"@objectstack/driver-memory": major
"@objectstack/driver-mongodb": major
"@objectstack/driver-sql": major
"@objectstack/driver-sqlite-wasm": major
"@objectstack/driver-turso": major
---

refactor(drivers)!: 五个驱动的 query 参数跟进 `DriverQuery`，休眠的类型谎言就此没有藏身处 (#6075)

#5181（PR #6076）把 `IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的 query 参数收窄为 `DriverQuery`（`Omit<QueryAST, 'object'>`），并在同一条 changeset 里写明：「把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾」。这就是那次收尾。

在此之前，五个驱动的实现仍旧声明 `query: QueryAST`（turso 侧是 `query: any`）。**它不红，也不会红** —— 方法参数按双变比较，实现声明得比契约宽照样满足契约。但调用方现在**有权**省略 `object`，于是这些实现的类型说 `query.object` 是 `string`，运行期却可能是 `undefined`：一句休眠的谎言，没有任何门拦得住下一个照着它写代码的人。

收尾之后，「驱动读 `query.object`」直接变成编译错误：

```ts
// 收窄前：编译通过，运行期可能是 undefined —— 谎言
// 收窄后：error TS2339: Property 'object' does not exist on type 'DriverQuery'.
const name = query.object;
```

**零运行时改动。** 本次改的全部是类型注解：五个驱动的六个契约方法签名，以及为让类型自洽而必须跟进的少量私有辅助方法参数（mongodb 的 `buildFindOptions` / `buildSortSpec`，sql 的 `findRows` / `orderKeysFor`，turso 的 `toRemoteQuery` / `toRemoteReadQuery`，memory 的 `performAggregation`）—— 它们都只转发或读取 `where` / `orderBy` / `groupBy` 这些字段，本来就不读 `object`。turso 的几处 `query: any` 一并收紧，多拿回一批本已放弃的检查。emit 无差异，测试全绿（memory 524、mongodb 206、sql 906、sqlite-wasm 254、turso 788）。

**迁移面：删掉驱动调用字面量里的 `object:` 键**，与 #5181 是同一句话，只是现在也覆盖了直接按具体驱动类（`SqlDriver` / `MemoryDriver` / …）而非按 `IDataDriver` 取类型的调用方。编译器会逐处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。本仓下游 25 个包实测零处需要改动，改动只落在五个驱动自己的测试里。

标 major 的依据与 #5181 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

`aggregate` / `distinct` / `syncSchemasBatch` 不在本次范围内 —— 它们不是 `IDataDriver` 收窄的那六个方法，其中 `syncSchemasBatch` 的条目里 `object` 是被真实读取的必填键，`expand` 条目里的 `object` 同理命名的是关联对象，都不是冗余。
