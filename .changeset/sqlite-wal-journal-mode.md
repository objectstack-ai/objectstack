---
'@objectstack/driver-sql': minor
'@objectstack/driver-sqlite-wasm': patch
'@objectstack/cli': patch
---

File-backed SQLite now runs `journal_mode = WAL` (#3941).

`SqlDriver.connect()` set `auto_vacuum` and left the journal mode alone, so
every ObjectStack SQLite database ran SQLite's built-in default — a rollback
journal. That is the worst mode for the shape this platform actually has, which
is **several processes on one file**: a dev server, `os migrate`,
`os meta resync`, a test run. Measured, on the same file:

| | rollback journal | WAL |
|:---|:---|:---|
| writer while another process holds a read open | `SQLITE_BUSY` — committing needs an exclusive lock | proceeds |
| idle attached connection visible to SQL | no — a lock lasts only as long as its transaction | yes (`locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` reports busy) |

The second row is why the `os migrate` occupancy check had to inspect file
descriptors to see a live server at all (#3940): under a rollback journal there
was nothing in the database to see. That signal stays — it names the process,
which WAL's lock probe cannot — but the SQL probe is now authoritative for
databases ObjectStack created rather than a fallback that was blind in practice.
Concurrent *writers* still serialize; SQLite allows one at a time in any mode.

Journal mode is a persistent property of the file, so an existing database is
converted in place on the next connect (a header change — no rows are touched)
and stays converted. Two consequences to plan for:

- `app.db-wal` / `app.db-shm` exist beside the database while a connection is
  attached, and `app.db-wal` can hold committed transactions. A clean shutdown
  checkpoints them away; a naive copy of `app.db` alone while a server runs does
  not. Use `sqlite3 app.db ".backup …"`.
- **WAL does not work on network filesystems** (NFS/SMB). Opt out with
  `OS_DATABASE_SQLITE_JOURNAL_MODE=delete`, or per datasource with
  `sqliteJournalMode: 'delete'` in the driver config (which outranks the env
  var). Either form *applies* `delete`, so it also converts a database that
  already adopted WAL back — skipping would have stranded it.

Nothing here fails a boot, and nothing is assumed: `PRAGMA journal_mode = X`
answers with the mode actually in force rather than raising on refusal, so the
reply is read back; and because a filesystem can accept WAL and then fail the
first read *through* it, the mode is proven with a read and rolled back to
`delete` if that fails — with a warning naming the file and the escape hatch.
`synchronous` is untouched, so durability is exactly what it was. `:memory:`
databases are left alone, as is `auto_vacuum = INCREMENTAL`, which keeps
reclaiming under WAL (ADR-0057).

`os db clean` now counts `-wal` / `-shm` as part of the database when it measures
what a `VACUUM` reclaimed, so bytes that were sitting in the log do not read as a
reclaim of zero.

`@objectstack/driver-sqlite-wasm` deliberately stays out of WAL. Its live
database is in the WASM heap and what reaches disk is a byte image it exports, so
nothing reads the database across processes and the pragma buys it nothing —
while still being a persistent header change in the operator's file. sql.js
*accepts* the pragma (its VFS is memory-backed), so this had to be declared
rather than discovered.

It also now parks a `-wal` left behind by an unclean native-driver exit rather
than loading the image beside it: wasm SQLite cannot read that log, and leaving
it next to a freshly rewritten image would let a later real SQLite replay frames
that no longer belong to it. The warning names the file it parked and how to
recover what was in it.
