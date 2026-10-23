---
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
---

feat: `ExecutionStatus` gains `missed`, the run status for a scheduled flow's due time that passed while no kernel was ticking

Clause-②: yes (widening)
Metadata-protocol: none

`ExecutionStatus` gains a tenth member, `missed`, appended last so every reader that indexes `.options` keeps its positions. It records a scheduled flow's due time that passed while no kernel was ticking, written once by the next kernel that finds the gap, one entry per missed due time. It is terminal: the run never started, is never resumed and is never replayed. It is distinct from `cancelled` (nobody cancelled it) and from `failed` (nothing ran).

No field is added. On an `ExecutionLog`, `startedAt` is the due time and `completedAt` the detection time; `durationMs` and `refusalMessage` are absent and `steps` is empty. On the stored run row, `started_at` and `finished_at` carry the same two instants, and `duration_ms`, `error` and `refusal_message` are absent.

`ListRunsRequestSchema.status` and the REST `?status=` filter read the enum, so both accept `missed`. `AutomationResult.status`, `TriggerFlowResponseSchema.data.status` and `JobExecutionStatus` do not change.

`@objectstack/plugin-approvals`: `RUN_STATUS_LIVENESS` maps `missed` to `terminal`, so an approval pending on a missed run is swept like one pending on any other finished run.

This release only declares the value. The engine writes `missed` rows in a later release.
