---
"@objectstack/metadata-protocol": minor
"@objectstack/service-cluster": minor
---

feat(metadata-protocol,service-cluster): fan runtime metadata mutations out to peer replicas — a runtime-authored object no longer answers OBJECT_NOT_FOUND on every replica that did not perform the write (#13331)

Measured on a live 3-replica EE deployment (ADR-0018 compose, redis driver):
an object authored through `PUT /api/v1/meta/object/...` persisted to the
shared `sys_metadata` (so `/api/v1/meta/*` answered 200 fleet-wide) but
registered with the ObjectQL engine registry of the writing replica only —
`/api/v1/data/<object>` answered a hard 404 `OBJECT_NOT_FOUND` on the other
replicas, indefinitely (200 concurrent creates through the LB: 67×201 /
133×404; a boot-loaded control object: 0 errors; the only recovery was a full
fleet restart). The runtime authoring path lives entirely in the metadata
protocol and never touches the metadata service, so the existing
`metadata.changed` bridge — even when attached — never heard these writes.

Maintainer-ruled design (2026-09-01, Option A):

- **Publisher at the producer choke point.** The protocol's post-persistence
  mutation funnel (`saveMetaItem` / `publishMetaItem` / `deleteMetaItem` —
  the same seam `onMetadataMutation` subscribes) now also publishes the
  mutation's ADDRESS on a new cluster channel `metadata.mutated`
  (`METADATA_MUTATION_CLUSTER_CHANNEL`, payload
  `ClusterMetadataMutationPayload`). Drafts are not published — they never
  enter any replica's registry.
- **Peers converge from their own DB read.** On receipt, a replica re-reads
  the row from its OWN `sys_metadata` and re-runs the registry write-through
  (active row present) or the delete heal walk (no active row). The payload
  is a signal, never trusted content — the shared database stays the single
  source of truth, and duplicate or out-of-order delivery converges to the
  row's current state by construction. After convergence the event replays
  into the replica's local `onMetadataMutation` listeners (never
  re-published), so boot-cached consumers such as the authored hook/action
  re-bind re-sync on peers exactly as they do on the writer.
- **New attach seam, mirrored from the shipped bridges.**
  `ObjectStackProtocolImplementation.attachMetadataMutationPubSub(pubsub,
  nodeId)` — idempotent on the `(pubsub, nodeId)` pair, with loopback
  suppression via `originNode`, shaped after
  `MetadataManager.attachClusterPubSub()` and the engine's
  `attachAuthzInvalidationPubSub()`. `MetadataClusterBridgePlugin` late-binds
  it at `kernel:ready` as a second, independent lane beside the existing
  metadata-service lane — the boot shape that lacks a manager-backed
  `metadata` service (the TS-config host-config boot, exactly the shipped EE
  shape) is the one that needs this lane most. The new lane skips the
  in-process memory driver (nothing to fan out to), the guard the authz
  sibling already carries.

No shipped driver exceeds at-most-once delivery, so a lost message still
degrades to the pre-existing staleness bound (heal at next boot); this
channel narrows the window from "until restart" to one network hop.
