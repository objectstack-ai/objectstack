---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/plugin-approvals": minor
"@objectstack/runtime": minor
"@objectstack/client": patch
---

fix(automation,approvals): the run-resume route is gated by the node the run is parked on (#3801)

`POST /api/v1/automation/:name/runs/:runId/resume` forwarded a caller-supplied
`{ inputs, output, branchLabel }` straight into `AutomationEngine.resume`, and
`resumeInternal` validated **machine state only** — the concurrent-resume latch,
the run exists, the flow exists, the suspended node still exists. Nothing asked
*who was calling*.

Approval nodes suspend and resume through exactly that mechanism. So a resume
carrying `branchLabel: 'approve'` walked the approve edge with **no approver
check, no `sys_approval_action` row and no status mirror** — the
`sys_approval_request` row and the run then disagreed permanently. The only
thing standing between the route and the approvals rules was convention; the
showcase spelled it out in a comment ("decide via the approvals API, never a raw
engine `resume`"), and a comment in an example is not an access control.

Removing the route was not the fix: it is load-bearing for **screen flows** —
the UI flow-runner posts `{ inputs }` there to advance a paused `screen` node.
The gate therefore keys on **what the run is parked on**:

- `ActionDescriptor.resumeAuthority` (`'any'` | `'service'`, default `'any'`) —
  a pausing node declares who may continue it. `approval` declares `'service'`.
- The engine refuses a `'service'` suspension unless the signal carries
  `RESUME_AUTHORITY_SERVICE` (`@objectstack/spec/contracts`), a **symbol** the
  owning service stamps in-process — a JSON body can never produce one, so the
  transport cannot forge it. `ApprovalService` stamps it on the tail of a
  decision it has already authorized and recorded.
- The gate follows a **subflow** pause down to the child the signal would
  actually reach, so resuming the parent is not a way around it.
- Refusal returns `{ success: false, code: 'forbidden' }` and the route answers
  **403**. Nothing is consumed — the request stays pending and the run stays
  parked, so the real decision still lands.

`screen` and `wait` pauses are unchanged, as is every path that already went
through the approvals API. What changes for consumers:

- **FROM:** finishing an approval with
  `client.automation.resume(flow, runId, { branchLabel: 'approve' })`
  **TO:** `client.approvals.approve(requestId, …)` (or `.reject` / `.recall`).
  The old call now answers 403 and changes nothing.
- Registering your own pausing node whose continuation belongs to a service
  rather than to whoever holds the run id? Declare `resumeAuthority: 'service'`
  on its descriptor and stamp `RESUME_AUTHORITY_SERVICE` on the signal from that
  service.

A suspension now records the node type that produced it
(`SuspendedRun.nodeType` / `sys_automation_run.node_type`), captured at suspend
time so a flow republished mid-pause cannot re-type the node out from under the
gate; rows written before this fall back to the flow definition.
