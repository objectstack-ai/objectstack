---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/trigger-schedule": minor
"@objectstack/lint": minor
---

fix(triggers,spec,service-automation,lint)!: a time-triggered flow declares its acting organization, and both its query and its run are confined to it (#16659)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: no `packages/spec` key changes its name, its type or its optionality, no stored shape moves, and every flow, node and start-node `config` that parses today parses byte-identically after this change — the start node's `config` is an OPEN record (ADR-0018), so the new `organization` key is an addition to a slot that already accepts anything. What narrows is behaviour, in two places, and neither is an authorable shape: the BIND-TIME accept set (a `schedule` or `time_relative` flow that declares no `organization` is no longer armed) and the RUN-TIME data plane (a time-triggered run, and a `time_relative` sweep's own query, are confined to the declared organization). Both are decided from the same key at runtime; no stored item is rewritten by either. The remedy is a value that only the deployment holds — a `sys_organization.id`, minted at runtime — so there is no authored artifact and no stored representation a rewrite could act on, and `objectstack migrate meta` has nothing mechanical to prescribe: it cannot know which organization a given sweep belongs to, and inventing one is precisely what the ruling forbids. The refusal names the flow and the key, which is the migration instruction, delivered where the deployment can act on it. -->

**BREAKING** in the accept-set sense, and in TWO places rather than one —
landing in the launch window as `minor` on all four packages (the lockstep
convention: during the window the bump level is not the carrier, this banner and
the disposition above are). Nothing that was refused becomes admitted.

1. **Bind time.** A `schedule` or `time_relative` flow that declares no
   `organization` is no longer armed.
2. **Run time — the DATA PLANE.** A time-triggered run now carries a
   `tenantId`, and a `time_relative` sweep now carries one on its own query.
   Where a run previously read, updated and deleted across every organization,
   it is now confined to the one it declares.

⚠️ **Read (2) as a narrowing that can stop something that was working**, because
it is one. Two shapes to plan for, and neither is hypothetical:

- **A deployment running ONE time-triggered flow to cover ALL organizations must
  now declare one flow per organization.** That is the ruling
  (「不允许跨组织的定时任务」) and it is the whole point, but it is migration
  work: there is no fan-out, and a sweep wanted in N organizations is N
  declarations. Nothing detects the shape for you — the flow simply starts
  seeing one organization's rows.
- **On a SINGLE-organization install a time-triggered flow WAS delivering** —
  the #8844 guard derives the only organization there — and after this change it
  is unarmed at boot until someone adds one line. That install loses nothing at
  run time (its one organization is the only scope there was), but the flow does
  stop until it is declared.

A `type: 'schedule'` flow and a `time_relative` sweep now declare their acting organization on the start node, and the run executes as that organization.

Maintainer ruling, 2026-09-08, verbatim: 「多组织定时任务本来只能在组织内运行，应该带组织ID，不允许跨组织的定时任务。」

A time-triggered flow launches its run from a job tick, and a job tick carries no identity, so `ScheduleTrigger` and `TimeRelativeTrigger` built an `AutomationContext` with no `tenantId`. Two consumers already read that key and both resolved NULL: `notify-node.ts` threads it onto the notification it emits (#11303), and `AutomationEngine.recordLog` copies it onto the `sys_automation_run` history row (#10101). On an install holding more than one `sys_organization` the #8844 guard then refused every tenant-scoped row beneath the run — `sys_inbox_message`, `sys_notification_delivery`, `sys_notification_receipt` and the history row — one layer BELOW anything that summarises a run. So the tick selected its rows, landed its `update_record` steps, reported `unmeasured=0`, and delivered nothing.

- **`@objectstack/spec`** declares the start-node `config.organization` key (`schedule-organization.zod.ts`): `SCHEDULE_ORGANIZATION_KEY`, `ScheduleOrganizationSchema`, the `ScheduleOrganization` type, `resolveScheduleOrganization`, `findScheduleOrganizationNearMissInConfig`, and `describeMissingScheduleOrganization` — ONE refusal sentence and ONE near-miss scan, so the engine's lift and both triggers cannot drift about what counts as declared.
- **`@objectstack/lint`** teaches `validate-flow-trigger-readiness` the requirement, so an author learns at authoring time rather than from a production stderr line at boot. It re-implements no judgement: `resolveFlowTriggerKind` says which flows owe the key and `resolveScheduleOrganization` says whether one was declared, which are the same two answers the triggers refuse with. Severity `warning`, not `error` — see **The four flows this repo itself ships** below.
- **`@objectstack/service-automation`** lifts the declaration onto the `schedule` / `time_relative` binding, beside `schedule`. `record_change` and `api` bindings leave it `undefined` by construction: both are fired by a caller who already carries an organization, and lifting a declared one onto them would let a flow overrule the tenant of the write that triggered it.
- **`@objectstack/trigger-schedule`** refuses to bind a time-triggered flow that declares none — at `error`, naming the flow, and dropping any prior binding so a hot re-publish that REMOVES the key cannot leave the previous job armed — and threads the declared organization onto the run as `tenantId`, **and onto the `time_relative` sweep's own query**. The refusal is **thrown** from `start()`, not merely logged: `FlowTrigger.start` returns `void`, so a logged-and-returned refusal leaves the engine free to record the flow as bound. Thrown, it takes the engine's designed catch path — the flow is never marked bound, `getFlowRuntimeStates()` reports `bound: false`, and `getTriggerBindingAudit()` lists it, so the `kernel:bootstrapped` warning and the CLI startup summary both name it.

**What an existing deployment feels.** A scheduled or time-relative flow with no `organization` stops being armed at boot; the log line names the flow, the key, where the key goes, and — when the author wrote a near-miss (`organizationId`, `tenantId`, `orgId`, …) — which spelling of theirs the open `config` record accepted and then ignored. On a SINGLE-organization install such a flow was working, because the #8844 guard derives the only organization there; it now needs one line to say so. That cost is the ruling's, not an implementation choice: "declared = enforced" is what makes the multi-organization case safe, and a posture-conditional refusal would leave a flow that is legal on a one-organization install and silently inert the day a second organization is created — which is the defect being closed, moved one step later.

⛔ Nothing on this path ever CHOOSES an organization — not the install's only one, not the platform organization, not the first row of `sys_organization`, not the swept record's own `organization_id`. (The trigger does read the declared value from two places, the lifted binding field and the raw start-node `config`; that is one value read twice, so an engine predating the lift reports a correctly declared flow as declared instead of turning a version skew into an authoring error. It resolves nothing the author did not write.) A wrong `organization_id` is worse than a refusal: a refusal is visible at boot and names its flow, while a wrong value is silently authoritative to every report, export and cleanup that filters by organization. ⛔ There is no fan-out either: a sweep wanted in N organizations is declared N times, and a single flow never spans them.

**Run-history volume is bounded by a contract that already exists.** Scheduled runs now persist to `sys_automation_run` where they previously could not, and that table's retention is two-sided and declared: a per-flow cap on terminal rows enforced at WRITE time (`runHistoryMaxPerFlow`, default 100) and declarative age retention (`retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } }`, ADR-0057 / #2834, with `paused` rows retained regardless of age). A minute-cadence flow is bounded by the per-flow cap, not by the tick rate. Measured before landing this: nothing in the tree depends on scheduled runs NOT reaching `sys_automation_run` — no test asserts an absent or zero run-history row for a time-triggered flow, and no deployment config, migration or quota keys off that emptiness.

No object's tenancy declaration changes, and `NotifyConfigSchema` is untouched — the two routes the ruling excluded. `system-write-organization.ts` stays exactly as it is: the producer it guards against now carries what it demands.

**What the declaration now bounds, precisely.** The value goes onto the run's `AutomationContext.tenantId`, and — for a `time_relative` sweep — onto its `find` context as well. From there it is the platform's existing tenancy path and nothing new: `Engine.buildDriverOptions` turns `context.tenantId` into `DriverOptions.tenantId`, and the driver scopes reads, updates, deletes and aggregates to that organization. ⛔ No `organization_id` predicate is hand-built anywhere — that would be a second implementation of tenancy inside a trigger, hardcoding a column an object is free to rename, selecting nothing on a platform-global object and breaking a federated one. Two consequences follow from using the platform's mechanism rather than a private one, and both are stated rather than discovered:

- **A store that cannot scope refuses the call instead of answering it.** `@objectstack/driver-memory` implements no row-level tenant isolation and refuses any call handed a tenant scope (`MEMORY_MULTI_TENANT_UNSUPPORTED`, #16589), so a time-triggered flow on that driver fails loudly rather than quietly crossing organizations. Multi-organization deployments use `@objectstack/driver-sql`; this is the same refusal that driver already gives every other org-scoped read.
- **On a platform-global (`tenancy: { enabled: false }`, ADR-0066) or federated (ADR-0015) object the declaration cannot narrow anything** — the engine drops the scope for those by design. Such a sweep still selects across every organization while its runs act as the declared one, and the trigger says so at bind, at `warn`, naming the object. ⛔ It does not pretend the flow is contained.

**The four flows this repo itself ships stop firing, and cannot be repaired by authoring.** `showcase_scheduled_digest` and `showcase_task_due_reminder` (`examples/app-showcase`), `task_reminder` and `overdue_escalation` (`examples/app-todo`) are all time-triggered and none declares an organization. There is no value they COULD declare: organization ids are minted per install at runtime, so a package-shipped flow has nothing to write there, and ⛔ inventing a placeholder is strictly worse than the omission — a value matching no row is silently authoritative. Each of the four now carries a comment saying it does not fire as shipped and why. What a package-shipped time-triggered flow should do instead is an open maintainer decision whose tracking card is being re-filed; this changeset and those comments are the record until it has a number. That corpus is also why the new lint id is a `warning`: at `error` it gates `objectstack build`, which was run and refuses `examples/app-showcase` outright — the repo would be unable to build its own examples for a defect they have no way to fix.
