---
"@objectstack/service-automation": patch
---

fix(service-automation): 降级注册那条 warn 不再插值 provider 的 reason,cause 走结构化 meta (#5660)

## 接缝

`AutomationEngine.registerDegradedConnector` 自己那条记录:

```ts
this.logger.warn(`Connector registered DEGRADED: ${parsed.name} (origin: ${origin}) — ${reason}`);
```

`reason` 不是我们的文本 —— 唯一调用点(`plugin.ts` 的 `degradeConnectorInstance`)传进来的是
`ConnectorUpstreamUnavailableError.message`,由**第三方 provider factory** 构造(ADR-0097 明确
邀请第三方去写;spec 只约束 `code`,不约束文本),所以上游 SDK 的多行失败会原样落进 message。
`ObjectLogger.write()` 每次调用只打一个 `<ts> <LEVEL>` 头,带换行的 message 就变成若干物理行,
只有第一行是记录。

这是 #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的 `fail()`)、#5636
(`degradeConnectorInstance` 的两条)之后同族的**第四条**,在另一个文件、另一个方法、另一份
契约里,所以是单独一单。它值得单独修的理由是**顺序**,不是严重度:

- 它**先**发生 —— `degradeConnectorInstance` 先调 `engine.registerDegradedConnector(…)`,
  之后才打自己那两条;
- 它在**默认分支**上 —— #5636 那条 `warn` 在 `catch` 里(husk 自己 parse 失败才走到),
  这条在同一个 `try` **成功**时打,也就是每个实例首次降级都打。

即:#5636 落地之后,常见的冷启动降级路径上仍然留着一条会溢出的 warn。

## 危害(与 #5636 同一条下游,机制已实测)

`ObjectLogger` 把 `warn` 送 stdout;`serve` 的启动静默窗口只包了 `process.stdout.write`;
冷启动会走到这个接缝 —— `materializeDeclaredConnectors(ctx, { fatal: true })` 遇到上游不可达是
**降级**、不是抛错 —— 而窗口此时正开着。`BootLogCapture.offer()` 只在 `classifyBootLogLine`
能在物理行上找到级别头时才保留该行,所以插值 message 的每条续行是被**直接丢弃**的。

本单新测试按 `pretty`(CLI 实际用的格式)实测了旧形状的代价,并且刻意报告了一个**比 #5636 更窄**
的结论:#5636 的载荷是 `ZodError.message`(首行只有一个 `[`),唯一被留下的那行不含任何事实;
这里的载荷是 provider 的散文,**首行会活下来**,丢掉的是它后面的 `cause:` / `hint:` 两行 ——
也就是「连哪个地址被拒」和「该去查什么」。3 行进,1 行留,2 行丢。

## 改法(#5660 分诊 A 路)

`registerDegradedConnector` 签名末尾加可选 `cause?: unknown`(在有默认值的 `origin` 之后,
所以既有调用形状全部照旧编译 —— 新测试里就有一个两参调用在钉这件事)。message 变成单行自足
(name / origin / 这个状态的后果与后续动作),事实走 `warn(message, meta?)` 的第二参:

- `degradedReason` —— **恒定存在**,是这次注册**存进** husk 的那段文本。字段名照 #5573 挑过:
  `ObjectLogger` 按 `password`/`token`/`secret`/`key` 子串递归脱敏,这个名字一个都不含;
- 抛出值自身的渲染(`error` 或 `issues`,经同包 `describeThrownForLog`)—— 仅当调用点传了
  `cause` 时出现。它描述的是**失败**,`degradedReason` 描述的是**注册**;今天唯一的调用点从
  前者派生后者所以两者重合,但记录形状不依赖这个巧合,将来传摘要的调用点也不会静默丢信息。

唯一调用点顺手把 `info.cause` 传了进来(该字段 #5636 已经存在)。

## 刻意没做的两件事

- **`reason` / `degradedReason` 一字不动**。`GET /connectors` 展示的、`connector_action` 被拒时
  引用的那段文本仍逐字保留 provider 自己的 message,换行包含在内 —— 它是人透过 JSON 读的,不经
  按行切分的消费者(#5636 在上一层做了同样的判断)。测试从两个方向钉住了这个分离。
- **没有扩 `describeThrownForLog`**。`ConnectorUpstreamUnavailableError` 自带一个 `cause`
  (底层 connect 错误),把**抛出值本身**一路带过来才使渲染它成为可能;但该 helper 目前只读
  `.message` / `.issues`,所以嵌套 cause 今天还不会出现在记录里。这一点被一条测试如实钉住,
  而不是含混带过 —— 扩宽它是改四个接缝共用的 helper,不是这个接缝该顺手做的决定。
