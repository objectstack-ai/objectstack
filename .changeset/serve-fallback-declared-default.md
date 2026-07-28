---
"@objectstack/cli": minor
"@objectstack/service-datasource": minor
---

feat(cli): the serve storage fallback declares the default datasource instead of constructing a driver (#3826)

The last open-core second site of "definition → live driver": when a host
`objectstack.config.ts` supplies objects but no driver plugin, `serve` built a
driver via `createStorageDriver` and registered it through `DriverPlugin`, with
its connect and failure verdict landing in `ObjectQLEngine.init()` — the same
split #3869 removed from the standalone stack.

- **`createStorageDriver` is gone.** `resolveStorageDefinition` translates the
  driver kind + URL into `{ driverId, config }` (a pure host-side translation,
  like `standalone-stack`'s), and serve hands it to the runtime's
  `DefaultDatasourcePlugin` — same shared factory, same `bootCritical` failure
  verdict, same `OS_ALLOW_DRIVER_CONNECT_FAILURE` escape hatch, and the primary
  DB's real status in Setup → Datasources.
- **`mysql`/`mysql2` joined the shared driver factory** (SqlDriver over
  `mysql2`; DSN or discrete fields, secret as password).
- **Host-composition passthroughs**: the factory honours `config.autoMigrate`
  (the #2186 dev loosen-only self-heal, for the SQL kinds) and `config.persist`
  (the CLI's wasm `on-disconnect` mode). Connection builders ignore both keys.
- **`turso`/libSQL fails loud at resolution**, same typed
  `UnsupportedDriverError`, same actionable message — nothing is constructed to
  fail later.
- **The `telemetry` sibling datasource stays a pre-built `DriverPlugin`** — the
  documented escape hatch for named auxiliary drivers. Its provisioning now
  gates on the statically-known sqlite file path; the old coupling to the
  primary's *resolved* engine is replaced by the telemetry provision's own
  step-down check, which already guarded the ABI-broken case.

Verified end to end: a host-composed config (plugins + objects, no driver)
boots through the declared fallback with the same banner labels; the artifact
path (`dev:crm --fresh`) is table-for-table unchanged (71 tables, zero
`no such table`).

**Migration.** None for CLI users — same URLs, same env vars, same banner. The
removed `createStorageDriver` was CLI-internal; `resolveDriverType`,
`inferDriverTypeFromUrl` and `UnsupportedDriverError` are unchanged.
