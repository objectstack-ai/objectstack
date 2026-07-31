---
---

docs(adr): ADR-0117 记录级业务单元归属（owning business unit）提案

仅新增一份 ADR 文档，不改动任何包的代码或公开 API，因此不发布任何版本。

提案内容：给记录归属补上缺失的中间一层。今天一条记录只有 `owner_id`（人）与
`organization_id`（租户墙），"属于哪个部门/哪个法人"是从所有者推导的（层级深度
档位最终编译成 `owner_id IN (…)`），带来归属漂移、无所有者语义的数据没有归属、
报表没有可聚合列三个问题。

ADR 提出 `owning_business_unit_id` 记录戳（挂靠既有 `ownership` 轴、新增
`business_unit` 一档）、三档盖章策略、`org_id` 由 BU 链推导的不变量、复用
`allowTransfer` 的写入守卫，以及把 `IHierarchyScopeResolver` 从返回 owner id
列表改为返回谓词规格的破坏性契约变更。实现另行开 PR。
