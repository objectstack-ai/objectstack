---
"@objectstack/spec": minor
---

feat(spec): 执行器契约面 —— `IMetadataService.matchEndpoint?` 与 `IHttpServer.setFallbackHandler?` 可选成员(#5040 执行器 E1)

**纯声明,零行为变更。** 本改动只在 `packages/spec/src/contracts/` 增加两个**可选**契约成员与一个导出类型;仓内没有任何实现体、没有任何接线,现网行为逐字节不变。声明式 `ApiEndpoint` 在 v17 仍被 publish 硬拒(#4936 裁决),本单落的是它未来得以执行所需的契约前件(contract-first 首件)。

**1. `IMetadataService.matchEndpoint?(query: { path, method })`** — 把一次请求的 `method`+`path` 解析为拥有该路由的 `api` 元数据条目,或在无人声明时返回 `undefined`。这是 HTTP dispatcher 在「内建 domain 均未认领」与「答语义 404」之间的那一步。随之导出新类型 `ApiEndpointMatch`:

- `endpoint` 是 `ApiEndpointSchema.parse` **之后**的形状 —— 默认值已物化,而非存储里的原始 JSON。作者漏写 `authRequired` 时消费端拿到的是 `true`(schema 默认值),因此消费端永远读不到「缺省」这个中间态,也就不可能把一个缺失的安全默认误读成放行。
- `params` 在 17.x **恒为 `{}`**。`ApiEndpointSchema.path` 词表已冻结(ADR-0121),既未定义 `:param` 也未定义 `{param}`,本契约**刻意不发明**模板语法 —— 只存在于实现里的语法就是隐藏方言(Prime Directive #12)。槽位现在就声明出来,是为了将来真要加路径模板时,那是词表的加法,而不是本契约的破坏性变更。

**2. `IHttpServer.setFallbackHandler?(handler: RouteHandler)`** — 传输层兜底 seam:仅当**全部显式注册的路由均未命中**后才被调用。它在结构上不可能遮蔽任何已注册路由,因此零注册顺序依赖 —— 这正是它优于「通配路由」方案的原因,后者由插件 `start()` 顺序下的 first-registration-wins 决定归属,即 ADR-0076 D11「一条路由一个属主」要防的病灶。第二条保证同样载入契约:兜底 handler 收到的 `req.body` **可读**,与 `use()` 中间件契约明确「body 不填充」相反(在 `use()` 处解析 body 会在真正拥有它的路由 handler 之前吃掉请求流)—— 这条差异正是中间件 seam 无法承载动态端点、而必须新增本成员的原因:由 flow 或 `create` 操作支撑的声明式端点必须读 body。

**两者均为可选成员**,消费端按仓内既有惯例以 `typeof x === 'function'` 探测(同 `watch?` / `subscribe?` / `getRawApp?`)。不实现它的 `metadata` 槽位占用者、无法表达 not-found 钩子的适配器,都仍然满足契约,消费端退化到既有的未命中应答。因此对现有实现方**无迁移动作**。

生成物影响:`api-surface.json` 新增一行 `ApiEndpointMatch (interface)`(0 breaking / 1 added)。两个新成员是 interface 成员而非导出,不动其余七件生成物。
