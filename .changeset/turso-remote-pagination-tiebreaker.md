---
'@objectstack/driver-turso': patch
---

fix(driver-turso): remote 分页读补齐确定性排序，与 local 面共用同一条规则

`TursoDriver` 在 remote 传输(`libsql://` / `https://` 等 URL)下的分页读不满足
`IDataDriver.find` 的确定性分页 MUST：`RemoteTransport.buildSelectSQL` 把调用方的
`orderBy` 原样拼进 SQL 后直接接 `LIMIT` / `OFFSET`，不追加任何唯一列，无序分页读
更是完全不排序。SQLite 不承诺并列行在两条语句之间排布一致，所以表一大、计划一变，
`ORDER BY status LIMIT 50 OFFSET 50` 翻页时就会有记录出现两次、另一条永远不出现 ——
每一页都是满的、每一行都合法，从任何单个响应里都看不出来。

同一个驱动的 local 面早已按 #4363 办事，于是一个驱动的两条传输对同一个分页查询给出
不同的排序保证，而传输模式只由 URL 决定。

修法是**复用**而不是复制：`TursoDriver.find` / `findOne` 现在通过继承来的
`SqlDriver.orderKeysFor()` 解析出完整排序键再交给传输层，三态规则只有一份实现 ——

| `orderBy` | 分页 | 结果 |
|---|---|---|
| 非空 | 任意 | 调用方的键 + `id` |
| 空 | 有 `limit`/`offset` | 单独 `id` |
| 空 | 都没有 | 不加 ORDER BY（#4363 carve-out，原样保留） |

`findOne` 的语义一并保住：它的 `limit: 1` 由传输层自己注入，若在 `buildSelectSQL`
里判定就会被误读成「页大小为 1 的第一页」，从而给系统里最热的读加上
`ORDER BY id LIMIT 1` —— 正是让计划器放弃谓词自身索引的形状。

唯一列的判定沿用 local 面同样保守的前提：只有本驱动自己建的表才追加 `id`
(`RemoteTransport` 建表时无条件写入 `"id" TEXT PRIMARY KEY`)；不是自己建的表保持
原样并告警一次，绝不凭空发明排序列。
