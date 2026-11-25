---
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
'@objectstack/rest': patch
'@objectstack/client': patch
---

feat(plugin-approvals): the record lock reads say whether a row is held by its own approval or by its master's

Clause-②: yes (widening: both lock doors' published entry gains a field)
Metadata-protocol: none

Both approval lock reads (`IApprovalService.getRecordLock` and `getRecordLocks`, and their REST doors `GET /api/v1/approvals/records/:object/:recordId/lock` and `POST /api/v1/approvals/records/:object/locks`) now answer a locked record with `lockSource`, which approval holds it:

- `'record'`: a pending request on the record itself, from a node whose `lockRecord` is not `false`. Deleting the record still goes through and cancels the request.
- `'master'`: the record is a `master_detail` line of a record so held. The server refuses the line's insert, update and delete with `409 RECORD_LOCKED`.

When both hold (a line with a pending request of its own, under a held master), the answer is `'master'`, because that is the delete the server refuses. An unlocked record still answers `{ locked: false }`, with no `lockSource`, and `null` (`404 RECORD_NOT_FOUND` at the single door, `locked: null` in the batch door) still means unreadable or missing, never told apart. No request id, node, approvers or `pending` flag is served. A list can now hide Delete on a line whose master is under approval instead of offering a delete the server refuses.

The `IApprovalService` return types gain the optional `lockSource?: 'record' | 'master'`, so an implementation may omit it on a locked answer and still satisfies the contract; the REST doors then serve `{ locked: true }` without a kind.

Which rows count as readable is unchanged at both doors. The two doors keep different readability anchors on purpose: the single door counts any returned row, the batch door only the row whose id is the asked id; aligning them would narrow a published answer (seat ruling 7152650156 on #37151). So an id the database matches only under another spelling (a different letter case, `07` for a numeric `7`) answers `null` in the batch door. The single-record door counts the row it finds as readable and judges it, as before: a line of a held master answers `'master'`, because that check reads the row found, but a record's own request is looked up by the id as asked, so a record held by its own request may answer `{ locked: false }` under another spelling. A client asking with the ids the server gave it gets the same answer from both doors.

`@objectstack/client`: `client.approvals.getRecordLock` and `getRecordLocks` type the answer with the optional `lockSource?: 'record' | 'master'`.
