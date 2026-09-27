---
"@objectstack/driver-turso": patch
---

`README.md` — the remote branch of the architecture tree no longer lists `beginTransaction`, `commit` and `rollback` as `RemoteTransport` operations. `RemoteTransport` has no transaction methods, and remote mode refuses all three with `NOT_IMPLEMENTED` / 501. A new "What remote mode refuses" section lists every `NOT_IMPLEMENTED` / 501 the remote face raises: transactions (including `options.transaction` passed to the remote data and schema methods), a record number for an empty `autonumber` field on `create`, `bulkCreate` and an `upsert` with no `id`, `_id` or `conflictKeys`, `setDeferredDdl(true)`, `detectManagedDrift()`, `planMediaColumnMove()`, and two `aggregate()` shapes that `engine.aggregate()` computes in memory instead (a `groupBy` entry with a `dateGranularity`, an `aggregations` entry with a non-empty `filter`).

Also corrected: the remote-mode bullet no longer says every operation is delegated to `RemoteTransport`, the remote example no longer says every CRUD call works as in local mode, and the local branch no longer lists array-style filters, which the driver refuses.

- **No behaviour moves.** The driver's source and every published export are byte-identical; only the README text shipped in this package's `files[]` changes.
