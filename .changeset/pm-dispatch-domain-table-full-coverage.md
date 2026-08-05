---
---

docs(pm-dispatch): 域分类表补全 22 个未列包 —— 未列包不再落入「不可被任何 PM 认领」死角 (#5095)

`.claude/skills/pm-dispatch/SKILL.md` 的 `domain:*` 包家族表只覆盖了一部分包,而同节的
label discipline 规定「未打标签的 issue 任何 PM 都不得认领」—— 两条合起来,落在未列包上的
issue 要么无法认领,要么每个 PM 各自临场判一次归属,车道协议「一个 PM 的分诊结论被缓存成
标签、其他 PM 直接读」的价值当场归零。表下本就写明:未列包在首次分诊时定级,并由 PR 更新表。
本条就是那个 PR。

对 `origin/main` 重新清点(77 个 workspace 包),补入的 22 个包按**锚定规则**逐包定级 ——
读 package.json 依赖方向、`src/` 内容与真实消费方,不从包名猜:

- **`domain:engine`**:`packages/formula`(CEL / `matches-filter` / RLS 谓词求值,消费方
  是 objectql 与各 driver)、`plugin-pinyin-search`(注册全局 `beforeInsert`/`beforeUpdate`
  钩子,与 #4775 同一条锚定先例)。
- **`domain:services`**:`packages/triggers/*`(三个 flow 触发器,承接 automation 引擎的
  `FlowTrigger` 接线)、`plugin-email`(#5087 首次分诊已定)、`plugin-reports`、
  `embedder-openai`、`knowledge-memory`、`knowledge-ragflow`(后两者直接依赖
  `@objectstack/service-knowledge`)。
- **`domain:devx`**:`packages/sdui-parser`(全仓唯一代码消费方是 `packages/lint`)、
  `packages/vscode-objectstack`(编写期编辑器 DX,只依赖 spec)、`apps/docs`(文档站)。
- **`domain:cli`**:`packages/rest`(#4886 先例,#5423 沿用)、`packages/mcp`(落点与
  `packages/runtime/src/domains/mcp.ts` 同缝)、`packages/observability`(最大消费方是
  runtime)、`packages/client` / `client-react`(REST 线协议 SDK,自带 route-ledger 一致性
  用例)、`packages/cloud-connection`(cli 车道 2026-08-05 首次分诊已定)、
  `packages/create-objectstack`、`packages/adapters/*`、`plugin-hono-server`、`plugin-dev`
  (`os dev` 装配栈,posture 门与 cli serve/verify 同面)。
- **兜底位显式点名**(表内新增一行,写明「不是遗漏」):`packages/apps/*`、
  `packages/console`、`examples/*` —— 各自的读法写在表下,`packages/console` 尤其点明其
  `dist/` 是 `../objectui` 的构建产物落盘位,UI 缺陷走 `repo:objectui`。

另加一句表的适用范围:本表只覆盖本仓的包;`objectui` / `cloud` 是仓库级分片,routing 用
`repo:*` 表达,不另打 `domain:*`(域车道是「同仓多 PM 并发」的切法,不是第二套仓库标签)。

只改域分类表与其说明段,协议其它条款(含第 8 步三轴决策框架)一字未动;仅内部 agent
协议文本,不发布任何包,空 frontmatter 仅为满足 changeset 门禁。
