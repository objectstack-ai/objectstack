---
"@objectstack/spec": minor
---

feat(spec): name the terminally-failed-but-repairable run on `AutomationResult.status` — `'stranded'` (#14384, contract half of #13937)

`AutomationResult.status` (`contracts/automation-service.ts`) gains a fourth
member beside `'completed' | 'paused' | 'failed'`: **`'stranded'`** — the run
whose resume CONSUMED its suspension and then had a downstream node throw, so
the run is recorded as failed and can be re-armed only by an explicit operator
verb (#13909's condition; the #13937 shape-4 ruling, maintainer 2026-09-01
「命名同批定」). The wire mirror `TriggerFlowResponseSchema.data.status`
(`api/automation-api.zod.ts`) carries the same four, and a pin test binds the
two at the type level and the value level.

Additive: no existing literal changes meaning, `'failed'` still says "the run
ran and was rejected", and no engine, route or client behaviour moves in this
change — the engine begins stamping `'stranded'` when #13937's services half
(the operator re-arm verb) lands. A consumer that switches exhaustively over
`status` needs a `'stranded'` arm; the measured count of such switches in this
repo is zero. plugin-approvals' report-only `StrandedRunState`
(`'missing' | 'failed'`) is deliberately not promoted (same ruling).
