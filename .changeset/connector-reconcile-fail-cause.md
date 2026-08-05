---
"@objectstack/service-automation": patch
"@objectstack/core": patch
---

fix(service-automation): connector 物化失败的软路径改用结构化 `meta`;顺带修好 `ObjectLogger.error` 丢弃契约第三参的缺陷 (#5575)

## service-automation:`fail(msg, cause)`

`reconcileDeclaredConnectors` 的报错器有两条路径(ADR-0097):冷启动 `throw`(fatal),
`metadata:reloaded` 之后 —— Studio publish、`os dev` 重编译 —— 记日志并让旧 connector
继续服务(soft)。其中两个调用点把**外来**的 `err.message` 插进那条日志 message:
`resolveInstanceAuth` 失败处,以及 provider factory 抛错处。这两个 message 都不是我们
自己的:credential resolver 由宿主提供
(`AutomationServicePluginOptions.credentialResolver`),provider factory 更是 ADR-0097
明确鼓励第三方去写的代码 —— 第一个用严格 Zod schema 校验 `providerConfig` 的 factory
抛出的就是 `ZodError`,它的 `.message` 是 issue 数组的多行 JSON dump,第一行是一个 `[`。

`ObjectLogger` 每次调用只写一条 `<ts> <LEVEL> <msg>` 记录,带换行的 message 会溢出到
不带等级头的后续物理行,于是运行时 stderr 的每一个按行工作的消费者 —— 文件 sink、
`docker logs`/journald 送进日志采集、一次 `grep ERROR` —— 都会把那些续行读成无法归属的
垃圾记录:一条诊断散成 N 个碎片。与 #5048 在 flow 绑定接缝上是同一类,也是同一条 #4632
原则:被搅烂的诊断比没有诊断更贵。

改法与 PR #5572 同源:`fail(msg, cause?)` —— message 是不含换行的自足句子,cause 按路径
分别渲染。soft 路径把 cause 交给 logger 的**结构化 meta**(`issues[]` / `error`);fatal
路径把 cause 文本接在抛出的 message 后面(`… cause: <text>`),因为 throw 不是日志记录,
内核失败通道原样打印,多行 ZodError dump 在终端里本来就好读 —— 同一个 cause,两种受众,
刻意不共用一种形状。`#5048` 引入的内部模块随之从 `flow-bind-diagnostics.ts` 更名为
`thrown-cause-diagnostics.ts`(`describeThrownForLog`),因为它从来不是 flow 专属的:
主题是日志管线,不是 metadata 类型。被拒键名仍放在 `unrecognized` 而不是 Zod 原本的
`keys`(`ObjectLogger` 的脱敏表按子串匹配,`keys` 含 `key`)。

**一处订正**:#5575 的 issue 正文把此处的危害归给了 `serve` 的启动诊断缓冲
(`BootLogCapture`)。那个缓冲看不到这条路径 —— `ObjectLogger` 把 `warn` 送 stdout(启动
静默窗口只包了 `process.stdout.write`),`error`/`fatal` 送 **stderr**,而且 soft 路径在
`metadata:reloaded` 之后才跑,窗口早已恢复。危害是上面那串按行消费者,以及日志查询根本
无法按字段过滤;机制写进了模块文档,连同 `warn`/`error` 下游不同这件事本身。

## core:`ObjectLogger.error`/`fatal` 兑现契约声明的 `meta`

`Logger` 契约声明 `error(message, error?: Error, meta?)`。`ObjectLogger` 按形状分派,
所以 meta 也允许出现在 `error` 位 —— 这份宽容没问题;**丢掉一个自己声明的参数**有问题:
`error === undefined` 时旧代码走 `write(level, message, errorOrMeta)`,第三个参数从未被
读取。于是每一个按契约书写的 `logger.error(msg, undefined, { … })` 都只输出一条裸 message,
事实全部静默消失 —— `metadata`、`metadata-protocol`、`client`、`core/security` 里约 15 处
调用点今天就是这样(其中 `metadata/src/endpoint-matcher.ts` 送的正是一个 Zod issue 数组)。
契约的另外两个实现(`@objectstack/observability` 的 `ConsoleLogger`/`JsonLogger`)都老老实实
用了这个位置,所以是契约对、这一个实现错:declared ≠ enforced。

三种形状现在都被兑现,两个位置同时带值时以更靠后的 `meta` 为准。这一处修好之后,上述
调用点的诊断自动恢复(`client` 的 `HTTP request failed` 记录重新带上
`{method, url, status, error}`)。connector 接缝改用契约的第三参而非第二参,是刻意的:
把原始 error 塞进第二位会让每条记录都附带完整堆栈,ZodError 还会附带整段多行 dump ——
正是我们要消灭的无界形状。
