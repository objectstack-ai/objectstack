---
'@objectstack/plugin-approvals': patch
---

fix: a locked record's lines read as locked, and deleting the locked record still removes its lines

Clause-②: no
Metadata-protocol: none

**Reading the lock answers for a line too.** `IApprovalService.getRecordLock` (and `GET /api/v1/approvals/records/:object/:recordId/lock`) now answers `{ locked: true }` for a `master_detail` child row while the record it belongs to is held by a locking pending approval: the same rows whose insert, update and delete the server refuses with `409 RECORD_LOCKED`. It used to answer `{ locked: false }` for them, so a page could offer an edit the server then refused. A row the caller cannot read still answers as a missing one.

**Deleting a record while its approval is pending removes its lines again.** The delete lands and cancels the pending request, as before the lines were locked; its `master_detail` lines are removed with it. The whole delete is refused `409 RECORD_LOCKED`, and the record, its lines and its request stay, when the line object has a second relation that also cascades on delete, or when the delete does not run inside an open transaction: a datasource that declares `supports.transactionsUnsupported`, a cascade across datasources, a record and its lines together on a datasource other than the default one, or a delete carrying the handle of a transaction that has already finished. Server code that owns the transaction must not catch the refused delete and commit anyway. A line is never removed by deleting a different record, except that when the locked record is itself the child of a record whose delete cascades to it (a `master_detail` child, or a `lookup` child with `deleteBehavior: 'cascade'`), deleting that parent removes the locked record and its lines and cancels its request.
