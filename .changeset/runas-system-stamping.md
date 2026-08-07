---
"@objectstack/service-automation": patch
---

fix(service-automation): runAs:'system' 的 create_record 按 ADR-0118 染全三列——组织、属主、创建者禁 NULL (#5494)

修的是缺陷,不是新语义——契约是 ADR-0118(#4608)既有的:显式 `isSystem`、fail-closed、
禁 NULL 歧义;`runAs` 声明的是授权姿态而非身份(ADR-0073 D2),提权不等于匿名。

根因:`resolveRunDataContext` 的 system 分支把触发上下文的 `userId` / `tenantId` 整个丢弃,
而三列的平台盖章恰好全部键在被丢弃的信息上——`created_by` 键在写上下文的 `userId`
(ObjectQL 审计钩子)、`owner_id` 键在安全中间件的 acting user(而整条中间件含盖章步骤在
`isSystem` 上短路)、`organization_id` 键在上下文 `tenantId`(驱动层租户机制)。于是用户
触发的 system 清扫流程建出的每一行三列全 NULL:落在组织分区之外(唯一索引跨 NULL 不生效、
org 作用域查询看不见),也落在所有 owner/creator 作用域授权之外——issue 里"admin 都
403"的由来。

修复(writer 侧,`packages/services/service-automation`):

- system 分支把触发身份原样带过去(`userId` + `tenantId`),与 action-body 缝的
  `{ ...caller, isSystem: true }` 信封(hotcrm#548 同族修复)同形:`isSystem` 独自决定
  授权(中间件在读到 `userId` 之前就短路),身份只驱动归因盖章(`created_by`/`updated_by`、
  审计 actor)、驱动层的 `organization_id` 填充,以及下游 record-change 级联的触发身份;
- `create_record` 对 system 运行补 `owner_id` 填充(fill-only、schema 存在才染):所有权锚
  的平台盖章在 `isSystem` 上被短路,payload 是唯一通道;染的是 acting user——与同一触发在
  `runAs:'user'` 下会得到的默认一致,不是把系统身份塞进 owner(ADR-0118 D6 / ADR-0073 D3);
- 流程 `fields` 显式给值一律优先;真正无用户的运行(schedule)保持三列不染——没有 acting
  user 时按 ADR-0118 D1,哨兵串与伪用户都是被禁的替代品,`svc:flow:*` actor 标签 +
  `flowRunId` 继续承担溯源。

行为变化:`runAs:'system'` 且触发上下文带 org 的运行,其数据操作在驱动层按
`(org = 触发 org OR org IS NULL)` 作用域——与 action-body 缝一致的姿态;schedule 触发的
运行不带 org,行为不变。
