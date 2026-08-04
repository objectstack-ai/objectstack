---
"@objectstack/plugin-approvals": patch
---

fix(approvals): 删除两处读 `session.roles` 的 admin 豁免 —— 记录锁与委托守卫回到单一权限词汇 (#4839)

`plugin-approvals` 的 `lifecycle-hooks.ts` 里有两处 admin 豁免,都读
`ctx.session.roles`:审批**记录锁**的 `bindApprovalLockHook`,以及
`sys_approval_delegation` 的 `bindDelegationWriteGuard`。两处都已删除。

**这不是行为变更。** `session.roles` 在整个平台没有生产者 —— ObjectQL 的
`buildSession()` 逐字段构造 session,从不写 `roles` —— 所以两个分支在任何真实引擎
路径上都是死代码,记录锁一直就对 admin 生效,委托一直就只能本人管理。删除让代码
说出运行时本来就在做的事(spec 的 `HookContext` 声明了 `roles`,消费方在读,生产方
从不写:典型的 declared ≠ enforced)。

**为什么不是「改用正确判据」而是删除。** `roles.includes('admin')` 还是第二套权限
方言:本仓库的权限一律由 ADR-0095 词汇裁决(能力授予 `permissions`、任职
`positions`、由其派生的 posture),ADR-0090 D3 更是直接禁掉 `role` 这个拼法。同包的
`ApprovalService.isOverrideActor` 已经这么做了。维护者裁定两处都取「删除」而非改判据:

- **记录锁**:admin 释放锁定记录的正规路径已经存在(#3424 —— `recall` /
  `decideNode` 驳回 / `reassign`,全部由 `isOverrideActor` 把关并留痕
  `via_override`)。让审批终结来释放锁,记录就永远不会在审批在途时被改写 —— 这正是
  合规场景购买记录锁所要的保证。
- **委托**:最终语义确定为**仅本人管理**(`delegator_id` 必须等于写入者;只有 system
  上下文旁路)。审批人临时不可用时,替他处置**在途**审批用的是
  `reassign`(把该审批人的名额交给替代人,连 per_group 分组归属一起带过去)/
  `recall` / 驳回。反过来,「替别人建一条委托」本来也做不到这件事:委托只在请求
  **开启**时(`resolveApproverSpec` 内的 `applyOooDelegation`)被查询,对已经挂在该
  审批人名下的在途审批毫无作用。

新增 `admin-exemption-retired.test.ts`,把上述证据变成可执行断言,并加了一道源码级
pin:本包非测试源码中不得再出现 `roles` 标识符或与字符串 `'admin'` 的比较。

spec 侧 `session.roles` 的退役(至此零消费方)按 ADR-0049 enforce-or-remove 另立协议
单处理,不在本次改动内。
