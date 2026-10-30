---
'@objectstack/service-automation': patch
'@objectstack/service-cluster': patch
---

fix(service-automation): a connector credential written or cleared through the door reaches every replica, not only the one that took the request

Clause-②: no
Metadata-protocol: none

`PUT` and `DELETE /api/v1/automation/connectors/credential-refs/:ref` reconciled the declarative connector instances of the replica that served the request. On a multi-replica deployment every other replica kept what it had: an instance whose stored value its upstream had refused is held with no retry timer, so a corrected credential took effect there only after a metadata reload or a restart, and requests landing on those replicas kept failing against a degraded connector.

- **A fourth cluster lane.** After the row is written or cleared, the door publishes `{ originNode, ref }` on the `connector-credential.mutated` cluster channel. The payload is an address only: never a value, a fingerprint or a revision.
- **Peers converge from their own read.** A peer drops its own `originNode`, then runs its connector reconcile on its reconcile queue, which re-reads the shared `sys_connector_credential` rows. Exactly the instances naming a changed reference re-materialize, held ones included; a cleared reference degrades them, naming it.
- **Attached where the other lanes are.** `MetadataClusterBridgePlugin` (`@objectstack/service-cluster`) attaches the lane at `kernel:ready` beside `metadata.changed`, `metadata.mutated` and `datasource.mutated`, duck-typed against the automation service's `attachConnectorCredentialPubSub()`. As with lanes 2 and 3, it is skipped on the in-process `memory` cluster driver, so a single replica behaves as before.
- **What it does not promise.** Delivery is at-most-once, as for every lane of the family: a lost message is not retried, and the next metadata reload or restart still reconciles that replica.
