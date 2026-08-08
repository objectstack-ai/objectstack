---
'@objectstack/objectql': patch
---

LifecycleService 的空间回收(VACUUM 级)与分片轮转(DROP 过期分片)现在也尊重 #4747 的 teardown abort 位。

PR #5956 / #5755 / PR #6397 依次给 reap 分页循环、Archiver 批循环和冷侧 `keep` prune 补上了 abort 判定,但 `sweep()` 里还剩两条同形的腿:

- **空间回收**:abort 判定在对象循环的**头部**,teardown 落在**最后一个**声明对象的 reap 内时,`batchedReap` 因读到 `aborted === true` 而 break,对象循环随即自然结束(不再经过那个判定),控制流直接落到回收循环 —— 向正在关闭的 datasource 发一次 VACUUM 级操作。
- **分片轮转**:对象同时声明 `ttl` 与 `storage.strategy: 'rotation'` 时,ttl reap 已经读过位并 break,返回后轮转仅由 strategy 与驱动能力把关,无判定地 DROP 过期物理分片。

两条腿都是「已经拿到答案之后作出的决定」,而不是恰好横跨 teardown 的一次 await。推迟均无代价:回收是纯粹的页面归还,不删任何行;轮转是 O(1) 的窗口回收,下一轮 sweep 用同一个 `shards × unit` 推出同一个窗口、清同一批分片 —— 至多晚一个 sweep 间隔。

仅声明 `rotation`(无 `ttl`)的一路行为不变:该形态下 `reapObject` 在轮转之前没有任何 await,位在结构上必为 false,而非「无人读过」。
