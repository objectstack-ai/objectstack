---
'@objectstack/plugin-approvals': patch
'@objectstack/spec': patch
---

fix(plugin-approvals): the batch lock read answers a line of a held master as locked, as the single read does

Clause-②: no
Metadata-protocol: none

`getRecordLocks` (`POST /api/v1/approvals/records/:object/locks`) answered `locked: false` for a master-detail line whose master is held by a locking approval, while `getRecordLock` answered `locked: true` and the line's write was refused `RECORD_LOCKED`. The batch read now asks the detail-row lock too, through its new batch form `detailRowsHeldByLockingApproval`: one read of the rows' master-detail columns plus one lookup per master-detail edge, whatever the page size, never one read per row. The answer's shape is unchanged (`{ locked }` or `null`); a list page that reads the batch door now stops offering an editor on such a line. The `getRecordLock` / `getRecordLocks` contract docblocks in `@objectstack/spec` now say a line of a held master answers `true`.
