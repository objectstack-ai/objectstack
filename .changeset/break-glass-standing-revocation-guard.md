---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): break-glass 不变量补上第三条路径 —— 撤销「管理员身份」的写(`sys_member` 降级/删行、`admin_full_access` 授权删/改)同样被拒 (#5978)

cloud ADR-0024 D5.2 的不变量是「环境永远至少留一个能登录的管理员」。此前它由两个引擎钩子守着,
**都装在 `sys_user` 上**:`banned = true`(#5892 / PR #5939)与删 `sys_user` 行(#5941 / PR #5993)。

但「谁是管理员」这件事根本不存在 `sys_user` 上 —— 它由另外两张表推导(`resolveAdminUserIds`
正是从这两张表反向枚举的)。于是第三条写法完全绕开两个守卫:**用户行原封不动,把他的管理员身份拿掉**。

- 把最后一个管理员的 `sys_member.role` 降到 admin 等级之下(better-auth 的 `updateMemberRole`、
  一次 SCIM 组映射变更、导入、脚本),或直接删掉那条 `sys_member` 行;
- 删掉那条 `admin_full_access` 的 `sys_user_permission_set` 授权,或把它改到不再生效
  —— 改指向别的权限集、加上 `organization_id` 组织作用域、把 ADR-0091 有效期窗口改过去。

三者事后状态与「删掉最后一个管理员」完全等价:所有人都还在,没有任何人能管理任何东西,
产品内部无恢复路径。

**新增的拒写语义。** 守卫现在按同一形状扩到 `sys_member` 与 `sys_user_permission_set` 的
`beforeUpdate` / `beforeDelete`(共六个钩子,同 `packageId`、同 priority 20)。判据就是 issue 的原话
——**枚举、模拟、再枚举**:先枚举当前管理员,再把这次写落地后的行拿同一个枚举函数跑一遍,
若第二次为空而第一次不为空则拒写。两次枚举是同一份实现,「谁是管理员」不可能对写前问题和写后问题
给出两个答案。

- **全覆盖,不是只拦自降级**:真正会发生的是 IdP 组映射改别人的角色,不是管理员给自己降级。
- **谓词/批量写照判**:一次 `where` 命中多行的 update/delete 会先解析出整个匹配行集再做写后模拟,
  而不是一律拒绝;只有匹配集本身解析不出来(读失败,或超过 `maxScan`)才响亮拒写。
- **fail-closed**:枚举失败或形状不确定一律拒写并点名 ADR-0024 D5.2,与既有两半同向。
- 模拟是**单向**的 —— 只会拿走身份,不会授予身份(把 role 从 `member` 升到 `admin`、把授权改指向
  `admin_full_access` 这类写,模拟看不见新增的管理员),因此每一处取整都倒向「拒写」而非「放行」。

**不拦的**:降级到**另一个** admin 等级(`owner` → `admin`,或逗号拼写 `member,admin`)—— 等级未失;
已被 ban 的管理员的身份被撤(本来就不能登录,没有东西被拿走);非管理员的 membership/授权;
以及不触及 `role` / `user_id`(membership)或权限集/作用域/有效期(授权)的 payload —— 这类写
静态可证不改变枚举结果,一次读都不做。

有效期语义按 `resolveAdminUserIds` 现有的 `isGrantActive`(ADR-0091 D2)**原样消费**,本次不新造
(#5893 才是那个问题的归属单)。等级判定全程只问 `isOrgAdminGrade` 这把唯一的尺(#5939 / #5942),
守卫内没有任何手抄的 role 解析。
