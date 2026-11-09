---
'@objectstack/service-settings': patch
'@objectstack/service-cluster': patch
---

feat(cluster): a settings change on one replica reaches every replica

Clause-②: yes (widening)
Metadata-protocol: none

Multi-replica deployments on the `redis` cluster driver only. The single-node default (no declared replicas, or any driver but `redis`) emits exactly what it emitted before.

`settings:changed` is an in-process subscriber set, and its subscribers rebuild the auth posture, password / session / MFA policy, organization access policy, mail, SMS, storage and the AI provider. Under round-robin only the replica that took the write rebuilt; every peer kept the old configuration, security posture included, until it restarted.

- **A fifth cluster lane (`@objectstack/service-cluster`).** `MetadataClusterBridgePlugin` attaches the settings service to the cluster bus on the `settings.changed` channel, only where the deployment declares several replicas (`OS_CLUSTER_REPLICAS` greater than 1, or `OS_EXPECT_MULTI_NODE=true`) over the `redis` driver (`declaresMultiReplicaOnRedis`). The split-brain guard is unchanged.
- **The message is an address, never a value (`@objectstack/service-settings`).** A write publishes the namespace, key, scope, action and time of the change. A peer emits its own local `settings:changed`, so each subscriber re-reads the shared store. A received change is never published again, and the writer's own message is dropped by its node id. New exports: `SETTINGS_CHANGE_CLUSTER_CHANNEL` and the `ClusterSettingsChangePayload` type; new methods `SettingsService.attachSettingsChangePubSub()`, `detachSettingsChangePubSub()` and `resyncSettingsChangePubSub()`.
- **Joins `cluster.resync`.** When the cluster driver's connection returns after an outage, every registered namespace is announced locally once (`key: '*'`), so a change whose message was lost during the outage still takes effect without a restart.
