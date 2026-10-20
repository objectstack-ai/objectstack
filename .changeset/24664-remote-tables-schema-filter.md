---
'@objectstack/service-datasource': minor
---

fix(service-datasource)!: listing a datasource's remote tables refuses a schema filter it cannot apply (`?schema=` or the datasource's `external.allowedSchemas`), instead of answering 200 with tables the filter never narrowed

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape, export or error code is added, removed or renamed. `?schema=` and `external.allowedSchemas` keep their declared meaning, and the refusal uses the code already registered for this service, `EXTERNAL_DATASOURCE_ERROR`. The listing now refuses a request it used to answer with tables neither filter had narrowed. Nothing stored changes, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** (an answer narrowing on two public HTTP doors, `GET /api/v1/datasources/:name/remote-tables` and its twin `GET /api/v1/datasources/:name/external/tables`), shipped as `minor` under the launch-window convention for breaking changes.

`listRemoteTables` learns a table's schema only from a schema-qualified name (`sales.orders`). The in-tree SQL driver (PostgreSQL, MySQL, SQLite, and the Turso and SQLite-wasm drivers built on it) reports bare names, so both filters skipped every table. On a Postgres datasource with tables in `public` and `sales`, `?schema=sales` answered 200 with the `public` tables. A datasource that declared `external.allowedSchemas` had every table listed, the ones outside the list included.

- **Now.** When `?schema=` or `external.allowedSchemas` is in force and the driver's introspection named no schema for a table, the listing answers `400` with `error.code: 'EXTERNAL_DATASOURCE_ERROR'`. The message names the datasource, the filter and one unattributed table, and says what to do. Both route spellings answer the same envelope.
- **Unchanged.** A listing with neither filter answers every table, as before. A driver that reports schema-qualified names is narrowed by both filters, as before. A filter no table can pass whatever its schema answers an empty list: an empty `external.allowedSchemas`, or a `?schema=` the allow-list leaves out.

What to do. On a datasource served by the in-tree SQL driver, list without `?schema=`. If such a datasource declares `external.allowedSchemas`, the driver cannot enforce it: limit what the connection itself can reach (its database, or `config.schema` on Postgres) and remove `external.allowedSchemas`. `os datasource list-tables --schema` and `@objectstack/client`'s `datasources.external.listTables(name, { schema })` now report the refusal instead of the unfiltered list. The console's schema browser sends no `?schema=`, so it is affected only on a datasource that declares `external.allowedSchemas`.
