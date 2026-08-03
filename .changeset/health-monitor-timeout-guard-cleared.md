---
'@objectstack/core': patch
---

fix(core): 健康检查的超时守卫在 race 落定时被清除,周期性检查不再堆积孤儿定时器 (#4875)

`PluginHealthMonitor.performHealthCheck()` 里那条 race 的守卫由 `timeout()` armed 之后就被
扔掉:插件的 `checkMethod` 赢下 race 之后,那根 `setTimeout` 既没 `clearTimeout` 也没
`unref()`,带着 ref 一直挂满整个 `config.timeout`。这与 #4813 修掉的两处(内核 init/start
守卫,PR #4874)是同一种漏法。

差别在于**健康检查是周期性的**:内核那两处是启动时一次性的固定份额(4 个插件 = 8 根),这里
则是**每个插件每一轮各留一根**,`interval` 越密、`timeout` 越长,堆得越高 —— 一个
`interval: 30s` / `timeout: 5s` 的插件在任意时刻都挂着若干根本该在毫秒级就回收的定时器。
今天这条还没发作,只是因为 `startMonitoring()` 目前没有被内核启动流程调用;一旦健康监控被接进
宿主,它就是 #4813 的放大版。

修法与 #4874 同形:`timeout()` 换成私有 helper `raceCheckTimeout()`,`try { await
Promise.race(...) } finally { clearTimeout(guard) }`。

**为什么是 `clearTimeout` 而不是 `unref()`。** `unref()` 让定时器不再钉住事件循环的同时,
也让它不再是一个守卫 —— 若检查永不 settle 且没有别的东西撑着事件循环,Node 会在定时器触发
之前退出,超时被静默吞掉。守卫必须在 race 未决期间保持 ref'd、在落定那一刻被回收,这正是
`finally { clearTimeout(guard) }` 表达的语义。回归测试因此是三条:守卫赢不了时不留 ref'd
定时器、连跑多轮不累积(fake timers 下计数,能识破 `unref()` 式的假修复)、以及检查真的挂住时
超时照常上报。

超时时长(`config.timeout`)一个都没动 —— 问题从来不在时长,而在没人回收。
