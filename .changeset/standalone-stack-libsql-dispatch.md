---
'@objectstack/runtime': minor
---

**`createStandaloneStack` now dispatches `libsql://` / Turso URLs** instead of refusing them as an unsupported scheme (#5820).

`detectDriverFromUrl()` recognised `memory://`, `postgres://`, `mongodb://` and `file:`, and threw on everything else — while `resolveDatabaseUrl()` listed `TURSO_DATABASE_URL` as one of its URL sources. A host that set it got the URL read in and then rejected on the way out. Since the CLI wired `libsql://` for `os serve` / `os start` (#5602), the same `OS_DATABASE_URL=libsql://…` booted under `os start` and failed under `os migrate`, which comes through this stack.

What changed:

- `libsql://…` and `http(s)://*.turso.…` resolve to the `turso` driver kind — the same two spellings the CLI classifies, kept identical on purpose.
- `databaseDriver: 'turso'` (and `OS_DATABASE_DRIVER=turso`) is accepted by the config schema.
- The driver comes from `@objectstack/driver-turso`, an **optional** install: it drags `@libsql/client` and its native bindings, so it is not a dependency of `@objectstack/runtime`. It is loaded lazily, only for a selection that asks for libSQL, and injected through the driver-factory seam `DefaultDatasourcePlugin` already exposes — so the connect path, the `bootCritical` fail-fast verdict, `OS_ALLOW_DRIVER_CONNECT_FAILURE` and the retained Setup → Datasources status are identical to every other kind.
- Package missing? The boot fails **loudly**, carrying the exact install command (`npm install @objectstack/driver-turso`) as data as well as prose. There is no SQLite fallback: a silent step-down would open an empty local database while your libSQL data stays untouched, and every write — including an `os migrate` DDL — would land in the wrong place (#3276).
- `databaseAuthToken` is no longer declared-and-ignored: the `turso` kind reads it, falling back to `OS_DATABASE_AUTH_TOKEN` and then the vendor's own `TURSO_AUTH_TOKEN` — the same precedence `os serve` uses.

Unknown schemes still throw, and the message now lists `libsql://` among the supported ones.
