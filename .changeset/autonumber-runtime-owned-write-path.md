---
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(objectql): `autonumber` 是运行时拥有的字段,写路径不再接受调用者提交的单号 (#5503)

`autonumber` 的值一直被文档声明为运行时所有 —— `applyAutonumbers` 的注释写着
"the runtime owns the value, not the client",两个记录校验器也正是因此在 insert
与 update 上都豁免了 `required` 检查。缺的是另一半:**没有任何一层写路径阻止客户端
自己填这个值**。于是一个普通的 REST 调用者可以:

- `POST /data/:object` 携带显式单号 → 原样落库,序列被绕过;
- `PATCH /data/:object/:id` 携带该字段 → 200 且改写落库,业务单号被篡改。

这与已修复的 #4447(`created_at` 可被普通 PATCH 伪造)是同一缺陷族。区别在于:
声明了 `readonly: true` 的字段早已被 #2948 / #3043 的剥离机制保护,而 `autonumber`
字段身上根本没有这个标记,剥离循环从它旁边直接走过去了。

**修法:在引擎/校验层把 `type: 'autonumber'` 视为隐含 readonly,insert 与 update
同权。** 非 system 上下文提交的单号,在派发给任何驱动之前就被剥离:

- **UPDATE** —— `stripReadonlyFields`(`packages/objectql`)的判定从"作者声明的
  `readonly: true`"扩展为"作者声明的 **或** 运行时拥有的字段类型"
  (`isRuntimeOwnedField`,当前恰好只有 `autonumber`)。单行更新与 `multi` 批量更新
  共用这一个剥离点,因此两条路径同时被覆盖。
- **INSERT** —— 引擎新增一个更窄的 `stripRuntimeOwnedFields`,只剥离运行时拥有的
  字段。它**不**接管作者声明的 `readonly` 在 insert 上的语义:那条防线按 #3413 的
  设计留在 DataProtocol 入口(#3043),因为 create 确实可能合法地写入只读列,而直接
  调用 `engine.insert` 的可信内部写入者(身份预置、元数据仓库、事件游标)必须不受影响。
  单号没有这种两可性 —— 谁都不该在 create 时自带单号。

剥离发生在引擎里、派发之前,这正是修复**与驱动无关**的原因:声明
`supports.autonumber === true` 的 SQL 驱动(持久序列)拿到的行里根本没有这个键,
所以它的序列必然胜出 —— 没有任何驱动需要改动一行代码。测试直接断言递交给
`driver.create` 的负载,而不是打补丁到驱动上。

**豁免语义保持不变**,与 update 侧原有的白名单完全一致:

- `isSystem` 写入(seed 回放、迁移、内部预置)整体跳过剥离;
- `preserveAudit`(#3493)的"历史数据导入"仍可写入原始单号 —— 把遗留系统的历史
  单号迁移进来正是这个白名单存在的业务场景,而 `autonumber` 属于作者声明的业务字段
  (`system !== true`),恰好落在 `isPreservableUnderAudit` 允许的范围内;
- `beforeInsert` / `beforeUpdate` 钩子计算出的值不受影响 —— 只有**调用者提交**的键
  才是剥离候选。

**这是一次静默剥离,所以它被上报而不是被吞掉。** 引擎 insert 路径上的
`onFieldsDropped`(#3407)此前只是为了与 `update()` 对称而存在、从不触发,并留了一
句"若 insert 将来出现静默剥离,必须在剥离点接上监听器"——现在正是那个剥离点。
事件沿用既有的 `readonly` 原因码(对调用者而言,隐含只读与声明只读被丢弃的理由完全
相同,不值得为一个没有消费者会区分的差别在 `packages/spec` 里分叉词表)。
`createManyData` 与 `insertManyData` 也补上了监听器转发:后者保持**逐行精度**——
引擎事件是整批的并集,但剥离只会移除**行自身提交过**的键,因此可以准确归属回具体行。
导入器优先走的正是 `insertManyData` 这条部分成功路径。

**与 `strictReadonlyWrites`(#5126 / #5610)叠加。** 该开关是"剥离即拒绝"的进程内出路,
本次改动使它自然覆盖单号,两条路径同权:

- **UPDATE 无需新代码** —— autonumber 限肢走的正是 `stripReadonlyFields` →
  `reportDroppedFields` → `assertNoStrictDrops` 这条 #5126 已经铺好的接缝,因此 strict
  开启时,调用者提交的单号与声明 `readonly` 的字段一样被拒绝,整笔写入不落库;
- **INSERT 需要接上** —— #5126 当时把该开关在 insert 上留作惰性,并写下条件:"insert
  一旦有了剥离,两个成员就在那个剥离点一起接上"。本次正是那个剥离点,于是
  `onFieldsDropped` 与 `strictReadonlyWrites` 一并兑现:默认剥离+上报,strict 开启则在
  任何驱动调用之前抛 `ERR_READONLY_FIELD_REJECTED`,且**监听器不触发**(被拒绝的写入
  并未完成,这是 #5126 自己的设计要点)。

接缝处**没有新增任何策略**:#5126 明确写着 strict "不引入第二套策略,它只是把既有策略
报出来",且"剥离拿不走的字段也不会被拒绝"。照此逐字适用,`isSystem` 与 `preserveAudit`
两个豁免在 strict 下依旧被接受(它们根本不会走到剥离分支)。

`ReadonlyFieldRejectedError` 新增可选的 `operation`(默认 `'update'`,#5126 的 UPDATE
文案逐字节不变):动词与补救办法确实因操作而异 —— INSERT 的拒绝必然关于运行时拥有的值,
其合法写入者是 `isSystem` 与历史导入 `preserveAudit`,而 `readonlyWhen` 在 create 上
根本锁不住任何东西。

**升级影响。** 普通(非历史)导入若把遗留单号列映射到 `autonumber` 字段,该值现在会
被丢弃并改由序列发号,同时在响应的 `droppedFields` 里上报、在服务端日志里留下一条
带补救办法的 `warn`。要保留原始单号,请把导入标记为历史导入
(`treat_as_historical` → `preserveAudit`),这与 #3493 为只读业务字段确立的划分一致。

`packages/spec` 未改动:`autonumber` builder 是否应当直接注入 `readonly: true` 是
spec 层的独立议题,与这条引擎侧防线不冲突。
