---
'@object-ui/console': patch
---

fix(console): the approvals inbox status filter offers Cancelled

Clause-②: no
Metadata-protocol: none

On the **Submitted by me** and **All** tabs of the approvals inbox, the status filter listed Pending, Approved, Rejected, Recalled and Returned for revision, but not **Cancelled**, although cancelled requests show in the same list with their own badge and the server answers `GET /api/v1/approvals/requests?status=cancelled`. The filter now offers Cancelled, and choosing it lists only the cancelled requests.

The options are now drawn from the approval contract's status list (`APPROVAL_STATUSES` in `@objectstack/spec/contracts`) rather than typed out one by one, so a status the platform adds later appears in the filter without a console change. Each option keeps the label its badge shows.

Nothing to migrate.
