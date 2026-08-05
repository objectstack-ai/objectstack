---
"@objectstack/service-automation": patch
---

fix(service-automation): flow 绑定失败的告警改用结构化 `meta`,不再把 Zod issue 数组塞进单行日志 (#5048)

`AutomationServicePlugin` 的五个 flow 绑定/读取失败点都把 `err.message` 插进一条
单行 `logger.warn`。而 `registerFlow` 用 `FlowSchema` 解析,#4001 关闭 metadata
schema 之后未知键是**抛出**而不是被丢弃 —— ZodError 的 `.message` 是 issue 数组的
多行 JSON dump,第一行就是一个 `[`。

两级管线随后把余下内容销毁:`ObjectLogger.write()` 每次调用只写一条
`<ts> <LEVEL> <msg>` 记录,带换行的 message 会溢出到没有等级前缀的后续行;而
`serve` 的启动诊断缓冲(`BootLogCapture.offer()`)只保留 `classifyBootLogLine`
能认出等级前缀的行。于是一次启动里 24 个绑不上的 flow,给出的是 24 条点了名字、
然后说一个 `[` 的告警 —— cloud#971 能横跨整条 rc.1 发布线没人发现,就是因为这个。

现在这些位置改为:message 是不含换行的静态字符串,事实交给 logger 的 `meta`
第二参(仓库里每个 `Logger` 实现都用 `JSON.stringify` 序列化它,值里的换行变成
`\n` 转义,整条记录稳定占一行,正是启动缓冲会保留的形态)。新增内部模块
`flow-bind-diagnostics.ts` 把 Zod issue 摊平成 `{ code, path, message,
unrecognized }`:`path` 渲染成 `nodes[0].config.x`,被拒的键名放在
`unrecognized` 而不是 Zod 原本的 `keys` —— 因为 `ObjectLogger` 的默认脱敏表
(`['password','token','secret','key']`)按**子串**递归匹配,`keys` 含 `key`,
原样转发 `err.issues` 会渲染成 `"keys":"***REDACTED***"`,恰好丢掉读者唯一需要
的那个事实。issue 列表有上限,超出时用 `issueCount` **显式声明**总数,而不是静默
截断。非 ZodError 的失败退回 `error` 字符串分支。

无公开 API 变化;日志文本的可 grep 前缀(`cold-boot flow bind: failed to
register`、`flow re-sync: failed to register`、`flow pull from ObjectQL
registry failed`、`flow read from protocol failed`)全部保留。与 #4632 同源:
被截断的诊断比没有诊断更贵。
