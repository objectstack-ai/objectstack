---
'@objectstack/platform-objects': minor
---

feat(platform-objects): sys_user 记录页新增 Permission Sets 与 Business Units 两个一站式分配 tab (A3, #2920)

管理员现在可在单个用户记录页完成三类分配:岗位(Positions,已有)、直接权限集授权(Permission Sets)、业务单元归属(Business Units)。两个新 tab 均为纯 SDUI 的 `record:related_list` + Add picker:

- **Permission Sets** — junction `sys_user_permission_set`(id-keyed,`relationshipField: 'user_id'`),Add picker 绑定 `sys_permission_set`(`linkField: 'permission_set_id'`)。服务端 audience-anchor(D5/D9)与 delegated-admin(D12)门禁的拒绝原因会显示在 Add 对话框。
- **Business Units** — junction `sys_business_unit_member`(id-keyed,`relationshipField: 'user_id'`),Add picker 绑定 `sys_business_unit`(`linkField: 'business_unit_id'`,按显示字段 `name` 标注)。

tab 顺序为 Positions → Permission Sets → Business Units,四语言标签齐全。
