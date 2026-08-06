---
"@objectstack/rest": minor
---

**`/openapi.json` 的 built-in 路由段改由 rest 按自身路由事实产出(#5588,维护者裁定 C 第一棒)**

发布出去的 `GET {apiPath}/openapi.json` 里,built-in 路由那一段**一条都不存在**:真实 boot 逐条探测,7 条 path / 10 个 operation **0/10 命中**。段落由 `packages/spec/scripts/build-openapi.ts` 按字面量 `basePath = '/api'` 手写,于是路径全部缺 `/v1`(CRUD 还缺 `/data`);`PUT {object}/{id}` 写错动词,服务器对 `PUT` 明确回 405;`/api/meta/types` 全仓无此路由;`/api/.well-known/objectstack` 是 runtime dispatcher 的路由、服务在**根路径**上而非 API base 下。照这份文档生成客户端,每一个数据调用都 404。

这个座位上也不可能写对:`apiPath` 是部署级配置(`api.apiPath ?? api.basePath + '/' + api.version`),随包发布的静态 JSON 无法为所有部署拼对前缀。

**改法**:built-in 段的属主是**挂载这些路由的包**(ADR-0076 一路由一属主;本文档的属主由 #5078 的真实 boot 坐实为 `packages/rest`)。serve 期流水线现在从 `routeManager.getAll()`——路由器自己用来匹配请求的那张表,请求时读取——产出该段,并**丢弃**静态产物里带来的 `paths` 而不是与之合并(合并等于把错误的段再发布一次;spec 侧的生成要到第二棒 #5744 才摘除)。同一张表既决定「谁被服务」又决定「谁被描述」,幽灵行因此在结构上不可能存在:四条 bulk 路由只在 protocol 实现了 `batchData` / `createManyData` 时注册,于是也只在那时被描述。

- 路径前缀跟随实际配置的 `apiPath`,project-scoped 镜像有自己的文档(不再把每条路径写两遍);
- 动词是注册时的动词(`PATCH` 就是 `PATCH`);
- 覆盖面:该 base 下经本服务器 `RouteManager` 挂载的**全部**路由(默认 boot 78 条,对比旧段的 10 个 operation),`rest-route-ledger.ts` 中 `source: 'route-manager'` 的各 family 全含,不按 `disposition` 裁剪——`server-only` / `public` 也是被服务的 HTTP 面。**不含**两个 `direct-mount` registrar(`package-routes.ts` / `external-datasource-routes.ts`,9 行):它们绕过 `RouteManager` 直接注册且受服务开关约束,本服务器**不持有**它们本次 boot 是否挂载的事实,而凭空补上正是本单要修的那类缺陷;也不含其它包挂载的路由(dispatcher 根路由、`service-storage`、`service-i18n`);
- 不编造:请求/响应 schema、状态码、query 参数一律不生成(旧段的 `CreateRequest` / `UpdateRequest` `$ref` 除了挂在 404 的路径上,连线上形状都是错的——`{ data }` 信封 vs 裸记录体,spec 自己的路由目录 `plugin-rest-api.zod.ts` 里已记录这一点)。每个 operation 只写从注册读出的 `summary` / `tags`、从路径机械推导的 `operationId` 与 path 参数,响应写 `default`(成功状态是逐 handler 的事实,写 `200` 对 201/204 的路由就是错的);
- 逐 operation 的 `security` 只在注册带 `public` 标签时写 `[]`(匿名表单),其余继承文档级要求——对 `/discovery`、`/openapi.json` 这类实际匿名的路由属于**故意少说**:注册没有携带鉴权事实,而「不需要凭据」是写错会漏数据的那个方向。

`{object}` 展开与声明式端点合并两步原样保留,只是展开的模板终于是真实存在的路由(`/api/v1/data/{object}` 及其同族)。`components.schemas` / `info` / `securitySchemes` 仍来自 `@objectstack/spec` 并原样保留——那是它真正拥有的部分。
