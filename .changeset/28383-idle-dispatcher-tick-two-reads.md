---
'@objectstack/service-messaging': patch
---

perf(service-messaging): an idle notification or HTTP dispatcher tick reads the database twice, instead of 18 and 10 times

Clause-②: no
Metadata-protocol: none

A kernel that mounts messaging runs two delivery dispatchers, and each one ticked against an empty outbox at a fixed price: one claim probe per partition (and, for notifications, one digest probe per partition), plus a visibility-timeout reap that issued its predicate `UPDATE` whether or not any claim had expired. With the default 8 partitions that was 18 statements per notification tick and 10 per HTTP tick, measured at the client on a kernel. A kernel's global `afterUpdate` hook makes the engine read the matched rows before it writes, so the reap cost two statements. At the framework's 30-second idle ceiling an idle tenant kernel read its database 56 times a minute.

An idle tick is now two reads per dispatcher, whatever `partitionCount` is:

- **The reap reads before it writes.** It reads one expired `in_flight` id. Only a hit runs the `UPDATE`, whose predicate is unchanged, so it still returns every claim expired by then to `pending`.
- **One due-work read gates the partition pass.** Before taking any partition lock, the dispatcher asks the outbox once, across every partition and organization, whether any `pending` row is due. For notifications this covers immediate and batched (digest) rows. If none is due, the tick ends: no lock is taken and no claim or digest probe runs. If one is due, the tick runs the full per-partition pass exactly as before, at the price of one extra read.

`INotificationOutbox` and `IHttpOutbox` gain an optional `hasDueWork({ now })`, with `DueWorkOptions` and `HttpDueWorkOptions` exported for it. Both built-in stores, SQL and memory, implement it. A custom outbox that does not implement it keeps the per-partition probes it had. `partitionCount` and the stored `partition_key` are unchanged.
