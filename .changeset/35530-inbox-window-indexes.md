---
'@objectstack/service-messaging': patch
---

perf(service-messaging): the inbox feed's receipt window read is served by an index

Clause-②: no
Metadata-protocol: none

The Console bell polls a user's `sys_notification_receipt` rows on the `inbox` channel every 10 seconds, newest first, top 20. The table had no key that leads on `user_id` and `channel` and continues with `created_at`, so each poll collected and sorted the user's whole receipt history. It now declares `(user_id, channel, created_at)` beside its two existing indexes.

Measured on SQLite with 56,000 receipts: the read went from about 3 ms to 0.1 ms for a user with 5,000 inbox receipts, and from about 1.8 ms to 0.1 ms for a user with 3,000 older ones. The plan changes from sorting the user's whole range to searching the new index and stopping at the window.

On existing databases the next boot creates the index. On PostgreSQL it is built concurrently, because the table already exists. On MySQL it is created where `user_id` and `channel` are already `varchar`, which holds for receipt tables created since those columns declared their bounds. On an older receipt table, the existing `(user_id, state)` index is already refused, so nothing changes there.

The matching `(user_id, created_at)` index on `sys_inbox_message` is deferred: on existing MySQL tables `user_id` is stored as `TEXT`, which MySQL cannot index, and schema sync never rewrites a column type.
