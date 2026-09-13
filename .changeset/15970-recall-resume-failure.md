---
"@objectstack/plugin-approvals": patch
---

An approval `recall()` whose resume strands the run now tells the caller WHICH failure it was, in fields — `resumeFailure: { code, runId, status, repairable }` beside the prose `resumeError` — instead of one sentence a caller has to parse (#15970; the #16472 family ruling, decision batch #76, option A).

**The shape.** A flow parks at an `approval` node; the reject branch's downstream node throws. The submitter recalls the request, which resumes the run down the `reject` edge — and that resume strands it. The withdrawal is durable and the call correctly does not throw, but the engine's own discriminator never reached the caller: `recall` resumes DIRECTLY rather than through `resumeRecordedOutcome`, and its `catch` kept `err.message` alone, discarding the `resumeStatus` (`AutomationResult.status: 'stranded'`) the error already carried one line before the result was built. `repairable` had a producer and, on this door, no consumer.

```
FROM  service.recall(requestId, { actorId }, ctx)
      -> { request: { status: 'recalled' }, runId, resumed: false,
           resumeError: "resume of run '<run>' failed: <downstream error>" }
         // prose only — nothing says the run is still repairable

TO    service.recall(requestId, { actorId }, ctx)
      -> { request: { status: 'recalled' }, runId, resumed: false,
           resumeError: "resume of run '<run>' failed: <downstream error>",
           resumeFailure: { code: 'RESUME_FAILED', runId: '<run>',
                            status: 'stranded', repairable: true } }
```

**⛔ The no-throw stays, and that is the ruling's point.** The withdrawal and the record-lock release are the product of this call and they have already happened when the resume fails; making `recall` fail would be the wrong fix, not a stricter one. The door's `error` log line is untouched too, at the same level with the same context keys — the ruling left logging alone, and the report is a sibling of that line, not a replacement for it.

**Two exits report, and the rest deliberately do not.** A report is stamped exactly where the engine's own verdict says `'stranded'`: this door's own resume stranding, and (the sibling half of #15556, whose producer landed one door over) a resume that SUCCEEDED while the subflow parent above it stranded — which answers `resumed: true` with the PARENT's `runId` on `resumeFailure`, exactly as `ApprovalRecallResult.resumed`'s docblock already declared. Every other exit answers as it always did, with no `resumeFailure` at all: a lost run's honest code is `RESUME_TARGET_LOST` and the tolerated duplicate's is `RESUME_IN_PROGRESS`, and this package's ADR-0112 ledger row admits exactly one code, so stamping `RESUME_FAILED` there would make the discriminator lie about which failure it was — the defect this fixes, one field over. Per the member's own docblock, an absent `resumeFailure` means no report was made, never that no run is stranded.

**Additive only — no migration, and `patch` rather than `minor`.** `ApprovalRecallResult.resumeFailure` was already declared, exported and type-pinned in `@objectstack/spec` ahead of this card (`contracts/approval-service.ts`, `resume-failure-report.pin.test.ts`); this fix is the first producer that fills it. The delivered diff adds no exported symbol to `@objectstack/plugin-approvals` — nothing new is reachable from its published entry — and adds no key to a payload that did not already declare one. Nothing existing changes shape: a consumer that ignores unknown fields sees no difference, and one that reads `resumeFailure` can now branch on `repairable` and call `restoreConsumedSuspension` on the run the report names.
