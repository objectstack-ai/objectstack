---
'@objectstack/spec': minor
'@objectstack/driver-sql': minor
'@objectstack/service-datasource': minor
---

feat(spec, driver-sql, service-datasource): SQL Server as a federation-only dialect — an `external` datasource over Microsoft SQL Server reads live, and with the double opt-in writes live

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — `skills/**` enumerates no datasource driver-id roster and teaches no per-dialect federation behaviour; `content/docs/data-modeling/external-datasources.mdx` gains the SQL Server section (config shape, federation-only scope, schema-qualified tables, the 2017 floor).

- **`@objectstack/spec`**: the driver vocabulary gains `mssql` (aliases `sqlserver`, `tedious`), with `hasLocalDefault: false` and the new `federationOnly` column: no boot host offers it, and a `managed` datasource declaring it is refused at parse, at `schemaMode`, with a message naming the federation-only scope. `FEDERATION_ONLY_DRIVER_IDS` and `driverIsFederationOnly()` export that column. `MssqlConfigSchema` is the closed config: `host`, `port` (1433), `instanceName`, `database`, `username`, `ssl`; an inline password, a connection URL and `autoMigrate` are refused with the reason. `type-compat`'s `SqlDialect` gains `'mssql'`, and `DIALECT_ALIASES.mssql` maps SQL Server's types (`nvarchar`/`nchar`/`ntext`/`xml` → text, `bit` → boolean, `datetime2`/`datetimeoffset`/`smalldatetime` → datetime, `uniqueidentifier` → uuid, `money`/`decimal`/`numeric` → decimal, `timestamp`/`rowversion` → binary). ADR-0015 §4.6 lists the dialect.
- **`@objectstack/driver-sql`**: `dialectName` reads `'mssql'` for knex's `mssql` client, so nothing falls to `'unknown'`. Text predicates keep the #6518 contract on SQL Server's case-insensitive default collations (a `Latin1_General_100_BIN2` comparison, `TRANSLATE` for the ASCII fold, `[` escaped); a `bit` aggregand is cast for SUM/AVG/MIN/MAX; writes use `INSERT … OUTPUT inserted.*` through a temp table, so a table with triggers accepts them; an unsorted page of a federated table is ordered by its own single-column primary key, read from the catalog; `limit: 0` compiles to `TOP (0)`; JSON fields read back from `nvarchar`; introspection lists every user table as `schema.table` (`dbo.Orders`) with its primary key, foreign keys, unique columns and indexes. Managed DDL is refused as federation-only (`SQL_DIALECT_EMISSION_UNSUPPORTED`), and `$contains` / `$empty` on a multi-value field is refused rather than approximated.
- **`@objectstack/service-datasource`**: the datasource driver factory builds an `mssql` datasource on `SqlDriver` with the `tedious` connection (`server`, `port`, `database`, `user`, the bound secret as password, `encrypt` / `trustServerCertificate` / `instanceName` from the config and the datasource `ssl` block), and reports `@@VERSION`.

Nothing existing changes for the other drivers.
