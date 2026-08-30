---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

feat(spec,rest): register `READ_BACK_FAILED` as a named wire row and map it in `handleApprovalError` (#13182)

The `READ_BACK_FAILED:` refusal (#12769: an approval mutation succeeded but its
post-write read-back is filtered out by the caller's organization scope) used
to reach REST clients through each route's terminal 500 arm — a registered
code (`APPROVAL_RECALL_FAILED` and siblings) whose name does not describe what
happened, with the accurate sentence only in the body.

Following the `RESUME_FAILED` precedent (a genuine server-side inconsistency,
but named), `READ_BACK_FAILED` is now registered in the ADR-0112 error-code
ledger and `handleApprovalError` maps the `READ_BACK_FAILED:` message prefix to
HTTP 500 with `code: 'READ_BACK_FAILED'` on the wire. The 500 semantics stay —
it is genuinely a server-side inconsistency; the write is recorded and NOT
rolled back, and the row can be read back with a system or
matching-organization context. Additive vocabulary only: no existing code,
status, or message changes.
