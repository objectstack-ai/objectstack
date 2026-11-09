---
'@objectstack/service-cache': patch
'@objectstack/service-cluster': patch
'@objectstack/service-cluster-redis': patch
---

fix(service-cache): the shared cache's Redis connection reports its outage once instead of printing an unhandled error per reconnect

Clause-②: yes (widening)
Metadata-protocol: none

During a Redis outage, the connection the shared cache derives from the redis cluster driver's (`duplicate()`) had no `error` listener. Every reconnect attempt on every replica printed `[ioredis] Unhandled error event` with a stack, which buried the single outage warning operators need.

- `@objectstack/service-cluster`: new `watchClusterDriverConnection(cluster, client, source)` reports a connection derived from the driver's into the driver's liveness. It returns a disposer and attaches nothing when the driver offers no liveness. `ClusterDriverLiveness` gains `watchConnection(client, source)`, the one listener style both use.
- `@objectstack/service-cluster-redis`: `watchRedisConnection` delegates to `ClusterDriverLiveness.watchConnection`. Its signature and behaviour are unchanged.
- `@objectstack/service-cache`: the plugin watches the connection it derives, as source `'cache'`. One outage now logs one warning across all of the driver's connections, and `cluster.resync` waits until the cache's connection is back too. If the driver offers no liveness (a redis driver released before the liveness offer), the connection gets a liveness of its own, so its outage is still logged once, without credentials, through the plugin's logger. The plugin detaches before its deliberate `quit()` on shutdown, so a shutdown is not reported as an outage. An injected `redis.client` belongs to its owner and gets no listener, and the memory cache is unchanged.
