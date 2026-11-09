---
'@objectstack/service-cluster': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

Cluster membership for multi-replica deployments. Under a declared multi-replica deployment on the Redis cluster driver (`OS_CLUSTER_REPLICAS>1` or `OS_EXPECT_MULTI_NODE=true`, with `OS_CLUSTER_DRIVER=redis`), each replica now keeps a heartbeat key `cluster:member:NODE_ID` with a TTL in the cluster KV and lists itself in the `cluster:members` roster. The new `readClusterMembers(cluster)` lists the replicas whose key is alive: a killed replica drops out within the TTL, and one that shuts down cleanly drops out at once. While the store is unreachable it answers `state: 'degraded'` with the last good reading and that reading's `asOf`, and never throws. A single node, or any deployment without the declaration, writes nothing and reads `state: 'single-node'` with itself alone. Timing is the new optional `ClusterServicePlugin` option `membership: { heartbeatMs, ttlMs }` (defaults 5000 ms and 15000 ms).
