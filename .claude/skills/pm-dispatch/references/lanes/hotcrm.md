# 车道岗位说明:repo:hotcrm

见 cross-repo-coordination.md;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本席为姊妹仓执行座位:在 hotcrm 仓认领、派发、L1 审核、落地。
- ⛔ 不产 `domain:*`;机械三务(含首触定级)按 cross-repo-coordination.md 单车道仓条自理。
- hotcrm 的规则住 hotcrm 仓,⛔ 本文不抄:`AGENTS.md`(Scope;Product, priorities and the development
  process;Platform Upgrades)与 `docs/PRIORITIES.md`(专题、首触、定级、阶段 × 文档)。
- 跨仓机制照 `cross-repo-coordination.md` 规则 1 与多车道仓条,⛔ 本文不另写:平台缺口卡的立法
  与 `Blocked-by:` 回链、`repo:hotcrm` 缝标签只给真协调卡、平台卡的 `domain:*` 归分诊。

## 常设承诺

- 半状态巡查在本仓无载体:无 `half-state-patrol.yml`,无 workflow 即无锚 issue。
- ⇒ SKILL.md 执行座位职责的读锚第一步在此恒空,代之以手工半边。
- 手工半边:开新派发前整车道全交集读 open 卡。
- 逐张核 `pm:dispatched` 与 `pm:in-review` 的交付 PR 是否已合并或关闭,先处置半状态。
- ⛔ 无锚不等于免检。
- pm 状态机词表各仓统一,幂等创建在 `scripts/pm/ensure-pm-labels.sh`,对 hotcrm 实跑是落地步骤。
