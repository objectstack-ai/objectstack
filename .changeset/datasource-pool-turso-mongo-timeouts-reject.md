---
'@objectstack/service-datasource': patch
'@objectstack/spec': patch
---

datasource `pool`: the last two silent drops are now loud — `turso` whole-arm, and mongodb's two timeout keys by name (#7243)

`datasource.pool` is declared, strict and documented, and #5714 / #5931 already
made it an authoring error on the three arms that cannot honour it
(`sqlite` / `sqlite-wasm` / `memory`). #6214's ledger pass read every remaining
arm and found two faces the rejected set could not cover, both still dropped in
silence. Measured on `origin/main` before this change:

```text
turso   + pool{min:3,max:9,idleTimeoutMillis:30000}   the arm never references `spec.pool` at all
mongodb + pool{max:20,idleTimeoutMillis:30000,connectionTimeoutMillis:3000}
                       → driver config: url + database + maxPoolSize:20, and nothing else
```

The mongodb line is the harder of the two because it is **half**-effective: `max`
took effect, so the author had real evidence their pool config worked, and the
two timeouts vanished anyway.

Maintainer ruling 2026-08-11, both halves:

1. **`turso` joins `POOL_UNSUPPORTED_DRIVER_IDS` whole-arm**, with no fork by url
   mode. `TursoDriverConfig` has no `min` / `max`; a `file:` / `:memory:` url runs
   the same better-sqlite3 engine the set already rejects for, and a `libsql://`
   url is a remote request transport with no persistent connections, capped by
   `config.concurrency`. The arm carries its own explanation rather than
   borrowing SQLite's, because an author on the remote transport told about
   `:memory:` would be reading about somebody else's datasource.
2. **mongodb's two unread timeout keys are rejected by name, not wired.**
   `MongoClient` does expose `maxIdleTimeMS` / `connectTimeoutMS`, so this one
   could have been implemented; with no measured consumer asking for it, wiring
   would be behaviour-surface expansion. Rejection keeps declared = enforced and
   tells the author at authoring time. It stays a one-line change on the day real
   demand appears.

The second half is a new shape for this module: a rejection scoped to individual
**keys** rather than the whole block, because `min` / `max` on `mongodb` are
honoured and must keep working. It is a data table (`POOL_UNREAD_KEYS_BY_DRIVER`)
rather than a per-arm `if`, so the next arm that half-reads the block is one line
and inherits all three doors — the Setup wizard's create/update, the boot-time
auto-connect pre-pass, and the driver factory's last door.

Both rejections name the datasource, name the offending key(s), say the rejection
is deliberate, and give the one edit that fixes it. Neither offers an escape-hatch
env var (#5794), and the mongodb message says what SURVIVES the edit — telling a
mongo author to "remove `pool`" would delete two keys that do take effect.

Nothing that was honoured changes: `postgres` / `mysql` still receive all four
keys, `mongodb` still maps `min` / `max` onto `minPoolSize` / `maxPoolSize`. New
API surface is `POOL_UNREAD_KEYS_BY_DRIVER` / `unreadPoolKeys` /
`unreadPoolKeysMessage`; `unsupportedPoolIssue` and `assertDatasourcePoolSupported`
keep their signatures and now cover both gates, so an injected host factory that
already calls them inherits this with no change.

`@objectstack/spec` carries the ledger half: `liveness/datasource.json`'s four
`pool.*` rows and their block note recorded both of these as "still dropped in
silence" — the honest record #6214 left, and false the moment this lands. They now
state the new verdicts. No schema, type or runtime behaviour changes in `spec`.
