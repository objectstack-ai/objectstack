---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/core": minor
---

feat(spec,objectql): `engine.transaction` 契约收紧第一批 —— `opts.require` fail-closed 与 `owned` 信号 (#5696)

`IObjectQLEngine.transaction` 的声明面(`packages/spec/src/contracts/objectql-engine.ts`,
ADR-0119 D1)此前把「默认驱动之外的对象写在事务外」与「驱动没有 `beginTransaction`
时静默降级」写成**声明语义**的一部分。#4619 把这两条降级变得可观测(PR #5724),本次
把其中两条收紧为调用方可选的契约,并同步修订 TSDoc 的事实性偏差。

**新增(可选,默认行为完全不变):**

- `transaction(cb, base, { require: true })` —— 驱动没有 `beginTransaction` 时
  **抛 `TransactionUnsupportedError`(`code: 'ERR_TRANSACTION_UNSUPPORTED'`)**,
  而不是静默降级成「无事务、无回滚」。在回调运行**之前**拒绝,所以调用方收到错误时
  一行都还没写。这是把 `batchData` 的 atomic 门(ADR-0119 D4)泛化成通用能力:
  只为「开事务的唯一理由就是回滚」的调用方而设,不传 `require` 的行为一字未变
  (仍然降级 + warn-once)。
- 回调的**第二个参数** `{ owned: boolean }` —— `true` 表示本次调用开启了事务并拥有
  提交/回滚,`false` 表示它 **join** 了外层已开的 ambient 事务(ADR-0067 D2),
  或者处在降级路径上(那里根本没有事务可拥有)。join 语义本身正确且保留;缺的是
  调用方**无从分辨**,而「整体一起回滚」这类担保只在 owned 时成立。单参数回调不受影响。

两点在 `ctx.api.transaction`(`ScopedContext.transaction`,沙箱 hook/action 体)上
同样生效 —— 同一个原语的第二份实现不该变成第二种方言。

**契约文本修订:** transaction 的 TSDoc 原先写「路由到别处的对象在事务**外**写入」,
实测不符 —— 引擎无条件把 ambient 事务句柄穿给了目标驱动,语句在**错误的连接**上执行
(#5351 在真 SQL driver 上实测为 `no such table`)。TSDoc 已按实测改写,并声明了随后
落地的两条语义:业务写跨驱动**响亮拒绝**、系统账本(`lifecycle.class` 为
`audit`/`telemetry`/`event`)**移出事务执行**。

**类型面:** `@objectstack/core` 的 `EngineWithTransaction` 从「手抄签名」改为
`transaction: IObjectQLEngine['transaction']`,窄接口可以窄,但不能与真签名漂移。
新导出 `EngineTransactionOptions` / `EngineTransactionInfo`(spec `contracts` 命名空间,
经 `@objectstack/core` 转出)。

升级须知:无破坏性变更。既有调用点全部保持原行为;要 fail-closed 的调用方显式传
`{ require: true }`。
