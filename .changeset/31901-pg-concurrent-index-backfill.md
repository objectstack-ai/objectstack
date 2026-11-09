---
'@objectstack/driver-sql': patch
---

fix(driver-sql): build PostgreSQL index backfills on existing tables concurrently

Clause-②: no
Metadata-protocol: none

On PostgreSQL, an index the schema sync adds to a table that already exists is now built with `CREATE INDEX CONCURRENTLY`, so writes to the table are no longer blocked while it builds. This covers the boot sync, `os migrate apply`, and rotation shards that already exist; non-unique and unique indexes alike. Before, the sync sent a plain `CREATE INDEX` (or `ADD CONSTRAINT … UNIQUE`), which blocks every INSERT, UPDATE and DELETE on the table for the whole build. Measured on PostgreSQL 16 at 1,000,000 rows: an INSERT sent during the build waited 537 to 777 ms before and about 1.2 ms after. The index that results is the same; a plain unique index still ends as the same unique constraint. A table the sync creates is empty and keeps the plain statement, and SQLite, MySQL and the other dialects send exactly what they sent before. `os migrate plan` output is unchanged. This also replaces the "plain `CREATE INDEX`, which blocks writes" note in this release's entry on implicit reference-column indexes: on PostgreSQL those indexes now build concurrently too.

What operators should know:

- **A concurrent build waits for older transactions anywhere in the database.** `CREATE INDEX CONCURRENTLY` waits for every transaction that started before it, on any table, not only the one being indexed. A long report query or an open, uncommitted session elsewhere holds it.
- **The wait is bounded, and a timeout is deferred to the next sync.** The build arms PostgreSQL's `lock_timeout` at the driver's existing DDL lock-wait bound, 120 seconds. On a timeout, boot logs an error naming the index and carries on. Every remaining concurrent build in that process is then deferred to the next sync, each with its own error line and without waiting again, so one long transaction costs a boot at most 120 seconds, not 120 seconds per missing index. `os migrate apply` instead fails with `DATABASE_ERROR` (500), naming the table, the bound, and how to find the holder in `pg_stat_activity`. Re-running it once the holder has ended is safe.
- **INVALID indexes are cleaned up automatically.** A concurrent build that does not finish (a lock timeout, or a duplicate row written during a unique build) leaves an INVALID index behind. The next sync reads `pg_index.indisvalid`, drops an INVALID index under a name this driver manages (`DROP INDEX CONCURRENTLY`, with a warn line), and builds it again. An INVALID index under another name is reported and left alone.
- **A unique index is probed for duplicates before its DDL.** Over duplicate rows no DDL is sent: the same error line as before names the conflicting groups, and no INVALID index is left behind.
