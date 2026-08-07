---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): hierarchy resolver 拿到调用方真实的活动组织(权威 `organizationId`)(#5859)

`resolveOwnerScopeIds` 构造 `HierarchyScopeContext` 时读的是
`(context as any).organizationId` —— **仓内没有任何传输层写过这个键**。REST
(`rest-server.ts`)和 runtime dispatcher(`resolve-execution-context.ts`)都从同一个
授权解析器 `resolveAuthzContext` 组装执行上下文,活动组织落在 `tenantId`
(session 路径 = `session.activeOrganizationId`,API-key 路径 = `sys_api_key.organization_id`),
`ExecutionContext` 的字段注释写的也正是这句。所以这个读取**结构性恒为 `null`**:
自 ADR-0057 以来,每一次 DEPTH(`unit` / `unit_and_below` / `own_and_reports`)解析
都是在**没有组织约束**的前提下跑的,而企业版 resolver 只按 `organizationId` 收窄
自己的 owner 集合 —— 于是整条 DEPTH 租户隔离从未生效。

爆炸半径不止「共享管理」一路:同一个 owner 集合喂给 `matchesOwnerScope` →
`canEdit` / `canDelete`,以及批量写路径 `buildWriteFilter`。#5852 的实测里,
`group` 姿态下的普通成员对**兄弟组织**记录 `POST /data/:obj/:idB/shares` 得到
**201**;探针那个 app 的写路径另被 `member_default` 的 `owner_only_writes`
(keyed on `created_by`)挡下,所以只观测到共享管理一路 —— **不带这条 owner-only
RLS 的部署,跨组织 edit/delete 同样放行**。

本次修复(producer 半边,契约半边见 #5858 / PR #5973):

- 权威字段 `organizationId` 由执行上下文的活动组织填充;`tenantId` 作为
  `@deprecated` 兼容别名原样继续携带(不是消费端 `?? tenantId` 兜底 —— 那正是
  #5858 为 resolver 明令排除的宽容消费者形状)。同样的映射在
  `@objectstack/plugin-security` 的 Layer-0 租户墙里早已在用
  (`computeTenantLayer0Filter({ organizationId: context?.tenantId })`),两层
  enforcement 现在按同一个字段的同一个值收窄。
- 无活动组织时如实传 `null`(契约类型即 `string | null`),空白字符串归一为
  `null`,绝不让一个假的组织 id 混进 resolver 的查询与日志。
- resolver 抛错的静默回退改为**留声**(`logger.warn`):此前「resolver 炸了」和
  「层级里确实没有别人」在外部完全同形,这也是本缺陷长期不可见的原因之一。

## 姿态感知的组织门(user-visible 行为变化)

`SharingService` 新增一个 late-bound 的 `tenancy` 姿态探针(读法与 `SecurityPlugin`
为 Layer-0 墙读 `tenancy` 服务的完全一致,由 `SharingServicePlugin` 自动接线),
按 **ADR-0105 D1** 的既有分叉决定「没有活动组织」意味着什么 —— 与
`computeTenantLayer0Filter` 对同一问题给出的答案逐条同形:

- **`single`**(纯单租户,无组织):**行为不变**,DEPTH 照常widened。此处「没有组织」
  是那一个隐含租户,不是「所有组织」。
- **`group` / `isolated`**(有墙):权威组织缺失/空白 → **拒绝**,根本不咨询 resolver,
  回落 owner-only 并打一条点名 ADR-0095 D1 / ADR-0105 D1 与 #5973 契约义务的 `warn`。
  即:有墙部署里,缺组织的 owner-scope 解析从「按无租户约束展开」变为「拒绝展开」。
- **姿态解析不出**(未接线 / 探针抛错 / 词表外的值)→ 按**有墙**处理。未知姿态不是
  `single` 的证据,否则恰恰在配置已经可疑的部署上恢复了展开。

对已有部署的影响:`single` 部署零变化;`group` / `isolated` 部署中,一个**没有活动
组织**的调用方将不再通过 DEPTH 拿到跨组织的 owner 集合(共享管理 / edit / delete /
批量写四条路径同时闭合)。
