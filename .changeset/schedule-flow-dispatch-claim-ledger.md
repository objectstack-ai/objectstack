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

The error-isolation `catch` that keeps a throwing flow from crashing the ticker is unchanged and still swallows. What it no longer does is leave the run indistinguishable from a delivered one: the throw settles the window's claim as `failed`, so a replay repairs it.

`sys_flow_dispatch` gains two optional columns, `outcome` and `settled_at`. Rows written before this release read as unsettled, which reads as not delivered — the safe direction, since a replay of one re-runs rather than being refused. A host supplying its own `FlowDispatchStore` keeps working untouched: `settle()` and `read()` are optional, and a store without them still deduplicates while announcing, once, that the replay refusal cannot fire.
