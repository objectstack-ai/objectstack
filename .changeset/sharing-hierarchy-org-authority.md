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

安全收紧:按组织收窄 owner 集合的 resolver(企业版即是)从此真正拿到组织,
跨组织的 share 管理 / edit / delete / 批量写全部按组织边界闭合。
