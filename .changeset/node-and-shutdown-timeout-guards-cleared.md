---
'@objectstack/service-automation': patch
'@objectstack/core': patch
---

fix: 节点执行与热重载 shutdown 的超时守卫在 race 落定时被清除,不再留下孤儿定时器 (#4952)

#4813(PR #4874,内核 init/start)与 #4875(PR #4950,周期性健康检查)修掉的是同一种漏法:
守卫 armed 之后就被扔掉 —— 被守护的一方赢下 race 之后,那根 `setTimeout` 既没 `clearTimeout`
也没 `unref()`,带着 ref 一直把事件循环钉满整个超时预算。本次清仓剩下的两处生产实例:

- **`AutomationEngine.executeWithTimeout()`**(`service-automation`)—— 三处里量级最大的一处:
  **每个声明了 `timeoutMs` 的流程节点各一根**,孤儿数随流程节点数 × 触发频率线性增长;一次性进程
  (`os` CLI 跑到 flow 的路径)干完活之后还会被最长的那根守卫按住到超时才退出。
- **`HotReloadManager.reloadPlugin()`**(`core`)—— 插件 `destroy()` 的 shutdown 守卫,与 #4813
  修掉的两处一字不差:一次毫秒级完成的热重载,照样把循环钉满 `shutdownTimeout`。

两处修法与 #4874 / #4950 同形,不新造变体:私有 helper +
`try { return await Promise.race([...]) } finally { clearTimeout(guard) }`。`hot-reload.ts` 的
helper 把入参放宽到 `T | PromiseLike<T>`(Plugin 契约允许同步 `destroy()`);`engine.ts` 的不放宽
(`NodeExecutor.execute` 声明返回 `Promise`)。

**为什么是 `clearTimeout` 而不是 `unref()`。** `unref()` 让定时器不再钉住事件循环的同时,也让它
不再是一个守卫 —— 若被守护的一方永不 settle 且没有别的东西撑着事件循环,Node 会在定时器触发之前
退出,超时被静默吞掉。守卫必须在 race 未决期间保持 ref'd、在落定那一刻被回收,这正是
`finally { clearTimeout(guard) }` 表达的语义。两处的回归测试各自沿用 #4950 的双向写法:
真实定时器下不留 ref'd 定时器、fake timers 下连跑多轮不累积(计数能看见 `unref()` 过的定时器,
因此识破 `unref()` 式的假修复)、以及被守护方真的挂住时超时照常上报。

超时时长(`timeoutMs` / `shutdownTimeout`)一个都没动 —— 问题从来不在时长,而在没人回收。
