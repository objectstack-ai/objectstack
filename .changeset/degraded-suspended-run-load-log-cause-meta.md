---
"@objectstack/service-automation": patch
---

fix(service-automation): 降级版挂起态读取器的「存储读不到」告警不再把驱动错误拼进 message,改走 meta (#6230)

`engine.ts` 的 `loadSuspendedRun` —— `loadSuspendedRunStrict` 的**降级版**读取器 ——
在 catch 里把**我们不控制文本**的数据源驱动失败原因直接插进了 `logger.warn` 的 message。
`ObjectLogger.write()` 一次调用只加一个「时间戳 + 级别」记录头,message 里的换行会把
**一条**记录变成多个物理行,后面几行既无级别也无时间戳。

这条比 #5912(PR #6228)刚治完的那条**多一层危害**:`ObjectLogger` 把 `warn` 路由到
**stdout**,而 `serve` 的 boot-quiet 窗口只包了 `process.stdout.write`,其
`BootLogCapture.offer()` 仅在该物理行带级别头时才保留 —— 所以无头续行是被**直接丢弃**,
不只是被误读。而它在 boot 期真实可达:`plugin.ts` 的 `start()` → `rearmSuspendedWaitTimers`
→ 对 overdue 运行 `engine.resume()` → `resume()` 的授权 gate 走的正是这个降级版读取器。

实测:一个三行的 better-sqlite3 驱动错误把这条告警切成 **3 个物理行**,过 boot 缓冲的
过滤后**只剩 1 行**留下 —— 而留下的那一行恰恰不含任何驱动事实。

改法与 #5048 / #5575 / #5636 / #5661 / #5737 / #5912 完全同一套,零新词汇:**message
单行自足**,外来 cause 交给 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)
`warn(message, meta?)` 的**第二**参 —— 注意与 `error(message, error?, meta?)` 的第三参
不同,`warn` 没有 `Error` 槽。

对运维可见的变化(日志形状,非行为):

- 这条记录恒为**一个**物理行,不论日志格式,boot-quiet 窗口内不再丢字节;
- 原因文本从 `msg` 末尾的 `: <驱动文本>` 移到记录的 `error` 字段(`meta`),多行驱动
  错误由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
- message 补上了这条降级的**后果**:读失败被翻译成 `null`,调用方(resume gate、screen
  取数)看到的与「本来就没有这个挂起运行」完全一样,而运行本身未被触碰、仍停在原处;
  原文本只说了「读失败」,没说读失败被翻译成了什么。

刻意**不变**的一处,已钉上回归测试:**级别仍是 `warn`**。这是一个刻意的**功能性**降级
读取器(注释写明它服务于只需要 best-effort 答案的顺带读取方),真正需要区分「存储挂了」
与「运行没了」的 `resumeInternal` 用的是严格版 —— 按 #4632 的判据这不是耐久性降级,
上调到 `error` 才是该规则的镜像误用(整个故障期间每次 gate 查询都报警)。

按记录末尾驱动文本字面量 grep 这条记录的日志查询,需要改成读记录的 `error` 字段。
