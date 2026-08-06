---
"@objectstack/metadata-core": patch
"@objectstack/objectql": patch
---

两个写动词的派发判定下沉到 `@objectstack/metadata-core` —— 公共 API 零变化,一次关闭 26 条 engine-double 基线条目

`ObjectQL.delete` / `ObjectQL.update` 的三分支派发判定(`engine-delete-dispatch.ts` #4550、
`engine-update-dispatch.ts` #5480)从 `packages/objectql/src/` **原样搬到**
`packages/metadata-core/src/`。这是一次搬移,不是重构:两个模块本来就零 import、纯自包含,
判定逻辑一个字未改。

**为什么搬。** `@objectstack/objectql` 的 `dependencies` 含 `@objectstack/metadata-protocol`,
所以那个包里 13 个假引擎结构性地无法 import 这两个谓词 —— 反向 devDependency 即成环,
turbo 2.10.7 直接拒绝任务图。判据来自门禁台账里
`packages/spec/src/contracts/data-engine.test.ts` 那条 EXEMPT:反向 import 不可行时,唯一
出路是下沉到**两边都已依赖**的包。`@objectstack/metadata-core` 正是这个包
(`objectql -> metadata-core` 与 `metadata-protocol -> metadata-core` 都是既有边),而它自己
的 `dependencies` 只有 `{ @objectstack/spec, zod }`,不含 objectql,故不引入新环。

**公共 API 与既有调用点零变化。** `packages/objectql/src/engine-delete-dispatch.ts` /
`engine-update-dispatch.ts` 保留在原路径,改为 re-export shim,因此
`@objectstack/objectql` 仍然导出
`resolveEngineDeleteDispatch` / `assertEngineDeleteDispatch` / `scalarDeleteId` /
`ENGINE_DELETE_REJECT_MESSAGE` / `ENGINE_DELETE_DISPATCH_CASES` 及 update 侧的五个同名对应物
(与全部类型),`engine.ts` 与 37 个既有 pinned 调用点一行未动。同一批符号现在也从
`@objectstack/metadata-core` 导出。

搭配的门禁改动:`scripts/check-engine-double-contract.mjs` 的两个 slice 现在同时接受
`@objectstack/metadata-core` 与 `@objectstack/objectql` 两种拼写(它们指向同一个函数),
失败提示也改为在「objectql 依赖该包」时优先建议 metadata-core。
