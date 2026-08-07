---
"@objectstack/driver-sql": major
"@objectstack/verify": major
---

refactor(driver-sql)!: `analyzeQuery` / `findWithWindowFunctions` 不再吃 `any`，窗口门自带扁平形类型 (#6212 批 A+E)

#5181（PR #6076）收窄了 `IDataDriver` 声明的六个方法，#6075（PR #6210）让五个驱动的实现跟上。收尾漏下的是**驱动自有、不在 `IDataDriver` 上**的那批查询门：它们同样吃 query AST，签名却是 `any`。本次处理 SQL 驱动的两个。

`any` 在 query 参数上不是「对象名没检查」，而是**检查全关**：`where` 的 filter 方言、`orderBy` 的 sort node 形状、`limit`/`offset` 是不是数字，全部被抹掉——而这两个方法体读的恰恰就是这些字段。`$like` 当年就是从同一个口子活到运行时的（cloud#1030、cloud#1053 实测 20 处）。

**`analyzeQuery` → `DriverQuery`。** 它是 `explain()` 的实现体，而 `explain()` 本来就声明 `DriverQuery` 并一行转发过来——收窄前这一对是自相矛盾的：契约门声明 AST，它背后的实现声明 `any`。方法体只读 `fields` / `where` / `orderBy` / `limit` / `offset`，全在 `DriverQuery` 内，因此这是一次纯注解：driver-sql 与 driver-sqlite-wasm 实测零报错、零 fixture 改动。

**`findWithWindowFunctions` → 驱动本地的扁平形类型**，新导出 `SqlWindowFunctionQuery` / `SqlWindowFunctionSpec`：

```ts
import type { SqlWindowFunctionQuery } from '@objectstack/driver-sql';

const ranked = await sqlDriver.findWithWindowFunctions('employee', {
  windowFunctions: [
    { function: 'rank', alias: 'salary_rank', partitionBy: ['department'], orderBy: [{ field: 'salary', order: 'desc' }] },
  ],
});
```

它**不能**标 `DriverQuery`：`query.windowFunctions` 在 spec 是 `retiredKey()` 墓碑（#4286），`QueryAST['windowFunctions']` 解析为 `undefined`，标上去会让这道门自己已发布文档里的载荷编译不过。类型因此写成 `Omit<DriverQuery, 'windowFunctions'> & { windowFunctions?: SqlWindowFunctionSpec[] }`——契约那一半照旧受检，驱动私有那一半由驱动自己声明。

类型放在驱动层、**不进 `packages/spec`**，是接着 #4286 的判断往下走：那次删掉 `WindowFunctionNodeSchema` 的理由正是它声明了 `field` / `over` / `frame` 这些门从不读的成员；再往 spec 加一套窗口词汇就是反悔那个判断。spec 的删除注记与 `migrations/registry.ts` 的迁移处方里逐字写着的 `{ function, alias, partitionBy?, orderBy? }`，就是这个类型的出处，三处必须始终说同一句话。请求面的墓碑**没有**被重新打开：`analyzeQuery('o', { windowFunctions: [...] })` 依然是编译错误。

**顺带（#6212 批 F）**：`@objectstack/verify` 的 `BucketableDriver.aggregate` 从 `query: unknown` 收到 `DriverQuery`。这是一个**已发布**的结构替身，cloud 的 driver-turso 照着它实现——声明 `unknown` 不叫「最小」，叫没检查，并且放任该文件里两处 AST 字面量各自把对象名多写一遍（#5181 的那种冗余）。同时删掉一处 `as never`：那个 cast 只是因为字面量推断把 `'count'` 放宽成了 `string`，注上类型就不需要它了。这里**不预断**驱动自身 `aggregate` 参数类型的收窄（#6212 批 B，排在 #6203 之后）——方法参数按双变比较，驱动那边声明 `any`、`QueryAST` 还是收窄后的类型，都照样满足这个替身。

**零运行时改动**，全部是类型注解与两处冗余键的删除（实测全仓驱动无一读 `query.object`）。测试：driver-sql 935、driver-sqlite-wasm 254、driver-turso 804、verify 17、dogfood 520 全绿。

**迁移面**：直接调用这两道门的嵌入方，把内联字面量里编译器指出来的键改对即可（TS2353）。本仓实测非测试生产者为零，两道门只有各自驱动包的测试在用，零处需要改动。标 major 的依据与 #5181 / #6075 一致：**源码级破坏性**（调用点内联字面量与 `BucketableDriver` 的导出形状），运行时行为零变化；`check:api-surface` 只记录导出的存在与否、不记录签名，所以这条说明是该变更唯一的下游载体。
