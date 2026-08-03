---
'@objectstack/core': patch
---

fix(core): 插件 init/start 的超时守卫定时器在 race 结束时被清除,进程不再空转 `startupTimeout` (#4813)

`ObjectKernel.initPluginWithTimeout()` / `startPluginWithTimeout()` 各自 `setTimeout` armed
一根超时守卫,然后**把它扔了**:插件赢下 race 之后,那根定时器既没 `clearTimeout` 也没
`unref()`,带着 ref 一直挂到 `startupTimeout` 走完。于是每个进程在活干完之后还要空转整整
一个 `startupTimeout` —— `ObjectQLPlugin` 是 120 秒。

实测(`examples/app-crm`,同一条 `migrate recorded-by --json`,同一个构建链,唯一差别是本
改动):

| | 墙钟 |
|:--|:--|
| 修复前 | 122.4s |
| 修复后 | 3.1s |

JSON 与 `✅ Graceful shutdown complete` 两次都在 ~3 秒出现 —— 后面那 119 秒纯粹是 8 根
孤儿定时器(4 个 init + 4 个 start)钉着事件循环。`os serve` 里同样漏,只是那里进程本来
就长命,看不出来。

**为什么是 `clearTimeout` 而不是 `unref()`。** 隔壁 `shutdown()` 的守卫用的是 `unref()`,
但那个写法在这里是错的,而且不是风格问题:`unref()` 让定时器不再钉住事件循环,**同时也
让它不再是一个守卫** —— 若 hook 永不 settle 且没有别的东西撑着事件循环,Node 会在定时器
触发之前直接退出,超时被**静默吞掉**,谁也不会收到那个 error。守卫必须在 race 未决期间
保持 ref'd,在 race 落定的那一刻被回收,这正是 `finally { clearTimeout(guard) }` 表达的
语义。两个守卫合并为一个私有 helper `raceStartupTimeout()`,措辞与理由写在它的 doc
comment 里。

`startupTimeout` 的取值一个都没动 —— 慢启动的插件需要那个上限,问题从来不在时长,而在
没人回收。
