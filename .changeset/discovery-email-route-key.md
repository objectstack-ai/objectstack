---
"@objectstack/spec": minor
"@objectstack/rest": minor
"@objectstack/client": patch
---

feat(spec,rest,client): the email surface becomes discoverable and the SDK follows the advertised base; the scoped client derives its prefix from discovery (#6714)

`@objectstack/client` 的 `email.send` 硬编码 `${baseUrl}/api/v1/email/send`,而服务端
`registerEmailEndpoints` 挂在 `getApiBasePath()` 下、**已经跟随 `apiPath`** —— 设了
`apiPath` 的部署上这是**现活 404**,不是潜伏项。实测(`apiPath: '/backend/api/v9'`
启动,录制挂载表):email 面只有 `POST /backend/api/v9/email/send` 一条,
`POST /api/v1/email/send` 在表中**不存在**。`ScopedProjectClient.scope()` 同样硬编码
`/api/v1/environments/...`,scoped 面全部 `meta` / `data` / `batch` / `packages` /
`automation` URL 由它拼出;同一启动下 83 条 scoped 路由全在
`/backend/api/v9/environments/:environmentId/...`,`/api/v1/environments/` 前缀零挂载。

按维护者裁定(2026-08-08)复刻 #6633 / PR #6712 的四车道模式:

- **spec**(minor,纯增量):`ApiRoutesSchema` 声明 `email` 键 —— `POST {email}/send`
  的挂载 base。`optional` 同 `datasources`:缺席 = 未挂载。
- **rest**(minor):`/discovery` 把 `routes.email` 作为**已录制挂载**的投影通告
  (RouteManager 表中 `registerEmailEndpoints` 写入的那一行,mounted ⇒ advertised,
  不二次计算)—— 挂载随 `apiPath` 移动时,通告按构造随行。未挂载 ⇒ 不通告。
  奇偶钉(`discovery-advertised-direct-mounts.parity.test.ts`)扩展覆盖 email:
  通告值 + `/send` 必须在同一张挂载表里解析得到,单侧移动即红。
- **client**(patch,行为修复):`email.send` 走 `getRoute('email')`;
  `ScopedProjectClient.scope()` 从通告的 `routes.data` base 推导 scoped 前缀。
  未连接、或服务端未通告 / 不可推导时,回退 URL 与旧硬编码**逐字节一致**。

面 3 为何用 `routes.data` 而不是 `scoping` 块:实测 discovery 的 `scoping` 只有
`enabled` / `resolution` / `scoped` / `environmentId` 四个键,**全是姿态、无路径**,
无法推导 base;`routes.data` 由 rest 通告为 `{realBase}{crud.dataPrefix}`,是唯一可
推导的来源。`dataPrefix` 被改成非 `/data` 时推导主动放弃、回退惯例(不做宽松再解析)。

`cloud.environments.*` 面(约 30 处)经测量**未改**:本仓无任何宿主挂载 `/cloud/*` ——
`@objectstack/rest` 的路由台账(`rest-route-ledger.ts`,由双向 conformance 门禁保证
穷尽)cloud 行数为 **0**;runtime dispatcher 无 cloud domain(无 `handleCloud`、无
`domains/cloud.ts`),且显式把 `/cloud` 列为他宿主的控制面(`skipPaths`)。而 `apiPath`
是 `@objectstack/rest` 独有配置项 —— 该面不随 `apiPath` 移动,按裁定「不随则不收敛」
保持原样。
