---
"@objectstack/driver-sql": patch
---

fix(driver-sql): an `upsert` whose `conflictKeys` have no backing unique index refuses with an ADR-0112 envelope instead of a raw `SqliteError` (#8445)

`SqlDriver.upsert` let SQLite's error escape exactly as raised when the named
conflict keys were not backed by a PRIMARY KEY or UNIQUE index. Measured on the
local face (knex + better-sqlite3):

```
upsert('plain', { email: 'a@b.com', title: 'x' }, ['email'])
  -> THREW name=SqliteError code=SQLITE_ERROR status=undefined
     msg=insert into `plain` (...) values ('a@b.com', ...) on conflict (`email`)
         do update set ... - ON CONFLICT clause does not match any PRIMARY KEY
         or UNIQUE constraint
```

**The payload was the larger half of the defect.** `mapDataError` builds the
response envelope from `error.code` / `error.status`; with neither set it falls
through to its default branch and serves the thrown message as the entire body —
and that message is the **statement**, bound values inlined. So a caller got no
`code` to branch on *and* the SQL text of the write it attempted.

The condition is now recognised at the throw site and re-raised as
`VALIDATION_ERROR` / 400, carrying the original error as `cause` so the SQLite
text an operator debugging the table needs is preserved rather than destroyed.
The wording is `driver-turso`'s remote refusal (#8413), first sentence for first
sentence — `TursoDriver` picks its face from `url`, so one condition answered in
two wordings would make the answer a property of the connection string (#5240).

**No call that worked before fails now, and no call that failed before
succeeds.** The same upserts are refused; they are refused legibly. A
`conflictKeys` upsert whose target *is* backed by a declared `unique: true`
still merges, and the default `id` merge key is untouched — both pinned as
controls beside the refusal, because an implementation that refused every
`conflictKeys` upsert would satisfy the refusal assertion while having broken
the capability.

**Recognition is SQLite-first, by decision rather than by oversight.** SQLite
fills exactly one channel for this condition — the message; it raises a plain
`SQLITE_ERROR`, the same generic code a syntax error carries, so `code` cannot
discriminate. Postgres and MySQL wording for the same condition is unmeasured
(no server for either was available to raise it), so those dialects keep the
behaviour they have today rather than being matched on transcribed-from-memory
text. Measuring them, and deciding whether the recognition then belongs in a
shared predicate in `@objectstack/types` beside `isUniqueViolationError`, is
tracked on #8567.
