---
'@objectstack/spec': minor
---

spec: `EmailServiceConfigSchema` 补齐 CLI 实读的 `queueDelivery` / `appName` / `defaultTemplateContext`

`config.email` 在全仓只有一个读者 —— `packages/cli/src/commands/serve.ts` 的
`resolveEmailCapabilityArg`。本次改动时它读八个键,`EmailServiceConfigSchema` 只声明
其中五个,差集三个已经被运行时消费多时:

- `queueDelivery` —— #5160 落地的耐久队列投递开关(env 侧 `OS_EMAIL_QUEUE_ENABLED`)
- `appName` —— 模板 `{{appName}}` 的产品名,兼作无 `defaultFrom` 时的兜底发件人来源
- `defaultTemplateContext` —— 合并进每次 `sendTemplate()` 的自由渲染上下文

于是用 `EmailServiceConfig` 标注 `objectstack.config.ts` 的作者写 `queueDelivery: true`
会拿到类型错误,而同一份配置 `os serve` 起得来、也确实走队列投递;生成的参考文档
`content/docs/references/system/email-config.mdx` 的属性表同样看不到这三个键,AI 作者
读到的是「不支持」。与 #5104(provider 缺 `smtp`)完全同型,只是键不同。

本次是把契约追平既成事实,**运行时零改动**:三个键都是 optional,不带 `.default()`
(默认值由 `resolveEmailCapabilityArg` 对着 env 与顶层 config 解析,schema 再造一个只会
多出一个谁也不赢的答案),`defaultTemplateContext` 保持自由 record —— 除 `appName` 外
读侧原样透传,声明一套读侧没有的约束等于发明契约。

`appName` 与 `defaultTemplateContext` 的 TSDoc / `.describe()` 按 #5448 已裁定的新序落笔
(`OS_APP_NAME` > `config.email.appName` > `defaultTemplateContext.appName` > 顶层
`appName` > `'ObjectStack'`,PR #5498 落地),因此生成的 `email-config.mdx` 属性表文案
随之更新:此前 context 里的 `appName` 压过 env 的旧行为已不复存在,文档不再那样承诺。

同时新增跨包契约测试 `serve-email-config-parity.contract.test.ts`,把 issue 里那条手工
grep 机械化:读侧多出一个未声明的键即变红,不必再等下一次人工比对。

Fixes #5307
