---
'@objectstack/driver-turso': minor
---

fix(driver-turso)!: a local or replica `TursoDriver` on a remote url, or a replica off a local file, is refused at construction

Clause-②: no (narrowing)

A remote `url` beside `syncUrl` was classified as an embedded replica, and the local SQLite engine that every replica read and write goes through was handed `:memory:`. Writes succeeded and read back, then vanished on restart, and none of them reached the remote. `@libsql/client` builds no embedded replica for a remote url: it routes `libsql://` / `https://` / `http://` to its HTTP client and `wss://` / `ws://` to its WebSocket client, neither of which reads `syncUrl`. A forced `mode: 'replica'` or `mode: 'local'` beside a remote url was handed the same `:memory:` engine, and so was a replica on `:memory:`. Measured before the change, with `create`, `find`, then a fresh driver on the same config:

```
libsql:// + syncUrl (sync.onConnect: false)  -> 1 row back, 0 rows after restart
libsql:// + mode: 'replica' or mode: 'local' -> 1 row back, 0 rows after restart
:memory: + syncUrl + a supplied client       -> 1 row back, 0 rows after restart
file: + syncUrl (unchanged)                  -> 1 row back, 1 row after restart
```

With the driver building its own client and the default `sync.onConnect`, two of these did fail at `connect()`, but on a libsql error that did not say why: `libsql://` + `syncUrl` with `SYNC_NOT_SUPPORTED`, and `:memory:` + `syncUrl` with `URL_INVALID`.

**BREAKING** accept-set narrowing on a published driver option, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **The constructor now refuses configurations it accepted before**, at `new TursoDriver()`, ahead of the Knex base and of any client, with the ADR-0112 envelope `code: 'VALIDATION_ERROR'`, `status: 400`. A remote url here means one of the schemes `TursoDriver.detectMode` classifies as remote: `libsql://`, `https://`, `http://`, `wss://`, `ws://`. The #19976 entry in this same version matches them in any letter case, so an uppercase `LIBSQL://` is a remote url too. Refused:

- a remote url beside `syncUrl`;
- a remote url under a forced `mode: 'replica'` or `mode: 'local'`;
- a replica on a url `@libsql/client` reads as in-memory (`:memory:`, or `file::memory:` with or without a query string), beside `syncUrl` or under a forced `mode: 'replica'`. `@libsql/client` refuses such an embedded replica itself. For `:memory:` and a bare `file::memory:` the local engine was a private in-memory database. With a query string it was a file literally named after the url's path (for example `:memory:?cache=shared`) in the working directory, which no sync reaches;
- under a forced `mode: 'replica'`, a `url` that is none of `:memory:`, a `file:` url or a remote url, such as a bare path or an unsupported scheme. The #19976 entry in this same version refuses such a url in every local or replica mode, and matches the `file:` scheme in any letter case: an uppercase `FILE:` url naming a file is a `file:` url and is not refused, and the replica runs on that file (`FILE::memory:` is refused as in-memory, like `file::memory:`).

The remote-url refusal names the scheme it met. Neither refusal echoes the url, which may carry a token. Both loaders (`@objectstack/runtime`'s host factory and the datasource factory) reach this refusal through the same constructor, so a datasource declaring one of these configurations now fails by name when its loader builds the driver.

**What stays accepted**, pinned by preservation tests: a `file:` url with `syncUrl` (the embedded replica), a `file:` or `:memory:` local database, a remote url on its own or with `mode: 'remote'`. `TursoDriver.detectMode()` still classifies a remote url beside `syncUrl` as `'replica'`: the refusal sits in the constructor, not in a re-classification.

**Not refused by this change:** a url with no `mode` that is none of a lowercase `file:` url, `:memory:` or a lowercase remote scheme, such as an uppercase `LIBSQL://`, an uppercase `FILE:` url or a bare path like `./data/app.db`, auto-detected `'local'` with or without `syncUrl`, and the local engine was handed `:memory:`. Under a forced `mode: 'local'` the same url got the same `:memory:` engine. The #19976 entry in this same version removes that fall-through: it matches every scheme in any letter case, so an uppercase remote url is a remote url and an uppercase `FILE:` url is a `file:` url, and it refuses every other url in a local or replica mode. No configuration runs on an in-memory database it did not name.

**What an affected author does.** Each refusal names its ways out. For a remote url in a local or replica mode:

- to use the remote database, drop `syncUrl` (and `sync`) and any forced `mode`; the remote url alone sends every read and write to it;
- for an embedded replica, point `url` at a local file and keep the remote in `syncUrl`: `url: 'file:./data/replica.db', syncUrl: 'libsql://my-db.turso.io'`.

For a replica off a local file, point `url` at a local `file:` path beside `syncUrl`. A throwaway in-memory database instead drops `syncUrl` (and `sync`) and any forced `mode: 'replica'`, and keeps `url: ':memory:'`.

Blast radius, measured on this tree: no example, template, published skill, hand-written doc or factory default declares a remote url beside `syncUrl`, and the host boot path (`OS_DATABASE_URL`) passes no `syncUrl`. Outside this package's own tests, the in-repo configurations carrying the pair are test fixtures that never construct the real driver: loader fixtures that exercise the config builder or a capturing constructor, stored-row redaction fixtures and a schema-parse fixture. Whether any out-of-repo deployment declares it is NOT measured and is not claimed to be zero.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed at the driver constructor: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `TursoDriverConfig.url`, `syncUrl` and `mode` keep their names and types, and both `TursoConfigSchema` copies are untouched. What moves is which CONFIGURATIONS `new TursoDriver()` accepts, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. Each refusal names its ways out, and which one an author wants (a remote database, an embedded replica on a local file, or a plain local database) is authoring intent no ledger line can decide. -->
