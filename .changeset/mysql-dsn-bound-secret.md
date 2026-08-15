---
"@objectstack/service-datasource": patch
---

fix(service-datasource): a bound `external.credentialsRef` reaches the mysql client on the DSN branch instead of being dropped (#8696)

<!-- adr-0087: not-required (no-migration-prescription) One connection-builder
branch stops discarding an already-resolved secret. Nothing authorable is
renamed, retired or tombstoned — `MysqlConfigSchema` is untouched, and this
change makes the runtime honour what that schema's `url` field has declared
since #8082 — so there is no conversion to register. -->

`DatasourceConnectionService` resolves a datasource's `external.credentialsRef`
to a cleartext secret and hands it to the driver factory as `spec.secret`. The
mysql arm then **threw it away** whenever `config.url` was present: the DSN
string became the whole knex `connection`, and the resolved credential reached
nothing. Measured on `origin/main`, driver `mysql`, `config.url`
`mysql://app@db.internal:3306/app`, secret bound:

```text
knex connection: typeof=string  value="mysql://app@db.internal:3306/app"
```

**This is a broken binding, not a disclosure.** Since #8082 refuses a
`user:password@` userinfo at the publish door, a bare-username DSN plus a bound
secret is the *only* authorable URL shape for this driver — the exact shape the
connection form produces and the exact shape #8155's re-homing remedy tells
operators to write. Such a datasource therefore connected **unauthenticated**,
or failed with a driver-level auth error naming nothing about the binding, while
its Setup page showed a credential bound and the connect path reported success.
It is the declared-≠-enforced shape one layer below Prime Directive #10:
`MysqlConfigSchema.url` already states the contract this code failed to keep —
*"bind the secret … and it is injected at connect time. A bare username
(`user@host`) stays writable."*

**The fix hands mysql2 the DSN and the secret together** — `{ uri, password }`
rather than a hand-parsed URL. mysql2 keeps owning its own DSN grammar (no URL
parsing, no re-encoding, no second dialect of `mysql://…` in this repo), and its
merge gives the **explicit** key precedence, so the bound credential also wins
over a legacy password embedded in a stored pre-#8082 row — the precedence the
postgres arm's DSN branch already declares. Measured on mysql2 3.23.1, knex
3.3.0 and pg 8.22.0.

A DSN with **nothing bound passes through unchanged**, as the bare string it has
always been, so the entire blast radius is datasources that bind a secret — the
ones that are broken today.

Two measured findings this change deliberately does **not** act on, each filed
on its own:

- **The mongodb arm is still open.** `buildMongoUrl`'s `if (explicit) return
  explicit;` drops the bound secret the same way, so a mongo DSN datasource
  still reaches `MongoClient` with an **empty** password. The remedy is not a URL
  rewrite — `MongoClient`'s `auth` option injects beside an unmodified url, and
  it wins over an embedded userinfo password (measured on mongodb 7.5.0) — but it
  requires a username as well, and reading the url's userinfo username needs the
  platform's own DSN grammar (`new URL()` rejects the multi-host form
  `MongoConfigSchema` documents). `@objectstack/spec/data` exports the password
  half of that grammar and no username half; adding one belongs beside it rather
  than as a second copy of the userinfo boundaries here.
- **The postgres arm passes this assertion at the config layer and is broken one
  layer below it.** `pg` merges `parse(connectionString)` **over** the explicit
  `password`, so `{connectionString, password}` resolves to the DSN's own
  (absent) password — effective `password: null`, measured on pg 8.22.0. Its
  `if (url)` branch is not fixed by symmetry with this one; the two clients merge
  in opposite directions, which is why each arm's precedence is measured rather
  than assumed.
