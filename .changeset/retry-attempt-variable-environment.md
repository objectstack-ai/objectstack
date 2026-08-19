---
'@objectstack/service-automation': patch
---

fix(service-automation): a retry attempt now runs with the same variable environment as the first

`executeWithoutRetry()` — the method the retry loop re-runs a flow through on every
attempt — seeded only the flow's declared variables and `$record`, while the first
attempt also binds `record` plus the triggering record's flattened fields, `previous`,
`$runId`, `$flowName` and `$flowLabel`. Every retry attempt therefore ran in a strictly
smaller environment than attempt 1.

Because conditions are strict CEL, where reading an unbound name aborts the predicate
rather than yielding `false`, this was user-visible exactly where retry is most used —
`errorHandling.strategy: 'retry'` on a record-change flow:

- a start condition or edge predicate reading `previous` (the create-vs-update
  discriminator) aborted on the retry, so the retry failed for a reason the first attempt
  never hit — reading as a flaky flow rather than a defect;
- a bare reference to a triggering-record field (`status`, `budget`) aborted for the same
  reason;
- a pausing node (e.g. Approval) reached on a retry attempt saw no `$runId`, so the
  external state it minted could not be mapped back to the run for resume (ADR-0019).

Both methods now seed through one shared chokepoint. First-attempt behaviour is unchanged.
