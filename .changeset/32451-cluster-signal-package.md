---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
---

fix(metadata-protocol): the cluster metadata-mutation signal names the row's package, so replicas converge to the same per-package item

Clause-②: yes (widening)
Metadata-protocol: none

`MetadataMutationEvent`, the event behind `onMetadataMutation` and the `metadata.mutated` cluster signal (`ClusterMetadataMutationPayload`), gains an optional `packageId`: the package the mutated row is bound to, or `null` for a row bound to no package. Under ADR-0150 D4 the package is part of a row's address, as the bundle `member` already is. Every write that emits the event stamps the binding it resolved. A producer that does not know the binding omits the key; `null` never means unknown.

A peer replica converging on the signal, for a type the metadata service stores per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`, now exported from `@objectstack/metadata`), reads the row at that package and registers it with that binding. With no row there, it runs the writer's own registry heal for that package. Every other type still converges by name. The cluster resync after an outage reads each row's `package_id` and re-converges two packages' rows of one name as two items.

FROM → TO, the peer's read: a peer converging a save or a removal of such an item on a name two or more packages hold FROM "re-registers the first row the store returns, whichever package wrote" TO "re-reads the row at the signal's package". Before, after one replica saved package B's item, the other replicas could keep serving package A's item under that name until a restart.

FROM → TO, transitional, for a signal with no `packageId` (sent by a replica running an earlier release during a rolling upgrade): on a name whose active rows are bound to two or more packages, FROM "re-registers the first row the store returns" TO "a logged stop: one `error` line names the holders, the replica keeps the entry it holds, and the next cluster resync, a re-save from an upgraded replica or a restart converges it". A name whose rows are bound to one package converges as before, and with no row left the heal runs as before.

An older replica ignores the new key, so a rolling upgrade needs no order.
