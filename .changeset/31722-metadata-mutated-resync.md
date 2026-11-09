---
'@objectstack/metadata-protocol': patch
'@objectstack/service-cluster': patch
---

fix(cluster): an object authored while the cluster store was unreachable is served by every replica once its driver reconnects, without a restart

Clause-②: yes (widening)
Metadata-protocol: none

The `metadata.mutated` lane (the one that makes a peer register an object authored on another replica) now has a resync seam, `ObjectStackProtocolImplementation.resyncMetadataMutationPubSub()`, and `MetadataClusterBridgePlugin` calls it on the cluster driver's local `cluster.resync` event, as it already did for the other lanes. Before, a hint lost during a store outage left every other replica answering `OBJECT_NOT_FOUND` for the object (or serving its old body, or still serving it after a delete) until restart.

On the event the replica reads `sys_metadata`'s active rows once (address and checksum only) and re-converges each item a lost hint could have touched — a row whose checksum moved, an item with no active row left, and an item a hint or local write named since the last convergence — through the same applier a delivered hint runs, from its own re-read. Nothing travels on the wire. A failed read is never a delete: the registry is left as it is and the next resync re-reads. The in-process `memory` driver never emits the event, so a single node is unchanged.

New public surface: the method above and its result type `MetadataMutationResyncReport`, exported from `@objectstack/metadata-protocol`. Nothing is removed or made required.
