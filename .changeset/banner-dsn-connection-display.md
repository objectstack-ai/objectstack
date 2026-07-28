---
"@objectstack/cli": patch
---

fix(cli): the startup banner reads a DSN-declared datasource, and stops printing credentials (#3793)

`OS_DATABASE_URL="postgres://u:p@127.0.0.1:59437/nope" os serve` printed:

```
  Driver:  SqlDriver(pg)  → (unknown)
```

The driver was identified; the address was not. The banner exists so a
developer sees at a glance which database they are on, and it went blank
exactly when the database is unreachable and the address is the one thing worth
reading.

`describeRegisteredDriver` knew three of the four shapes a driver's
`config.connection` arrives in — a DSN string, `{ filename }` (sqlite), and
discrete `{ host, port, database }` — but not `{ connectionString }`, which is
what `defaultDatasourceDriverFactory` builds for a pg datasource declared with
`config.url` / `config.connectionString`. So *any* DSN-declared datasource read
`(unknown)`, while the same datasource spelled out in discrete fields read
fine. (`driver.config` keeps the shape its author passed — pinned by a
driver-sql test — so #3791's knex-side `{ connectionString, connectionTimeoutMillis }`
rewrite neither caused nor worsened this.)

Chasing that turned up two more `(unknown)`s with the same cause — the reader
returned as soon as a driver had a `config` at all, so it could only ever
succeed for a `SqlDriver`:

- **MongoDB** keeps its DSN in a top-level `config.url`, and `MongoDBDriver`
  *does* have a `config`, so the "mongo/turso expose the URL on the instance"
  arm below it was unreachable — every mongo boot banner read `(unknown)`.
- **In-memory** `config` is `{}` when none was passed, which is truthy, so the
  `(in-memory)` arm was unreachable too — a preset-wired memory driver
  bannered as `com.objectstack.driver.memory → (unknown)`.

Both are now read by shape rather than by which arm matched first. A related
latent one is fixed alongside: `SqliteWasmDriver` passes knex a dialect *class*
as `client`, and the label interpolated it — `SqlDriver(${cfg.client})` would
have pasted the class source into the banner. The label only interpolates a
string `client` now, and falls back to the driver's constructor name.

Both halves of the original bug are now one renderer,
`utils/connection-display.ts`:

- **`describeDriverConnection(config)`** knows all four `connection` shapes,
  plus the `{ uri }` / `{ url }` mongo-family spellings, applies the same field
  precedence to a top-level address, and returns `undefined` — not a guess —
  for a function-valued `connection` the host builds per pool checkout.
- **`redactConnectionUrl(value)`** drops credentials rather than masking them.
  The previous `//user:****@` mask left two holes: a password supplied with no
  username (`postgres://:secret@host/db`) did not match its regex and printed
  verbatim, and a Turso DSN carries its secret in the query string
  (`libsql://….turso.io?authToken=…`), which was never touched. Userinfo *and*
  query are now dropped; non-URL values (`:memory:`, a sqlite path,
  `(in-memory)`) pass through untouched, and the function is idempotent.

Three byte-identical copies of the old mask (`serve` / `start` / `dev`) and a
fourth variant in `schema-migrate` collapse into that one helper. The
`schema-migrate` copy had the same DSN blindness with higher stakes: it feeds
the `Apply N change(s) to …?` confirm, where a `{ connectionString }` config
rendered as a bare `pg` — an operator was asked to approve a destructive
migration against an unnamed database.

Banner/prompt output changes accordingly — `postgres://admin:hunter2@db:5432/app`
was shown as `postgres://admin:****@db:5432/app` and is now
`postgres://db:5432/app`. Display only; no configuration or API surface moves.
