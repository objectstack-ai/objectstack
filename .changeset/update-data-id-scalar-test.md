---
"@objectstack/metadata-core": patch
"@objectstack/objectql": patch
---

fix(metadata-core,objectql): `ObjectQL.update` 的 `data.id` 同过标量测试,不再把载荷里的算子对象当主键 (#5748)

`ObjectQL.update(object, data, options)` 用两处取主键,而这两处此前用的是**两套规则**:

- `options.where.id` 走**标量测试** —— `{ id: { $in: [...] } }` / `{ id: [...] }` /
  `{ id: null }` 是多行谓词,不算 id(#4434 / #4550);
- `data.id` **不做任何测试**,只要为真就原样当主键,并且先于 `where`、也先于
  `options.multi`。

于是同一个算子对象,写在 `where.id` 里被正确识别为谓词,写在 `data.id` 里却被
当成主键绑进 `driver.update(object, id, …)` 的主键位置,**显式声明的
`multi: true` 被无声忽略**。后果不是数据被覆盖,而是静默失灵或难读的驱动错误:
SQLite 侧报参数绑定错误,别的驱动可能只匹配零行 —— 两种都不会告诉调用方
「你的 `multi` 被忽略了」。这是 declared ≠ enforced 的一种,#5393 刚给 flow 的
`update_record` 补上的 `multi` 批量意图键正是被这条更早的规则盖掉的。

现在 `data.id` 与 `where.id` **共用同一个标量测试**(判定在
`packages/metadata-core/src/engine-update-dispatch.ts` 定义一次,`engine.ts` 与
全部 fake engine 经 `resolveEngineUpdateDispatch` /
`assertEngineUpdateDispatch` 复用同一份)。非标量 `data.id` 不算 id,因此不再
盖住任何东西:判定按 `where.id` → `multi` → `reject` 的原有阶梯继续往下走。

**行为矩阵(FROM → TO)。标量 `data.id` 的按 id 写法完全不受影响。**

| 调用 | FROM | TO |
|:---|:---|:---|
| `update(o, { id: 'rec_1', …f })` | by-id `'rec_1'` | **不变** |
| `update(o, { id: 'rec_1', …f }, { multi: true })` | by-id `'rec_1'` | **不变**(标量 `data.id` 仍先于 `multi`) |
| `update(o, { id: 'rec_1', …f }, { where: { id: 'rec_2' } })` | by-id `'rec_1'` | **不变**(标量 `data.id` 仍先于 `where`) |
| `update(o, { id: 0, …f }, { multi: true })` | multi | **不变**(真值判定,`0` 不标识行) |
| `update(o, { id: { $in: [...] }, …f }, { multi: true })` | by-id,算子对象被绑进主键位 | **multi** —— 声明的批量意图被执行 |
| `update(o, { id: ['a','b'], …f }, { multi: true })` | by-id,数组被绑进主键位 | **multi** |
| `update(o, { id: { $in: [...] }, …f })`(**无** `multi`) | by-id,算子对象被绑进主键位 | **reject**,消息不变:`Update requires an ID or options.multi=true` |
| `update(o, { id: { $in: [...] }, …f }, { multi: false })` | 同上 | **reject** |
| `update(o, { id: { $in: [...] }, …f }, { where: { id: 'rec_1' } })` | by-id,绑的是**算子对象** | by-id,绑的是 **`'rec_1'`** |

最后一格是这次修复里唯一「判定不变、绑定值变了」的一格 —— 前后都是 `by-id`,
变的是哪一个 id 源胜出。`ENGINE_UPDATE_DISPATCH_CASES` 因此新增可选的
`expectId`,把落进主键位的值本身也钉住,避免用例因为「什么都没产出」而绿。

**「无 `multi` 的非标量 `data.id`」被明确定成响亮拒绝**,不会静默升级成一次真的
批量写 —— 这是裁决(维护者 2026-08-06)对方案 B 那条顾虑的处置:把算子对象写进
载荷大概率是写错了位置,那就报错,而不是替作者决定他想批量写。

无 API 变更:导出符号、类型与 `ENGINE_UPDATE_REJECT_MESSAGE` 的文案均不变。
