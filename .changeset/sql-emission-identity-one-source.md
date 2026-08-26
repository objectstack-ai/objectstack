---
'@objectstack/driver-sql': minor
'@objectstack/spec': minor
---

feat(driver-sql,spec): one emission-identity source — `redshift`/`cockroachdb` DDL is refused by name, `pgnative` joins the Postgres family (#11991, landing the #11756 ruling)

**BREAKING** accept-set narrowing on `SqlDriver`'s DDL path, shipped as `minor`
under the repo's launch-window convention for breaking changes — and a widening
in the same edit, so read both directions.

Maintainer ruling, 2026-08-25 (#11756, verbatim 「同意」 on 「C，但 pgnative
归入 Postgres 家族」). Three knex clients speak the PostgreSQL wire protocol
without being the PostgreSQL this driver emits DDL for, and the driver had no
opinion about any of them — it simply let knex compile whatever it compiles.
Measured on `origin/main` before the change, one `CREATE TABLE` per client:

```
pg / pgnative / cockroachdb   "body" text          primary key inline
redshift                      "body" varchar(max)  primary key in a separate ALTER TABLE
```

So on Redshift the pre-ruling behaviour was not a failure — it was a table of a
different shape, built quietly, with the deployment finding out when it wrote
data into it.

**Refused (narrowing).** A `redshift` or `cockroachdb` datasource that reaches
schema DDL — `initObjects` / `syncSchema`, `dropTable`, `rotateShards`,
`reconcileManagedSchema` — now gets an immediate
`UnsupportedDialectEmissionError`: code `SQL_DIALECT_EMISSION_UNSUPPORTED`
(newly registered under `@objectstack/driver-sql` in `ERROR_CODE_LEDGER`),
HTTP status `501`, and a message naming the client, every client the driver
DOES emit for, and the supported way to keep the database — manage its schema
out-of-band and boot with `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`. It throws
before any statement is issued, so nothing is half-built. Connection, the
connect bound and the #11389 calendar-day parser are untouched: the boundary is
DDL only, drawn where behaviour was actually verified.

**Recognised (widening).** `pgnative` is now a member of the Postgres emission
family — knex resolves it to the same `postgresql` dialect and the same query
compiler as `pg`, differing only in which npm binding carries the bytes. It was
previously in neither the emission set nor the wire table, so a `date` column
got a bare `CURRENT_TIMESTAMP` default (the server's calendar day, the exact
#11550 defect) and no calendar-day parser. It now behaves identically to `pg`
and carries the #11389 pin.

**One source of truth.** The pair `cockroachdb, redshift` used to be
hand-written into the connect-timeout table and again into the wire table. It
is now declared once, as `POSTGRES_WIRE_ONLY_CLIENTS`, and both tables extend
the emission sets through it — as does the refusal, which reads the same set.
Adding a future pg-wire client is one edit, and the three answers cannot drift
apart. `mariadb` is explicitly out of the ruling's scope and keeps its third
state: neither recognised nor refused.

<!-- adr-0087: not-required (no-migration-prescription) A DDL-emission scope narrowing plus one added client spelling, both inside `driver-sql`. No spec schema, no authorable metadata key and no runtime interface is removed, renamed or re-shaped: the value that decides the outcome is a datasource's knex `client`, which lives in deployment configuration rather than in any stored `sys_metadata` document, so `objectstack migrate meta` has nothing to rewrite and there is no tombstone to project. The channel that reaches an affected deployment is the refusal itself — raised at the DDL gate, before any statement is issued, naming the supported clients and the `skipSchemaSync` posture — and choosing between "move this datasource to a supported database" and "manage its schema out-of-band" is a deployment decision no migration entry can make on an operator's behalf. `pgnative` is a widening and needs no upgrade action at all. -->
