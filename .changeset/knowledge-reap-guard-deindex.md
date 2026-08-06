---
'@objectstack/service-knowledge': patch
---

知识索引在保留期回收(reap)删除行之前先去索引,不再留下孤儿条目(#4672)。

`object` 知识源是**逐记录投影**,而 `LifecycleService` 的保留期回收按谓词删行 ——
ADR-0057 §3.3 又禁止把它扇出成 N 条逐记录事件(清理会回灌正在清空的表)。结果是行没了、
文档还在:孤儿条目仍会占掉 `topK` 名额(权限过滤发生在适配器返回之后),`isSystem`
调用方还会直接读到它们。

现在 `KnowledgeServicePlugin` 会为每个被 `object` 源投影的对象注册一个 ADR-0057
**reap guard**:sweep 在删除前把候选行交给 guard,guard 按 id 删除对应文档,只确认删除
成功的行。

- **失败方向**:`adapter.delete` 失败 ⇒ 该行本轮**保留**,下次 sweep 重试。允许「行比索引
  条目活得久」,绝不允许反过来。
- **组合语义**:多个 guard 按交集组合(#5535),因此它既不会顶掉 `service-storage` 的字节
  回收 guard,也不会被其顶掉。
- **分批**沿用 sweep 自身的约束(每批 500 行、每轮 20 批)。
- **退出开关**:源上的 `refresh.onRecordChange: false` 或插件的 `enableEventSync: false`
  会同时关掉两个方向的内联同步(事件订阅与 reap 去索引)。

零新增契约面:未新增任何 spec 键、`IKnowledgeAdapter` 成员或 `packages/objectql` 改动 ——
经由既有的 `ctx.getService('lifecycle')` duck-type + `registerReapGuard` seam 接入,与
`service-storage` 回收 `sys_file` 字节的方式一致。

应用层谓词写(调用方自己的 `multi: true` 写)**仍不覆盖**,#4639 的 warn 保留并已改写为
准确描述这条分界。
