---
"@objectstack/service-automation": patch
---

fix(service-automation): `wait` 节点的五条日志不再把外来 cause 拼进 message,改走 meta (#5737)

`builtin/wait-node.ts` 里有五处记录把**我们不控制文本**的失败原因(数据源驱动、
job 服务、`engine.resume()` 的错误信封)直接插进日志 message。`ObjectLogger.write()`
一次调用只加一个「时间戳 + 级别」记录头,所以 message 里的换行会把**一条**记录变成
多个物理行,后面几行既无级别也无时间戳。在 `pretty` / `text` 格式(`os dev` / `os serve`
的默认)下,文件 sink 会把它们当成独立记录存,日志采集器读成无主碎片,而
`grep ERROR` 只捞得到不含任何事实的那一行 —— 恰恰是运维正在找的那条。

五处现在都改成:**message 单行自足**,外来 cause 交给 logger 的结构化参数位 ——
按 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)选位置,`warn(message, meta?)`
用第二参,`error(message, error?, meta?)` 用**第三**参(第二参留空,否则每条记录都
会带上整个栈)。与 #5048 / #5575 / #5636 / #5661 完全同一套修法,零新词汇。

对运维可见的变化(日志形状,非行为):

- 这五条记录各自恒为**一个**物理行,不论日志格式;
- 原因文本从 `msg` 末尾的 `Cause: …` 移到记录的 `error` 字段(`meta`),多行驱动错误
  由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
- 消息里原本指向拼接文本的「the cause below」措辞改为指向记录的 meta;
- 级别一律不变。其中三处是 #4632 明确定为 `error` 的耐久性诊断
  (`rearmSuspendedWaitTimers` 的 store 不可列、overdue 运行叫不醒、唤醒 job 没排上),
  仍是 `error`,`pnpm check:durability-log-level` 照旧覆盖;「无 job 服务」那条声明式
  缺失仍是 `warn`。

按 `Cause:` 字面量 grep 这五条记录的日志查询需要改成读记录的 `error` 字段。
