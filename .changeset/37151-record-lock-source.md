---
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
'@objectstack/rest': patch
---

feat(plugin-approvals): the record lock reads say whether a row is held by its own approval or by its master's

Clause-②: yes (widening: both lock doors' published entry gains a field)
Metadata-protocol: none

Both approval lock reads (`IApprovalService.getRecordLock` and `getRecordLocks`, and their REST doors `GET /api/v1/approvals/records/:object/:recordId/lock` and `POST /api/v1/approvals/records/:object/locks`) now answer a locked record with `lockSource`, which approval holds it:

- `'record'`: a pending request on the record itself, from a node whose `lockRecord` is not `false`. Deleting the record still goes through and cancels the request.
- `'master'`: the record is a `master_detail` line of a record so held. The server refuses the line's insert, update and delete with `409 RECORD_LOCKED`.

When both hold (a line with a pending request of its own, under a held master), the answer is `'master'`, because that is the delete the server refuses. An unlocked record still answers `{ locked: false }`, with no `lockSource`, and `null` (`404 RECORD_NOT_FOUND` at the single door, `locked: null` in the batch door) still means unreadable or missing, never told apart. No request id, node, approvers or `pending` flag is served. A list can now hide Delete on a line whose master is under approval instead of offering a delete the server refuses.

The `IApprovalService` return types gain the optional `lockSource?: 'record' | 'master'`, so an existing implementation that answers `{ locked }` alone still satisfies the contract; the REST doors then serve `{ locked: true }` without a kind.

Both doors now count a row as readable by one rule: the caller's read must hand back the row whose id is the asked id, spelled as asked. The single-record door used to accept any row the read handed back, so an id the database matched loosely (a different letter case under a case-insensitive collation, `07` for a numeric `7`) answered the lock there and `null` in the batch door. It now answers `null` at both. A client asking with the ids the server gave it sees no change.
