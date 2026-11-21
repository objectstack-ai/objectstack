---
'@objectstack/plugin-approvals': patch
---

fix: a locked record's lines read as locked, and deleting the locked record still removes its lines

Clause-②: no
Metadata-protocol: none

**Reading the lock answers for a line too.** `IApprovalService.getRecordLock` (and `GET /api/v1/approvals/records/:object/:recordId/lock`) now answers `{ locked: true }` for a `master_detail` child row while the record it belongs to is held by a locking pending approval: the same rows whose insert, update and delete the server refuses with `409 RECORD_LOCKED`. It used to answer `{ locked: false }` for them, so a page could offer an edit the server then refused. A row the caller cannot read still answers as a missing one.

**Deleting a record while its approval is pending removes its lines again.** The delete lands and cancels the pending request, as before the lines were locked; its `master_detail` lines are removed with it. A line is still never removed by deleting a different record: when the line object has a second relation that also cascades on delete, its removal is refused while any of its masters is locked.
