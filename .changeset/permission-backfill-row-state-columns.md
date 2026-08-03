---
"@objectstack/plugin-security": patch
---

fix(security): 让 permission-set 投影只写 spec 认的键，并把静默失败的 backfill 变响亮 (#4669)

ADR-0094 D4 的 permission-set backfill 在 #4001 之后 **100% 失败**：`sys_permission_set`
每一行都有 `active` 存储列，`permissionSetBodyFromRow()` 把整行转成 metadata body 时把它
一起带上，而 #4001 已经把 `PermissionSetSchema` 封成 `.strict()` —— 于是每一次
`saveMetaItem` 都抛 `[invalid_metadata] … Unrecognized key(s) on this permission set:
'active'`。失败被 `catch` 成一条 `warn`、计数器不加一，所以测试全绿、没有任何自动信号：
一个整条停摆的投影路径就这样过了一个发布周期。

**归属判定：`active` 是行状态，不是声明。** 它的全部消费面 —— 表列、`highlightFields`、
Setup 列表视图的过滤器、两个启停动作的 `bodyExtra: { active: … }` —— 都是记录的运行时开关，
不是作者声明的能力边界。所以修法是在**投影侧挑键**，而不是把状态提升进 spec
（`packages/spec/**` 零改动）。

- `permissionSetBodyFromRow()` / `mergeRowPatchIntoBody()` 现在都经过一个**从
  `PermissionSetSchema.shape` 派生**的键白名单（不是手抄的字符串数组 —— 手抄的话 spec 加键
  时这里又会静默漏，正是本 bug 的翻版）。存储列（`active`、时间戳、`managed_by` /
  `package_id` / `customized`）一律不进 metadata body；`#4001` 之前**已经落库**、body 里
  仍带着 `active` 的历史 overlay 行，也在同一个闸口被滤掉，因此它们的数据门编辑不再报 422。
- 两个启停动作行为不变：只含行状态的 PATCH 不再被改写成 metadata 写入，而是原样交给驱动
  执行列写入（保留 history / `updated_at` / FLS 等正常语义），并且不会再给一个包自带的
  permission set 平白造出一条“customization” overlay。投影通道则不再从 body 读 `active` ——
  一次投影不会再用陈旧 body 把管理员刚停用的 set 重新打开。
- backfill 真失败时按 AGENTS.md「Degradation log levels」(#4632) 变响亮：`error` 级、
  文案写明后果（记录照常列出、看起来一切正常，但定义不在 metadata 里，重新 provision 不会
  重建它）与修复动作，并新增 `ProjectionReconcileOutcome.backfillFailed` 计数，让降级出现在
  结果里而不只在日志里。
