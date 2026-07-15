---
'@objectstack/plugin-security': minor
'@objectstack/rest': patch
---

feat(plugin-security): C2-β — explain 引擎 record 粒度行级归因 (#2920)

`explain(principal, object, operation, recordId?)` 现支持记录级解释。透传 `recordId` 时，引擎在对象级流水线之上叠加**行级归因**，全部复用 enforcement 同一批函数（explained-by-construction）：

- **`tenant_isolation` Layer 0**：作为永远最先的层被 prepend；每层打上 `kernelTier`（`layer_0_tenant` vs `layer_1_business`），可区分「租户墙挡的」还是「业务 RLS 挡的」。
- **每层 `record` 归因**（tenant / owd_baseline / sharing / rls）：`outcome`（admitted/excluded/not_evaluated）、有效 `rowFilter`、`matchesRecord`（用 `@objectstack/formula` 的 `matchesFilterCondition` 对同一条 FilterCondition 求值)、命中的 `rules[]`（tenant_filter/owd_baseline/ownership/record_share/sharing_rule/team/rls_policy，含 grants/via/effect）。
- **顶层 `record` 判定**：`visible` + `decidedBy` 决定性层。读走复合行过滤匹配，写走 sharing service 的 `canEdit`（均为 enforcement 原语）。
- **`principal.posture`**：ADR-0095 D2 档位（PLATFORM_ADMIN/TENANT_ADMIN/MEMBER/EXTERNAL）的 B2 stand-in 派生（复用 `resolveAuthzContext` 已投影的 platform_admin / org 角色证据），待 B2 合并后替换。
- `computeRlsFilter` 重构为 `computeLayeredRlsFilter`（暴露 `{ layer0, layer1 }` 拆分）+ 薄 andCompose 包装，单一代码路径，行级归因不会与执行漂移。
- REST `security.explain`（GET/POST）接受可选 `recordId`。

**向后兼容**:无 `recordId` 的对象级请求输出 **byte-identical**——无 `tenant_isolation` 层、无 `kernelTier`、无 `posture`、无 `record`。
