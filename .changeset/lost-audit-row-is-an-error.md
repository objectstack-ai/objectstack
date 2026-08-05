---
'@objectstack/plugin-audit': patch
---

审计行写失败改为 `error` 级,并只报一次

按 AGENTS.md「Degradation log levels」的判据,审计写失败属 **durability / data-consistency** 类而非 functional 类:被审计的那次写入本身成功、数据已落库、接口返回 200,从外面看一切正常,只有记录「谁做的」的 `sys_audit_log` 行没有落地,而且没有任何重试。这正是 #4420 在合规账本上的同一形状,因此原先的 `WARN Audit write failed` 升级为 `error`。

这条 `error` 同时给出**后果**与**修复方向**:审计轨迹已不完整;`sys_audit_log` 受 ADR-0057 §3.6 生命周期分流,注册了 `telemetry` 数据源时会被路由过去(`os dev` 默认以兄弟 SQLite 文件形式提供一个),所以出现 "no such table" 通常意味着该次写入执行在了与建表处**不同**的数据源连接上;`OS_TELEMETRY_DB=0` 可让所有 lifecycle-classed 对象留在主数据源。

审计写发生在**每一次**数据变更上,因此该 `error` 全进程**只报一次**(后续失败降为 `debug`,细节仍可通过提高日志级别取回)—— 每次失败都报一遍会训练所有人略过 `error`,而这正是当初让 #4420 的 `warn` 无人阅读的反射。

写入点提取为具名的 `persistAuditTrailRow`,并登记进 `scripts/check-durability-degradation-log-level.mjs` 的 `DURABILITY_CRITICAL_CALLEES`,由 `pnpm check:durability-log-level` 守住该级别,防止日后被悄悄改回 `warn`。
