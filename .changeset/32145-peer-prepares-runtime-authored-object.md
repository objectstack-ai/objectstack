---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a replica that learns of an object authored on another replica prepares its storage the way the writer did

Clause-②: no
Metadata-protocol: none

On a multi-replica deployment, an object authored at runtime (`PUT /api/v1/meta/object/NAME`) on one replica was registered on its peers through the `metadata.mutated` cluster lane, but the peers never ran the object's schema sync, which the writer's save runs right after registering it. The table already existed in the shared database, so nothing looked missing, yet the peer's SQL driver builds its per-object state only in that sync: a row created on a peer got no autonumber value, and a tenant member's create on a peer was refused `400 VALIDATION_FAILED` ("Organization is required") because the driver did not know which organization column to stamp. A restart healed it, since the boot syncs every registered object.

A peer now runs the same storage sync entry point after it re-registers the object (or an `object_extension`'s target) from its own read of the shared metadata, so numbering and the organization stamp hold on every replica without a restart. A single-node deployment is unchanged: the cluster lane does not attach on the in-process cluster driver.
