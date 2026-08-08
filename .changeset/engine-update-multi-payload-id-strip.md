---
'@objectstack/objectql': patch
---

`multi: true` 更新的 SET 载荷不再携带 `id`——算子对象不会再被写进每一行的主键列

`update(o, { id: { $in: ['a','b'] }, title: 'x' }, { multi: true })` 的**派发**自 #5748 裁 A / PR #5919 起就是对的:算子对象不是主键,不再遮蔽派发阶梯,声明的 bulk intent 照做,调用落到 `driver.updateMany`。#5919 没有做、#5922 也按 PD #10 明确留在范围外的,是**载荷**那一半。实测(origin/main,记录型 driver 驱动真实引擎):

```
updateMany({ object: 'probe_task' }, { "id": { "$in": ["a","b"] }, "title": "x" })
                                       ^^^^^^^^^^^^^^^^^^^^^^^^ 这是 SET 子句
```

即驱动被要求把一个序列化的算子对象写进**每一条命中行**的主键列。五个后端会对这件事各给一个答案(#5240 / #4434 家族),而在接受它的后端上,命中行的身份不可逆地丢失。

修法是**剥离**:走到 multi 分支本身就意味着 `resolveEngineUpdateDispatch` 答了 `multi`,即它在**两个** id 来源里都没找到真值标量 id——所以此刻 `data.id` 里的任何东西(算子对象、数组、`null`、假值标量)都是引擎**已经裁定不是主键**的值。同一个问题的同一个答案,只是多用在一层上:不是主键的东西,也就不该坐在主键列上。

- **零 verdict 变更**:`ENGINE_UPDATE_DISPATCH_CASES` 一行未动,`operator object in data.id WITH multi:true` 仍是 `'multi'`,`engine-update-dispatch.test.ts` 全绿。响亮拒绝(#6262 的 B 案)要反转这条刚落地的 case,属对 #5748 裁 A 的部分回退,需要新裁决,不在本次范围。
- **无可达的合法写入被吞掉**:真值标量 `data.id` 压过 `where` 与 `multi`,根本到不了这个分支;而 N 行也不可能共用一个主键。
- **单 id 路径零变化**:`driver.update(object, id, data, …)` 的主键走的是独立参数,载荷里的 `id` 只是冗余而非破坏,本次不动(已按现状钉死)。
- **假值标量同判**:`{ id: 0 }` / `{ id: '' }` 的**判定语义**按 #5747 / #5748 原样不变(仍是 `multi`),载荷同样剥离——把算子对象剥掉却把假值标量留下,等于对同一个事实立第二条规则,正是 `engine-update-dispatch.ts` 这一族被抽出来防止的事。

被剥离时按 `warn` 记一条日志,点明后果与两种正确写法(单行按 id 更新 / 用 `where` 选行集)。刻意**不**走 `onFieldsDropped`:`DroppedFieldsEvent.reason` 是 `readonly` / `readonly_when` 两值的闭合枚举(#3407 / #3042),扩这个词表是 `packages/spec` 的改动、有 batch 与 REST 协议响应两处消费者,不该搭引擎修复的车。
