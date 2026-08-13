---
"@objectstack/spec": minor
---

feat(spec): refuse `${…}` placeholder syntax in connection-material driver config keys at publish (#8336)

A `${…}` placeholder written in authored datasource config (e.g.
`config.url: 'postgresql://${DB_HOST}/db'`) is resolved by **nothing** — it was
stored verbatim in `sys_metadata` and handed verbatim to the database client at
connect (#7990 census, measured during #8078), so the connection failed (or
connected somewhere unintended) with no error naming the unresolved placeholder.
The maintainer-ruled fix (#8336, direction 2, 2026-08-13) refuses the syntax
loudly at publish instead of implementing resolution, making the non-capability
explicit: **placeholders are not resolved here**.

**What is refused:** a complete `${…}` span anywhere in a connection-material
string value of the built-in driver configs — postgres/mysql/mongo
`url`/`host`/`database`/`username`, postgres `schema`/`applicationName`, mongo
`authSource` and every nested string in the `options` passthrough, turso
`url`/`syncUrl`/`encryptionKey`, sqlite/sqlite-wasm `filename`.

**What stays accepted:** every literal value byte-identically, including
placeholder-looking near-misses (`$VAR`, `{name}`, an unclosed `${`); configs of
drivers with no shipped contract (plugin-contributed ids stay unjudged, the
#4410 boundary).

**Carve-out (by construction):** runtime-environment DSNs — `OS_DATABASE_URL`
and friends — are translated into driver config by the boot hosts and never pass
through this authoring schema; environment-driven deployment is exactly what
they are for.

## FROM → TO

```ts
// before — parsed green, stored verbatim, failed at a distance
defineDatasource({
  name: 'prod', driver: 'postgres',
  config: { url: 'postgresql://svc@${DB_HOST}:5432/prod' },
})

// after — write the literal value; env-driven deployments use the runtime DSN
defineDatasource({
  name: 'prod', driver: 'postgres',
  config: { url: 'postgresql://svc@db.internal:5432/prod' },
})
// (or set OS_DATABASE_URL in the runtime environment — never through this
// schema; for secret material, bind it via the connection form's secret field /
// external.credentialsRef instead.)
```

There is deliberately **no automatic rewrite**: the placeholder names a value
that exists only in the author's intended deployment environment, which a
source-file transform cannot know — substituting anything would invent a
connection target. `os migrate meta` surfaces the change as a structured TODO
(semantic entry `datasource-config-placeholder-refused`).

<!-- adr-0087: registered datasource-config-placeholder-refused -->
