---
'@objectstack/driver-turso': minor
---

fix(driver-turso)!: a local or replica `TursoDriver` whose engine would have nothing durable behind it is refused at construction, instead of silently running on a private in-memory database

Clause-②: no (narrowing)

A remote `url` beside `syncUrl` was classified as an embedded replica, and the local SQLite engine that every replica read and write goes through was handed `:memory:`. Writes succeeded and read back, then vanished on restart, and none of them reached the remote. `@libsql/client` builds no embedded replica for a remote url: it routes `libsql://` / `https://` / `http://` to its HTTP client and `wss://` / `ws://` to its WebSocket client, neither of which reads `syncUrl`. The same fallback caught a forced `mode: 'replica'` or `mode: 'local'` beside a remote url, and a replica on `:memory:`. Measured before the change, with `create`, `find`, then a fresh driver on the same config:

```
libsql:// + syncUrl (sync.onConnect: false)  -> 1 row back, 0 rows after restart
libsql:// + mode: 'replica' or mode: 'local' -> 1 row back, 0 rows after restart
:memory: + syncUrl + a supplied client       -> 1 row back, 0 rows after restart
file: + syncUrl (unchanged)                  -> 1 row back, 1 row after restart
```

With the driver's own client and the default `sync.onConnect`, the first and third rows already failed at `connect()`, but with a libsql error (`SYNC_NOT_SUPPORTED` / `URL_INVALID`) that did not say why.

**BREAKING** accept-set narrowing on a published driver option, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **The constructor now refuses configurations it accepted before**, at `new TursoDriver()`, ahead of the Knex base and of any client, with the ADR-0112 envelope `code: 'VALIDATION_ERROR'`, `status: 400`:

- a remote url (`libsql://`, `https://`, `http://`, `wss://`, `ws://`) beside `syncUrl`;
- a remote url with a forced `mode: 'replica'` or `mode: 'local'`;
- a replica (`syncUrl`, or `mode: 'replica'`) whose `url` is not a local `file:` path, `:memory:` and `file::memory:` included. `@libsql/client` refuses an in-memory embedded replica itself.

The message names the scheme it met, never the url, which may carry a token. Both loaders (`@objectstack/runtime`'s host factory and the datasource factory) reach this refusal through the same constructor, so a datasource declaring one of these configurations now fails its connect by name.

**What stays accepted**, pinned by preservation tests: a `file:` url with `syncUrl` (the embedded replica), a `file:` or `:memory:` local database, a remote url on its own or with `mode: 'remote'`. `TursoDriver.detectMode()` still classifies a remote url beside `syncUrl` as `'replica'`: the refusal sits in the constructor, not in a re-classification. An uppercase or unrecognised scheme with no `mode` still falls through to `'local'`, unchanged here.

**What an affected author does.** The refusal names both ways out. For a remote database, drop `syncUrl` (and `sync`), or the forced `mode`: the remote url alone sends every read and write to it. For an embedded replica, point `url` at a local file and keep the remote in `syncUrl`: `url: 'file:./data/replica.db', syncUrl: 'libsql://my-db.turso.io'`.

Blast radius, measured on this tree: no example, template, published skill, hand-written doc or factory default declares a remote url beside `syncUrl`, and the host boot path (`OS_DATABASE_URL`) passes no `syncUrl`. The only in-repo configurations carrying the pair are loader fixtures that exercise the config builder or a capturing constructor, never the real driver. Whether any out-of-repo deployment declares it is NOT measured and is not claimed to be zero.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed at the driver constructor: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `TursoDriverConfig.url`, `syncUrl` and `mode` keep their names and types, and both `TursoConfigSchema` copies are untouched. What moves is which CONFIGURATIONS `new TursoDriver()` accepts, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The refusal names both ways out, and which one an author wants (a remote database, or an embedded replica on a local file) is authoring intent no ledger line can decide. -->
