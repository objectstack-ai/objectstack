---
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
'@objectstack/rest': patch
'@objectstack/client': patch
---

feat(plugin-approvals,rest,client): a record-anchored approval lock read, `{ locked }` for every caller who can read the record

Clause-②: yes (widening)
Metadata-protocol: none

A member who could read and edit a record but was not on its approval was offered an edit the server then refused with `409 RECORD_LOCKED`. The lock's only carrier was the request row's `lock_record`, and that row is rightly not served to a non-participant unless the object turns on `approvalsVisibleToReaders`. The lock now has a carrier of its own.

- **`@objectstack/spec`.** `IApprovalService` gains the optional member `getRecordLock(object, recordId, context)`, which answers `{ locked: boolean }`, or `null` when the caller cannot read the record. No exported schema or type is added.
- **`@objectstack/plugin-approvals`.** `ApprovalService.getRecordLock` reads the record as the caller. A record the caller cannot read answers `null`, the same answer as an id that does not exist. A caller with no read on the object is refused for every id, whether it exists or not. `locked` is `true` while a pending request's node has `lockRecord` other than `false`. The lock judgement is now one function, `nodeConfigLocksRecord` (not exported from the package), and the record-lock hook, the request row's `lock_record` and the new read all call it. Request content stays behind `approvalsVisibleToReaders`: the answer carries no request id, node, approvers or `pending` flag.
- **`@objectstack/rest`.** New route `GET /api/v1/approvals/records/:object/:recordId/lock`. It answers `{ success: true, data: { locked } }`. A `null` answers `404 RECORD_NOT_FOUND` with one body, whether the record is unreadable or missing. A service without the member answers `501`. The route's closed query-parameter set is empty, so any query parameter is refused with a `400`. The route is ledgered as `sdk`.
- **`@objectstack/client`.** `client.approvals.getRecordLock(object, recordId)` calls that route.
