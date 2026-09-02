---
"@objectstack/service-datasource": minor
"@objectstack/service-cluster": minor
---

feat(service-datasource,service-cluster): fan datasource record writes out to peer replicas — a deleted datasource no longer keeps draining `/api/v1/ready` on every replica that did not serve the DELETE (#13805)

Measured on a live 3-replica EE deployment: the ObjectQL DRIVER registry had
no cluster propagation in either direction. Each replica filled it at boot
from the shared datasource records and mutated it only for the writes IT
served, so after `DELETE /api/v1/datasources/:name` only the replica that
served the DELETE evicted the stuck driver (#13578's door) — the other N-1
kept it, and `/api/v1/ready` kept answering 503 there, until restart. A
datasource created through one replica likewise had no pool on any other
until restart.

Maintainer-ruled design (2026-09-01): the driver registry adopts the same
cluster-invalidation family `metadata.mutated` (#13331) established — no
second propagation mechanism, no bespoke poll loop, and no delete-only
broadcast (that would have made delete more cluster-aware than create, a new
asymmetry rather than a repair).

- **Symmetric publisher at the three write doors.** `DatasourceAdminService`
  now publishes the record's ADDRESS on a new cluster channel
  `datasource.mutated` (`DATASOURCE_MUTATION_CLUSTER_CHANNEL`, payload
  `ClusterDatasourceMutationPayload` — `{ originNode?, name }`) after
  `createDatasource`, `updateDatasource` and `removeDatasource`. Fire-and-
  forget: a publish failure never fails the write it announces.
  `migrateCredential` does not publish — it leaves the live pool alone by
  design, on every replica alike.
- **Peers converge from their own read of the SHARED record.** On receipt a
  replica re-reads the durable `sys_metadata` row for that name — the same
  store its boot rehydration reads, not its per-replica metadata registry —
  and converges its live pool through the seams it already owns: builds what
  is missing, rebuilds in place what changed (`reregisterPool`, keeping the
  old pool on failure exactly as the serving replica's update path does),
  evicts what is gone (`unregisterPool` → the #13578 eviction door), and
  leaves a matching pool untouched. The payload is a signal, never trusted
  content, so a duplicate or re-ordered delivery converges to the same pool
  state by construction — which is what makes a replayed create safe without
  any new idempotency machinery. A name the replica never pooled is left
  alone, so a stray signal cannot reach a code-defined pool.
- **New attach seam, mirrored from the shipped bridges.**
  `DatasourceAdminService.attachDatasourceMutationPubSub(pubsub, nodeId)` —
  idempotent on the `(pubsub, nodeId)` pair, loopback suppression via
  `originNode`, shaped after the protocol's `attachMetadataMutationPubSub()`.
  Only `IPubSub` from `@objectstack/spec/contracts` crosses it:
  `@objectstack/service-datasource` takes no dependency on the cluster
  service, and `@objectstack/objectql` — the registry's owner — is handed no
  bus. The host wires the receive half through a new optional
  `DatasourceAdminServiceConfig.convergePool` seam; `DatasourceAdminServicePlugin`
  supplies it.
- **`MetadataClusterBridgePlugin` gains a third, independent lane** that
  late-binds the seam at `kernel:ready` beside the metadata-service and
  protocol lanes, duck-typed on the `datasource-admin` service. It skips the
  in-process memory driver (nothing to fan out to), the guard the other lanes
  carry, so a single-replica boot behaves byte-identically to before.

No shipped driver exceeds at-most-once delivery, so a lost message still
degrades to the pre-existing bound (the next boot's full rehydration); this
channel narrows the window from "until every replica restarts" to one network
hop. The `/api/v1/meta/datasource` metadata registry's own cross-replica
coherence (#13609) is a different sink and is not touched here.
