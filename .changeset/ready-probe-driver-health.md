---
"@objectstack/objectql": minor
"@objectstack/runtime": minor
---

feat(runtime): `/ready` reports 503 when a data driver stops answering (#3756)

`/health` returned `{status: 'ok'}` unconditionally and `/ready` only checked
whether the kernel state was `running` — a flag set once when bootstrap finishes
and never revisited. Neither probe touched the data layer. So a database that
went away *after* boot (restart, failover, network policy change, pool exhausted,
credentials rotated) left both probes green: the load balancer kept routing to a
replica that failed 100% of its requests, and the orchestrator saw nothing wrong.
The driver's `checkHealth()` already existed and was cheap (`SELECT 1` /
`db.command({ping:1})`) but was only consumed by `datasource-admin`'s
`testConnection` — no probe path called it, and `ObjectQL` exposed no way to ask
(`drivers` is private with no accessor).

This is the runtime-side half of #3741, which fixed only the boot-time version
of the same defect.

- New `ObjectQL.checkDriversHealth({ timeoutMs })` pings every registered driver
  and returns a `DriverHealth[]` verdict. Each probe is settled independently and
  bounded (default 2s) — `checkHealth()` swallows its own errors, but on a dead
  knex pool it does not return at all, waiting out `acquireConnectionTimeout`
  (60s by default), and a probe that hangs is as useless as one that lies. A
  driver implementing no `checkHealth()` is reported healthy: absence of a probe
  is not evidence of failure.
- `GET /ready` now returns 503 with the failing driver names when the kernel is
  running but a driver is down, on top of the existing booting/shutting-down
  cases. The result is memoized for ~1s so Kubernetes' few-second polling does
  not become one database round-trip per probe per replica.
- `GET /health` deliberately still checks nothing, and now says why in the code.
  A failing *liveness* probe restarts the pod, which cannot fix an unreachable
  database but would put every replica into a restart storm for the length of the
  outage. Readiness — leave the rotation — is the failure mode that helps.

The readiness check **fails open**: a kernel with no data engine (lite kernels,
edge, metadata-only hosts), an engine predating `checkDriversHealth`, or a probe
that itself throws all read as ready, exactly as before. Readiness gates whether
a replica receives any traffic at all, so an inconclusive answer must not
black-hole a working deployment. Only a driver that positively reports itself
unhealthy takes the replica out.

**Migration.** None. Deployments already wiring `/api/v1/ready` as their
readiness probe get the stricter check automatically; deployments that pointed a
*liveness* probe at `/ready` should move it to `/health`, which is the endpoint
that never fails on a dependency.
