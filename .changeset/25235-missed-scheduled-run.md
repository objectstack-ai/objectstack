---
'@objectstack/trigger-schedule': patch
'@objectstack/service-automation': patch
'@objectstack/service-job': patch
---

feat(trigger-schedule): a scheduled run whose due time passed while no kernel was ticking is recorded as `missed` in the flow's run history, and is not run

Clause-②: yes (widening)
Metadata-protocol: none

A hosted kernel that is stopped, evicted or restarting does not tick, and a scheduled flow due in that gap used to leave no trace: nothing ran and nothing said so, so an app could not tell a sweep had not happened. Now the next kernel to bind the flow records each such due time once, as a run-history entry with status `missed`:

- **What the entry says.** `startedAt` is the due time that passed and `completedAt` the instant the next kernel detected it. No step ran, so `steps` is empty; `trigger.type` is `schedule`. The entry is listed by `listRuns` (and `GET /api/v1/automation/:name/runs`), `?status=missed` selects it, and it is durable history in `sys_automation_run`, aged out like every other terminal run.
- **Record only.** Nothing is run for a missed due time. It is never replayed or caught up; the flow's next due time runs as usual.
- **What counts as a silence.** The flow's job was still armed when its kernel stopped (its `sys_job` row still `active`: a kernel that stops ticking cancels nothing, while disabling, republishing or withdrawing a flow does), and a due time of the schedule that kernel armed falls after its last fire and before the next kernel bound the flow. A kernel that ticked through records nothing, and a flow that was deliberately unbound records nothing for the time it was unbound.
- **A refusal is not a silence.** A kernel that refuses the flow on purpose (scheduled work switched off for it, a missing acting organization, an unreadable schedule) now disarms the job by its name even when it never bound it, so the next kernel to run the flow does not read that kernel's life as missed due times. `FlowTrigger` gains an optional `release(flowName)`, which the engine calls when its scheduled-work policy refuses a flow before the trigger is reached.
- **Never a run that happened.** A due time whose tick window is claimed in the dispatch ledger (`sys_flow_dispatch`) was dispatched, landed or died in flight, and is not recorded. With no persisted ledger the check is skipped, and a ledger read that fails records nothing for that due time; the trigger says either at `warn`, naming the flow.
- **Bounded by the run history's own cap.** At most the run history's per-flow cap (`maxTerminalRunsPerFlow`, 100 by default) of the newest due times are recorded per flow per detection, since the store keeps no more terminal rows than that per flow. One `warn` line names the flow, how many earlier due times were not recorded and the earliest of them.
- **Two replicas, one row.** The entry's id is derived from the flow and the due time, so replicas that detect the same silence write one history row.

`DbJobAdapter` gains `readArming(name)` (adapter-local, like `setReplayGuard`; not part of `IJobService`), which reads how a job's `sys_job` row was left. `AutomationEngine` gains `recordMissedRun(...)` and `missedRunLimit()`, the run stores expose their configured `maxTerminalRunsPerFlow`, and `TERMINAL_RUN_STATUSES` and the `sys_automation_run.status` options gain `missed`.
