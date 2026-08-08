---
"@objectstack/spec": major
---

feat(spec)!: `HookContext.api` 从 `z.unknown()` 收窄为 `IScopedContext`，文档教的第一个 hook 终于编译得过 (#5945)

`HookContext.api` 是文档教的**主数据通道**，而它的类型是 `unknown`。于是所有文档、技能、示例里那个标准写法：

```ts
handler: async (ctx: HookContext) => {
  const users = ctx.api.object('user');   // error TS18046: 'ctx.api' is of type 'unknown'.
}
```

一行都编译不过 —— 包括 `hook.zod.ts` 里 `api` 这个键**自己 JSDoc 上的示例**。语料库全在这么教（`skills/objectstack-data/references/data-hooks.md`、`content/docs/automation/hooks.mdx`、`content/docs/api/error-handling-server.mdx`、`content/docs/kernel/runtime-services/*`），这些块都没进 `os:check`，所以从来没有一道门看见过。唯一进了 `os:check` 的那块（`runtime-services/examples.mdx`）也只能靠在示例里自建一个 `type CrossObjectApi = …` 再 `ctx.api as CrossObjectApi` 才编得过 —— 每个消费方各 cast 一遍、cast 的形状无人校验，正是 contract-first 要终结的方向。

**本次落地维护者裁决 C**：`packages/spec/src/contracts/` 新增 `IScopedContext` / `IScopedObjectRepository`（与 `IDataEngine` / `IObjectQLEngine` 同层同风格），`HookContext.api` 的 TS 类型指向它。

**声明面 = 语料库实测的调用点**，不多也不少（证据表在 PR 正文，逐条 file:line）：

- `IScopedContext`：`object(name)` + `transaction(cb, opts?)`
- `IScopedObjectRepository`：`find` / `findOne` / `count` / `insert` / `update` / `updateById`

`upsert` / `delete` / `aggregate` / `create` 只出现在文档的**方法表与能力表**里、从没有一处调用点（表格不过编译器），`sudo()` 的三个调用方全部把值持成 `any` 且它是提权动作 —— 一律不声明，等到有调用点再按同一条规则加。这与 `IDataEngine` 当年（#4251）确立的「有证据才声明」是同一条纪律。

**运行时零变化**：Zod 侧仍是 `z.unknown()`（`z.custom` 会让 `HookContext` 在 JSON Schema 里不可表达，`gen:schema` 直接不再产出 `json-schema/data/HookContext.json`，进而在下次 `gen:docs` 抹掉它的参考页 —— 实测过，不是推测）。收窄是纯静态的：接受的值、JSON Schema、生成的参考页行全部逐字节不变，只有 `.describe()` 文案改了。

**漂移由编译器盯着**：`packages/objectql` 的 `ScopedContext` / `ObjectRepository` 声明了 `implements`，契约与引擎实际绑定的那个对象再也不能各说各话（把 `updateById` 改个名，objectql 的 `tsc` 会在 `implements` 处和五个 hook 派发点同时报错 —— 实测过）。

**FROM → TO —— 什么代码需要改**

读取端只会变宽，原来编译得过的读法一行都不用动（原来根本没有能编译过的读法）。两类**写入端**可能要改：

```ts
// 1. 自建 cast 的消费方 —— 删掉 cast 即可，`ctx.api` 现在自带类型
-const api = ctx.api as CrossObjectApi;
-const account = await api.object('crm_account').findOne({ where: { id } });
+const account = await ctx.api?.object('crm_account').findOne({ where: { id } });

// 2. 构造 HookContext 字面量的测试替身 —— `api` 现在必须是 IScopedContext 形状（或省略）
 const ctx: HookContext = {
   object: 'account', event: 'beforeInsert', input: {}, ql: {},
-  api: whateverStub,
+  api: undefined,   // 或一个带 object(name) / transaction(cb) 的替身
 };
```

`api` **仍是可选的**：`buildHookApi` 在全部五个派发点都会设置它，但改成必填会开始拒绝今天能过的部分上下文（没有活引擎时构造的 context），所以读法是 `ctx.api?.object(…)`。
