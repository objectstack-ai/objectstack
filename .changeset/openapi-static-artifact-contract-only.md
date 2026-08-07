---
"@objectstack/spec": major
---

**`@objectstack/spec/openapi.json` 不再描述任何路由 —— 静态产物收缩为它真正拥有的契约半边(#5744,#5588 裁定 C 第二棒)**

`packages/spec/scripts/build-openapi.ts` 里手写的 built-in 路由段(`generateCrudPaths` / `generateMetadataPaths` / `generateDiscoveryPaths`,7 条 path、10 个 operation)整体摘除。这一段在真实 boot 上逐条探测 **0/10 命中**:路径按字面量 `basePath = '/api'` 拼接,于是全部缺 `/v1`(CRUD 还缺 `/data`);`PUT {object}/{id}` 的动词服务器明确回 405;`/api/meta/types` 全仓无此路由;`/api/.well-known/objectstack` 是 runtime dispatcher 的路由、挂在**根路径**上。而且它在这个座位上原理上就写不对 —— `apiPath` 是部署级配置(`api.apiPath ?? api.basePath + '/' + version`),随包发布的静态 JSON 无法为所有部署拼对前缀。

段落的唯一属主是**挂载这些路由的包**(ADR-0076 一路由一属主;本文档的属主由 #5078 的真实 boot 坐实为 `@objectstack/rest`)。第一棒 #5821 已让 REST 服务在 serve 期从 `routeManager.getAll()` 产出该段、并**整体丢弃**静态产物带来的 `paths`,所以本次摘除对服务出的 `GET {apiPath}/openapi.json` 是**零行为变化**:那份文档的路由段早已逐字节来自 rest。

发布出去的静态产物现在只剩 `openapi` / `info` / `servers` / `components`(`schemas` + `securitySchemes`)/ `security` 五个顶层键 —— 正是 rest serve 期会从产物里读走的那几项。

**破坏性**:直接 `import '@objectstack/spec/openapi.json'` 的消费者会看到

- **`paths` 键消失**(不是变成 `{}`)。OpenAPI 3.1 里 `paths` 可省(`paths` / `components` / `webhooks` 三者有其一即为合法文档),而两种写法说的不是一件事:`paths: {}` 断言「这个 API 什么都不服务」——假的;键不存在则对路由不作任何断言 —— 这才是这份产物有资格作出的声明。`doc.paths` 上直接取值的代码需要改成防御式读取,或者改去读服务出的 `GET {apiPath}/openapi.json`(那份是完整文档)。
- **`tags` 键消失**。`CRUD` / `Metadata` / `Discovery` 三个 tag 只为命名被摘掉的三段而存在,任何文档里都没有 operation 携带它们;服务出的文档的 tag 列表由 rest 与路由段一起产出。

要一份**带路由**的文档,唯一正确的来源是运行中的服务:`GET {apiPath}/openapi.json`。

**门禁随形状调整,不靠留活口维持覆盖**:#5168 的产物自恰门保留,但如实标注 —— 9 个 `$ref` 全部住在被摘掉的 operation 请求/响应体里,所以 `assertRefsResolve` 在**今天**的产物上是空断言。留着它是因为幸存的那半边仍然能走到它防的形状:`z.toJSONSchema` 会把复用/递归子 schema 放进它**返回值**根部的 `$defs`,并用根相对的 `#/$defs/…` 指过去;这些 schema 各自独立转换后被停在 `components.schemas[Name]` 下,于是该指针指的是整份 OpenAPI 文档的根 —— 那里没有 `$defs`。九个契约 schema 今天都不是递归形状,反向验证用变异复现了这一天(注入 `#/$defs/Recursive` → 生成器非零退出)。另新增两条钉子:产物**不含**路由段(七条幽灵路径与三个 tag 逐条断言不存在),以及产物**仍完整保留** spec 拥有的五个顶层键 —— 后者防的是把这次收缩做过头、连 rest 要读的东西一起删掉。

`check:generated` 台账里 `gen:openapi` 那条 `why` 同步改写:原文「no check gate compares it to the routes」在裁定 C 之下已无第二方可对账,现在如实记录真正剩下的缺口 —— 没有任何东西把产物的 `components.schemas` 与 `src/api` 对账,产物过期不会让任何东西变红(自恰性由 #5168 在写盘前自检覆盖,**时效性**没有)。
