---
"@objectstack/objectql": minor
"@objectstack/runtime": minor
---

fix(runtime,objectql): `/api/v1/ready` drains only on the PRIMARY datasource's failure; a secondary/tenant datasource is reported, not drained (#13408)

On a multi-datasource deployment, one datasource whose driver could not start
pinned `/api/v1/ready` to 503 on **every replica** — so a readiness-checked load
balancer drained every upstream and took the whole deployment offline, while
Postgres and the app itself were healthy (`/api/v1/health` 200, direct reads
working). One tenant's misconfiguration = total outage. Observed on a live
3-replica EE deployment and recovered only by restarting every process.

Ruled 2026-08-31 (第 6 场总监席决裁批 #12, maintainer verbatim 「同意」), Option B:

> `/api/v1/ready` 只在**主/默认数据源**不健康时摘流量;次要/租户数据源的故障照常
> **上报**(`/ready` 响应 body、日志、告警)但不 drain 节点。

**What changed.** When a driver reports itself unhealthy, `/ready` now asks
which datasource is the deployment's primary one before choosing a status:

- primary unhealthy, or the criterion unresolvable ⇒ **503**, unchanged envelope;
- primary healthy, only a secondary down ⇒ **200**, with the failed drivers named
  in a new `degraded` block: `{ status, state, degraded: { drivers, primaryDatasource } }`.

The failed driver is never hidden — the rejected alternative of filtering it out
of the response stays rejected. `degraded` appears **only** on that branch; an
all-healthy 200 body is byte-identical to before.

**The criterion is a readable fact, not a heuristic.** `ObjectQL.resolvePrimaryDatasource()`
(new, exported with `PrimaryDatasourceVerdict` / `PrimaryDatasourceUnresolvedReason`)
answers *where this deployment's platform system objects actually live*, resolved
through the same five-step routing order every query uses — never registration
order, never the driver flagged default at registration. The ADR-0057 §3.6 system
ledgers (`audit` / `telemetry` / `event`) are excluded because they are
deliberately routed off the primary. Disagreement, silence, or a name with no
driver behind it return an **unresolved verdict**, never a guess.

**Fail toward draining.** Every way of not knowing — an engine that predates the
probe, a probe that throws, a malformed verdict, a genuinely split deployment —
falls back to the old whole-node 503. Staying in rotation requires a *positive*
reading; the absence of a negative one is not permission. Pinned in both
directions, including an inversion ablation.

**framework#3756 is not overturned.** Its quantified reason — "a replica that
would fail 100% of its requests" — still holds in the single-datasource
deployment it was measured on, where the primary *is* the only source; that
deployment's answer is unchanged down to the response body. What #3756's
reasoning never covered is the multi-datasource shape, and that is the only
branch this carves out.

**Grade: `minor` for both, proposed rather than assumed** — this changes when a
published operational probe drains a node, so an operator whose alerting keys on
`/ready` returning 503 for *any* driver failure will see 200 + `degraded`
instead, and `degraded` is a new response field. Nothing is removed or renamed,
no declared contract key is added (the ruling explicitly declines that: 「⛔ 本裁不
加契约键」), single-datasource behaviour is bit-identical, and no migration is
required — so `major` overstates it and `patch` understates a deliberate change
to an availability control surface.

⚠️ Out of scope, tracked separately as **#13578**: `DELETE` of a datasource still
does not evict the stuck driver from the in-memory engine registry, so the
datasource keeps appearing in `/ready`'s report until the process restarts. That
half is a defect under either answer to this card and is queued independently.
