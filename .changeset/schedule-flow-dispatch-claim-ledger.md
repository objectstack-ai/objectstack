---
"@objectstack/trigger-schedule": minor
"@objectstack/service-automation": minor
"@objectstack/service-job": minor
---

A scheduled (cron) flow is now delivered once per tick window, and replaying a window that was already delivered is refused instead of silently sent again.

A `time_relative` flow has taken a persisted dispatch claim per `(flow, window, record)` since #10220, so per-record once-only delivery is free for it. A `schedule` flow runs once per tick with no record and had no claim surface at all, so "this batch already went out" fell back to whatever each app remembered for itself. A scheduled digest that was replayed by an operator, or whose process restarted inside its window, delivered twice.

Scheduled flows now claim `(flow, tick-window)` in the same `sys_flow_dispatch` ledger, and settle that claim with what the run turned into:

- **A second fire inside one window does nothing.** The window key is a pure function of the schedule descriptor and the clock — the previous occurrence of the very same cron expression in the very same timezone, computed with the same library the job adapter schedules with — so a restart inside the window computes the same key and hits the same claim.
- **`IJobService.replay()` refuses a delivered window**, with the ADR-0112 envelope its contract declares: `code: 'RESOURCE_CONFLICT'`, `status: 409`, and a message naming the window and the claim that refused it. The promise rejects — an operator who presses replay and sees nothing happen is exactly the outcome this replaces.
- **`replay(name, data, { force: true })` sends anyway.** The duplicate is the operator's, taken knowingly.
- **A window whose claim is absent, failed or unsettled re-runs** on a plain `replay()`, with no force needed. A job that takes no claim at all — every job that is not a scheduled flow — is the absent row and behaves exactly as before.
- **`succeeded` is absorbing.** A replay that repairs a failed window records `succeeded`, so the next unforced replay is refused. A *forced* replay that throws leaves the window recorded delivered rather than rewriting it to `failed` — otherwise a failed re-send would silently reopen the unforced re-delivery door. An operator whose forced replay failed forces again.
- **A `once` schedule now has a tick window too** — the single instant it is due, which is one window for the job's whole life. The visible consequence is on replay: an operator who replays a one-shot job *before* its due instant claims that single window, so the real fire then finds the claim and does nothing. Previously both ran.

The error-isolation `catch` that keeps a throwing flow from crashing the ticker is unchanged and still swallows. What it no longer does is leave the run indistinguishable from a delivered one: the throw settles the window's claim as `failed`, so a replay repairs it.

`sys_flow_dispatch` gains two optional columns, `outcome` and `settled_at`. Rows written before this release read as unsettled, which reads as not delivered — the safe direction, since a replay of one re-runs rather than being refused. Only `schedule:` claims are ever settled; a `time_relative` sweep's rows stay `null` by design.

⚠️ **If you manage this table's DDL out of band** — anything other than letting the platform sync `sys_flow_dispatch` from its object definition — add `outcome` (text) and `settled_at` (datetime) yourself before upgrading. Without them every `settle()` throws against the driver. Dispatch dedup still works and no flow fails (the settle is best-effort and logged), but no claim ever records an outcome, so the replay refusal never fires and this release's headline change is silently absent.

Interface changes for hosts that implement the ledger themselves:

- `FlowDispatchStore` gains **optional** `settle()` and `read()`. A store without them still deduplicates; it announces once that the refusal cannot fire.
- `FlowDispatchStoreEngine` — the narrow ObjectQL slice the bundled store demands — now **requires** `update` alongside `find` and `insert`. A custom engine adapter typed against it must add the method.
- New exported types: `FlowDispatchClaim` and `FlowDispatchOutcome` from `@objectstack/service-automation`; `ReplayGuard` and `ReplayGuardDecision` from `@objectstack/service-job` (the parameter type of `DbJobAdapter.setReplayGuard`, exported so it can be named); `ScheduleDispatchLedger`, `ScheduleDispatchClaim`, `ScheduleDispatchOutcome`, `ReplayGuard` and `ReplayGuardDecision` from `@objectstack/trigger-schedule`.
- `croner` moves from a devDependency to a **dependency** of `@objectstack/trigger-schedule`, which now imports it at runtime to compute the cron tick window. It is already a runtime dependency of `@objectstack/service-job` at the same range, so the platform's dependency set does not grow.
