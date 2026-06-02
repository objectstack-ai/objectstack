---
'@objectstack/client': minor
'@objectstack/spec': minor
---

client SDK: add `approvals` namespace; remove dead workflow approve/reject surface (ADR-0019)

ADR-0019 collapsed approval into Flow: approval is no longer a workflow step but
a first-class **flow node** that opens a request and suspends the run, with a
human decision resuming the flow down the matching `approve` / `reject` edge.
The server already exposes this as a dedicated `/api/v1/approvals` surface
(`registerApprovalsEndpoints`), but the client SDK still carried the old
approval-on-`workflow` methods, which pointed at routes that never existed.

- **`@objectstack/client`** gains a `client.approvals` namespace backed by the
  real REST surface:
  - `listRequests(filter?)` → `GET /approvals/requests` (the "my approvals"
    inbox; filter by `status` (single or array), `object`, `recordId`,
    `approverId`, `submitterId`).
  - `getRequest(id)` → `GET /approvals/requests/:id`.
  - `approve(id, { actorId?, comment? })` / `reject(id, …)` →
    `POST /approvals/requests/:id/{approve,reject}` (records a decision and
    resumes the owning flow run).
  - `listActions(id)` → `GET /approvals/requests/:id/actions` (audit trail).

  The approval runtime types (`ApprovalRequestRow`, `ApprovalActionRow`,
  `ApprovalStatus`, `ApprovalDecisionInput`, `ApprovalDecisionResult`) are
  re-exported so consumers can type the namespace without reaching into
  `@objectstack/spec`.

- **Removed the dead workflow approve/reject surface.** `client.workflow.approve`
  / `client.workflow.reject` and the backing `WorkflowApprove*` / `WorkflowReject*`
  protocol schemas, types, `IProtocolService` methods, and the `/approve` /
  `/reject` entries in `DEFAULT_WORKFLOW_ROUTES` are gone — approval decisions
  are no longer recorded on a workflow record. `workflow` is reclaimed for state
  machines, so `getConfig` / `getState` / `transition` are unchanged.

- Discovery advertises the new route key: `ApiRoutesSchema.approvals`.
