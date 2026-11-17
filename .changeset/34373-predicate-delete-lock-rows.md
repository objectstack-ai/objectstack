---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
---

fix(spec, objectql, driver-sql): a predicate delete with a cascade locks the rows it walks, so a concurrent commit cannot move one out of the predicate before the delete (#34373)

Clause-②: yes (widening: DriverOptions.lockRows and DriverCapabilities.lockRows)
Metadata-protocol: added

**The defect.** A predicate delete (`delete(object, { where, multi: true })`, a flow's `delete_record` with `multi: true`) on an object that delete-family lookups reference reads the matched ids, walks the cascade, then deletes those rows by id. The caller's predicate is not on the final DELETE, so a guard such as `{ id, source: 'idp_pending' }` ("delete only if still pending") held only at the read: a concurrent commit that moved the row out of the predicate between the read and the delete was deleted anyway, and counted.

**The fix.** Inside the delete's unit of work, the matched-row read now takes a lock on a driver that can lock, so no other writer can change a matched row behind the unit: it waits until the unit ends, or one side fails. The rows deleted are still exactly the rows walked; nothing changes for a delete that meets no concurrent writer.

- `DriverOptions` (`@objectstack/spec/data`) gains `lockRows`: on a read inside a `transaction`, lock the returned rows against concurrent writers until the transaction ends (SQL `SELECT … FOR UPDATE`).
- `DriverCapabilities` gains `lockRows`: the driver's `find()` honours that option. Absence means `false`, and the engine sends no lock request to such a driver.
- `driver-sql` declares the bit. PostgreSQL and MySQL take row locks (`FOR UPDATE`), SQL Server an update lock (`UPDLOCK`). SQLite compiles nothing: its single-connection pool and database lock already keep another writer from changing a returned row behind the transaction. A second writer through the same driver waits; one on another connection either fails `SQLITE_BUSY` (rollback journal) or commits and makes the transaction's own delete fail `SQLITE_BUSY_SNAPSHOT` (WAL), so the moved row is never deleted. A `find()` with `lockRows` and no transaction is refused `PRECONDITION_REQUIRED` / 428.
- The engine's read and delete verbs do not take `lockRows` from a caller (an option they do not execute, as before). Any other option bag that carries it to the engine's driver hop is refused there, before any driver runs: an object whose driver does not declare the bit answers `NOT_IMPLEMENTED` / 501, and a request with no transaction reaching that driver `PRECONDITION_REQUIRED` / 428.

**What keeps the window.** A driver without the bit (memory, MongoDB, OData), and a cascade that cannot run in one transaction (the `split` plan, a driver with no transactions), read unlocked as before.
