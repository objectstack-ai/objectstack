---
"@objectstack/service-datasource": minor
---

Updating a datasource now rebuilds its live pool when the change actually bears on connectivity — and `active: false` actually takes it out of service

`updateDatasource` persisted the merged record and called `registerPool`, whose
connect-path idempotency guard answered `already-registered` while the OLD
driver held the name and returned before building anything. Nothing on the
update path called `disconnect` first. So reconfiguring a datasource — new
host, new credentials, new pool settings, `active: false` — changed the stored
record and left the running connection untouched until process restart, while
`toSummary` kept reporting the ORIGINAL connect's retained `connected`: a
successful save describing a pool the record no longer declared. The
`active: false` corner is security-adjacent — an explicitly disabled data
plane kept serving.

What "Save" now means for the live pool, decided by what actually changed:

- **A connectivity-bearing field changed** (`driver`, `config`, `external`
  including `credentialsRef`, `pool`, `schemaMode`, `active` — the set verified
  against what `attemptConnect` reads into driver construction; a supplied
  secret counts too, since a rewrap-in-place changes the credential without
  changing the ref) → the pool is rebuilt in place via the new
  `DatasourceConnectionService.reconnect`: the old registration is evicted
  (the #13578 door), a new driver is built FROM THE NEW RECORD through the one
  shared connect path, and the replaced pool's connection is closed.
- **The rebuild fails** → the OLD driver instance is restored (with the
  datasource def eviction removed alongside it), so the datasource is never
  left pool-less: the previous configuration keeps serving while the retained
  verdict is loudly degraded and says exactly that. Runtime-admin writes still
  never brick a running server over a UI action.
- **`active: false`** → the pool is torn down and the registry stops answering
  the name — matching every other lifecycle door (`connectDeclared` and boot
  rehydration never build a pool for a disabled record). `createDatasource`
  gets the same guard: a datasource born disabled no longer comes up serving.
- **Nothing connectivity-bearing changed** (a label edit) → the idempotent
  no-op path, exactly as before: same driver instance, no eviction, no
  connection churn.

Hosts wiring `DatasourceAdminServiceConfig` directly get the rebuild by
supplying the new optional `reregisterPool` seam; without it the behaviour is
unchanged (the idempotent register). The comparison itself is exported as
`datasourceConnectivityChanged` so a custom seam can ask the same question the
shipped update path asks.
