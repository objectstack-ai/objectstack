---
"@objectstack/service-automation": minor
"@objectstack/plugin-approvals": minor
---

An approval `decide()` that resumes a subflow CHILD now tells the caller when that resume bubbles into a PARENT run that stranded — instead of answering full success with nothing to distinguish it from a healthy composition (#15556; the #16472 family ruling, decision batch #76, option A).

**The composition.** A parent flow parks at a `subflow` node whose child hosts the `approval` node, so the approvals row names the CHILD run. The decision door resumes the child, the child completes, `bubbleToParent` resumes the parent, and the parent's own downstream node throws. The parent lands on the engine's `'stranded'` exit — it consumed its suspension and is now terminal, repairable only by an operator's `restoreConsumedSuspension` — and `bubbleToParent` already logged that at `error` (unchanged by this fix). What the caller was TOLD did not: `resumed: true`, no `resumeError`, and a `runId` naming the healthy child — identical to what a fully healthy composition answers.

```
FROM  service.decide(requestId, { decision: 'approve' }, ctx)
      -> { finalized: true, decision: 'approve', runId: '<child>', resumed: true }
         // identical to a healthy composition's answer — no caller can tell

TO    service.decide(requestId, { decision: 'approve' }, ctx)
      -> { finalized: true, decision: 'approve', runId: '<child>', resumed: true,
           resumeError: "RESUME_FAILED: … its own flow run '<child>' resumed, but the " +
                        "subflow parent above it — run '<parent>' — consumed its suspension " +
                        "and is now stranded: <downstream error>",
           resumeFailure: { code: 'RESUME_FAILED', runId: '<parent>', status: 'stranded', repairable: true } }
```

**Additive only — no migration.** `ApprovalDecisionResult.resumeFailure` was already declared (and pinned) in `@objectstack/spec` ahead of this card; this fix is the first producer that fills it. No existing field changes shape, no status code moves (the door still never throws for this shape — `AGENTS.md`'s "a failure handed to the caller" answer does not apply here, since before this fix no caller was told at all), and the door's `error` log line is untouched. A consumer that already ignores unknown fields sees no difference; a consumer that reads `resumeFailure` can now tell a bubbled parent strand from a clean resume without diffing `runId` against a durable run history.

**What did not move, on purpose.** `RESUME_IN_PROGRESS` / `STORE_UNAVAILABLE` bubble outcomes stay the functional degradation they always were (`warn`, unreported on `resumeFailure`) — the #16472 ruling is scoped to the one exit the engine calls `'stranded'`. The sibling `recall` door (`ApprovalRecallResult.resumeFailure`, #15970) is a separate card and is not touched here.

**New public surface — the reason for `minor` on both packages, not `patch`.** Getting the parent's strand from the engine to the approvals door without touching `packages/spec` or the wire-visible `AutomationResult` (which a raw REST `POST …/resume` also serves verbatim, so a field there would leak an undeclared key onto every subflow resume, not only an approvals-mediated one) needed a small new internal channel:

- `@objectstack/service-automation`: `AutomationEngine` gains a new public method, `takeSubflowParentStrand(childRunId: string): SubflowParentStrand | undefined` — read-once (deletes on read), populated only by `bubbleToParent`'s `'stranded'` exit. `SubflowParentStrand` is a new exported interface (`{ runId, repairable: true, error }`).
- `@objectstack/plugin-approvals`: `ApprovalResumeSurface` (already exported from the package entry) gains a matching optional member, `takeSubflowParentStrand?(childRunId): { runId, repairable, error } | undefined`.

Both are additive and optional; nothing existing changes shape or behaviour. Neither reaches any wire payload — `AutomationResult`, the REST resume door's response, and every other published contract are byte-for-byte unchanged.
