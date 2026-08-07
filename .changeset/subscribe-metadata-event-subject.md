---
"@objectstack/spec": minor
"@objectstack/client": major
"@objectstack/client-react": major
---

refactor(client)!: `subscribeMetadata` 的 `type` 收窄为 `MetadataEventSubject`，订阅一个合同上永远不会来的事件改为编译报错 (#4627)

`MetadataEventType` 是一个封闭枚举：13 个 metadata 类型 × 3 个动作。#4602 已经把生产端钉成 declared = enforced —— 枚举外的类型（`translation`、`datasource`、`page`、`hook`、`trigger`、`validation` 等，全都是 `DEFAULT_METADATA_TYPE_REGISTRY` 里可注册的真实类型）**不发布**任何 realtime 事件，因为不存在能合法交付给 `(event: MetadataEvent) => void` 回调的事件形状。

消费端却一直是宽的 `string`。于是 `client.events.subscribeMetadata('translation', cb)` 编译全绿、运行永盲：回调永远不会被调用，而类型系统一个字都没说。这正是 AI 写订阅代码最容易踩的形状 —— 它看起来订阅上了。

本次把消费端也钉上，两端对齐后这种代码写不出来。

**新增导出**：`@objectstack/spec/api` 的 `MetadataEventSubject` —— `metadata.{type}.{action}` 的 `{type}` 半边，`'object' | 'field' | 'view' | …`。它是从 `MetadataEventType` **派生**的（模板字面量 + 分发式条件类型），不是在旁边重抄一份，所以两者不可能各说各话：枚举加一个成员，这个联合自动跟着长。`check:api-surface` 记录为 0 breaking / 1 added。

**签名收窄**（三处，全部只是把 `string` 换成这个联合）：

- `@objectstack/client` 的 `RealtimeAPI.subscribeMetadata(type, …)`
- `@objectstack/client-react` 的 `useMetadataSubscription(type, …)`
- `@objectstack/client-react` 的 `useMetadataSubscriptionCallback(type, …)`

**FROM → TO —— 原来传 `string` 的代码怎么改**

枚举内的字面量一个字都不用动，本仓 6 处调用点（`'object'`）零迁移：

```ts
// 照常编译，没有变化
client.events.subscribeMetadata('object', onEvent);
useMetadataSubscription('view');
```

真正被拒绝的只有两种写法，各有各的一行修复：

```ts
// FROM —— 变量声明成了宽的 string
const type: string = route.params.metaType;
client.events.subscribeMetadata(type, onEvent);   // TS2345

// TO —— 把变量（或 state、或路由参数）的类型改成这个联合
import type { MetadataEventSubject } from '@objectstack/spec/api';
const type: MetadataEventSubject = 'object';
client.events.subscribeMetadata(type, onEvent);
```

```ts
// FROM —— 订阅一个没有 realtime 合同的类型
client.events.subscribeMetadata('translation', onEvent);   // TS2345

// TO —— 删掉它。这段代码从 #4602 起就收不到任何事件，
//       编译器现在说的是它一直以来的运行时事实，不是新增的限制。
```

编译器会把每一处指出来，错误码都是 **TS2345**（`Argument of type '"translation"' is not assignable to parameter of type 'MetadataEventSubject'`）。**运行时行为零变化** —— 被拒绝的调用本来就收不到事件，标 major 是因为这是源码级破坏性变更（#5181 的同一条先例：源码级破坏、运行时不变，仍走 major）。

**本次不做、也不预答的**：哪些可注册类型「应该」有 realtime 事件，是 #4627 的轴 2 —— 一个由真实需求驱动的产品覆盖面问题（例如 #4426 的 flow/workflow i18n 若落地会把 `translation` 推上来）。枚举没有动一个成员。派生关系保证了这件事将来只需要改一处：枚举加三个名字，两端同时跟上。
