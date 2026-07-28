---
"@objectstack/objectql": minor
"@objectstack/types": minor
"@objectstack/driver-mongodb": patch
---

feat(objectql)!: `init()` refuses to boot when a data driver fails to connect (#3741)

`ObjectQLEngine.init()` wrapped every driver's `connect()` in a try/catch, logged
one error line, and carried on. A server whose database was unreachable therefore
"started successfully" — health endpoints could even stay green — and then failed
every request with an error that reads nothing like *the database is down*. The
warning it printed (`Operations may recover via lazy reconnection or fail at query
time`) was half fiction: grep the repo and no reconnection exists in `driver-sql`
or `driver-mongodb`, so only the "fail at query time" half was ever real. The
caller made it worse — `ObjectQLPlugin.start()` runs `syncRegisteredSchemas()`
immediately after `init()`, issuing DDL against a driver that isn't there.

The structural half of the bug was worse than the operational one: the catch
removed a driver's ability to **refuse startup at all**. Any fatal startup check —
licence, server version, incompatible configuration, missing capability, not just
an unreachable socket — is expressed by throwing from `connect()`, and every one
of them was silently downgraded to a runtime error. That is why driver-mongodb's
multi-tenancy guard (#3724 / #3734) had to be hoisted into its constructor.

- `init()` now **throws** `DriverConnectError` (`code: 'ERR_DRIVER_CONNECT'`)
  when any boot-registered driver's `connect()` rejects, aborting kernel
  bootstrap. It still attempts every driver first, so one failed boot names all
  of them. The message is self-contained — each failed driver and its cause —
  because the CLI prints `error.message` alone; the first cause is also attached
  as `error.cause`. Exported from both `@objectstack/objectql` and
  `@objectstack/objectql/core`.
- `connect()` is now a supported place for a driver to veto boot. Startup
  validation that needs a live connection (server version, capability probes)
  no longer has to be forced into a constructor.
- The misleading "lazy reconnection" warning is gone.
- New escape hatch `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`
  (`resolveAllowDriverConnectFailure()` in `@objectstack/types`) restores the old
  lenient boot, but loudly: a `DEGRADED BOOT` banner names the failed drivers and
  states that they are never retried or reconnected and that every query and
  schema sync routed to them will fail for the process lifetime. The banner goes
  to stderr as well as the logger, because `os serve` swallows all of stdout
  during boot and `Logger` routes `warn` there — logger-only, the one message
  that matters would be invisible in exactly the deployment the flag is for.
  Defaults off.

**Migration.** No code or config change is needed for a correctly configured
deployment — a driver that connected before still connects. A deployment that was
*silently* booting without its database now fails the boot instead, with the
driver name and cause in the error; fix the datasource configuration (typically
`OS_DATABASE_URL`, credentials, or network reachability). To keep booting without
it — deliberately, and knowing every request that touches it will fail — set
`OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.
