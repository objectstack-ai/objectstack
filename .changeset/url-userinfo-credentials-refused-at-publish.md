---
"@objectstack/spec": major
---

feat(spec)!: refuse URL-embedded credentials (`user:password@host`) in driver `config.url` at publish (#8082)

#7990 refused the inline credential keys (`config.password` / `config.authToken`),
and #8078 measured — and pinned as a fact — that `config.url` still accepted the
identical secret one syntax over: `postgresql://user:password@host/db` landed in
`sys_metadata` cleartext exactly as `config.password` did, and the key refusal
itself steered authors (very often AI authors) into the URL form. The
maintainer-ruled fix (#8082, Option A) closes that door with one value-level
parse shared by the four URL-bearing driver schemas (postgres / mysql / mongo
`config.url`, turso `config.url` + `config.syncUrl`).

**What is refused:** a URL whose userinfo carries a NON-EMPTY password segment
(`user:password@host`, `user:${DB_PASSWORD}@host`, percent-encoded included).

**What stays accepted:** a bare username (`user@host` — `username` is a writable
key; only the secret is refused, matching #7990's posture), and every
credential-free URL byte-identically. The shape the #8126 read path serves for a
legacy stored row (`user@host`) parses green, so an untouched "Save" on a legacy
row keeps working.

**Carve-out (by construction):** runtime-environment DSNs — `OS_DATABASE_URL`
and friends — are translated into driver configs by the boot hosts and handed to
the driver factory directly; they never pass through this authoring schema and
are unaffected.

## FROM → TO

```ts
// before — accepted, stored in cleartext in sys_metadata
defineDatasource({
  name: 'legacy', driver: 'postgres',
  config: { url: 'postgresql://svc:hunter2@db.internal:5432/prod' },
})

// after — the URL is credential-free; the secret lives in the secret store
defineDatasource({
  name: 'legacy', driver: 'postgres', schemaMode: 'external',
  config: { url: 'postgresql://svc@db.internal:5432/prod' },
  external: { allowWrites: false, credentialsRef: 'sys_secret:<handle>' },
})
// (Setup → Datasources binds the secret for you: its secret field encrypts into
// sys_secret and writes external.credentialsRef; the resolved secret is injected
// at connect time and wins over anything embedded in the URL.)
```

Do NOT substitute a `${…}` placeholder into the URL: placeholders in authored
metadata are resolved by nothing and reach the database client verbatim
(#8078, measured).

There is deliberately **no automatic rewrite**, for the same reason as #7990's
entry: moving the credential requires encrypting it through a running secret
binder, which a source-file transform cannot do — auto-stripping the userinfo
would silently drop a live credential. `os migrate meta` surfaces the change as
a structured TODO (semantic entry `datasource-config-url-userinfo-refused`).

<!-- adr-0087: registered datasource-config-url-userinfo-refused -->
