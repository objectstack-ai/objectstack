---
'@objectstack/metadata-core': patch
---

`resolveEngineDeleteDispatch` 末尾改真值测试:假值标量 `where.id` 不再答 `by-id`

`engine-delete-dispatch.ts` 的自我描述是「what does `ObjectQLEngine.delete` do with this call」的**唯一**答案,其测试文件头把赌注写得很明白:一份漂移的共享判定比没有判定更糟——每个钉在它上面的假引擎都会自信地、一致地错,而门禁照样报绿。这条性质此前在**假值标量 id** 上不成立,实测(origin/main,记录型 driver 驱动真实引擎):

| 调用 | 真实 `ObjectQL.delete` | 判定(修改前) |
|:---|:---|:---|
| `{ where: { id: 0 } }` | `reject` | `by-id` |
| `{ where: { id: '' } }` | `reject` | `by-id` |
| `{ where: { id: 0 }, multi: true }` | `multi` | `by-id` |
| `{ where: { id: '' }, multi: true }` | `multi` | `by-id` |

原因是两侧问了不同的问题:判定读 `scalarDeleteId(...) !== undefined`,而 `engine.ts` 把判定结果落进 `id` 之后按 `if (hookContext.input.id)` 分支——**真值**测试,`0` / `''` 落到 multi/reject 阶梯。于是按 `assertEngineDeleteDispatch(options)` 钉死的替身会**接受** `delete(o, { where: { id: '' } })`,而真服务器抛 `Delete requires an ID or options.multi=true`:pinned 替身在这一个输入上仍比生产者宽松,正是本模块存在的理由(#4434 形状)。`id: ''`(路径段为空 / 表单字段未填直传 `where.id`)是可达形状,不是猎奇。

本次改的是**判定,不是引擎**。`resolveEngineDeleteDispatch` 是对 `ObjectQL.delete` 的描述,错的是描述:`delete(o, { where: { id: 0 } })` 改动前抛错,改动后照样抛错,**生产者行为零变化**,`engine.ts` 一字未动。反向做法(让 `{ id: 0 }` 变成真的按 id 删)是改生产者行为,已作为 #5747 的 B 方案明确不取。

同时给 `ENGINE_DELETE_DISPATCH_CASES` 补上 `{ id: 0 }` / `{ id: '' }` 的有/无 `multi` 四例——此前这套逐例对照**结构上够不到**这个输入(#4868 家族:一次逐例跑不可能反驳一个没人列出来的输入),这才是判定能悄悄漂移一年的原因。`scalarDeleteId` 保持值忠实(`{ where: { id: 0 } }` 仍返回 `0`),真值测试只加在判定这一层,与 update 侧孪生模块 `scalarUpdateId` 的分法一致。
