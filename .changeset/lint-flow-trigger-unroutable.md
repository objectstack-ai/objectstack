---
'@objectstack/lint': minor
---

新增 gating 规则 `flow-trigger-unroutable`（#6637）：`type: 'record_change'` 的 flow 若在 start 节点声明了引擎无法路由的 `triggerType`（如 `onCreate`、`on_update`、`['onCreate']`），现在在 `os lint` / `os validate` / `os build` 与运行时发布闸门上报 `error`。

这是 never-fire 家族里最安静的一种失败。引擎的 `resolveTriggerBinding` 只按字面量 `startsWith('record-')` 认领 record-change flow，落空后整条分支链走到底返回 `undefined`，`activateFlowTrigger` 直接 `return`，该 flow 就被当成手动 flow —— 而专门为「悄悄没绑上」而建的 `getTriggerBindingAudit` 调用的是同一个 resolver，会以「manual / screen flow — nothing to bind」跳过它。因此启动告警和 CLI 启动摘要都不会点名，唯一痕迹是 banner 里 flow 总数比 bound 数多一。

规则范围刻意收窄到「声明了 `record_change`」的 flow：落空到无绑定本身也正是一个 flow 合法地成为手动 flow 的机制，而 `autolaunched` / `screen` 才是手动 flow 声明的类型，所以这条规则在结构上不可能误伤真正的手动 flow。`triggerType` 完全缺失的情形（同样必死）不在本次范围内，另行处理。
