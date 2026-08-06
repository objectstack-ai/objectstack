---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the ADR-0010 lock gate refuses an uncertain write instead of allowing it (#5706)

`getEffectiveLock` is the single source of truth for the ADR-0010 §3.3 lock
gate, and both of its callers are write-path admission — `assertLockAllowsWrite`
(save / publish / rollback) and `assertLockAllowsDelete`. Its overlay read was
wrapped in a bare `catch` that fell through to `lock: 'none'`.

`'none'` is not a neutral placeholder there. It is the verdict "the author
declared no protection", and `evaluateLockForWrite` / `evaluateLockForDelete`
turn it straight into "allow". So a `sys_metadata` read that **failed** became a
write that was **performed**, on an item whose overlay row declared it
protected. Measured before the fix, with the overlay row carrying `_lock` and
only the gate's own read rejecting: `saveMetaItem` returned `success: true`
after updating a `_lock: 'no-overlay'` item, and `deleteMetaItem` returned
`success: true` after deleting a `_lock: 'no-delete'` one — while the very same
rows, read successfully, produce `403 ITEM_LOCKED`. The audit trail did not
record the miscarriage either: the allowed path writes its ordinary
`outcome: 'allowed'` row, so nothing afterwards showed the write should have
been denied.

**Wire-visible change.** When the lock state cannot be read, `save`, `publish`,
`rollback` and `delete` now fail with `503` / `SERVICE_UNAVAILABLE` (the driver
error attached as `cause`) instead of proceeding as if the item were unlocked.
Refusing one uncertain write is the intended trade against performing one that
had to be refused. Callers that retry on 503 need no change; callers that
treated a successful save as proof the item was unlocked never had that
guarantee.

The discrimination reuses `rethrowUnlessMetadataStoreUnprovisioned`, introduced
in #5705 for this file's overlay reads, rather than inventing a second
predicate: an unprovisioned `sys_metadata` genuinely has no overlay row, so
`'none'` is the truth and first boot still saves normally; every other error is
an outage.

Unaffected, and covered by regression tests: artifact-level locks (answered from
the in-memory registry before the overlay read is reached), a genuine miss on a
healthy store (still allowed), and control-plane kernels (`environmentId`
undefined), which never enter either gate.
