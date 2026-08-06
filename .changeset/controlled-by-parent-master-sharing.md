---
"@objectstack/plugin-security": patch
---

fix(security): `controlled_by_parent` 现在真的跟随主档访问 —— 折入主档的归属与共享授权 (#5386)

**这是一次安全收紧。** 升级后,此前被越权看到 / 写到的明细行会读不到、写不了 —— 那正是
声明本来就要求的边界。

ADR-0055 的 `controlled_by_parent` 对作者的承诺是「子记录跟随父记录的访问」。实现只兑现了
一半:派生用的主档 id 集来自 `computeRlsFilter(master, 'find')`,即只有 Layer 0(租户)与
Layer 1(`rowLevelSecurity` 策略)。归属(owner scope)与 `sys_record_share` 授权由**另一个
插件** `plugin-sharing` 的 `buildReadFilter` 贡献,而它对「有效共享模型不是 `private`」的对象
返回 `null` —— `controlled_by_parent` 在那边恰好映射为 `public`。于是记录级访问的两半在派生
对象上从未相遇。

后果比文档里那句「sharing grants 未折入」读起来严重得多:

- 主档上**没有写任何 `rowLevelSecurity`** 的应用,得到的是一个**不受限的主档 id 集**,派生
  过滤器等于什么都没收窄 —— 只要持有对象级 read,全部明细行可读。行项目类对象(报价行、
  发票行)是这个形状的常客,而它们携带逐行定价与折扣。
- 在主档上补写 RLS 也不是绕法:RLS 与 sharing 过滤器是 **AND**,补写会连同被共享进来的行
  一起切掉。
- 写这半有同样的洞,而且是从另一侧来的:`assertControlledByParentWrite` 只在主档的写 RLS
  编译出非空过滤器时才检查主档行,主档没写 RLS 时**整段跳过** —— 持有 `allowEdit` 的调用者
  可以改自己根本看不到的父记录下的明细。

**修复**:主档可达性改走与「直接读 / 直接写主档」完全相同的路径,复用既有合成点,不在
plugin-security 里重刻一份 sharing 语义。

- 读:`computeControlledByParentFilter` 现在把主档的读 RLS 与 `resolveSharingReadFilter`
  (`getReadFilter` 已经在用的那个 OWD/共享半边)AND 起来再解析主档 id 集。哪一半生效由
  **主档自己的有效共享模型**决定,因此派生出的可见集与直接 find 主档逐点一致。
- 写:`assertControlledByParentWrite` 在原有的 CRUD `update` + 写 RLS 之外,**无条件**追问
  plugin-sharing 的单记录写闸 `canEdit`(归属按写深度放宽、`edit` 级共享、
  `modifyAllRecords` 旁路)—— 无条件,正因为写 RLS 那一半在常见情形下会被整段跳过。
- 两侧解析失败一律**fail closed**(主档 id 集为空 / 拒绝写),而不是悄悄放宽回全员可见。

未变更的部分:v1 的**单层**语义 —— 主档自身的 `controlled_by_parent` 仍不递归下钻;没有装
`plugin-sharing` 的部署行为不变(那种部署里主档本身也没有归属与共享可言,派生集依旧与直接
读主档相等);`read` 级共享仍然只开读不开写,与直接访问主档的逐动词答案一致。
