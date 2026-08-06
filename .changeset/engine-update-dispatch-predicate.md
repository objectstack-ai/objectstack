---
'@objectstack/objectql': patch
---

`ObjectQL.update` 的三分支派发抽成生产者侧唯一判定 `engine-update-dispatch.ts`

`delete` 的派发决策自 #4550 起就是一份共享判定(`resolveEngineDeleteDispatch`),任何顶替引擎的测试替身都能 import 它,因此结构上不可能比引擎更宽松。`update` 的同款三分支——标量 `where.id` → 按 id;`options.multi` → `driver.updateMany`;否则抛错——此前只是 `engine.ts` 里的一个内联字面量 throw,既没有导出的常量也没有可复用的函数。后果不是理论上的:#5393 给 flow 的 `update_record` / `delete_record` 补真实契约测试时,delete 侧能把假引擎钉死在生产者契约上,update 侧只能退而断言执行器交出的 options 包,并在文件头写明「不对引擎会不会接受它发表第二份意见」——因为唯一的替代做法是在 fake 里手抄一遍判定,而手抄必然漏掉 `where: { id: { $in: [...] } }` 看着像 id 实为谓词这一半(#4434 正是这样带着全绿的测试发布了一条对每个调用者都回 500 的路由)。同一个执行器的两个写入动词,一个能被绑定到生产者契约、另一个结构上不能,而谓词 update 的破坏性并不低——它覆盖每一行匹配记录的字段。

本次新增:

- `packages/objectql/src/engine-update-dispatch.ts`,导出 `resolveEngineUpdateDispatch` / `assertEngineUpdateDispatch` / `scalarUpdateId` / `ENGINE_UPDATE_REJECT_MESSAGE` / `ENGINE_UPDATE_DISPATCH_CASES`,均从 `@objectstack/objectql` 公开导出;
- `ObjectQL.update` **自身改用它**——生产者与判定必须是同一份,否则只是第二份副本。

这是**行为保持的重构**:三分支语义、`$in` 谓词判定、拒绝消息文本一字未改(`Update requires an ID or options.multi=true`,现在是导出常量 `ENGINE_UPDATE_REJECT_MESSAGE`)。判定里有两处刻意照抄而非「改良」了生产者的现状,并在模块头与测试中写明:

1. `data.id` **不做标量测试**,只要为真就直接作为 id,且优先于 `where` 与 `multi`;
2. 分支按**真值**而非 `!== undefined`,所以 `where: { id: 0 }` 不走按 id 路径。

比生产者更「聪明」的判定就是第二份意见,正是 #4550 消除的东西;这两点该改的时候会在两个文件里一起改,现在那是一次编辑而不是两次。

新测试 `engine-update-dispatch.test.ts` 不去对照写在旁边的期望表,而是用记录型 driver 驱动**真实引擎**跑完 `ENGINE_UPDATE_DISPATCH_CASES`,逐例断言引擎的实际行为等于判定的裁决——两半唯一同处一室的地方。
