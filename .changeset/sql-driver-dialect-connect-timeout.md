---
"@objectstack/driver-sql": minor
---

fix(driver-sql): give the bounded connection attempt an accurate error message (#3769)

#3781 bounded a connection attempt at 10s via `pool.createTimeoutMillis`, which
stopped the 30s hang but kept knex's own wording: `Timeout acquiring a
connection. The pool is probably full`. The pool is not full — the server never
completed the handshake — so that message sends an operator to tune `pool.max`
while the network is what is broken. This is the same defect class the boot
guard in #3741 was about: an error that reads nothing like its cause.

`SqlDriver` now also sets the **dialect's own** connect timeout, which fails with
a message that names what happened:

| client | key | message |
|---|---|---|
| `pg` / `postgres` / `postgresql` / `cockroachdb` | `connectionTimeoutMillis` | `timeout expired` |
| `mysql` / `mysql2` | `connectTimeout` | `connect ETIMEDOUT` |

Carrying the timeout requires `connection` to be an object, so a URL string is
moved into the dialect's URL slot (`connectionString` for pg, `uri` for mysql2).
Verified against a black-holing listener that both forms still reach the URL's
own host/port and still honour `?sslmode=require`. SQLite is untouched — opening
a file has no handshake to time out.

**The two bounds are deliberately unequal.** They race and knex wins a tie, so
equal values would let the pool timeout fire first and the accurate message would
never be seen. The dialect timeout is the effective bound at **10s**; the pool
timeout is a strictly looser backstop, raised from 10s to **15s**, reached only
by a dialect with no connect-timeout knob or one that ignores the one we set.

`driver.config` keeps the shape the author passed — the rewrite applies only to
what knex receives. Two existing readers depend on that: `serve.ts`'s startup
banner and `createDatabase()`, which parses the URL to swap in the maintenance
database. A test pins it.

`createDatabase()`'s own admin connection now gets the same bound; it is opened
during boot against the very server we already suspect is unreachable, so it must
not be the one place that still waits 30s.

**Migration.** None for a healthy datasource. A deployment that deliberately
needs longer than 10s to establish a connection (a slow cross-region replica)
sets `connection.connectionTimeoutMillis` (pg) or `connection.connectTimeout`
(mysql2) explicitly, and it is left alone.
