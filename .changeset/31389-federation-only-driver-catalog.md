---
'@objectstack/service-datasource': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(service-datasource): the Studio connection form offers Oracle and SQL Server, federation only

Clause-②: yes (widening)
Metadata-protocol: none

`GET /api/v1/datasources/drivers` now lists `oracle` (Oracle Database) and `mssql` (SQL Server). Each entry's connection fields are projected from the driver's config contract in `@objectstack/spec`, like every other entry, and its words are served in every language on the platform locale table.

Both drivers serve federation only (ADR-0015 §4.6), so their entries carry a new key, `federationOnly: true`, read from the spec's `FEDERATION_ONLY_DRIVER_IDS`. The key is absent on every other entry; a client that does not read it sees two more entries and nothing else changed.

The New datasource dialog reads that key from the catalog: for Oracle and SQL Server its Schema mode select offers External and Validate only, never Managed (the spec refuses a managed datasource naming either), and one sentence under it says why. A Managed choice made on another driver moves to External when one of them is chosen. As with PostgreSQL and MySQL, the database client (`oracledb`, `tedious`) is an optional install next to the server. A SQL Server datasource whose `tedious` is missing is now refused with the install of `tedious` as its remedy, like the other clients; it used to be told to rebuild the workspace.
