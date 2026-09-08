---
"@objectstack/spec": minor
---

`ResumeFailureReport` — the machine-readable half of a resume failure, declared once in `contracts/approval-service.ts` and carried as the optional, additive `resumeFailure` member of `ApprovalRecallResult` and `ApprovalDecisionResult` (the contract half of the #16472 family ruling, decision batch #76).

The ruling: when a resume failure is told to the caller, it is told in a shape the caller can act on — a registered error code, the `runId` of the run that is actually stranded, and `repairable` — and the door's status code does not change because of it. A decision whose own run advanced still answers success, with the failure behind it carried on the success answer. This change declares that shape; the doors adopt it separately (#15556 for the decision door's subflow bubble-up, #15970 for `recall`).

- **Declared once, by reuse.** `ResumeFailureReport extends ResumeFailureDetails` (`api/automation-api.zod.ts`), the structure the automation resume door already publishes inside its `400 FLOW_FAILED` details. `runId`, `status` and `repairable` are inherited, never re-spelled, so the carriers cannot drift; a caller that parses the member with `ResumeFailureDetailsSchema` reads the same three facts it reads off that door. The report adds exactly the one member a success envelope cannot leave to its envelope: `code`.
- **No new error code is minted.** `code` is typed as `ErrorCode`, the ADR-0112 ledger vocabulary, so an unregistered spelling fails `tsc` rather than reaching the wire. A consumer that needs a distinct code to branch is its own card.
- **The absence rule is explicit and pinned.** The member is optional because it is additive, and an absent member means no report was made — a producer that predates this field, a door that never resumes — never that no run is stranded. A consumer may branch on presence to read a failure; it must not branch on absence to conclude health.
- **`resumeError` is no longer "when `resumed` is false".** Both carriers' `resumeError` docblocks now say its presence is decided by whether a failure was told, never by `resumed`, and name `resumeFailure` as the machine-readable half of the same telling; both `resumed` docblocks say `true` speaks for this door's own resume, not for every run behind it. `ApprovalSendBackResult` and `ApprovalResubmitResult` are unchanged — the ruling names no carrier on those doors.
- `StrandedDecisionDetails` (`@objectstack/types`, the error-envelope carrier of the `decide` door's own strand, #13807) is unchanged.
