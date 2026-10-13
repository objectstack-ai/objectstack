---
'@objectstack/service-messaging': patch
---

The notification and HTTP outboxes read their claim credential back from the store, so `ack()` lands on a Postgres table whose epoch-ms columns are still `real`

Clause-②: no

Tables created while the `number` field type still mapped to `real` keep those columns as IEEE-754 binary32. Newer tables get an exact numeric column, and existing columns are not migrated. A binary32 `claimed_at` stores a rounding of the claim's `now`, to the nearest 131 072 ms at today's magnitude, and reads back a nearby decimal. `SqlNotificationOutbox` and `SqlHttpOutbox` handed out the in-memory `now` as the claim credential, so it never equalled the stored value. Every `ack()` was refused with `DELIVERY_NOT_ELIGIBLE` as a lost claim, and the dispatcher absorbed the refusal. The row stayed `in_flight` with `attempts = 0`, and every reap handed it to the next claim. The notification was re-delivered about every 131 s, with no end.

- **What changes.** `claim()` and `claimDigest()` return `claimedAt` as the `claimed_at` value the store returned after the claiming update. The value written is unchanged. The rows a claim took are identified by candidate id, holder and status. `claimed_at` is no longer compared with the client's `now` in that read. `ack()`'s ownership check and its compare-and-set are unchanged. They now compare that stored value with the stored value, which is exact on any numeric column.
- **A stuck row heals by itself.** A row left `in_flight` by a refused ack is reaped by the visibility timeout, claimed again, sent once and acked. No operator act is needed. On a `real` column the reap still runs at binary32 granularity, up to about 131 s after `claimTtlMs`.
- **What is unchanged.** A genuinely lost claim is still refused. If another node, or this node's own later claim, reaped and re-claimed the row while a send ran, the late ack gets `DELIVERY_NOT_ELIGIBLE` and writes nothing. The `ClaimedDeliveryRecord` and `HttpClaimCredential` types are unchanged. Existing `real` columns are not migrated, and duplicate inbox rows that were already delivered stay as they are.
