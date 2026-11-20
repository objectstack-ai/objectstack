---
'@objectstack/service-messaging': patch
---

perf(service-messaging): the inbox feed's two window reads are served by an index each

Clause-②: no
Metadata-protocol: none

The Console bell polls two reads every 10 seconds: a user's `sys_inbox_message` rows and their `sys_notification_receipt` rows on the `inbox` channel, each newest first, top 20. Neither table had a key that leads on the filter columns and continues with `created_at`, so the receipt read collected and sorted the user's whole receipt history on every poll, and the inbox read walked the table-wide `(created_at, id)` index and skipped every other user's rows on the way. Both now have one:

- `sys_notification_receipt`: `(user_id, channel, created_at)`, beside its two existing indexes;
- `sys_inbox_message`: `(user_id, created_at)`.

Measured on SQLite with 28,000 inbox rows and 56,000 receipts, the reads now take about 0.1 ms each, whatever the user's history: the receipt read went from about 3 ms to 0.1 ms, and the inbox read of a user whose rows are all older than everyone else's went from about 4.7 ms to 0.13 ms.

`sys_inbox_message.user_id` now declares `maxLength: 255`. A column a declared index keys on must be bounded, so that MySQL can key it, and 255 is the width of the `sys_user` id it holds. `sys_notification_receipt.user_id` already declares the same bound. The only writer is the inbox channel, which writes a user id, and the data API refuses writes to this object.

What existing databases get on the next boot:

- **PostgreSQL and SQLite:** schema sync creates both indexes. On PostgreSQL it builds them concurrently because the tables already exist. No column changes.
- **MySQL:** the receipt index is created where `user_id` and `channel` are already `varchar`, which holds for tables created since their bounds were declared. `sys_inbox_message.user_id` stays `TEXT`, because additive schema sync never rewrites a column type, so MySQL refuses the new inbox index. Schema sync reports this at error level and names the column. The fix is a manual `ALTER TABLE sys_inbox_message MODIFY user_id varchar(255) NOT NULL`. Take a backup first. The next boot then creates the index.
