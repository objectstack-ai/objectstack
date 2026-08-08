---
"@objectstack/rest": minor
---

fix(rest): 设置了 `api.apiPath` 时,9 条 direct-mount 路由跟随同一个 API base(#6306)

`RestServer.getApiBasePath()` 回答 `api.apiPath ?? `${basePath}/${version}``,
而 `rest-api-plugin.ts` 为两个 direct-mount registrar(`packages.*` ×4、
`datasources/:name/external/*` ×5)自行重算了一次 `${basePath}/${version}`,
从不读取 `apiPath`。两个表达式只在 `apiPath` 未设时相等——于是设置了
`apiPath` 的部署同时出现两个 API 前缀。实测(`apiPath: '/backend/api/v9'`,
真实 `createRestApiPlugin(...).start()` 组合、记录型 host server 枚举全部
挂载):**92 条路由中 83 条迁到 `{apiPath}`,恰好 9 条滞留 `/api/v1`**;
`{apiPath}/openapi.json` 的 `isUnderBase` 过滤把这 9 条排除在文档之外
(**71 paths**);`/discovery` 也如实通告了滞留位置
(`routes.packages: '/api/v1/packages'`)——通告没有说谎,是挂载本身分裂了。

按 maintainer 裁定(Option 1,单一真相源):registrar 现在直接消费
`restServer.getApiBasePath()` 的返回值——共享同一个值,而不是把 `??`
表达式复制到第二处(复制正是这个缺陷的成因)。`getApiBasePath()` 因此
从 `private` 变为 public,职责写入其 doc comment。

**行为变化,仅限设置了 `api.apiPath` 的部署**:这 9 条路由的 URL 从
`/api/v1/...` 移到 `{apiPath}/...`,旧前缀不再服务(无兼容双挂载)。
修复后实测 92 条全部挂在 `{apiPath}` 下,`{apiPath}/openapi.json`
完整列出这 9 条(**71 → 79 paths**),`/discovery` 通告 `{apiPath}/packages`
与 `{apiPath}/datasources`。

需要动手的只有**基础设施配置**:若反向代理、健康检查或外部监控里硬编码了
`/api/v1/packages` 或 `/api/v1/datasources/*/external/*`,改成 `{apiPath}/…`。
**SDK 与应用代码无需改动**:`@objectstack/client` 自 #6633 / PR #6712 起从
`/discovery` 通告的 base 派生这两个面,而通告是已录制挂载的投影,因此客户端
按构造跟随本次移动。该键也没有 authoring 路径可达
(`defineStack({server:{api:…}})` 被 strict 块 loud 拒绝,`api:{apiPath}` 被
静默 strip,`os serve` 只转发两个 scoping 键),只有程序化组合
`createRestApiPlugin` 的 embedder 能设到它。

**默认配置(未设 `apiPath`)逐字节不变**:两个表达式在该情形下同值;实测
修复前后默认挂载表(92 条)、`{base}/openapi.json`(79 paths)与
`/discovery` 通告完全一致,逐行 diff 无差异。

另修复同一来源的第二处分歧:插件旧表达式用 `||` 兜底(空串 `basePath`
⇒ `/api`),`RestServer` 规范化用 `??`(空串保留)——`basePath: ''` 时
route-manager 面挂 `/v1` 而 9 条挂 `/api/v1`,同样的分裂不需要 `apiPath`
也会出现(实测 83/9)。读同一个值后该分歧不复存在。

Bump 判定为 `minor` 而非 `patch` / `major`。不是 `patch`:除了修缺陷,它
改变了一个真实配置键下可观测的 URL 表面,并且新增了公共 API 面
(`RestServer.getApiBasePath()` 由 `private` 转 public,是这次单一真相源的
承载物)。不是 `major`:没有任何可授权(authorable)的键被移除或重命名,
没有需要作者迁移的元数据(因而 ADR-0087 无可登记项),默认部署逐字节不变,
受影响部署的客户端按构造跟随;唯一的 FROM → TO 落在部署方自己的代理配置上,
而这些部署今天本就是 split-brain——本次是让 `apiPath` 被完整遵守,不是收回
一个曾被兑现的承诺。
