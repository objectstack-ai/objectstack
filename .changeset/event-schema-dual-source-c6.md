---
"@objectstack/spec": major
---

BREAKING(spec): `@objectstack/spec/automation` 不再导出 `EventSchema` —— 该名字在本包内曾指向**两个键集完全不相交的声明**,automation 侧是孤儿,已删除;`EventSchema` 现在全包唯一地指 `@objectstack/spec/kernel` 的事件总线信封 (#4658, #4535 C6)

`EventSchema` 过去被两个入口导出,但**不是同一个声明**,拿到哪个只取决于 import 路径 —— #4411 陷阱。且两侧不是宽窄之差,是**两个概念**,键集零重叠:

| 入口 | 声明位置 | 形状 | 概念 |
|:--|:--|:--|:--|
| `@objectstack/spec/automation`(**本次删除**) | `automation/state-machine.zod.ts` | `{ type, schema? }` | XState 式**信号声明**(「这台状态机接受哪些事件」) |
| `@objectstack/spec/kernel`(**不变,唯一真源**) | `kernel/events/core.zod.ts` | `{ id?, name, payload, metadata }` | 事件总线**信封**(一条已发出的事件实例) |

automation 侧是**孤儿声明**:`StateMachineSchema` 从不引用它(状态机的事件类型是 `on:` 的**记录键**,纯字符串),`packages/spec` 内外零消费者(objectstack / cloud / objectui 三仓 import 语句级实测均为零)。收敛会把「状态机信号声明」写成「事件总线信封」—— 在合同里写假话 —— 故按维护者裁决(#4658,路线 A)删除孤儿而非收敛。

## FROM → TO

```ts
// FROM —— 编译期起将以 TS2305 失败(实测三仓零命中,预期无人受影响)
import { EventSchema } from '@objectstack/spec/automation';
```

- 若你想要的是**事件信封**(校验一条已发出的事件):

  ```ts
  // TO
  import { EventSchema } from '@objectstack/spec/kernel';
  ```

- 若你想要的是**事件类型的声明**(名字、版本、payload 的 JSON Schema):

  ```ts
  // TO —— kernel 侧本来就有的「事件定义」概念
  import { EventTypeDefinitionSchema } from '@objectstack/spec/kernel';
  ```

- 若你想给**状态机**声明它接受的事件:该表面从来不存在 —— 事件类型写在状态节点 `on:` 的记录键上(`on: { APPROVE: 'approved' }`),被删的 schema 从未接入 `StateMachineSchema`,没有替代物也不需要替代物。

## 定级理由(逐条自证,未照抄前例)

定 **major**,因为这是一次**已发布导出名的移除**:外部 `import { EventSchema } from '@objectstack/spec/automation'` 会以 TS2305 编译失败(与 C14 同形)。

同时它是**零元数据迁移**:

- `automation/Event` def 从 `BUILTIN_METADATA_TYPE_SCHEMAS` 元数据根(24 型)**不可达** —— 以 #4650 门禁同款真 Zod 图 BFS 对合并基线实测复核(输出见 PR;同一次 BFS 里 `StateMachineSchema` 本身可达,证明删除是外科式的)。没有任何元数据文档曾被它解析,`authorable-surface.json` 里对应两行(`automation/Event:type` / `automation/Event:schema`)是过度收集的产物,随整 def 出账(#4650 门禁在本 PR 打印的判定是「def no longer emitted」自证路径),**无 tombstone、无 ADR-0087 conversion / migration**。
- 已存 `sys_metadata` 数据、运行时校验行为全部不受影响;`kernel/events/core.zod.ts` 的 `EventSchema` 一字未动。
- JSON Schema 产物中 `automation/Event` 停止发布(`json-schema.manifest.json` 同步删键,#2978 蓄意移除通道)。

## 基线 13 → 12

`dual-source-exports.baseline.json` 删掉 `EventSchema — [./automation (const)] ≠ [./kernel (const)]` 一行,其余 12 行一字未动。
