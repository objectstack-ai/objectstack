---
"@objectstack/types": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
---

fix(drivers): a `conflictKeys` upsert with no backing unique index refuses legibly on **Postgres** too, not only SQLite (#8567)

`SqlDriver.upsert` recognised "the `ON CONFLICT` target is not backed by a
PRIMARY KEY or UNIQUE index" on **SQLite only** (#8445). `driver-sql` serves
three dialects, so on Postgres the raw driver error still escaped: `mapDataError`
fell through to its default branch and served the thrown message as the whole
response body — and that message is the **statement**, with no `code` for any
client to branch on.

**What a Postgres caller got, and now gets.** Measured against a real
PostgreSQL 16.13 through the same knex + `pg` path the driver uses:

```
before:  code=42P10  status=undefined
         message=insert into "plain" ("email", "id", "title") values ($1, $2, $3)
                 on conflict ("email") do update set "title" = excluded."title"
                 - there is no unique or exclusion constraint matching the ON CONFLICT specification

after:   code=VALIDATION_ERROR  status=400
         message=Cannot upsert into "plain" on conflict keys ("email"): no PRIMARY KEY or
                 UNIQUE index backs them, … Fix by declaring the column(s) "unique: true" …
```

The accept/reject set does not move: the same upserts fail, they fail legibly.
The server's own sentence is preserved on the error's `cause`, which no error
mapper puts on the wire, so an operator debugging the table keeps the ground
truth while the caller stops receiving SQL text.

**One clause of the refusal wording changed, on both faces.** "…and SQLite
refuses the statement" is now "…and **the database** refuses the statement".
Once recognition covers Postgres, naming SQLite points a Postgres operator at
the wrong engine. `driver-turso`'s remote-face copy moved in the same commit —
the two are held word-for-word identical (#5240) by #8568's cross-face parity
pin. No other sentence of the refusal changed.

**Recognition is now a named, shared predicate.**
`isUnbackedConflictTargetError` is exported from `@objectstack/types` beside
`isUniqueViolationError`, carrying one measured message limb per dialect that
can raise the condition. ⚠️ It is deliberately a **separate** predicate:
`isUniqueViolationError` answers the opposite condition (an index exists and the
row violated it), and a merged one would report a working constraint as a
missing one.

**MySQL is unaffected, by measurement rather than omission.** knex compiles
`onConflict(...).merge(...)` on that dialect to `ON DUPLICATE KEY UPDATE`, which
takes no conflict target — the named keys never leave the process, so the server
is never asked to find an index for them and the condition cannot arise. The
compiled statement is pinned; the live MySQL cell is reported as un-run rather
than passing vacuously.
