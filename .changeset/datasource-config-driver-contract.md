---
'@objectstack/spec': minor
'@objectstack/service-datasource': minor
---

`datasource.config` is now validated against its driver's contract (#4410)

`config` was the one authorable slot on a datasource with no gate at all. The
schema's own comment claimed "the driver's own `configSchema` is what validates
it" — nothing did: both bundled driver specs set `configSchema: {}`, no code read
the field, and the per-driver zod schemas were not even exported from the
package. So `config: { hostname: 'db.internal' }` (the key is `host`) was
accepted in silence and the datasource connected to `localhost` while the parse,
the save and the connection probe all reported success.

`DatasourceSchema` now parses `config` — and each `readReplicas` entry — against
the contract for the declared driver, and `DatasourceAdminService`
(create/update/test, the Setup wizard's path) applies the same check. Both read
one registry in `@objectstack/spec/data`, which also projects each contract to
JSON Schema for `DriverDefinitionSchema.configSchema` and the Studio connection
form, so the form offers exactly the fields the validator accepts.

New exports from `@objectstack/spec/data`: `PostgresConfigSchema`,
`MysqlConfigSchema`, `SqliteConfigSchema`, `SqliteWasmConfigSchema`,
`MongoConfigSchema`, `MemoryConfigSchema`, plus `resolveDriverId`,
`getDriverConfigSchema`, `getDriverConfigJsonSchemaById` and
`validateDriverConfig`. A driver the platform ships no contract for (a plugin's
`com.vendor.snowflake`) keeps an unvalidated `config`.

**Migration.** A config that was silently ignored now fails with the correction
in the message. The renames:

| Wrote | Write instead | Driver |
| --- | --- | --- |
| `user` | `username` | postgres, mysql, mongo |
| `connectionString` / `dsn` | `url` | postgres, mysql, mongo |
| `uri` | `url` | mongo |
| `file` / `path` / `database` | `filename` | sqlite, sqlite-wasm |
| `hostname` | `host` | postgres, mysql, mongo |
| `searchPath` | `schema` | postgres |

And the relocations — keys that were never driver config:

| Wrote in `config` | Write instead |
| --- | --- |
| `min` / `max` / `idleTimeoutMillis` / `connectionTimeoutMillis` | the datasource's own `pool` block |
| `schemaMode` | next to `driver`, on the datasource |
| `readOnly` | `capabilities: { readOnly: true }` |
| `ssl: { ca, cert, key, rejectUnauthorized }` | the datasource's own `ssl` block — inside `config`, `ssl` is the on/off boolean shorthand |

Two memory-driver keys are **removed**: `indexes` and `maxRecordsPerObject`.
`InMemoryDriverConfig` has no field for either — the driver keeps no indexes and
evicts nothing — so both were inert. Drop them; for real indexing use a driver
that indexes.

A postgres, mysql or mongo datasource must now name a connection target
(`database`, or a `url` that carries it). An empty `config` used to mean "the
client's own localhost default", which is the same defect in its most complete
form.

**Also fixed, because the contract can only be enforced where it is honoured.**
These keys were declared and read by nothing; they now reach the driver:

- `datasource.pool` is honoured by every SQL driver (it was declared, carried
  into the connection spec, then overwritten with a hardcoded `{ min: 0, max: 5 }`),
  and maps onto the Mongo client's `minPoolSize` / `maxPoolSize`.
- `datasource.schemaMode` reaches the driver. It was dropped between the
  datasource record and the connection spec, so a `schemaMode: 'external'`
  database — one ObjectStack must never run DDL against — was constructed as
  `managed`.
- `datasource.ssl` reaches the SQL clients, certificates and all. It stopped at
  the record — nothing put it on the connection spec — so a TLS block configured
  nothing, which is exactly what its own schema comment warns about ("a TLS
  setting that never took effect looked identical to one that did").
- postgres `schema` (knex `searchPath`), `applicationName` and `statementTimeout`.
- mongo `password`, `authSource` and `options`. A mongo datasource carrying a
  `config.password` previously composed its URL with an **empty** password.
