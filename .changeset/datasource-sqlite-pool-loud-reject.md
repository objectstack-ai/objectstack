---
"@objectstack/service-datasource": minor
---

fix(service-datasource): a `pool` block on a sqlite datasource is rejected, not dropped in silence (#5714)

`datasource.pool` is declared, strict and documented, and until now it reached a
driver only from the arms that build a pooled client: `postgres` / `mysql` hand
`buildSqlPool(spec)` to `SqlDriver`, `mongo` maps `min`/`max` onto the client's
`minPoolSize`/`maxPoolSize`. The `sqlite` and `sqlite-wasm` arms passed no pool
at all — `resolveSqliteDriver` has no such option and `SqliteWasmDriver` does
not take one — so an author who sized their pool got the driver's own single
connection and nothing said otherwise. Measured through the real factory:

```text
sqlite   + pool{min:3,max:9}   knex.client.config.pool {"createTimeoutMillis":15000}   live {min:1,max:1}
postgres + pool{min:3,max:9}   knex config.pool {"min":3,"max":9}                      live {min:3,max:9}
```

`examples/app-crm` was the live specimen: `CrmDatasource` asked for
`{ min: 1, max: 5 }` and ran on one connection.

**Wiring it through would be wrong, not merely more work.** Knex's
better-sqlite3 dialect pins `{min:1,max:1}` on purpose: every pool acquire runs
`new Database(filename)`, so two connections to `:memory:` are two separate,
mutually invisible databases. Honouring `max: 5` there would split one
datasource's data across five stores. Sizing a SQLite pool is not a knob the
platform can offer, so the declaration is rejected at authoring/publish instead
— Prime Directive #12: fix the metadata at the producer, reject it loudly, never
tolerate it in the consumer.

**Observable behaviour change — read this if any datasource declares `pool`.**
A `sqlite` / `sqlite-wasm` datasource carrying a `pool` block now **fails**
where it used to boot with the block ignored:

- **Boot** (`DatasourceConnectionService.connectDeclared`) refuses before a
  single connection is attempted, naming every offending datasource in one
  throw. Every *declared, active* datasource is judged, including the ones the
  ADR-0062 D2 gate leaves unconnected — a pool block on a datasource nobody
  connects is exactly as dropped as a connected one's. `active: false` is
  skipped, so switching a datasource off remains the way out.
- **Setup → Datasources** (`createDatasource` / `updateDatasource`) rejects the
  draft before the record is stored. An update that touches neither `pool` nor
  `driver` is not re-judged, so a record written before this gate stays editable
  — including the `active: false` that takes it out of service.
- **The driver factory** (`createDefaultDatasourceDriverFactory`) rejects it as
  the last door, for hosts that build drivers directly.

The fix is to delete the block: `pool` is a no-op on SQLite either way, so
removing it changes nothing about how the datasource runs.

```diff
 export const CrmDatasource = defineDatasource({
   name: 'crm_primary',
   driver: 'sqlite',
   config: { filename: ':memory:' },
-  pool: { min: 1, max: 5 },
   active: true,
 });
```

`pool` is unchanged and still honoured on `postgres` / `mysql` / `mongo`, and a
plugin-contributed driver id (`com.vendor.snowflake`) is not judged at all —
the same boundary the `datasource.config` gate draws in #4410: the platform
validates what it can construct.

This verdict is an **authoring** error, not a connect failure: it never goes
through the ADR-0062 D5 degradation path, so `OS_ALLOW_DRIVER_CONNECT_FAILURE`
does not apply to it and is not suggested. That hatch exists for a database that
is unreachable — a fact about the world that may resolve itself. A `pool` the
driver cannot read is a fact about the metadata.

Hosts that inject their own driver factory can hold the same contract with the
newly exported `assertDatasourcePoolSupported` / `driverReadsDeclaredPool` /
`unsupportedPoolIssue` / `POOL_UNSUPPORTED_DRIVER_IDS`.
