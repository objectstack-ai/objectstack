---
"@objectstack/driver-turso": patch
---

`TursoDriver` in **remote** mode reads and writes a federated object's remote table, `external.remoteName`, the way the local and embedded-replica modes always have (#20107).

Clause-②: no

**What was wrong.** `registerExternalObject` records a federated object's remote table (ADR-0015), and the local face reads that record for every statement. The remote face inherited the registration but never read it. Every remote data door handed `RemoteTransport` the object name, and the transport used it as the table. So an object `ext_customer` bound to the remote table `customers` was queried as a table named `ext_customer`. Measured on a remote face over a libSQL `file:` client, with a local driver over the same file answering every door from the mapped table:

- `find`, `findOne`, `count` and every write door failed with a bare `LibsqlError` (`SQLITE_ERROR: no such table: ext_customer`). It carried no `status`, so REST served it as an unclassified 500.
- `aggregate` answered `[]`, because the transport reads "no such table" as "no rows".
- `distinct` answered `DATABASE_ERROR` / 500.

**What changes, on the remote face only:**

- Every data door (`find`, `findOne`, `count`, `aggregate`, `distinct`, `create`, `update`, `upsert`, `delete`, `bulkCreate`, `bulkUpdate`, `bulkDelete`, `updateMany`, `deleteMany`) compiles against the table the registration recorded. That is `external.remoteName` for a federated object, and the object's own name otherwise. It is read from the same `SqlDriver` registry the local face reads, and not copied. Managed objects send the same statements as before.
- A remote table name is quoted as one SQL name, with any embedded quote doubled, so a name the local face can read (`order-lines`) can be read here too.
- `find`, `findOne` and `count` now end in the local face's read-exit envelope. A statement the backend refuses, for example on a remote table that really is absent, answers `DATABASE_ERROR` / 500. The libSQL error rides under a non-enumerable `cause`, the dialect text goes to the server log, and the targeted table is declared for `isMissingTableError`. Before, the bare `LibsqlError` reached the caller. The write doors keep the local face's behaviour, where a write fault is classified at the REST boundary from its message.
- A federated object whose `external.columnMap` **renames** a column is refused with `NOT_IMPLEMENTED` / 501 on every remote data door, before any statement is sent. The remote transport addresses columns by field name and does not translate the map. With the table resolved, a filter on a renamed field would read a column the table does not have, and the transport answers that with an empty list rather than the matching rows. Before this change the same object failed on every door with `no such table`. A map whose entries rename nothing is served. **If this refusal fires for you:** use the local or embedded-replica transport for that object, or name its fields after the remote columns and drop the renaming entries.

`RemoteTransport`'s data methods take the physical table as an optional last argument. When it is omitted, the object is its own table, which is what a transport used on its own always did.
