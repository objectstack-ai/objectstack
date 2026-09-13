// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'schedule-flow-acting-organization-required',
  surface:
    'The START NODE `config.organization` key of every time-triggered flow — a `type: '
    + "'schedule'` flow carrying a `config.schedule` cadence, and the `timeRelative` sweep "
    + 'that carries its cadence in the same slot (`FlowTriggerKind` `schedule` / '
    + '`time_relative`). Nothing is renamed, retired or re-typed: the start node\'s `config` '
    + 'is an OPEN record (ADR-0018), so the key is an ADDITION to a slot that already '
    + 'accepted it, and every flow that parses today parses byte-identically after the '
    + 'change. What narrows is the BIND-time accept set and the RUN-time data plane.',
  replacement:
    'Declare the organization the flow runs as, on the start node beside the cadence: '
    + "`config: { schedule: { … }, organization: '<sys_organization.id>' }`. There is "
    + 'deliberately NO fan-out — a sweep wanted in N organizations is N flows, one per '
    + 'organization — and deliberately no fallback: nothing on this path ever chooses an '
    + 'organization, because a wrong `organization_id` is silently authoritative to every '
    + 'report, export and cleanup that filters by organization, while a refusal is visible '
    + 'at boot and names its flow. ⚠️ Three consequences of the split that the declaration '
    + 'itself does not carry, and each is deployment work: (1) rows whose tenant column is '
    + 'NULL stay visible to a scoped read (`org = :tenant OR org IS NULL`), so after the '
    + 'split each such row is matched ONCE PER FLOW — N runs and N notifications for one '
    + 'row, each acting as a different organization; (2) the dispatch-claim key embeds the '
    + 'flow name (`schedule:<flowName>:<window>`, '
    + '`time-relative:<flowName>:<scope>:<recordId>`), so renaming one flow into N abandons '
    + "the current window's claims and a window already delivered under the old name can "
    + 'deliver once more under the new ones; (3) a run SUSPENDED before the upgrade '
    + 'rehydrates its context from `context_json`, which carries no `tenantId`, so it '
    + 'resumes org-less — drain or accept in-flight suspended runs rather than assuming the '
    + 'upgrade confines them retroactively.',
  reason:
    'Maintainer ruling, 2026-09-08, verbatim, untranslated: '
    + '「多组织定时任务本来只能在组织内运行，应该带组织ID，不允许跨组织的定时任务。」 A time-triggered '
    + 'run is launched from a job tick and a job tick carries no identity, so the run reached '
    + 'the tenancy guard with nothing to offer it: the notification wrote '
    + '`organization_id = NULL`, every tenant-scoped row beneath it was refused, and the tick '
    + 'still summarised itself as healthy. ⛔ NOT losslessly convertible, and the reason is '
    + 'that the remedy is a value only the deployment holds: an organization id is minted per '
    + 'install at runtime, so there is no authored artifact and no stored representation a '
    + 'transform could rewrite — `objectstack migrate meta` cannot know which organization a '
    + 'given sweep belongs to, and inventing one is precisely what the ruling forbids. '
    + 'Registered under ADR-0087 D3 rather than left silent because the change DOES carry a '
    + 'prescription — "declare one flow per organization, no fan-out" is deployment work a '
    + 'human must do, which is what D3 says a structured TODO is for. The direct precedent is '
    + '`rest-requireauth-default-flip` (protocol 12): behaviour-only, no shape moved, a '
    + 'deployment judgement no transform can make, registered anyway.',
  acceptanceCriteria:
    'Every `schedule` / `time_relative` flow in the stack declares a non-empty '
    + '`config.organization` on its start node. `os lint` reports '
    + '`flow-schedule-organization-missing` for none of them (severity `warning`, so it does '
    + 'NOT gate a build — an unfixed flow is silently unarmed, which is why the lint run is '
    + 'part of the criteria rather than the build), and boot logs no '
    + '`[schedule] NOT BOUND` / `[time-relative] NOT BOUND` line: '
    + '`getFlowRuntimeStates()` reports `bound: true` and `getTriggerBindingAudit()` lists '
    + 'no time-triggered flow. A deployment that ran ONE flow across all organizations has '
    + 'split it into one flow per organization and has re-checked the three consequences '
    + 'above — NULL-tenant rows, abandoned dispatch claims, suspended runs. ⚠️ '
    + '`@objectstack/driver-memory` has NO legal configuration for a time-triggered flow '
    + 'that touches per-organization data: it refuses any call handed a tenant scope '
    + '(`MEMORY_MULTI_TENANT_UNSUPPORTED`), so a declared flow is refused per call while an '
    + 'undeclared one is not armed at all. Multi-organization deployments use '
    + '`@objectstack/driver-sql`.',
};
