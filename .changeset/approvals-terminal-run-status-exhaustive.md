---
"@objectstack/plugin-approvals": patch
---

fix(approvals): the dead-run sweep classifies every `ExecutionStatus` member, so a `refused` run releases its pending approval (#16433)

`ApprovalService.releaseDeadRunRequests` guarded on a hand-copied four-member subset of `ExecutionStatus` — `completed`, `failed`, `cancelled`, `timed_out` — written when that enum had eight members. #14945 then appended `refused`, documented on the enum as *"Terminal, never resumed"*, and the subset did not grow with it. A run in `refused` was therefore skipped by the sweep, so a still-pending approval on it read as ALIVE, was never released, and kept its record lock forever.

**Why this is shipped as a fix rather than left alone.** Nothing inside this repo drives a run to `refused` yet — that is #15788 (lane 2 of the #14945 ruling), still open. But `ApprovalService` takes a HOST-supplied automation surface through `attachAutomation`, so a host whose `getRun` already answers with the status the published spec declares sees the corrected behaviour the moment it upgrades, rather than on the day lane 2 lands. That is a real behaviour change in a published package, which is why it carries a bump instead of `skip-changeset`.

The repair is not "add `refused`" — that yields a five-member hand-copy with the identical trap re-armed for the tenth member — and it is not "derive the terminal set from the enum" either, since `running` and `paused` are plainly not terminal and a wholesale derivation would default every future member to terminal, i.e. to releasing approvals out from under LIVE runs. Instead the file now declares a **total map** over `ExecutionStatus`, classifying each member `terminal` or `live`, from which the terminal set is derived. A tenth member fails to compile until someone classifies it, and fails a test as well.

No API change: the classification is module-internal and the package barrel is untouched.
