---
"@objectstack/driver-turso": patch
---

fix(driver-turso): a REMOTE `TursoDriver` no longer needs `better-sqlite3` installed (#20054)

`package.json` declares `better-sqlite3` an optional peer, and the README tells a remote-only deployment (Vercel, an Edge runtime) that it does not need it. The code did not keep that promise: with `better-sqlite3` absent, `new TursoDriver({ url: 'libsql://…' })` threw knex's `Knex: run $ npm install better-sqlite3 --save` error at construction, before any remote call. Remote mode handed the `SqlDriver` base a `better-sqlite3` Knex config on `:memory:`, and knex loads a dialect's native driver whenever the config carries a `connection`. Remote mode now builds that Knex instance with no `connection`, so it loads no native module, opens no pool and holds no private in-memory database. With `better-sqlite3` absent, a remote driver constructs, connects and runs CRUD through `@libsql/client`.

- **Local and embedded-replica modes are unchanged.** Their `toKnexConfig` arms are untouched and still run on `better-sqlite3`; a local driver (`:memory:` or a `file:` url) still fails at construction without it.
- **Every call remote mode sends to `RemoteTransport` behaves as before.** None of them used the Knex instance.
- **`SqlDriver` methods that remote mode does not override, and that run a statement through Knex, now fail instead of running against the private in-memory database.** On a remote driver, `introspectSchema()`, `findWithWindowFunctions()` and `reclaimSpace()` reject with knex's `Unable to acquire a connection` error. Before, `introspectSchema()` answered "no tables" and `reclaimSpace()` resolved, both from that private database, whatever the remote database held. `distinct()` answers the same `DATABASE_ERROR` / 500 as before. `analyzeQuery()` and `explain()` still answer the compiled SQL with an `error` field, which now carries knex's message instead of a missing-table error.
- **The `NOT_IMPLEMENTED` / 501 messages of `detectManagedDrift()` and `planMediaColumnMove()` on a remote driver** no longer say that remote mode's Knex connection is a placeholder in-memory database. They say remote mode has no Knex connection. Both calls still refuse, with the same code and status.
