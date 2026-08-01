---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/plugin-approvals": minor
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

fix(automation,approvals): an approval decision can no longer succeed while its flow stays parked (#4420)

A flow paused at an `approval` node, a deploy, then an approver clicking
Approve: the request row flipped to `approved`, the UI toasted success — and
the flow never moved. No next-stage request, no error, the record's mirrored
status frozen mid-workflow. Approval flows pause for days by design, so a
restart mid-flight is the normal case: every release could quietly zombify
every in-flight approval, with the approvers none the wiser.

Durable suspended runs (#1518) had shipped and were not the missing piece. Two
other things were.

**The wiring could enable a store over a table nobody had created.** Object
registration and store activation resolve different services in different
phases — `manifest` at `init()`, `objectql` at `start()` — and the plugin
declared no ordering. Composed ahead of ObjectQL, `init()` found no `manifest`,
warned, and continued; `start()` then attached the DB-backed store anyway. Every
suspend failed with `no such table: sys_automation_run` into a log line nobody
read, pauses silently stayed in memory, and the next restart lost them all.
Now: `AutomationServicePlugin` declares `optionalDependencies:
['com.objectstack.engine.objectql']` (order-if-present, per ADR-0116 — an
engine-less kernel must still boot); a registration missed at `init()` is
retried at `start()`, which still lands before ObjectQL's schema sync; the
store is never attached when registration did not happen, and says so at
**error** level instead of warning; the table is probed once at boot so a
broken setup surfaces there rather than one failed write at a time; and a
failed durable write of a paused run is logged at error — it is data loss in
waiting, not a warning.

**A reported resume failure read as success.** `AutomationEngine.resume()`
answers a lost run by *returning* `{ success: false }`, never by throwing.
`ApprovalService` discarded that return value, and `decide()` counted only a
thrown error as failure — so a decision against a dead run came back
`resumed: true`, HTTP 200. Resume failures are now classified
(`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, joining
`PERMISSION_DENIED` / `INVALID_SIGNAL`), so a run that is gone for good is
distinguishable from a store that is merely unreachable, and the raw resume
route maps them to 404 / 503 / 409.

Approvals acts on them. A new `AutomationEngine.hasSuspendedRun(runId)` — which
reads the suspension store, unlike `getRun()`, and throws rather than answering
`false` when the store is unreadable — pre-flights every flow-advancing
operation (`decide`, `sendBack`, `resubmit`) **before its first write**, so the
zombie half-state is never created rather than merely reported: the decision
fails with `RESUME_TARGET_LOST` (HTTP 409) and the request stays actionable. A
resume that fails after the decision is durable can no longer be undone, but it
now throws `RESUME_FAILED` (HTTP 500) naming the stranded run instead of
reporting success. A concurrent duplicate resume stays benign — the engine's
idempotency guard is doing its job — and reports through the new optional
`resumeError` field. Recall and revise-window cancellation stay non-fatal by
design (they abandon the request), but log at error with the reason instead of
swallowing it. Compositions with no automation engine attached are unaffected.

Existing zombie requests from affected deployments (already `approved`, run
stranded) are not repaired by this change — `releaseDeadRunRequests` only
sweeps requests that are still `pending`.
