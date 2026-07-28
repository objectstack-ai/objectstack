---
"@objectstack/driver-sql": minor
"@objectstack/objectql": patch
"@objectstack/types": patch
---

fix(driver-sql): bound a connection attempt at 10s, and correct the "no reconnection" claim (#3769, #3759)

Two related corrections, both from measuring what #3741/#3751/#3765 had only asserted.

**The claim was wrong.** #3751 and #3765 shipped several statements that drivers
never reconnect — "there is no lazy reconnection", "NOT retried and NOT
reconnected", "stays disconnected for the process lifetime". Measured, both
drivers recover on their own:

- driver-mongodb: killing a real `mongod` and restarting it on the same port,
  the *same* driver instance served the next write successfully (13ms), with no
  reconnect call from us — the official driver's topology monitor handles it.
- driver-sql: a knex/pg pool is not poisoned by an outage. Its error tracks live
  server state (`ECONNREFUSED` while down → a handshake error once a listener is
  back → `ECONNREFUSED` again), i.e. every acquire opens a fresh connection.
  `storage-driver.ts` also configures `pool.min: 0`, so no stale idle
  connections are held.

The original reasoning grepped this repo for `reconnect`, found nothing, and
concluded recovery does not happen — but the recovery lives in the client
libraries, not in our code. The claims are now corrected in `DriverConnectError`,
the `DEGRADED BOOT` banner, `resolveAllowDriverConnectFailure`'s docs, and the
drivers / self-hosting pages.

**Fail-fast at boot is unchanged and still correct** — the reason is just
different. It is not that the connection can never return; it is that the *boot
sequence* never re-runs. A driver that missed `init()` also missed
`syncRegisteredSchemas()`, so its tables can simply not exist even after the
database comes back. The banner now says that.

**The real defect underneath.** `SqlDriver` passed its config to knex untouched,
so a database endpoint that accepts TCP but never completes the handshake — an
overloaded instance, a half-open firewall, a load balancer mid-failover — made
every query wait out tarn's 30s default, then fail with `Timeout acquiring a
connection. The pool is probably full`, pointing an operator at pool sizing
instead of the network. With a small `pool.max` a few such queries saturate the
pool and everything else queues.

`SqlDriver` now defaults `pool.createTimeoutMillis` to **10s**, matching
driver-mongodb's existing `connectTimeoutMS ?? 10_000` so both drivers give up on
an unreachable server at the same point. A host that sets its own
`createTimeoutMillis` is left alone.

**Migration.** None for a healthy datasource. A deployment that deliberately
relies on connection establishment taking longer than 10s (a slow cross-region
replica) should set `pool.createTimeoutMillis` explicitly on its `SqlDriver`
config.

Not fixed here, tracked in #3769: knex still reports the bounded wait as "the
pool is probably full". An accurate message needs a dialect-specific connect
timeout (pg's `connectionTimeoutMillis`), which changes the shape of `connection`
and would regress the startup banner's URL display.
