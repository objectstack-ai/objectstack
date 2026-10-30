---
'@objectstack/service-automation': patch
---

fix(service-automation): a connector definition saved, published or deleted on one replica now converges every replica

Clause-②: no
Metadata-protocol: none

A connector instance definition changed through the per-item publish door re-materialized only on the replica that published it: that replica's `metadata:reloaded` hook ran the connector reconcile, but the hook is kernel-local, and the cluster's metadata-mutation lane (lane 2, `metadata.mutated`) delivered the change to the other replicas' mutation listeners, where the automation plugin acted on `flow` mutations only. Peers kept serving the old definition until a reload or a restart. A direct active save (`PUT /api/v1/meta/connector/:name`) raised no reload at all, so it did not re-materialize even the replica that wrote it.

The automation plugin's metadata-mutation listener now queues the same soft reconcile `metadata:reloaded` runs for a `connector` mutation that is not a draft. No new cluster channel is added: a peer converges on the lane 2 replay it already receives, re-reading the shared store.

- A publish on the writing replica reconciles from both of its signals; the second run finds the instance unchanged, so the provider is still called once per changed definition.
- A direct active save re-materializes the writing replica and converges its peers. A deleted connector is torn down on every replica.
- A draft save, and a mutation of any other type, runs no connector reconcile. Flow mutations are handled as before.
