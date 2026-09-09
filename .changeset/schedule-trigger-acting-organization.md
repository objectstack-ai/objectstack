---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/trigger-schedule": minor
---

fix(triggers,spec,service-automation)!: a time-triggered flow declares its acting organization and the run executes as it (#16659)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: no `packages/spec` key changes its name, its type or its optionality, no stored shape moves, and every flow, node and start-node `config` that parses today parses byte-identically after this change — the start node's `config` is an OPEN record (ADR-0018), so the new `organization` key is an addition to a slot that already accepts anything. What narrows is the BIND-TIME accept set: a `schedule` or `time_relative` flow that declares no `organization` is no longer armed. The remedy is a value that only the deployment holds — a `sys_organization.id`, minted at runtime — so there is no authored artifact and no stored representation a rewrite could act on, and `objectstack migrate meta` has nothing mechanical to prescribe: it cannot know which organization a given sweep belongs to, and inventing one is precisely what the ruling forbids. The refusal names the flow and the key, which is the migration instruction, delivered where the deployment can act on it. -->

**BREAKING** in the accept-set sense — a bind-time narrowing on the two
time-triggered flow kinds — landing in the launch window as `minor` on all
three packages (the lockstep convention: during the window the bump level is
not the carrier, this banner and the disposition above are). Nothing that was
already delivering stops delivering; what stops is a flow that was armed and
inert. Nothing that was refused becomes admitted.

A `type: 'schedule'` flow and a `time_relative` sweep now declare their acting organization on the start node, and the run executes as that organization.

Maintainer ruling, 2026-09-08, verbatim: 「多组织定时任务本来只能在组织内运行，应该带组织ID，不允许跨组织的定时任务。」

A time-triggered flow launches its run from a job tick, and a job tick carries no identity, so `ScheduleTrigger` and `TimeRelativeTrigger` built an `AutomationContext` with no `tenantId`. Two consumers already read that key and both resolved NULL: `notify-node.ts` threads it onto the notification it emits (#11303), and `AutomationEngine.recordLog` copies it onto the `sys_automation_run` history row (#10101). On an install holding more than one `sys_organization` the #8844 guard then refused every tenant-scoped row beneath the run — `sys_inbox_message`, `sys_notification_delivery`, `sys_notification_receipt` and the history row — one layer BELOW anything that summarises a run. So the tick selected its rows, landed its `update_record` steps, reported `unmeasured=0`, and delivered nothing.

- **`@objectstack/spec`** declares the start-node `config.organization` key (`schedule-organization.zod.ts`): `SCHEDULE_ORGANIZATION_KEY`, `ScheduleOrganizationSchema`, the `ScheduleOrganization` type, `resolveScheduleOrganization`, `findScheduleOrganizationNearMissInConfig`, and `describeMissingScheduleOrganization` — ONE refusal sentence and ONE near-miss scan, so the engine's lift and both triggers cannot drift about what counts as declared.
- **`@objectstack/service-automation`** lifts the declaration onto the `schedule` / `time_relative` binding, beside `schedule`. `record_change` and `api` bindings leave it `undefined` by construction: both are fired by a caller who already carries an organization, and lifting a declared one onto them would let a flow overrule the tenant of the write that triggered it.
- **`@objectstack/trigger-schedule`** refuses to bind a time-triggered flow that declares none — at `error`, naming the flow, and dropping any prior binding so a hot re-publish that REMOVES the key cannot leave the previous job armed — and threads the declared organization onto the run as `tenantId`. The refusal is **thrown** from `start()`, not merely logged: `FlowTrigger.start` returns `void`, so a logged-and-returned refusal leaves the engine free to record the flow as bound. Thrown, it takes the engine's designed catch path — the flow is never marked bound, `getFlowRuntimeStates()` reports `bound: false`, and `getTriggerBindingAudit()` lists it, so the `kernel:bootstrapped` warning and the CLI startup summary both name it.

**What an existing deployment feels.** A scheduled or time-relative flow with no `organization` stops being armed at boot; the log line names the flow, the key, where the key goes, and — when the author wrote a near-miss (`organizationId`, `tenantId`, `orgId`, …) — which spelling of theirs the open `config` record accepted and then ignored. On a SINGLE-organization install such a flow was working, because the #8844 guard derives the only organization there; it now needs one line to say so. That cost is the ruling's, not an implementation choice: "declared = enforced" is what makes the multi-organization case safe, and a posture-conditional refusal would leave a flow that is legal on a one-organization install and silently inert the day a second organization is created — which is the defect being closed, moved one step later.

⛔ There is no fallback limb anywhere on this path — not the install's only organization, not the platform organization, not the first row of `sys_organization`, not the swept record's own `organization_id`. A wrong `organization_id` is worse than a refusal: a refusal is visible at boot and names its flow, while a wrong value is silently authoritative to every report, export and cleanup that filters by organization. ⛔ There is no fan-out either: a sweep wanted in N organizations is declared N times, and a single flow never spans them.

**Run-history volume is bounded by a contract that already exists.** Scheduled runs now persist to `sys_automation_run` where they previously could not, and that table's retention is two-sided and declared: a per-flow cap on terminal rows enforced at WRITE time (`runHistoryMaxPerFlow`, default 100) and declarative age retention (`retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } }`, ADR-0057 / #2834, with `paused` rows retained regardless of age). A minute-cadence flow is bounded by the per-flow cap, not by the tick rate. Measured before landing this: nothing in the tree depends on scheduled runs NOT reaching `sys_automation_run` — no test asserts an absent or zero run-history row for a time-triggered flow, and no deployment config, migration or quota keys off that emptiness.

No object's tenancy declaration changes, and `NotifyConfigSchema` is untouched — the two routes the ruling excluded. `system-write-organization.ts` stays exactly as it is: the producer it guards against now carries what it demands.
