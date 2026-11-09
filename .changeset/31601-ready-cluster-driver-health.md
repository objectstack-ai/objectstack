---
'@objectstack/runtime': patch
'@objectstack/service-cluster': patch
---

feat(runtime): `/ready` reports the cluster driver's health on a declared multi-node deployment on the redis driver, answering `200` with `status: 'degraded'` while Redis is unreachable

Clause-②: yes (widening)
Metadata-protocol: none

**Who sees this:** operators of a multi-replica deployment, one that declares itself multi-node (`OS_EXPECT_MULTI_NODE=true` or `OS_CLUSTER_REPLICAS` greater than 1) and runs the redis cluster driver (`OS_CLUSTER_DRIVER=redis`). Their readiness probe now shows when the cluster has lost coordination. Before this change a replica whose Redis had stopped kept answering `GET /ready` with a plain `200 { status: 'ready' }`, so nothing told the operator that locks, counters and cross-replica events had stopped working.

On such a deployment the `200` body gains a `cluster` entry: `{ driver: 'redis', reachable: true }` while the store answers, and `{ driver: 'redis', reachable: false, reason }` with `status: 'degraded'` while it does not. `reason` is one of `timeout`, `ping-failed`, `unexpected-reply` or `no-probe`. The store's address never appears in the body, because `/ready` answers anonymous callers. The status stays `200` on purpose: every replica loses a shared Redis at the same moment, so a `503` would take every replica out of the load balancer and turn a degraded cluster into a total outage while the database can still serve. Alert on `status: 'degraded'` or `cluster.reachable: false`.

The probe is one bounded `PING` (500 ms), cached for one second like the data-driver check, so frequent polling costs no extra round-trips.

Nothing else changes. A single-node deployment, one that runs the in-process `memory` driver, and one with no cluster service answer exactly the body they answered before, and their Redis is never probed. The booting and shutting-down `503` (graceful drain on SIGTERM) and the primary-datasource `503` are reached before the probe and are byte-identical.

`@objectstack/service-cluster` adds `probeClusterDriverHealth(cluster, driver, { timeoutMs })`, the reading `/ready` uses. It returns `undefined` when the cluster offers no connection for that driver and never throws.
