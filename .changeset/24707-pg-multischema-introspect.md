---
'@objectstack/driver-sql': minor
---

fix(driver-sql)!: on PostgreSQL, `introspectSchema` reads each table's columns in the table's own schema, and refuses a `search_path` that reaches one table name in two schemas instead of silently dropping one

`introspectSchema` lists the base tables of every schema in `current_schemas(false)` and keys the answer by bare table name. Two things went wrong when a connection's `search_path` named more than one schema (`ALTER DATABASE … SET search_path = public, sales`). First, each table's columns came from knex `columnInfo()` on the bare name, which reads only the first schema on the path, so a table that lives only in a later schema (`sales.orders`) was listed with no columns. `listRemoteTables` answered it `columnCount: 0`, and a draft built from it had no fields. Second, a same-named table in a later schema (`sales.customers` behind `public.customers`) was dropped without a word, because one key cannot hold two tables. The PostgreSQL branch now reads every table's columns in its own schema. When one bare name is reached in more than one schema, it refuses the whole introspection with `RESOURCE_CONFLICT` / `409`, naming each colliding table with its schemas in `search_path` order. A connection that reaches one schema, the default `public` deployment included, answers exactly what it answered before. The SQLite and MySQL branches are unchanged.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the SQL driver's PostgreSQL introspection gives for a connection whose search_path reaches more than one schema: a table in a later schema now carries its own columns, and a table name reached in two schemas is refused rather than answered with one of the two tables. The remedy is connection configuration (one schema per connection) or a rename on the remote database, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (introspection's accept set narrows on PostgreSQL), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** a PostgreSQL connection whose `search_path` reached a table name in two schemas got a successful `introspectSchema()` answer holding one of the two tables (the one in the earliest schema on the path), and so did every caller built on it: `listRemoteTables`, object drafting, catalog refresh and the external datasource's connection test.
- **TO:** the same call throws `RESOURCE_CONFLICT` (`status: 409`), naming each colliding table and its schemas, for example `'customers' ('public', 'sales')`. Those callers surface that error.
- **Also changed (a wrong answer made right, no accept set moved):** a table that lives only in a later schema on the path now reports its own columns where it reported none.
- **Unchanged:** a connection that reaches one schema, the default `public` deployment included. One schema cannot hold two same-named tables, so it is never refused, and its answer is byte-identical to before.
- **Fix:** point the connection at one schema (the datasource's `schema` setting sets its `search_path`), or rename one of the two tables on the remote database.
