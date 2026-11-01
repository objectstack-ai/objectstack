---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell,console): an approver who opens an approval request sees its decision panel again, read from the approvals service

Clause-②: no
Metadata-protocol: none

Since the record page started opening with one request (`POST /api/v1/data/:object/:id/page`), an approval request's own page took the request from that data API read. A non-admin approver is refused `sys_approval_request` there, so opening a request from the Approvals inbox, by its `?request=` link or by a cold load of its record route drew "You don't have access to Approval Request records" with no Approve, Reject or Reassign. An admin approver was answered the stored row: it carries no per-caller `viewer` block, so the decision actions stayed hidden, and its `pending_approvers` is the comma-joined string, so the "Waiting on" strip drew one chip per character.

A request's page now asks no record page payload. Each part reads on its own through the adapter, as before the payload, and the Console routes the request read to `GET /api/v1/approvals/requests/:id`, which serves `viewer`, the decision tally and the approvers as an array. Nothing about what the data API lets an approver read changes. Every other record page still opens with its one request.

The Console's routed adapters (`routeApprovalRecordReads` and the inbox's scoped source) now refuse a request's `getRecordPage` with the `UNSUPPORTED_QUERY_PARAM` refusal and send nothing for a request's `prefetchRecordPage`, so a request's page can no longer be drawn from the data API's row through that door. A record shown in a drawer whose open asks no payload keeps warming the next record's related counts.
