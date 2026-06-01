---
"@objectstack/service-automation": minor
---

Implement the `wait` node executor — durable timer / signal pause.

The flow designer offered a `wait` node but the engine had no executor for it, so
a flow using it couldn't run. `wait` now suspends the run on entry (ADR-0019
durable pause, the same suspend/resume machinery as `screen` / `approval`) and
resumes by one of two paths, per `waitEventConfig.eventType`:

- **timer** — schedules a one-shot job (`IJobService`, `{ type: 'once', at }`)
  that calls `engine.resume(runId)` when the ISO-8601 `timerDuration` elapses.
  With no job service the run still suspends and is resumable via an external
  `resume(runId)` (logged) — never silently no-ops or fails the flow.
- **signal / webhook / manual / condition** — suspends with the signal name as
  the correlation key; an external producer resumes the run when the event
  arrives.

Reads its run id from the engine-injected `$runId` variable (same mechanism the
approval node uses). Adds a `parseIsoDuration` helper (`PT1H`, `P3D`, `PT90M`,
`P1DT12H`, bare ms). Registered as a built-in node, so a bare
`AutomationServicePlugin` now ships 13 executors including `wait`.

Tests: `wait-node.test.ts` — duration parsing, suspend→resume traversal,
one-shot job scheduling + handler-driven resume, named-signal suspend.
service-automation **113 passing**. A worked `showcase_task_follow_up` flow
(wait → notify) demonstrates it end-to-end.
