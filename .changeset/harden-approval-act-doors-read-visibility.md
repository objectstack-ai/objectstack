---
'@objectstack/plugin-approvals': patch
---

harden(approvals): every door that acts on an approval request answers a request the caller may not read the way the read door does

Clause-②: no
Metadata-protocol: none

The doors that act on one approval request now ask the read door's own visibility rule first, before any check that depends on the request.

- **What changes.** `approve`, `reject`, `recall`, `revise`, `resubmit`, `reassign`, `remind`, `request-info` and `comment` on `/api/v1/approvals/requests/:id/…` (and `IApprovalService.decide`, `recall`, `sendBack`, `resubmit`, `reassign`, `remind`, `requestInfo`, `comment` for an embedder calling the service) answer a caller who may not read the request — no participant of it, or outside its organization — with `404 REQUEST_NOT_FOUND`, exactly the answer an id that names no request gets. The rule is the one `GET /api/v1/approvals/requests/:id` serves by — the caller's organization, the participant set, the override actor's view and the opt-in record-reader tier — read from one place, not a copy. Nothing is written for such a caller.
- **What does not change.** A caller who can read the request keeps the door's own answer: a submitter is still `403 FORBIDDEN` on the approver's verbs, an approver on the submitter's, and a decided request is `409 INVALID_STATE`. Pending approvers decide, submitters recall, remind and resubmit, as before. An administrator's override — the platform administrator's across organizations included — and system contexts (the SLA sweep, the email action link) act as before.
