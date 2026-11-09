---
'@objectstack/cloud-connection': patch
'@objectstack/service-cluster': patch
'@objectstack/spec': patch
---

feat(cloud-connection)!: marketplace install-local refuses to install or uninstall a package when the deployment declares several replicas on the Redis cluster driver, instead of changing the one replica that served the request

Clause-②: yes (narrowing) — narrowed: `POST /api/v1/marketplace/install-local` and `DELETE /api/v1/marketplace/install-local/:manifestId` now answer `409 MULTI_REPLICA_PACKAGE_CHANGE_REFUSED`, right after the caller is admitted and before the body or the ledger is read, when the deployment declares several replicas (`OS_CLUSTER_REPLICAS` greater than 1, or `OS_EXPECT_MULTI_NODE=true`) and the composed cluster service runs the `redis` driver. Nothing is written, registered or withdrawn. On a single node, on the in-process driver or with no cluster service composed, both doors answer exactly as before. Widened: two published faces gain members, `ERROR_CODE_LEDGER` (`@objectstack/spec`) registers `MULTI_REPLICA_PACKAGE_CHANGE_REFUSED` under `@objectstack/cloud-connection`, and the `@objectstack/service-cluster` root exports `declaresMultiReplicaOnRedis`, `composedClusterDriver`, `MULTI_REPLICA_CLUSTER_DRIVER` and `MULTI_REPLICA_PACKAGE_CHANGE_REFUSED`; nothing is removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export is removed: a request that changed one replica's install ledger and kernel is now refused, with a new registered error code, only on a deployment that declares replicas on the Redis driver. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a multi-replica deployment on the Redis cluster driver that installs or uninstalls packages through install-local (the Console's marketplace, `os package install`, or the HTTP door).

- **Before.** The install wrote the ledger under the serving process's own `OS_HOME` and hot-loaded the package into that process's kernel alone; the uninstall withdrew it from that one replica. The other replicas never saw the change, and each replica rehydrates its own ledger at boot, so the divergence was permanent.
- **Now.** Both doors refuse with `MULTI_REPLICA_PACKAGE_CHANGE_REFUSED` (409) and name the maintenance-window recipe: run the install script, then restart every replica. A `POST` with `dryRun: true` is refused too: the refusal comes before the body is read, and the preview reads the serving replica's own ledger.
- **Unchanged.** A single node, or replicas declared on any driver other than `redis`, install and uninstall as before. The split-brain guard is untouched: replicas declared on the in-process driver still refuse the boot unless `OS_ALLOW_MEMORY_CLUSTER_MULTINODE=true`.
- **Who sees it.** An operator or administrator of a multi-replica deployment on the Redis cluster driver who installs or uninstalls a package at runtime.

`@objectstack/service-cluster` exports the condition, `declaresMultiReplicaOnRedis(env, clusterDriver)`, with `MULTI_REPLICA_CLUSTER_DRIVER` (`'redis'`), `composedClusterDriver(services)` and the code constant `MULTI_REPLICA_PACKAGE_CHANGE_REFUSED`, so every multi-replica refusal keys on one predicate; the cloud binding credential's `sharesCloudBindingCredential` now delegates to it, with the same answers. `@objectstack/spec` registers the code under `@objectstack/cloud-connection` in the error-code ledger.
