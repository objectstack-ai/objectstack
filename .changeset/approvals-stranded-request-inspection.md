---
"@objectstack/plugin-approvals": patch
---

fix(approvals): find the zombie requests nothing was looking at (#4469)

#4460 stopped new zombies being produced; the rows already stuck had no mechanism
to find or release them. The failure shape (#4420) is a request flipped to
`approved` / `rejected` / `returned` whose `flow_run_id` points at a run that no
longer exists — the decision landed, the flow never moved. Any deployment on
17.0.0-rc.1 that hit the wiring hole and crossed a restart mid-approval can be
carrying these rows.

`releaseDeadRunRequests` could not see them, and the reason is worth stating
plainly: it scans `status: 'pending'`, and the very step that zombifies a request
is the one that takes it OUT of `pending`. The act of breaking it removed it from
the only sweeper's field of view — a large part of why this class of failure
stayed silent. It could not have answered the question even if it had looked: its
liveness oracle is `getRun`, which reads the execution LOG and returns `null` for
a perfectly ALIVE suspended run after a restart. It treats `null` as alive
(conservative, and correct for what it does) — which is exactly why it has no way
to say "this run is really gone".

Adds `ApprovalService.inspectStrandedRequests()`, which uses BOTH oracles and
reports only rows that fail both:

- `hasSuspendedRun(runId) === false` — the suspension store itself says no live
  pause exists. It THROWS when the store cannot be read, and that case is
  SKIPPED and counted as `undetermined`, never condemned: an unreadable store
  means "unknown", and a storage outage must not be published as a lost run.
- `getRun(runId) == null` — no terminal history row either. A run that merely
  finished is not stranded; a request whose run neither waits nor ever completed
  is.

**It reports; it never rewrites.** No status is changed and no run is cancelled.
The decision genuinely happened — a human approved or rejected — and silently
rolling it back would make the audit trail disagree with the facts. The report
carries what an operator needs to decide: which requests are stuck at which step,
and what the mirrored status field on the business record still reads (usually
the stale value the user is staring at). Whether to re-run the downstream actions
or re-open the approval is a judgement call this cannot make.

It rides the existing escalation/dead-run sweep clock, so the finding surfaces in
the logs without an operator knowing to go looking for it. `recalled` is
deliberately out of scope: a recall abandons its run on purpose, and reporting
those would bury the real findings under expected ones.

New export: `StrandedApprovalRequest` (the report row shape).
