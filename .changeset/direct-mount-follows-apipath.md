---
"@objectstack/rest": patch
---

fix(rest): 设置了 `api.apiPath` 时,9 条 direct-mount 路由跟随同一个 API base(#6306)

`RestServer.getApiBasePath()` 回答 `api.apiPath ?? `${basePath}/${version}``,
而 `rest-api-plugin.ts` 为两个 direct-mount registrar(`packages.*` ×4、
`datasources/:name/external/*` ×5)自行重算了一次 `${basePath}/${version}`,
从不读取 `apiPath`。两个表达式只在 `apiPath` 未设时相等——于是设置了
`apiPath` 的部署同时出现两个 API 前缀:实测 92 条路由中 83 条迁到
`{apiPath}`,9 条滞留 `/api/v1`,且 `{apiPath}/openapi.json` 的
`isUnderBase` 过滤把这 9 条排除在文档之外(71 paths),`/discovery`
也如实通告了滞留位置。

按 maintainer 裁定(Option 1,单一真相源):registrar 现在直接消费
`restServer.getApiBasePath()` 的返回值——共享同一个值,而不是把 `??`
表达式复制到第二处(复制正是这个缺陷的成因)。`getApiBasePath()` 因此
从 `private` 变为 public,职责写入其 doc comment。

**行为变化(仅限设置了 `api.apiPath` 的部署,该键只有程序化组合
`createRestApiPlugin` 的 embedder 可达,`defineStack` / `os serve` 均无
authoring 路径)**:这 9 条路由的 URL 从 `/api/v1/...` 移到
`{apiPath}/...`,旧前缀不再服务(无兼容双挂载)。今天这些部署本就是
split-brain——SDK 自 #6633 / PR #6712 起跟随 `/discovery` 通告的 base,
通告又是已录制挂载的投影,因此客户端按构造跟随本次移动。
`{apiPath}/openapi.json` 现在完整列出这 9 条(实测 71 → 79 paths)。

默认配置(未设 `apiPath`)逐字节不变:两个表达式在该情形下同值,实测
修复前后默认挂载表完全一致(92 条)。

另修复同一来源的第二处分歧:插件旧表达式用 `||` 兜底(空串 `basePath`
⇒ `/api`),`RestServer` 规范化用 `??`(空串保留)——`basePath: ''` 时
route-manager 面挂 `/v1` 而 9 条挂 `/api/v1`,同样的分裂不需要 `apiPath`
也会出现。读同一个值后该分歧不复存在。
