---
'@objectstack/service-cluster': patch
'@objectstack/service-cluster-redis': patch
'@objectstack/service-job': patch
'@objectstack/metadata': patch
'@objectstack/service-datasource': patch
'@objectstack/service-automation': patch
---

fix(cluster): a Redis outage no longer crashes replicas, is logged once, and caches re-read on reconnect

Clause-②: yes (widening)
Metadata-protocol: none

Every API addition below is a new export or an optional member (a widening). The one new default is the bounded command time on the redis driver. Multi-replica deployments on the `redis` cluster driver only. The single-node default (the in-process `memory` driver, no declared replicas) behaves exactly as before: it never loses a connection, so none of the paths below runs on it.

- **No crash on a dead lock (`@objectstack/service-job`).** `CronJobAdapter` leader-elects every scheduled fire on the cluster lock. When the lock store was unreachable, `acquire` rejected inside a timer callback, the rejection went unhandled, and every replica exited at its next tick. A failed `acquire` now skips that fire (no node can prove it alone runs it) and the next tick asks again; a failed `release` after the fire ran is absorbed (the lease expires on its TTL). The adapter logs ONE warning per lock outage — not one per tick — and one info line when the lock answers again. No process-wide `unhandledRejection` handler is added.
- **The driver watches its connections (`@objectstack/service-cluster-redis`).** Every ioredis client the driver holds (the command connection and the pub/sub subscriber) now has an `error` listener, so ioredis no longer prints `[ioredis] Unhandled error event` with a stack per reconnect attempt. The driver logs one warning when the store becomes unreachable (naming `host:port`, never the URL or a password) and one info line when it returns. New option: `driverOptions.logger` (`{ warn, info? }`, default `console`).
- **Bounded commands.** `createRedisClient()` now sets `commandTimeout: REDIS_COMMAND_TIMEOUT_MS` (2000 ms; exported). A black-holed Redis (a socket that accepts and never answers) used to hold a caller about 30 s — a sign-in counting through the shared cache included, since the cache derives its connection with `client.duplicate()`, which inherits the bound. Every command the driver and the shared cache issue is O(1); a caller that needs longer passes its own `options.commandTimeout`, or its own client through `driverOptions.client`.
- **`cluster.resync` (`@objectstack/service-cluster`).** Cross-node cache hints ride at-most-once pub/sub, so a hint published during an outage was lost and a peer kept serving what it had cached until restart. When the driver's connection returns after an outage it now emits ONE local `cluster.resync` event (never published to peers). New exports: `onClusterResync(cluster, handler)` to subscribe (a no-op on the memory driver), `readClusterDriverHealth(cluster)` (`{ driver, nodeId, state: 'unknown' | 'up' | 'down', since, outages, lastError? }`, `undefined` on the memory driver) for readiness probes, and `ClusterDriverLiveness` / `offerClusterDriverLiveness` for driver authors, plus `CLUSTER_RESYNC_EVENT`, `describeConnectionError` and `redactCredentials`.
- **The caches re-read on it.** `MetadataClusterBridgePlugin` calls each attached lane's resync seam: `MetadataManager.resyncClusterPubSub()` (`@objectstack/metadata`: drops every list cache and the endpoint index, so the next `list()` re-reads the loaders; registry entries are kept), `DatasourceAdminService.resyncDatasourceMutationPubSub()` (`@objectstack/service-datasource`: re-converges every stored datasource and every held pool from this replica's own read), and `AutomationEngine.resyncConnectorCredentialPubSub()` (`@objectstack/service-automation`: the connector reconcile a peer's signal runs; the connector-credential door gains an optional `resyncFromCluster()`). `AuthzClusterBridgePlugin` advances the engine's write epoch (reason `remote`), retiring cached grants. The `metadata.mutated` registry lane has no resync yet; it still converges per item on delivered signals and fully at boot.
