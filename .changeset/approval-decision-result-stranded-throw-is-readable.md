---
"@objectstack/spec": patch
---

`ApprovalDecisionResult`'s contract docblock now records what the stranded-decision throw carries — execution item 2 of the #13807 ruling (maintainer 2026-09-04, decision batch #37).

The posture itself was already declared: a decision that finalises a flow-bound request and cannot resume its own run throws rather than answering `resumed: false`, because a recorded decision whose flow never advances is #4420's zombie half-state. What the docblock did not say is that the throw is now *readable*. The ruling's item 2 owes both halves — "throws with the decision and run identified; the fields are the published way to read it" — and only the first half was written down.

- **Prose only. No member moves.** `finalized`, `decision`, `runId` and `repairable` ride the ERROR body of the 500-class `RESUME_FAILED`, as `StrandedDecisionDetails` (`@objectstack/types`, attached by `strandedDecisionFailure`, read back by `strandedDecisionDetails`, merged into the response by the REST approvals door). Adding them to `ApprovalDecisionResult` would declare a success shape that never carries them, so the docblock names them where they actually live and says so explicitly.
- **The status code does not move either.** A durable decision over a run that will not advance is still a failure; what the ruling changed is that a caller holding the status code alone no longer has to read a bare 500 as "the decision did not happen" when the row is terminal.
- **Kept distinct from `resumeFailure`.** That member is the #16472 family's different event — a resume failure told *behind an answer that still succeeded* — and the new paragraph says so, so the two carriers are not read as one.
