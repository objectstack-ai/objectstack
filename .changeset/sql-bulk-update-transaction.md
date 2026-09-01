---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `bulkUpdate` applies as one transaction, so a mid-batch refusal rolls back the rows already applied (#13854)

`SqlDriver.bulkUpdate` is a sequential loop of individual `update()` calls — one
per id, because each id carries its own patch and no single statement expresses
N different SET lists. That loop had no transaction around it, so every
`update()` autocommitted its own row. A batch refused partway through — a unique
violation on a later row, a NOT NULL violation, any per-row failure from the
database — left every row processed **before** the refusal permanently
committed. The caller received an exception while the database held a state
nobody declared: neither the pre-image nor the post-image, and a retry of the
same array was not safe.

The loop now runs inside a transaction, so the batch applies as one unit.
`driver-turso` reaches this door through `super.bulkUpdate` and inherits the
repair; no subclass change is needed or was made.

Same defect class #13340/#13435 closed on `driver-memory`'s batch doors, on the
production SQL driver. `bulkDelete` was measured and is untouched — it is a
single `whereIn(...).delete()` per rotation shard, already atomic per shard.

**Behaviour inside a caller's transaction.** When the caller supplies
`options.transaction`, the batch runs in a nested transaction (a `SAVEPOINT`) on
that same transaction rather than opening a competing one. A refused batch is
undone as a unit, the caller's own surrounding work is untouched, and the
caller's transaction stays usable — so a caller that catches the refusal and
commits anyway no longer lands a partial batch.

No API, signature or accepted-input change: every input accepted before is
accepted after, and every refusal that fired before still fires. A missing id is
still skipped rather than refused, unchanged.
