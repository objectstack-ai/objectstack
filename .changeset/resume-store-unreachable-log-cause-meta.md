---
"@objectstack/service-automation": patch
---

fix(service-automation): resume 时「存储不可达」的日志不再把驱动错误拼进 message,改走 meta (#5912)

`engine.ts` 的 `resumeInternal` 在读挂起态存储失败的那一支,把**我们不控制文本**的
数据源驱动失败原因直接插进了 `logger.error` 的 message。`ObjectLogger.write()` 一次
调用只加一个「时间戳 + 级别」记录头,所以 message 里的换行会把**一条**记录变成多个
物理行,后面几行既无级别也无时间戳。在 `pretty` / `text` 格式(`os dev` / `os serve`
的默认)下,文件 sink 会把它们当成独立记录存,而 `grep ERROR` 只捞得到不含任何事实
的那一行 —— 恰恰是运维正在找的那条。实测:一个三行的 better-sqlite3 驱动错误把这条
告警切成 **3 个物理行**,只有第 1 行带 `ERROR` 头。

改法与 #5048 / #5575 / #5636 / #5661 / #5737 完全同一套,零新词汇:**message 单行
自足**,外来 cause 交给 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)
`error(message, error?, meta?)` 的**第三**参(第二参留空,否则每条记录都会带上整个栈)。

这是这条 resume 路径上最后一处。#5737(PR #5911)修完 `wait` 节点五处之后,同一次
「resume 时存储不可达」会产生两条记录:wait 节点那条已是干净单行,engine 这条仍被
切碎;本次之后两条都干净。

对运维可见的变化(日志形状,非行为):

- 这条记录恒为**一个**物理行,不论日志格式;
- 原因文本从 `msg` 末尾的 `: <驱动文本>` 移到记录的 `error` 字段(`meta`),多行驱动
  错误由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
- message 补齐了 #4632 要求的后果与修法(挂起态**未被消费**、运行仍停在原处、存储
  恢复后可原样重试),并指明 cause 在本记录的 meta 里。

刻意**不变**的两处,已各自钉上回归测试:

- **返回值信封** `AutomationResult.error`(`STORE_UNAVAILABLE`)仍逐字拼接驱动文本。
  它是给调用方读的结构化返回值,经 REST 出去是 JSON 字符串字段、不按行切分;#5636
  对 `degradedReason` 是同源取舍,且 PR #5911 已让 wait 节点侧把它整体放进 meta 保留。
- **级别仍是 `error`**。运行在盘上而 resume 没落地,正是 #4632 定义的耐久性降级,
  `pnpm check:durability-log-level` 照旧覆盖。

按记录末尾驱动文本字面量 grep 这条记录的日志查询,需要改成读记录的 `error` 字段。
