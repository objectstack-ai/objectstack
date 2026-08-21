---
"@objectstack/service-storage": patch
---

**Bug fix (retention leak):** an UPDATE that re-points a `sys_attachment` row's `file_id` now detaches the PRIOR file the same way deleting that row would — tombstoning it when the re-pointed row was its last reference (#10171).

`installAttachmentLifecycleHooks` registered only delete-side and insert-side handlers, so a `file_id` re-point left the old `sys_file` sitting at `status='committed'` with zero join rows and no `deleted_at`. That is not the module's "fail toward retention" bias, which buys a **later** look: `sys_file`'s declared lifecycle nominates a row for the sweep only through `ttl { field: 'deleted_at' }` or `retention { onlyWhen: { status: 'pending' } }`, and a silently detached file matches neither — so the reap guard is never asked about it and the storage bytes are stranded permanently, with no later re-examination.

The new `afterUpdate` handler fires only when the payload actually carries `file_id` and the value actually changes, then runs the existing orphan rule (zero remaining join rows, attachments-scope, committed) on the prior id. It is best-effort like its siblings and never blocks the user's write; with no pre-image available it tombstones nothing, keeping the file.

The departed id comes from the engine-bound pre-image `ctx.previous`, **not** from a `beforeUpdate` stash mirroring the delete pair. Since #5574 (ADR-0058 Addendum II D1/D2) a predicate write dispatches one fresh context per matched row in each phase, so a stash written in `beforeUpdate` reaches `afterUpdate` on the by-id path and is lost on the predicate path — a stash-based twin would have been silently half-dead on exactly the multi-row updates that orphan the most files. Reading `previous` also adds no driver round trip: the prior-row read is memoized per operation and already demanded on this object.

**No revival leg was added**, deliberately. Re-pointing a row ONTO a grace-window tombstone is already handled by the reap guard's sweep-time re-verification, which resolves current references, un-tombstones the file and vetoes the reap rather than reclaiming bytes. A second revival mechanism here would be a duplicate answer to a question that already has one.
