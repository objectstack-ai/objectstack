---
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-pgvector': patch
'@objectstack/cli': patch
---

fix(service-knowledge, knowledge-pgvector): a build that loses its lease stops at the next page, and a build that stalls is cancelled

Clause-②: yes (widening)
Metadata-protocol: none

- **A build that loses its cluster lease stops.** Before each page, a build checks that it still holds its cluster lease. The lease counts as lost when the lock says so, or when no renewal has succeeded within the 60-second lease (the lock store is unreachable, or a renewal hangs). The build then stops before reading or embedding another page. It neither purges nor completes, and its record (`buildRecord`, `os knowledge status`) reads the new status `lease-lost`. Before this change the build only logged a warning and went on, so a second node could build the same source and the embedding spend doubled.
- **A build that stalls is cancelled.** A build that finishes no page for 15 minutes (a fixed ceiling, not a setting) is cancelled, for example when an embedding call never answers. The walk stops waiting on that call and the lease is released. The record reads the new status `timed-out`, and a new rebuild can start without a restart. The limit applies to the time between two pages, not to the whole build, so a large source that keeps making progress is never cut short.
- **pgvector: a build that lost its builder lock writes and completes nothing.** Each write and removal of a build checks, on the lock's own session, that the source's session advisory lock is still held. Once the lock is gone (freed after `buildLockIdleMs`, or its session ended), the write is refused `LOCK_CONFLICT` (409) before anything is embedded. `completeBuild` completes only the build this adapter began, and only the generation that build began. Otherwise it is refused `LOCK_CONFLICT` and switches, records and deletes nothing, so a build that lost its lock can no longer switch a generation another build has taken up since. A lock kept from an earlier build is re-checked at the next `beginBuild`, so a session that ended is never taken for a lock that is still held. **Behind a transaction-mode connection pooler** (PgBouncer transaction pooling, or a hosted provider's pooled URL), a deployment the store already did not support, the advisory lock does not stay with the session that took it. The check therefore reads a held lock as lost, and every complete build is now refused `LOCK_CONFLICT` at its first page, where before it ran with a release warning. Point the store's `url` at a direct or session-mode endpoint; the refusal's remedy says so.
- **pgvector: a search whose source's index was switched under it three times** is now refused `CONCURRENT_MODIFICATION` (409) instead of throwing an error with no code.

Widening: the exported `KnowledgeBuildRecord.status` type gains `lease-lost` and `timed-out`. A consumer that switches over it should handle both the way it handles `failed`. No other export changes: the fence and its 15-minute limit are internal to the service.

`os knowledge rebuild` and `os knowledge status` know the two new statuses: a followed rebuild that ends `lease-lost` or `timed-out` exits 1 with the build's message, as a `failed` one does.
