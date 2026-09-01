---
"@objectstack/plugin-approvals": patch
---

fix(plugin-approvals): the stranded-request inspection now sees a run that FAILED mid-resume (#13909)

`ApprovalService.inspectStrandedRequests` was structurally blind to the shape
#13909 owns, and reported `0` for it — the one shape an operator most needs to
see.

**The mechanism.** `AutomationEngine.resumeInternal` consumes the suspension
*before* running the downstream nodes: `forgetSuspendedRun(run, 'resumed')`
precedes `traverseNext`. A downstream node that merely THREW therefore threw
with the pause already gone, the catch arm recorded the run `failed`, and
nothing can resume it again (`resume` answers `RUN_NOT_FOUND`, `cancelRun` is a
no-op). The decision is durable and the flow stopped half-way.

**Why the inspection could not see it.** Its second oracle was
`if (terminal) continue` — the existence of ANY run-history row ended the check,
on the reading "the run ran to a terminal state, it is not dangling". But the
terminal row here is written BY the failure that stranded the request, so the
evidence of the defect was read as evidence of health. `releaseDeadRunRequests`
cannot see it either: it scans `status: 'pending'`, and the decision is what
took the row out of `pending`.

**The widening, and its limits.** The second oracle now classifies the run
instead of merely detecting it. A `failed` run is reported; `completed`,
`cancelled` and `paused` are each still skipped, one named reason at a time, and
a status this code does not recognise is skipped too — the spec's
`ExecutionStatus` vocabulary is wider than the four statuses the engine writes,
and a future status must not become a silent false positive. `paused` in
particular stays skipped because "the suspension is gone but no terminal row is
written yet" is exactly what a resume IN FLIGHT looks like. The first oracle is
unchanged: a run the suspension store still holds is alive, and an unreadable
store is still counted `undetermined`, never condemned.

Reported rows now carry `runState: 'missing' | 'failed'` (new exported type
`StrandedRunState`), because the two shapes need different remedies: a `missing`
run has no history to read, a `failed` one has a step log and an error naming
the node that threw. The sweep's own warning splits its counts the same way.
`StrandedApprovalRequest` is an output-only reporting shape the service
produces; the added field is not constructed by any caller in this repo.

**Still read-only, and still not a census.** No status is changed and no run is
cancelled — the decision genuinely happened. This makes the condition *visible*
in a deployment; how many runs are already in it can only be answered against
that deployment's own tables. Nothing here changes the resume ordering, which
is #13909's own next slice.
