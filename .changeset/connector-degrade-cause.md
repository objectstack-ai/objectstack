---
"@objectstack/service-automation": patch
---

fix(service-automation): connector 降级路径的两条日志改用结构化 `meta`,message 保持单行 (#5636)

## 接缝

`degradeConnectorInstance`(#3017 的降级/重试路径)有两条记录报告的是**外来**失败,却把
它插进了日志 message —— 与 #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的
`fail()`)同一类,是那两单范围之外的第三个接缝:

- **husk 注册失败**(`warn`):`err` 来自 `engine.registerDegradedConnector` →
  `ConnectorSchema.parse`,catch 自己的注释就写着「the entry's def no longer parses」,
  也就是说这里预期接到的正是 `ZodError` —— 它的 `.message` 是 issue 数组的多行 JSON
  dump,第一行只有一个 `[`。
- **降级公告**(`error`):文本是 `ConnectorUpstreamUnavailableError.message`,由第三方
  provider factory 构造(ADR-0097 明确鼓励第三方去写)。spec 只定义错误类、不约束文本,
  所以上游 SDK 的多行失败会原样落在这里。

## 危害:这条 `warn` 的下游与 #5575 的 `error` 不同(实测)

`ObjectLogger` 把 `warn` 送 stdout、`error`/`fatal` 送 stderr,而 `serve` 的启动静默窗口
只包了 `process.stdout.write`。#5575 的接缝全是 `error`,所以那一单的结论是「启动缓冲根本
看不到」;这一条不同,而且差别是**测出来**的,不是推的:

- 它是 `warn` → stdout,缓冲**确实**看得到;
- 它在**冷启动**就会跑 —— `materializeDeclaredConnectors(ctx, { fatal: true })` 遇到上游
  不可达是降级、不是抛错 —— 而窗口此时正开着(`serve` 在 config 加载前接管 stdout,直到
  banner 打印才恢复);
- `BootLogCapture.offer()` 只在 `classifyBootLogLine` 能在该物理行上找到 `<ts> <LEVEL>`
  头时才保留它,所以插值 dump 的每一条续行是被**直接丢弃**,不只是难解析。

对一份 13 行的插值 ZodError 实测:写出 13 行物理行,缓冲保留 **1** 行(那条止于 Zod `[`
的头行)、丢弃 **12** 行 —— 唯一被留下的那行不含任何事实。这正是 cloud#971 的原始形态。
`error` 那一条走 stderr,不经缓冲,危害是 #5575 那一串按行消费者(文件 sink、
`docker logs`/journald 送采集、`grep ERROR`):一条诊断散成 N 个无法归属的碎片。

## 改法

两条都复用同包 `thrown-cause-diagnostics.ts` 的 `describeThrownForLog`(#5572/#5575 落地):
message 是不含换行的自足句子,cause 走 logger 的结构化 meta。位置按 `Logger` 契约区分,
并且是核对源码后确认的而非照抄:`warn(message, meta?)` 没有 `Error` 位,cause 就在**第二**
参;`error(message, error?, meta?)` 的 cause 在**第三**参(第二参塞原始 error 会让每次重试
的记录都附带完整堆栈)。

## 刻意没有改的一件事

`degradedReason` —— `GET /connectors` 展示的、以及 `connector_action` 被拒时引用的那段文本
—— 仍然逐字保留 provider 自己的 message,包含换行。它是人透过 JSON 读的字段,不经按行切分
的消费者;重塑它属于另一次契约变更。因此调用点同时传 `reason`(那段文本)与 `cause`(抛出值
本身):前者喂 husk 与重试簿记,后者只喂日志记录。测试双向钉住了这个分离。
