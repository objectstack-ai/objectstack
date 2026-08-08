---
"@objectstack/spec": patch
---

docs(spec): `lifecycle.storage` 的 rotation 文案补上方言限定 —— O(1) 整分片 DROP 仅在 SQLite 成立 (#6631)

`lifecycle.storage` 块的三处文案把 SQLite 独有的机制写成了 rotation 策略的无条件属性:
`maxAge` guidance 的 "Rotation does not reap by age — it ... DROPs the oldest shard
whole"、`strategy` describe 的 "(O(1) reclaim)"、以及模块 TSDoc 的 "Rotator
(time-shard + DROP oldest)"。实测权威:物理分片是 SQLite-only 的驱动能力
(`driver-sql` 的 `supportsRotation` 只在 `isSqlite` 下为 true,`rotateShards`
在其他方言直接拒绝),Postgres/MySQL 走 LifecycleService 的 `'rotation-fallback'`
分支 —— 按 `created_at` 的年龄批量 reap,恰是旧文案宣称 rotation 不使用的机制。

三处文案改为驱动注释早已写对的表述:保留窗口(`shards` × `unit`)在所有方言上
一致 —— 声明的边界处处成立;回收机制不一致 —— SQLite 整分片 DROP(O(1) 回收),
其他方言按年龄 reap 同一窗口。`maxAge` guidance 的路由建议(用 `shards`/`unit`
设窗口,或改用 `retention`)原样保留。

**纯文案修改,接受面零变化**:`LifecycleSchema` 接受/拒绝的输入集合与改动前
逐字节相同;`superRefine`(含 `retention.onlyWhen` × rotation 的拒绝及其理由)
未触碰。批 20 测试新增两条 pin:guidance 与 describe 必须同时点名两条腿
(SQLite 的分片 DROP 与其他方言的按龄 reap),并各带反空洞守卫,防止整段文案
消失时 pin 静默变绿。
