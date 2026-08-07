---
"@objectstack/spec": major
---

feat(spec)!: `system-data` 的桶默认不再包含 CSV `import`,改为按对象显式 opt-in (#4671)

**FROM → TO:`managedBy: 'system-data'` 的默认 affordance 从
`create/import/edit/delete/exportCsv: true` 收窄为
`create/edit/delete/exportCsv: true`,`import: false`。** 需要 CSV 导入向导的对象
显式写一行:

```ts
export const SysHolidayCalendar = ObjectSchema.create({
  name: 'sys_holiday_calendar',
  managedBy: 'system-data',
  userActions: { import: true }, // 明确要这个入口
});
```

`platform` 现在是唯一默认授予 `import` 的桶。其余五个桶(`config`、`system-data`、
`engine-owned`、`append-only`、`better-auth`)一致地把它留给对象自己声明。

## 具体消失的是哪几个 UI 入口

仓内 8 个 `system-data` 对象都不再从桶默认继承导入向导,其中要紧的是三张 RBAC 关联表 ——
它们是整个权限模型的**授予面**:

| 对象 | v17-rc.3 之前的管理台入口 | 本次之后 |
| :--- | :--- | :--- |
| `sys_user_position` | 「CSV 批量绑定用户 ↔ 岗位」 | 不再出现(需显式 opt-in) |
| `sys_user_permission_set` | 「CSV 批量绑定用户 ↔ 权限集」 | 不再出现(需显式 opt-in) |
| `sys_position_permission_set` | 「CSV 批量绑定岗位 ↔ 权限集」 | 不再出现(需显式 opt-in) |

另外 5 个成员(`sys_user_preference`、`sys_approval_delegation`、
`sys_notification_template`、`sys_notification_subscription`、
`sys_notification_preference`)同样从「有导入入口」回到「无导入入口」。

**要恢复其中任意一个,在该对象上加 `userActions: { import: true }` 即可** —— 只动
`import` 这一个动词,create/edit/delete/exportCsv 仍走桶默认,不需要像 v16 那样把整块
`userActions` 抄回来。

## 为什么

授权边界一点没动。`import` 是 **affordance**,只决定 UI 入口是否渲染;CSV 导入写下的每一行
仍然逐条经过 `DelegatedAdminGate`、RLS 与权限集裁决 —— 一个无权手工授予某权限集的 admin,
通过 CSV 同样授不出去(ADR-0103 D5 关于 enforcement 的结论完全不变)。

变的是**杠杆**:逐行点选时一次误操作影响一个人;一份错误 CSV 就是一次批量授权,且没有天然的
复核节奏 —— 而这三张表恰好决定「谁能做什么」。所以批量授予入口应当是一次显式声明,而不是
「被归进了正确的桶」就自动继承的东西。对成批继承桶默认的 AI 生成对象元数据尤其如此:
「没想过 import」的默认结果落在安全侧,打开它则是 reviewer 能看见的一行。

原先「默认含 import」出自 #3355 上更早的 agent 会话(评论带 Claude Code 脚注),不是维护者
拍板;当时的实现 agent 自己标注了这条 security-adjacent 并指出裁决可能未考虑批量绑定权限集
这一具体场景。维护者 2026-08-03 正式裁决收窄,2026-08-06 最终确认。记录见 ADR-0103 的
#4671 addendum。

## 升级影响

**从 v16 升上来的用户:零影响。** v16 的 `managedBy: 'system'` 默认 LOCKED,8 个成员各自用
`userActions: { create, edit, delete }` 重开写入,没有一个重开 `import` —— 所以 CSV 导入在
v16 就解析为 `false`,改名后仍是 `false`。#3355 的 4 个包逐对象 before/after 等价 pin 因此
从「四动词等价 + 一条 import 差异」变成**五动词全等价**,并新增一条 opt-in 可达性 pin。

**已在 v17 rc.1–rc.3 上依赖 `system-data` 默认导入入口的用户:** 加
`userActions: { import: true }`。
