---
"@objectstack/spec": major
---

refactor(spec)!: `IDataDriver` 的 query 参数改为 `DriverQuery`（`Omit<QueryAST, 'object'>`），对象名只写一遍 (#5181)

`IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的第一个实参已经是对象名，而它们要求的 `QueryAST` 又把 `object` 列为必填 —— 同一个事实被要求写两遍，并因此有了两处互相矛盾的余地。上层为这份歧义已经付过账：objectql 引擎刻意把键序写成 `{ ...query, object }`，好让一个夹带的 `query.object` 覆盖不掉已解析的名字；wire 层则用一条具名 400（`QUERY_OBJECT_MISMATCH`）拒绝不一致。

驱动这一侧付的账是**成片的 cast**：一个手上只有 `where` 的直接调用方叫不出这个类型的名字，于是 `as any`，连带把 `where`/`orderBy`/`fields` 的类型检查一起关掉（cloud#1053 实测 20 处；cloud#1030 的 `$like` 就是从这个口子活到运行时的）。

**FROM → TO**

```ts
// FROM —— 对象名写两遍
await driver.find('account', { object: 'account', where: { status: 'open' } });
// TO —— 第一个实参就是对象名
await driver.find('account', { where: { status: 'open' } });
```

一行修复：**删掉驱动调用字面量里的 `object:` 键**。编译器会把每一处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。

**两个方向的兼容性，都不强迫任何一侧动**

- **调用方**：手上是一个 `QueryAST` **值**的，原样传即可 —— 它具备 `DriverQuery` 要求的全部属性，多出来的那个在非新鲜字面量上 TypeScript 一律接受。新被拒绝的**恰好只是冗余本身**：写在调用点上、拼出 `object` 的内联字面量。本仓的迁移面因此实测只有 1 个文件 6 处（`@objectstack/metadata` 的 history-cleanup），已在同一 PR 里删除；引擎的 `driver.find(object, ast, …)` 一个字都不用改。
- **驱动实现**：仍旧声明 `query: QueryAST` 的实现继续编译 —— 方法参数按双变比较。它们不再可以做的是**读 `query.object`**：调用方现在有权省略，声明会对一个运行时为 `undefined` 的值说谎。本仓五个驱动（memory / mongodb / sql / sqlite-wasm / turso）实测没有一个读它，因此本次不动驱动代码；把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾。

`QueryAST` 的 zod 形状（`data/query.zod.ts` 的 `BaseQuerySchema`）**没有动**：`object` 在引擎与 hook 那一层是被读的，改的只是驱动契约的参数类型。`expand` 条目里的 `object` 同样保留 —— 那里它命名的是**关联对象**，没有任何实参携带这个事实，不是冗余。

标 major 是因为这是**源码级破坏性**变更（调用点字面量），运行时行为零变化。注意 `check:api-surface` 只看得见新增的 `DriverQuery` 导出、看不见参数类型的收窄（它记录导出存在与否，不记录签名），所以这条迁移说明是该变更唯一的下游载体。

<!-- adr-0087: registered data-driver-query-omit-object -->
