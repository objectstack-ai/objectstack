---
"@objectstack/service-automation": patch
---

fix(service-automation): 启动路径三条日志改用结构化 `meta`,message 保持单行 (#5661)

## 接缝

`AutomationServicePlugin` 里还有三处把**外来**错误的文本插进日志 message —— 与
#5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的 `fail()`)、#5636
(`degradeConnectorInstance`)同一类,是那三单范围之外的第四组:

- **`registerRunObject`**(`warn`):`err` 来自内核服务注册表(`ctx.getService('manifest')`
  或 `manifest.register()` 的解析拒绝),文本不是我们的。
- **启动 probe**(`error`):`err` 来自 `candidate.probe()`,即**数据源驱动**抛出的错误。
- **重启后 wait-timer 重新挂载**(`error`):`err` 是从 `rearmSuspendedWaitTimers` 逃出来
  的任何东西。

## 为什么后两条尤其值得改

它们的**存在理由**就是可读性。代码自己写明后果 —— 「suspended runs will NOT survive a
restart」「every wait/approval paused before this restart will hang indefinitely」—— 并被
#4632 特意定为 `error` 级,好让运维能找到。而 `ObjectLogger.write()` 一次调用只加一个
「时间戳 + 级别」记录头,所以带换行的 message 会变成多个物理行、只有第一行有头:文件 sink
把其余行当成独立记录存,采集端读成无法归属的碎片,`grep ERROR` 只捞到那条不含任何事实的
头行。这个 plugin 里最响的耐久性告警,恰好是最可能以读不懂的形态抵达的那一条。

第一条的危害是另一种,并且是测出来的:`warn` 走 **stdout**,正是 `serve` 启动静默窗口包住
的那条流,而 `BootLogCapture.offer()` 只在该物理行上找得到级别头时才保留它 —— 所以续行是
被**直接丢弃**,不只是难解析。`registerRunObject` 在 `init()` 里跑,正处于窗口开着的时候。

## 改法(零新词汇)

三处都复用同包 `thrown-cause-diagnostics.ts` 的 `describeThrownForLog`:message 是不含换行
的自足句子,cause 走 logger 的结构化 meta。参数位按 `Logger` 契约区分 ——
`warn(message, meta?)` 没有 `Error` 位,cause 在**第二**参;`error(message, error?, meta?)`
的 cause 在**第三**参(第二参塞原始 error 会让记录额外附带堆栈)。#4632 要求的「后果 + 修
法」仍然完整留在 message 的第一行里,只是末尾的 `: ${err.message}` / `Cause: ${err.message}`
换成了指向 meta 的一句话。

`pnpm check:durability-log-level` 仍绿:24 个耐久性接缝,三处 `error` 未降级、未改成 rethrow。

## 测试

新增 `plugin-startup-log-cause.test.ts`:13 个用例全部让真 `ObjectLogger` 写真字节再读回来
(照 #5662 的先例 —— spy 只能证明接缝**调用**了什么,证明不了按行消费者会**看到**什么,而
后者才是 cloud#971 付掉一整条 rc 线的那一半)。三条接缝各自钉住「多行 cause 不进 message、
进结构化 meta」、参数位、以及无 cause 时输出零字节;末尾两个用例把插值形态与结构化形态并排
渲染、量出差别(`warn` 侧:一次调用多个物理行、启动缓冲只留下止于 Zod `[` 的那一行;`error`
侧:一条记录散成三个碎片,后两行无记录头)。

`plugin-suspended-run-wiring.test.ts` 里那条 #4420 的 probe 用例做了重新裁决而不是重新拼写:
它原来断言驱动文本出现在 message 里,现在双向断言 —— message 里**没有**、meta 里**有**。
单向的断言在 cause 被整个丢掉时也会通过。
