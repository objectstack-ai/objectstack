---
"@objectstack/rest": patch
---

fix(rest): REST 面的执行上下文补齐 ADR-0090 D9/D10 的 principal 分类(#6071)

`resolveAuthzContext`(`@objectstack/core`)被提取出来,正是为了让两个 HTTP 入口
不再在**授权**上漂移。但它之后的一步 —— 把授权信封组装成 `ExecutionContext` ——
仍是两份手写副本,而两份的字段集已经不一致:runtime / dispatcher 那份
(`packages/runtime/src/security/resolve-execution-context.ts`)按 ADR-0090 D9/D10
设置 `principalKind`(必要时连同 `onBehalfOf`),`rest-server.ts` 的 `computeExecCtx`
两个都不设。

后果不在装饰面而在 enforcement 面:`plugin-security/explain-engine.ts` 的
posture 下限、`security-plugin.ts` 的 agent 基线、`observability/perf-timing.ts`
的披露闸门都读 `principalKind`,于是同一个请求走 dispatcher 与走 REST 会拿到不同
的上下文,读这个字段的判断在 `os serve` / `dev` 的数据与元数据路由上**从不成立**。
问题由 #5859 实施时的 dogfood 全栈 boot 插桩测得:到达消费方的键集里 `__kernel`
在(自证是 rest-server 这条组装路径)、`principalKind` 不在。

本次改动只补这一个传输上缺的字段,口径与 runtime 侧完全一致:

- 会话(cookie)或 API key 背书的主体 ⇒ `principalKind: 'human'` —— 与 runtime
  侧「an authenticated (API-key) request resolves as a human principal, never
  guest」的钉子同一判定。
- `'agent'` 与随之而来的 `onBehalfOf` **在本传输上不可表达**:它需要一个指明已授权
  客户端的 OAuth access token,而该凭据只在 dispatcher 的 `/mcp` 门上被接受
  (`acceptOAuthAccessToken`),正是为了不让粗粒度的工具族 scope 溜进 REST。
- `'guest'` 同样不可表达:`computeExecCtx` 在信封没有 `userId` 时就返回
  `undefined`,匿名 REST 调用者本来就拿不到任何上下文(随后被 `enforceAuth` 401)。
  **匿名面零变化** —— 不给匿名调用者凭空发一个 guest 上下文。

行为差量(逐条核过,无一条改变授权结果):`explain-engine.ts` 的 guest ⇒ `EXTERNAL`
与 `security-plugin.ts` 的 agent 分支在 REST 面仍不成立(前者的 `!context?.userId`
前肢本就恒真,后者读 `'agent'` 标签、且真正的兜底是委托 LINK);`perf-timing.ts`
只认 `'service'` / `'system'`,`'human'` 不开闸。唯一可观测的新增是 explain 输出里
多回显一个 `principalKind: 'human'`(该字段在 explain schema 中本就是 optional)。
