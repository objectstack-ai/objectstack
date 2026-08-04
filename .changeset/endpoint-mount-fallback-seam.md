---
"@objectstack/plugin-hono-server": minor
"@objectstack/runtime": minor
---

feat(runtime,hono): 挂载 seam —— `setFallbackHandler` 实现 + 声明式端点派发步(#5040 E3, #5090)

给声明式 `apis:` 端点铺上**唯一一条**能进入处理器的通路,并且这条通路在构造上不可能遮蔽任何
已注册路由。执行器本身尚未落地,本次改动**零现网行为变更**:任何 stack 目前都无法发布非空
`apis:`(publish 硬拒,直到 #5040 E7 翻转),所以这里新增的一切在真实组合里结构性不可达。

**`@objectstack/plugin-hono-server` —— `IHttpServer.setFallbackHandler` 的实现**

契约(#5080 落在 `@objectstack/spec/contracts`)的四条保证逐条兑现:

- 映射到 Hono 的 `app.notFound` 钩子,**不是**通配路由。这是全部要点:通配路由要与之后注册
  的每一条路由竞争,而 Hono 按先注册者赢裁决,归属就变成插件 `start()` 顺序的函数 ——
  ADR-0076 D11 正是为此存在。兜底器只在全部显式路由未命中后运行,**零注册顺序依赖**。
- handler 拿到的 `req.body` **可读**(与 `use()` 中间件 seam 相反,后者的契约明确不填充
  body),按 content-type 解析,与真实路由处理器走同一段代码。
- 重复安装即**替换**,不成链。
- handler 不写响应 → 适配器既有的未命中答案(404,或方法不匹配时 405 + `Allow`)原样保留。

配套的一处属主收敛:404/405 应答此前由 `HonoServerPlugin.start()` 直接写在
`getRawApp().notFound(...)` 上。`app.notFound` 是后调用者覆盖,兜底 seam 落在同一个钩子上,
两个写入方意味着幸存者由插件启动顺序决定 —— 应答本体因此移入 `HonoHttpServer`
(`installNotFoundSeam()` / `setFallbackHandler()` 在其中组合),一个钩子一个属主。行为
逐字节不变(`notfound-405.test.ts` 原样通过)。

顺带修好同一段代码上的两处不一致:适配器构造的 `IHttpRequest` 现在一律带
`remoteAddress`(此前只有中间件 seam 有,同一个契约有两种形状);处理器**同步**抛出与
异步 reject 现在报同一种结果(此前同步抛出会逃到 Hono 自己的错误页)。

**`@objectstack/runtime` —— dispatcher 端点派发步**

dispatcher-plugin 在 `start()` 中探测 `typeof server.setFallbackHandler === 'function'`
并注册兜底器。对落在 ADR-0121 D1 保留段 `<prefix>/apps/<命名空间>/<子路径>` 下的请求,
探测 `metadata` 服务的 `matchEndpoint`(#5089 的实现在并行开发,探测缺席即穿透):

- **命中** → `501 NOT_IMPLEMENTED`,包络说明执行器随 17.x 落地(#5040 E4–E5 接策略键与
  执行目标);
- **未命中 / 无 matcher / 无 metadata 服务 / 路径不在挂载前缀下** → **不写任何响应**,
  传输层既有的 404/405 答案原样成立(有回归测试逐字节钉住);
- `matchEndpoint` 抛错按 5xx 出口应答,不降级为 404 —— 故障不得伪装成「没有这条路由」。

派发步**不重入** `dispatch()`:那条管线会解析环境与 `executionContext`、跑匿名拒绝门、并以
语义 404 收尾,把全部未命中请求灌进去会改变今天未命中请求的答案。裸 404 与语义 404 的收口
是另一个决定,本次刻意不做。

`route-ledger.ts` 新增 `* /apps/**` 登记行与 `NON_DISPATCH_MOUNT_PREFIXES`(本包在
`dispatch()` 之外挂载的前缀),注记如实描述已接线的部分与**尚未**接线的执行部分;新增
一致性测试钉住 ADR-0121 D1 赖以成立的事实 —— `/apps` 不属于任何内建域。
