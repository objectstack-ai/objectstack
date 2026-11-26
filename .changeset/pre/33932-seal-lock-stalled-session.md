---
'@objectstack/objectql': patch
'@objectstack/plugin-audit': patch
---

fix(objectql, plugin-audit): a database session lock whose connection stalls no longer hangs the audit sealer, `os migrate audit-* --apply` or a migrator's release

Clause-②: no
Metadata-protocol: none

A held database session lock (the audit seal lock, and the schema-migration lock) used to wait for its connection with no limit when it checked or let go of the lock. A connection stalled half-open, with no reply and no reset, never fails a statement, so the liveness probe (`select 1`), the unlock statement and the close of the raw connection could each wait for good. That hung a sealer pass checking its lock before a checkpoint, the `finish()` of an `os migrate audit-* --apply` run, and a migrator's release.

Each of the three steps now gives up after 10 seconds (`DATABASE_SESSION_LOCK_ANSWER_MS`). A live session answers each one in milliseconds and waits exactly as before.

- A probe the session does not answer in time reads as a lost lock. The session is not probed again, and the release sends it no unlock: it closes the connection, which releases the lock.
- An `--apply` run whose lock's session stopped answering reports the lock lost, as for a session that ended: it prints the line at error, names `os audit verify` and exits non-zero. The line now reads `(its database session ended, or stopped answering)`.
- A sealer pass whose lock's session stops answering reports that the audit seal lock lapsed and writes no checkpoint. The next pass tries again.
- The schema-migration lock runs the same statements. A release on a session that has stopped answering returns after the bound instead of hanging the migration or the boot. The lock then stays with the database session until that connection dies, as it would if the process had been killed.

Nothing an author writes, no exported signature and no statement changes.
