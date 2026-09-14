---
"@objectstack/types": minor
"@objectstack/spec": minor
"@objectstack/trigger-schedule": minor
"@objectstack/service-automation": minor
"@objectstack/runtime": minor
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(types,triggers,service-automation,runtime,cli,spec,lint)!: package-authored scheduled work is a deployment decision — `OS_AUTOMATION_SCHEDULED_WORK_ENABLED`, off by default everywhere (#17396)

<!-- adr-0087: not-required (already-registered schedule-flow-acting-organization-required) entry 18 is the ledger row for this exact surface — the start-node `config.organization` key of a time-triggered flow — and this change REWRITES it rather than adding a sibling: its surface, replacement, reason and acceptance criteria now carry the deployment switch and the posture split, so an upgrader reading `objectstack migrate meta`, `spec-changes.json` or the generated upgrade guide gets the narrowed rule from the one row that was always going to be their channel. A second entry would split one prescription across two rows and let a reader act on half of it. -->

Maintainer ruling, 2026-09-12, verbatim, untranslated:

> schedule 是风险很大的模型，尤其在云端，无算是单独多租户还是每库一租户，可能造成极大的资源浪费。对于单租户或着集团版私有部署，我觉得不需要做限制。定时任务 如果不好处理，现在也没想清楚，有没有可能定义为一个环境变量，根据环境变量控制？

> 如果多租户暂时只接禁用定时任务，完整的考虑一下影响面。

> group 默认也关，云端每库一租户全局默认关

**A new deployment variable, `OS_AUTOMATION_SCHEDULED_WORK_ENABLED`, decides whether this deployment runs PACKAGE-AUTHORED scheduled work at all** — time-triggered flows (`type: 'schedule'` with a `config.schedule` cadence, and the `timeRelative` sweep) and packaged `defineJob` cron jobs. It is read at boot beside `resolveTenancyPosture` and is ⛔ **not** a metadata concept and ⛔ **not** a new spec key: whether a clock-driven workload is affordable is a fact about the deployment — its database, its tenants, its budget — that no package author can know, and a metadata key would ask them to.

**OFF by default, in every posture and in every kernel.** Unset means off; `true` / `1` / `on` / `yes` (case-insensitive) means on. ⛔ Deliberately not the opt-out `!== 'false'` shape `OS_MULTI_ORG_ENABLED` uses, which reads a typo as "on" — here that would arm exactly the workload an operator meant to refuse.

⛔ **Platform-internal scheduled work is NOT gated** and runs either way: approvals escalation, the lifecycle Reaper, the messaging dispatch loop, membership backfill. The boundary is **authored by a package**, not "runs on the job service" — the platform's own maintenance is part of the runtime a deployment asked for.

**BREAKING**, in two directions, and both land inside the same launch window as #16659 / PR #17334, so no published version ever saw the rule this narrows.

1. **A NARROWING, and it is the one to plan for.** A deployment that upgrades and does nothing runs **no** packaged time-triggered flow and **no** packaged `defineJob`. Anything that was firing from a package stops. ⇒ Set `OS_AUTOMATION_SCHEDULED_WORK_ENABLED=true` if you depend on it. Nothing detects the shape for you at authoring time, by design — but nothing is silent either: every such flow is listed in `getTriggerBindingAudit()` and the `os dev` / `os start` startup summary with a DISTINCT reason, **disabled by deployment policy**, ⛔ never as "binding failed"; the packaged-job loop says so once per app at `info` with the count; and `os doctor` prints the effective value in both states.
2. **A WIDENING of what binds.** With the switch on and tenancy posture `single`, a time-triggered flow that declares **no** `config.organization` now binds and runs — under #16659 alone it was refused. That posture holds exactly one organization (a second is refused), so the run carries **no** organization and every tenant-scoped insert beneath it resolves that one the way a single-organization install always did; a `timeRelative` sweep there runs **unscoped**. ⛔ Nothing is invented: the key is OMITTED, never filled from the install, the platform organization, or the swept record's own `organization_id`.

**Under a walled posture (`group` / `isolated`) the 2026-09-08 ruling on #16659 stands unchanged**: a time-triggered flow declares `config.organization` or it is not armed, there is no fan-out, and no organization is ever chosen for it. `group` is walled here for a measured reason rather than by analogy — `resolveSystemWriteOrganization` refuses an organization-less system insert under any wall and `TenancyService.defaultOrgId()` answers `null` (ADR-0093 D3), so an organization-less group-wide sweep could read the whole group while every row it inserts is refused. Which organization such a sweep's inserts belong to is not yet decided; until it is, `group` behaves as walled.

**`flow-schedule-organization-missing` is DELETED** from `@objectstack/lint` (the id and its exported constant, `FLOW_SCHEDULE_ORGANIZATION_MISSING`; both are unreleased — they were introduced by the still-unconsumed #16659 changeset in this same window, so no consumer can be holding either). The rule family's criterion is *is this stack enough to know the flow is dead?*, and the honest answer here is no: the deployment switch and the tenancy posture decide it, and neither is in any stack. A finding that is false for the default deployment is noise. ⛔ The near-miss diagnostic did **not** go with it — `describeMissingScheduleOrganization` and its `organizationId` / `tenantId` / … scan still fire at BIND, the one door that can read both facts, and only where the key is actually required.

**ADR-0087 semantic entry 18 (`schedule-flow-acting-organization-required`) is REWRITTEN, not added.** Its acceptance criteria required every time-triggered flow to declare; that is no longer the rule. It now prescribes the two decisions in order — decide the switch, then declare per organization under a wall — and records that `os lint` reporting nothing is the criterion being met rather than a check that was skipped. The unconsumed `.changeset/schedule-trigger-acting-organization.md` carries a banner saying the same, so a reader of either one cannot get the narrower half alone.

**Where the switch is read, and where it is not.** Both triggers gate at `start()`, ahead of the descriptor and the declaration, so an operator on a deployment that was never going to run a flow is not sent to fix a descriptor nothing would have read. `AutomationEngine.activateFlowTrigger` reads the same resolver and does not call `start()` at all when it is off — that is what keeps the audit's reason precise, since a refusal arriving as a THROW can only be reported through the catch that says "Failed to bind". Neither read is cached: the resolver reads `process.env` live, so a host that rebinds after the environment changes sees the value current at the bind. The scope is `schedule` and `time_relative` only — `record_change` and `api` are fired by a caller that already exists and already carries an identity, and a kind added to `FlowTriggerKind` later is OUTSIDE the switch until someone decides otherwise, because a new capability that disappears on arrival is the worse default.
