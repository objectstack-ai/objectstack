---
"@objectstack/platform-objects": patch
"@objectstack/service-queue": patch
---

`sys_job_queue`'s claim path no longer sorts the whole queue on every poll, and a job's due time is now a SQL predicate instead of a filter applied after `LIMIT` (#17612).

`DbQueueAdapter.claimBatch` — the 1s poll every `DbQueueAdapter` runs — read the queue as `WHERE queue = ? AND status = 'pending' ORDER BY priority ASC, scheduled_for ASC`, while `sys_job_queue` declared `['queue','status','scheduled_for']`. The sort's **first** key, `priority`, was in no declared index at all, so the equality prefix seeked and the planner then built a sorter over every pending row in the queue, every tick. Measured on both Turso faces:

```
SEARCH sys_job_queue USING INDEX idx_sys_job_queue_queue_status_scheduled_for (queue=? AND status=?)
USE TEMP B-TREE FOR ORDER BY
```

- **The declared index becomes `['queue','status','priority','scheduled_for']`**, replacing `['queue','status','scheduled_for']` — the table still declares three. The full-queue sort is gone on both faces; what remains is a sorter bounded to rows tying on the whole indexed prefix, because a paged read carries one ORDER BY term the caller never writes — the unique tie-breaker of the deterministic-paging contract (ADR-0053 D-A1), here `id`. ⛔ That last term is deliberately **not** closed by appending `id` to the index: `id` is an unbounded `Field.text`, and a text column a declared index keys on without a `maxLength` makes MySQL reject the index DDL outright (`check:keyed-text-bounds`, ER_BLOB_KEY_WITHOUT_LENGTH).
- **Due-ness moved into `where`** as `$or: [{ scheduled_for: null }, { scheduled_for: { $lte: now } }]`, the same shape `SqlOutboxStore.claim` uses. It had been a JS filter applied to rows `LIMIT` had already chosen, so a window full of not-yet-due high-priority jobs hid already-due work behind it indefinitely: at the default `batchSize: 10` (candidate window 30), 30 future-dated `priority: 1` rows plus one due `priority: 100` row claimed **0** per poll, forever. It now claims 1.
- **`priority` still decides claim order.** The alternative — dropping it from the sort — would have left a declared, documented field (`Lower = higher priority`) with no runtime effect at all.
- ⚠️ **On an existing database the superseded index is not dropped.** The retrofit adds `idx_sys_job_queue_queue_status_priority_scheduled_for` and leaves `idx_sys_job_queue_queue_status_scheduled_for` in place (measured: 3 indexes before, 4 after, no row touched), so a provisioned table carries one redundant index until an operator drops it through the migrate-plan path. A freshly created table gets three.
