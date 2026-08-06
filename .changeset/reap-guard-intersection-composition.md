---
"@objectstack/objectql": minor
---

fix(objectql): 同一 object 的多个 reap guard 现在按交集组合,后注册者不再静默顶掉前者 (#5535)

`LifecycleService.registerReapGuard(object, guard)` 此前是一行 `set()`,契约写明
「One guard per object (last registration wins)」,而注册表是 `private`、无探针、
覆盖时也不打日志。两点合起来:同一 object 上的**第二个注册方静默解除第一个**,且
**无从察觉**。

这在 reap guard 这个座位上格外危险,因为 guard 的语义不是「投票」而是**回执**——
「外部副作用已经做完,这行现在可以删了」。`sys_file` 的 guard 做的正是字节回收:
先 `storage.delete(row.key)`,失败则 veto 把行留到下一轮(行是字节的唯一指针,
先删行就永久泄漏)。任何第二个消费者在 `sys_file` 上注册,这段字节回收会被**整体
解除**:行照删、字节泄漏、零日志。而 ADR-0057 §3.3 的 amendment 恰恰把「domain
callback」认定为 guard 的合法形态,第二个注册方是被 ADR 鼓励出来的,不是假想。

**新契约:交集组合。** 一个 object 可以有多个 guard,注册**追加**而非替换;只有
**全部** guard 都确认的 id 才进删除集,任一 veto 即保留、由下一轮 sweep 重试。这与
单 guard 时的语义完全兼容(现有五条单 guard 回归全部原样通过),也与同文件
`registerRetentionFloor` 的「每个注册方都保留发言权,最严者胜」同构。

写 guard 时值得知道的两点:

- **guard 按注册顺序执行,但只会被问到「前面的 guard 已经确认过」的行。** 这是
  刻意的:被问到即意味着「到目前为止所有人都同意这行可以删」,于是 guard 不会
  为一行别人正要保留的记录做不可逆的清理(否则就会出现「行还在、字节已删」或
  「行还在、索引已删」)。删除集本身与注册顺序无关。
- **guard 抛异常的处置不变**:异常上抛到 `sweep()` 的 per-object handler,该
  object 本轮一行不删(erroring guard 永不 fail open 进删除)。同一批里更早的
  guard 已经做掉的清理由下一轮 sweep 重试,而不会在无人完成确认的批次上兑现成
  一次删除。

重复注册**同一个函数引用**是 no-op(重跑 wiring,不是第二份意见):与自己求交集
不改变任何结果,却会让它的外部清理在每批上跑两遍。

无需调用方改动:`service-storage` 的两个注册方(`sys_file` / `sys_upload_session`)
一行未改,行为逐条不变。本单落地即解除 #4672(知识插件走 reap-guard 去索引化)的
Blocked-by——它可以直接在 `sys_file` 上追加注册,而不必担心顶掉字节回收。
