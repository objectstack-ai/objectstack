---
"@objectstack/driver-sql": patch
---

fix(driver-sql): drop the vestigial `sqlite3` peerDependency — the SQLite path uses `better-sqlite3` (#3277)

`package.json` advertised `peerDependencies.sqlite3: "^5.0.0"`, but the driver never
loads `sqlite3` at runtime. Every first-party SQLite construction site builds a
`client: 'better-sqlite3'` Knex driver (`resolveSqliteDriver` in
`@objectstack/service-datasource`, the datasource driver factory, and the whole
driver test suite), and the README already tells consumers to `pnpm add better-sqlite3`.
`better-sqlite3` is auto-provided as an `optionalDependency` (with the native → wasm →
memory step-down of #2229 covering a failed native build), so the SQLite requirement is
already satisfied without the consumer installing anything.

The stale `sqlite3` peer only misled: a consumer resolving peer deps could `pnpm add
sqlite3` (never used) while believing they'd satisfied the SQLite requirement. Removing
it aligns the declared contract with the code and the docs. The `sqlite3` string alias
still maps to `better-sqlite3` in the driver factory and dialect detection, so
`driver: 'sqlite3'` config keeps working — it just resolves to `better-sqlite3` like
everything else.
