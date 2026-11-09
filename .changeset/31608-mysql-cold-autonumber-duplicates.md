---
'@objectstack/driver-sql': patch
---

fix(driver-sql): concurrent first writes to a new autonumber object on MySQL no longer issue duplicate numbers

Clause-②: no
Metadata-protocol: none

On MySQL 8, the first records written concurrently to an object whose autonumber counter did not exist yet could share a number (measured: 16 cold writers gave up to 10 duplicates, with some creates failing `ER_LOCK_DEADLOCK`). The cold seed locked a missing counter row before inserting it; on InnoDB that takes a gap lock every writer shares, so the inserts deadlocked, the server rolled the losers' whole transactions back, and the driver went on in autocommit, where its locked read no longer locked anything.

The counter row is now seeded first, by an idempotent insert (`ON CONFLICT DO NOTHING` on Postgres and SQLite, a no-op `ON DUPLICATE KEY UPDATE` on MySQL), and locked only once it exists, so a cold counter takes the same path as a warm one. Measured on MySQL 8.0 after the fix: 16 cold writers on one driver, on two drivers, and in 16 caller transactions issue 1..16 once each, with no deadlock.

When the server does roll the whole transaction back (`ER_LOCK_DEADLOCK`): an issue in a transaction the driver owns is retried from the start, up to five attempts; an issue inside the caller's transaction is not retried and the caller gets the server's `ER_LOCK_DEADLOCK`, since that transaction, and the caller's earlier writes in it, are already gone. Before, the issue went on and its writes autocommitted outside the caller's transaction.

Postgres and SQLite issue the same numbers as before; every issue now reads the counter row once without a lock before locking it.
