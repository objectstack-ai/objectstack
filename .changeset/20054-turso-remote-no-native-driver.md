---
"@objectstack/driver-turso": minor
---

fix(driver-turso)!: a REMOTE `TursoDriver` no longer needs `better-sqlite3` installed, and the two inherited calls that answered from its private in-memory database now reject (#20054)

Clause-②: no (narrowing)

`package.json` declares `better-sqlite3` an optional peer, and the README tells a remote-only deployment (Vercel, an Edge runtime) that it does not need it. The code did not keep that promise. With `better-sqlite3` absent, `new TursoDriver({ url: 'libsql://…' })` threw knex's `Knex: run $ npm install better-sqlite3 --save` error at construction, before any remote call.

The cause: remote mode handed the `SqlDriver` base a `better-sqlite3` Knex config on `:memory:`, and knex loads a dialect's native driver whenever the config carries a `connection`. Remote mode now builds that Knex instance with no `connection`. It loads no native module, opens no pool and holds no private in-memory database. With `better-sqlite3` absent, a remote driver constructs, connects and runs CRUD through `@libsql/client`.

**BREAKING** — two calls on a remote driver that resolved before now reject. This is an accept-set narrowing on a published driver, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). The calls are `SqlDriver` methods that remote mode does not override, and they now reject with knex's `Unable to acquire a connection` error:

- `introspectSchema()` used to resolve `{ tables: {} }`, "no tables", whatever the remote database held;
- `reclaimSpace()` used to resolve.

Both old answers came from the private in-memory database, not from the remote one. The per-method answer or refusal for these inherited calls is carried by #20055.

**Error wording only, not the narrowing.** On a remote driver:

- `findWithWindowFunctions()` still rejects. The error is now knex's `Unable to acquire a connection` instead of a missing-table error from the in-memory database.
- `analyzeQuery()` and `explain()` still resolve the compiled SQL with an `error` field. That field now carries knex's message instead of a missing-table error.
- `distinct()` answers the same `DATABASE_ERROR` / 500 as before.

**Unchanged:**

- **Local and embedded-replica modes.** Their `toKnexConfig` arms are untouched and still run on `better-sqlite3`, so a local driver (`:memory:` or a `file:` url) still fails at construction without it.
- **Every call remote mode sends to `RemoteTransport` behaves as before**, including raw SQL through `execute()`. None of them used the Knex instance.
- **The `NOT_IMPLEMENTED` / 501 refusals of `detectManagedDrift()` and `planMediaColumnMove()` on a remote driver** still refuse, with the same code and status. Their messages no longer say that remote mode's Knex connection is a placeholder in-memory database; they say that remote mode has no Knex connection.

<!-- adr-0087: not-required (no-migration-prescription) A narrowing of which calls a remote `TursoDriver` answers: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `TursoDriverConfig` and both `TursoConfigSchema` copies are untouched, and `introspectSchema` / `reclaimSpace` keep their names and signatures. What moves is only that a remote driver no longer answers those two calls from a private in-memory database, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The per-method answer or refusal on the remote face is carried by #20055. -->
