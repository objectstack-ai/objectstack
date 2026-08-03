---
'@objectstack/objectql': minor
'@objectstack/cli': patch
---

修复:每个 `os migrate` 子命令关停后,#4551 悬空引用巡检都会把 `sys_metadata` / `sys_view_definition` 报成 `unreadableObjects`(#4747)

一条**成功**的命令过去会在返回 JSON 之后打出两行 `ERROR Find operation failed` 和一份
`unreadableObjects` 非空的巡检报告 —— 对抓 ERROR 的 CI 流水线是直接误报源,更要命的是它把
`unreadableObjects` 变成了恒为真的告警:那个桶存在的意义正是区分「我没能检查」和「我检查了,
没问题」,一个每次健康运行都非空的桶不再携带任何信息。

两处静默空转叠出了这个结果:

- `ObjectQLPlugin` 的关停逻辑写在 `stop()` 里,而内核的插件契约是 `init`/`start`/`destroy` ——
  `stop()` 从来没有被任何人调用过,ADR-0057 巡检定时器因此在任何宿主上都不会被解除。改为
  `destroy()`(与 `DefaultDatasourcePlugin` 一致)。
- `bootSchemaStack().shutdown()` 调的是 `(runtime as any).stop?.()`,而 `Runtime` 根本没有
  `stop` —— 可选调用把「没有关停」伪装成了「关停过了」。改为走内核自己的 `kernel.shutdown()`,
  与 `os serve` 收到 SIGTERM 时同一条路径。

同时 `LifecycleService.stop()` 不再只是清定时器:它还会把「引擎正在拆」这一位交给正在飞行中的
sweep,巡检据此在读之前停手。因关停而失败的读**不再进入** `unreadableObjects` —— 那不是关于
数据源的证据;报告改用新增的 `DanglingReferenceReport.aborted` 记录「这次没跑完」,所以不完整
依然是响的,只是不再占用发现桶。

**真正读不出来的对象(数据源故障)照旧进 `unreadableObjects`**,巡检在 CLI 场景也照旧运行 ——
这里没有「一次性命令不跑巡检」的开关,只有「引擎活着才读」的生命周期边界。
