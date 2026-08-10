---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): share-link 路由把完整授权信封交给 enforcement,修复 `group` 姿态下建链恒 403(#6206,裁决 A 案的消费半边)

`SharingServicePlugin` 的 share-link 路由此前在 `resolveAuthzContext` 之后重新
拼一个四字段对象(`userId` / `tenantId` / `positions` / `permissions`),而这个
对象被原样当作 enforcement context 喂进 `engine.find` —— 即 [Finding-2]
「只能为你自己看得见的记录建链接」那道可见性校验。被丢在半路的是
`accessible_org_ids`、`org_user_ids`、`systemPermissions`、`posture`、
`tabPermissions`。

实害(已复现,非仅代码读出):`group` 租户姿态下 `accessible_org_ids` 就是
Layer 0 那堵墙(ADR-0105 D2),集合缺席即判否(fail closed)。于是可见性校验
查不到任何行,建链接对**调用方本来读得到的记录**返回
`403 FORBIDDEN: Not permitted to share <object>/<id>` —— 一个已发布姿态上,
已发布功能完全不可用。`single` 姿态(默认)不读该字段,行为不变。

改法按维护者 2026-08-07 的 A 案裁决(契约半边 #6430 / PR #6511 已落):信封
**整个**透传(`{ ...authz, isSystem: false }`),不再逐字段挑选 —— 逐字段挑选正是
这条缝出问题的方式,也是下一个新增授权维度会再次漏掉的地方。`posture` 随上下文
流动、不在 enforcement 处重推(ADR-0095 D2)。窄类型 `ShareLinkExecutionContext`
保留,但只服务路由自己的 401 判定(认证与否),不再出现在任何裁决路径上。

`ShareLinkService.createLink` / `revokeLink` / `listLinks` 与 `canManageShares`
探针的参数类型随之收成完整 `ExecutionContext`,与 #6511 落地的契约一致。
