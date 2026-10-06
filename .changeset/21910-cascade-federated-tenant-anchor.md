---
'@objectstack/objectql': patch
---

Deleting an organization no longer fails with a 500 on a deployment that has a federated (ADR-0015 `external`) object bound. The engine's referential cascade no longer treats the `organization_id` the platform injects into a federated object as a reference to `sys_organization`.

Clause-②: no

- **What was wrong.** The registry injects `organization_id` into every object, federated ones included, and the platform provisions no storage for a federated object. The cascade's dependents probe filtered the remote table on that column, the SQL driver refused the unknown column (`INVALID_FILTER`), and the probe's failure propagated, so the delete failed. The showcase, with its federated fixture provisioned, answered every organization delete with 500.
- **What changed.** The cascade scan skips a federated object's injected tenant anchor. It asks the same `isFederatedObject` predicate as the driver-option builder and the related-record read, plus the injected-column provenance marker, so an `organization_id` the author declared on a federated object is still probed. The cascade's atomicity plan asks the same question, so it keeps counting exactly the relations the scan probes.
- **What did not change.** Any lookup an author declares on a federated object is still probed, and a probe that cannot run still fails the delete. Only a missing child table is passed over as having no dependents.
