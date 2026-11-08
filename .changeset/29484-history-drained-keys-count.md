---
'@objectstack/metadata': patch
---

feat(metadata): a read-only count of the history snapshots the drained-key scrub would rewrite

Clause-②: no
Metadata-protocol: none

`@objectstack/metadata/migrations` gains `scrubHistoryDrainedKeys(driver, { mode: 'count' })`, the count mode of a one-time scrub of `sys_metadata_history` snapshots written before history started withholding what a connector save drains (undeclared `auth` keys).

- **One predicate.** A stored snapshot is counted exactly when `historySnapshotBody` — the helper both history writers already store through — would store a different body for it today. Nothing in the count names a key or a type, so the count and the write-time withholding cannot disagree, and a snapshot written since that withholding landed is never counted.
- **Read-only.** It takes a driver's `find` and nothing else, pages the table by primary key, and reports the number of affected rows, the number of distinct items they belong to, and the affected rows' ids as opaque handles. A body that is not JSON, or one the snapshot helper cannot reduce, is listed beside the count, never folded into it. The result never carries a key name, a value or a body.
- **Count only.** Any other mode is refused before anything is read. The rewrite of stored history runs only after the maintainer confirms the count; run the count on a copy of the database and hand its numbers over privately.
