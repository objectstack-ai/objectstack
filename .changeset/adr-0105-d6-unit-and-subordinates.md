---
"@objectstack/lint": patch
---

fix(lint): 扩 ADR-0105 D6 ② 的收件人词表至 ADR 原文范围 —— `unit_and_subordinates`
也判红

`org-axis-cross-org-bu-grant`(D6 ②)此前只对 `sharedWith.type ===
'business_unit'` 判红,而授权面**更大**的另一个业务单元收件人
`unit_and_subordinates`(一个 BU **加上其全部后代单元**,ADR-0057 D5 子树扩张)
直接放行。两者的缺陷完全相同:平台级对象(`tenancy.enabled: false` /
`systemFields.tenant: false`)没有 organization 列可供 Layer 0 收口,BU 子树没有
任何 organization 可供解析,授权因而跨到库里每一个 organization —— 正是 ADR 拒绝
的"跨 org BU 巨树",从后门到达。

漏掉的恰恰是 ADR-0105 D6 ② 自己点名的那一个:

> Every BU mechanism — `unit_and_subordinates` sharing, `adminScope`
> delegation, depth scopes — operates within one organization. There is no
> cross-org tree.

判定改为收件人类型 ∈ `{ business_unit, unit_and_subordinates }`,诊断信息里点名
**实际写下的**类型并说明其触及范围(子树那一个额外写明 "AND every descendant
unit"),修复建议改为指向三个扁平收件人。

词表与 spec 枚举 `ShareRecipientType` 的差集不再是隐式的:规则里以表格逐条写明
拦截二者、放行 `user` / `team` / `position` 的理由(它们的运行时展开都不经
`BusinessUnitGraphService`,是 `tenancy.enabled: false` 平台级目录**被设计用来**
共享的方式),并附一条测试断言两半恰好划分 `ShareRecipientType` —— 将来枚举加成员
会在词表处失败,而不是无声地落进没人选过的那一桶。#4991 正是这条断言缺席的产物。

这是 error 级门禁的扩张,因此复核了真实元数据:`examples/app-showcase` /
`app-crm` 是仓库里仅有的已声明 sharing rule(共 11 条),全仓无任何对象关掉
tenancy,扩张后 org-axis 红线数为 **0** —— 不产生新红。
