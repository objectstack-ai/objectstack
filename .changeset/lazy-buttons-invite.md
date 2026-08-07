---
'@objectstack/rest': minor
---

REST 的 9 条 direct-mount 路由现在对 `RestServer` 可枚举,并随之进入 `GET {apiPath}/openapi.json`

`package-routes.ts`(4 条 `packages.*`)与 `external-datasource-routes.ts`(5 条
`datasources/:name/external/*`)一直绕过 `RouteManager`、直接挂在宿主 `IHttpServer` 上,
`RestServer` 因此不持有「这 9 条本次 boot 是否挂载」的事实。#5588(PR #5821)把
`/openapi.json` 的 built-in 段改成服务器自身路由表的投影之后,这 9 条(其中 8 条在
`rest-route-ledger.ts` 里是 `disposition: 'sdk'` 的真实能力)就不在生成的文档里 ——
用 `/openapi.json` 生成客户端的 consumer 拿不到它们,任何基于 `getRoutes()` 的自省也看不见。

现在两个 registrar 各自把「实际挂载的那一个数组」原样返回,由组合步骤
(`mountAndRecordDirectRoutes`,`rest-api-plugin.ts` 调用)登记到 `RestServer` 上:

- `RestServer.getRoutes()` 返回本次 boot 的**全部**已挂载路由,每条带 `source`
  (`'route-manager' | 'direct-mount'`),类型为新导出的 `MountedRoute`;
- `/openapi.json` 的 built-in 段随之覆盖这 9 条,带各自的 summary / tags / 路径参数;
- 描述与挂载**同源**:返回的数组就是用来挂载的那个数组,不存在第二份手工清单。

诚实性两个方向都保持不变:某次 boot 没有 `package` 服务 ⇒ `packages.*` 既没挂载、
也不出现在 `getRoutes()` 与文档里;federation 那 5 条无条件挂载(服务缺席时按请求答 503),
所以它们始终出现 —— 文档说的仍然只是「什么被挂载了」。

对使用者的影响:`getRoutes()` 的返回值多了 9 条(服务在场时)以及每条上的 `source`
字段;既有的 `method` / `path` / `handler` / `metadata` 读法不变。
