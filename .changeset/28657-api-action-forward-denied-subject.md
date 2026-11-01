---
'@objectstack/runtime': patch
---

fix(runtime): a non-admin approver's decision from the request page reaches the approvals routes instead of answering 404 (#28657)

Clause-②: yes (widening: on `POST /api/v1/actions/:object/:action` and MCP `run_action`, a same-origin `type: 'api'` action whose subject row the caller's own scope does not deliver, and whose request needs no field of that row, is forwarded and answers its target's answer where it answered `404 RECORD_NOT_FOUND`)
Metadata-protocol: none

The request page's decision actions (`approval_approve`, `approval_reject`, `approval_comment`, `approval_request_info`, and the submitter's `approval_remind` / `approval_recall`) are same-origin `type: 'api'` actions that forward to the approvals routes (`/api/v1/approvals/requests/{id}/approve` and the rest). The action door loaded the `sys_approval_request` row in the caller's data scope first, and a member has no data-door read on that object by design, so every decision a non-admin sent from the page answered `404 RECORD_NOT_FOUND` before the approvals route, which admits a pending approver itself, was ever asked.

- **Now.** When the caller-scope load does not deliver the row, a same-origin api action is forwarded anyway, and the door answers what the target answers: a pending approver's Approve answers 200 and the request moves; a member who is not on the slate gets the approvals route's own refusal. The target authorizes the caller with the caller's own credentials (ADR-0066 D4), the same request the caller could send it directly, so nothing new is disclosed.
- **⛔ No row data the caller could not read reaches the request.** On a denied load the request is built from the `recordId`, the params and the caller only. A declaration whose request needs a field of the row (a `{field}` path token other than `{id}`, or a `recordIdParam` read from a `recordIdField` other than `id`) keeps the `404 RECORD_NOT_FOUND`, and nothing is forwarded.
- **Unchanged.** The declarative update, `type: 'flow'` and script/body actions still refuse a denied load with `404 RECORD_NOT_FOUND` before anything trusted is built. The member data grant on `sys_approval_request` is not widened.
- **Both doors, one rule.** The REST `/actions` door and the MCP `run_action` bridge call one shared function at the same point (`refuseDeniedSubjectLoadBeforeDispatch`, with `apiForwardSubjectRecord` building the request's row).
- **The target's sentence is relayed.** A target that answers `{ code, error: '<sentence>' }`, as the approvals decision routes do, now has that sentence relayed as the refusal's message (for example, which decision outputs are required to approve), where the door answered "its target answered HTTP 400".
