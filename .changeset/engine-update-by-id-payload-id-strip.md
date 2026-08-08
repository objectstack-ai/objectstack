---
'@objectstack/objectql': patch
---

by-id 更新的 SET 载荷不再携带「已被判定不是主键」的 `id`——算子对象 / 数组 / `null` / 假值标量不会再覆盖被更新那一行的主键列

`update(o, { id: { $in: ['a','b'] }, title: 'x' }, { where: { id: 'rec_1' } })` 的**派发**自 #5748 裁 A / PR #5919 起就是对的:算子对象不是主键,判定顺着阶梯落到 `where.id`,绑定 `rec_1`(`ENGINE_UPDATE_DISPATCH_CASES` 里就写着这一行,`expect: 'by-id'` / `expectId: 'rec_1'`)。#6262 / PR #6433 收口的是 **multi 臂**的载荷;**by-id 臂**的同一半一直没做。实测(origin/main,记录型 driver 驱动真实引擎):

```
driver.update('task', 'rec_1', { "id": { "$in": ["a","b"] }, "title": "x" })
                                 ^^^^^^^^^^^^^^^^^^^^^^^^ 这是 SET 子句
```

`driver-sql` 的 `update()` 用**整个** `data` 出 `formatted`(`applyWriteColumnMap(formatInput(object, data))`,`id` 不在任何跳过名单里),于是 SQL 形如 `UPDATE task SET id = '{"$in":["a","b"]}', title = 'x' WHERE id = 'rec_1'` —— rec_1 的行标识被一个序列化的算子对象不可逆地覆盖。

修法与 #6262 同构:**剥离**,而且只剥「派发已经裁定不是主键」的那一份。成员资格不在这里重新推导,而是**调用派发本身**去问(`resolveEngineUpdateDispatch(data, undefined)` 为 `by-id` 当且仅当 `data.id` 是真值标量)——`asScalarId` 是**故意不导出**的,"给同一个问题添第三种公开写法,正是一条规则长出第二条的方式"。

- **零 verdict 变更**:`ENGINE_UPDATE_DISPATCH_CASES` 一行未动,同一个调用仍派发 `by-id`、仍绑 `rec_1`,`engine-update-dispatch.test.ts` 全绿。响亮拒收(路线 B)要反转这条 case,属对 #5748 裁 A 的部分回退,需要新裁决,不在本次范围。
- **标量 `data.id` 刻意不动**:那里载荷的 `id` **就是**被绑定的主键(标量 `data.id` 压过 `where` 与 `multi`),写出来是 `SET id = 'rec_1' WHERE id = 'rec_1'`,同值空写,冗余而非破坏,且是长期行为;要不要一并剥是另一个决定,已按现状钉死(对照 pin)。
- **`data: { id: null }` 的回写入口是可达的**(静态读取,非端到端 HTTP 复现):REST 的 `PATCH /data/:object/:id` 只剥 `expectedVersion`,`UpdateDataRequestSchema` 把 `data` 声明为 `z.record(z.string(), z.unknown())`(接受 `null`),协议层 `updateData` 再把请求体**原样**交给 `engine.update(object, data, { where: { id } })`。客户端 GET 一条记录、改两个字段、整体 PUT 回来而序列化把 `id` 写成 `null`,就落在这里。
- **假值标量同判**:`{ id: 0 }` / `{ id: '' }` 的**判定语义**按 #5747 / #5748 原样不变(仍绑 `where.id`),载荷同样剥离——只剥算子对象而留下假值标量,等于对同一个事实立第二条规则。

被剥离时按 `warn` 记一条日志,点明后果与两种正确写法。与 #6262 同样刻意**不**走 `onFieldsDropped`:`DroppedFieldsEvent.reason` 是 `readonly` / `readonly_when` 两值的闭合枚举(#3407 / #3042),扩这个词表是 `packages/spec` 的改动、另有消费者,已单独记为 #6437。
