---
"@objectstack/spec": minor
---

feat(spec): refuse a postgres `config.url` that `pg` itself cannot parse at publish (#9091)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`, like the sibling refusals #8337,
#9040 and #9041; the migration prescription is registered under protocol major
18, where `os migrate meta` users will look).

`PostgresConfigSchema.url`'s own describe text documents the postgres URL
grammar (`postgresql://[user@][host][:port][/dbname][?params]`) and, until now,
enforced none of it: the value was only string-scanned for credentials
(#8082/#8337) and placeholders (#8336). That leniency is deliberate at the
SHARED helper — its refusal to parse is load-bearing for mongo's
multi-host/`+srv` forms (#8696) — but for postgres it amounted to no check at
all. Measured on `pg@8.22.0`: both `pg-connection-string`'s `parse` and `pg`'s
`ConnectionParameters` throw `TypeError [ERR_INVALID_URL]` on
`postgresql://app@h1:5432,h2:5433/app` (node-postgres does not implement
libpq's multi-host DSN), yet the schema accepted that exact value — the
operator discovered the datasource could never connect only at connect time,
via a bare `Invalid URL` whose `input` field `pg` redacts.

The schema now asks `pg`'s own grammar at publish — a per-driver `superRefine`
on the postgres `url` runs `parse` from `pg-connection-string` (the parser `pg`
itself uses; now a dependency of `@objectstack/spec`) — and refuses, at the
value's path:

- anything `parse` throws on (multi-host DSNs, non-numeric ports, malformed
  percent-escapes), with the parser's own message quoted;
- a scheme-less non-URL, which `parse` only "accepts" by resolving it against
  its placeholder base (`postgres://base`) — pg would connect to the literal
  host `base` with the authored text as the database name;
- the fs-reading query parameters `?sslcert=` / `?sslkey=` / `?sslrootcert=`,
  which make `parse` itself call `fs.readFileSync` — a publish verdict must
  not depend on the validating host's filesystem, and certificate material
  already has its declared home in the datasource-level `ssl` block (the same
  prescription the config-level `ca`/`cert`/`key` keys carry).

Every measured shape `pg` genuinely opens stays accepted byte-identically:
single-host URLs (credential-free ones included), the empty-host libpq forms
(`postgresql:///db`, `postgresql://user@/db`), unix-socket spellings (a
leading-`/` path, `socket:`, a percent-encoded socket host), IPv6 hosts, and
non-credential/non-fs query parameters. Mongo, mysql and turso URLs are
untouched — the shared helpers keep refusing to parse, per-driver by design.

## FROM → TO

```yaml
# before — parsed green; `pg` then threw a redacted `Invalid URL` at connect
driver: postgres
config:
  url: postgresql://app@h1:5432,h2:5433/app

# after — point the URL at a single host (or a proxy/pooler in front of the
# cluster); `pg` does not implement libpq's multi-host DSN, so no spelling of
# it can connect
driver: postgres
config:
  url: postgresql://app@h1:5432/app
```

There is deliberately no automatic rewrite: a URL `pg` cannot parse does not
carry enough structure to say which single host the author meant (a multi-host
DSN names several on purpose), so the choice of target is the author's.
Runtime-environment DSNs (`OS_DATABASE_URL` and friends) never pass through
this publish door and are unaffected by construction.

<!-- adr-0087: registered datasource-config-postgres-url-unparseable-refused -->
