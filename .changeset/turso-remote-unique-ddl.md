---
"@objectstack/driver-turso": minor
---

fix(driver-turso): the remote face emits the declared `unique`, and an unbacked `conflictKeys` upsert refuses in an envelope (#8413)

`RemoteTransport`'s DDL builder had no notion of `unique` at all, so a column
declared `{ type: 'string', unique: true }` reached a remote Turso endpoint as a
bare `"email" TEXT`. Two consequences of one cause, both fixed here:

1. **Declared uniqueness was not enforced on the remote face.** Same driver,
   same object definition, opposite answers: the local face rejected a duplicate
   while the remote face accepted it and the duplicate landed. A remote
   deployment that believed its `unique` declarations was accumulating
   duplicates silently, and no read reported it. The remote face now emits a
   companion `CREATE UNIQUE INDEX`, built from `uniqueIndexesFromFields` — the
   same helper `SqlDriver` uses locally — so both faces produce the same index
   name and the same key, including the ADR-0120 D1/D3 per-organization form.
2. **`conflictKeys` upserts could not work on remote at all.** SQLite requires
   an `ON CONFLICT` target to be backed by a PRIMARY KEY or UNIQUE index; with
   the index never created, every business-key upsert raised a raw `SqliteError`
   (`code: 'SQLITE_ERROR'`, `status: undefined`) — not an ADR-0112 envelope. It
   now answers `VALIDATION_ERROR` / 400 naming the object, the keys and the
   remedy, with the SQLite text preserved as `cause`.

**Who is affected.** Remote (`libsql://` / `https://`) Turso deployments only;
local and embedded-replica modes are unchanged. On a remote deployment a
duplicate write to a declared-unique column now **fails** where it previously
succeeded. That is the declaration being honoured rather than a new restriction
— the local face has always rejected it — but it is a real change in runtime
accept/reject and is the reason this is called out here rather than buried.

**Existing tables are retrofitted, never migrated.** A table that already exists
gets its unique index created outside the schema-sync batch, so one table's
failure cannot roll back another object's DDL. If the table already holds the
duplicates the missing constraint admitted, the index cannot be created: that is
reported at `error` level naming the table and the remedy, the boot continues,
and `conflictKeys` upserts against it get the enveloped refusal above. **No
stored row is deleted, merged or rewritten** — resolving existing duplicates is
an operator decision, not a side effect of a driver booting.

**On the bump.** The behaviour change alone would be `patch` by the usual
reading — it refuses a shape that was never entitled to an answer, since the
metadata declared the column unique. It is `minor` because `RemoteTransport`
(exported from the package root) gains two public wiring methods,
`setDurabilitySink` and `setTenantFieldResolver`. Nothing is removed, renamed or
narrowed.
