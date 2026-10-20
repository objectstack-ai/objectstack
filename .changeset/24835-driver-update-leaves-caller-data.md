---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `update()` no longer writes its `updated_at` stamp into the caller's `data`, so webhook deliveries for record updates are stored again on PostgreSQL and MySQL

Clause-②: no

- **What was lost.** On PostgreSQL and MySQL, every webhook delivery for a record update was lost. `SqlDriver.update()` assigned its `updated_at` stamp onto the patch object the caller passed in. ObjectQL publishes that same object as the update event's `changes`. On those two dialects the stamp is a knex `Raw` (`CURRENT_TIMESTAMP`) that holds the database client, its pool and a timer. The webhook outbox could not serialise the event (`Converting circular structure to JSON`), so no `sys_http_delivery` row was written. The record write still answered 200, and the webhook still read active. Every other reader of the update event's `changes`, and of the patch after the driver call, saw the same `Raw`. On SQLite the stamp is an ISO string, so the delivery was stored, but the caller's patch and the event's `changes` still carried an `updated_at` the caller never wrote.
- **What changed.** `update()`, including its rotated-table path, stamps `updated_at` into a fresh object, as `updateMany()` already did. The caller's `data` is left exactly as it was passed.
- **Unchanged.** The stored `updated_at` value on every dialect, `preserveAudit` imports, tables without an `updated_at` column, `upsert()` (it already stamps a copy of its input), and every export and option.
