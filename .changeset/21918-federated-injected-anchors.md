---
'@objectstack/objectql': patch
---

Deleting a business unit or a user no longer fails on a deployment that has a federated (ADR-0015 `external`) object bound. The engine's referential cascade no longer treats any column the platform injects into a federated object as a reference.

Clause-②: no

- **What was wrong.** The registry injects its own columns into every object, federated ones included: the tenant anchor `organization_id`, the business-unit anchor `owning_business_unit_id`, the owner `owner_id`, and the audit lookups `created_by` and `updated_by`. The platform provisions no storage for a federated object, so none of them exists on the remote table. An earlier fix taught the cascade to skip `organization_id` alone. The cascade's dependents probe still filtered the remote table on the other anchors, the SQL driver refused the unknown column (`INVALID_FILTER`), and the failure propagated. On the showcase with its federated fixture provisioned, deleting a business unit answered 400 and removing a user answered 500.
- **What changed.** The cascade scan and its atomicity plan skip every column the registry injected into a federated object and the object does not provision. They read which columns those are from the registry's own injected-column provenance, not from a list of names, so a column the registry injects later is covered too. The lifecycle reap and archive passes no longer split a federated object's rows per tenant on its injected `organization_id`: such rows carry no organization, so a tenant-scoped retention override for that object has no rows to select, and the object is swept in one global pass.
- **What did not change.** A lookup the author declares on a federated object, including the author's own `organization_id` or `owner_id`, is still probed, and a probe that cannot run still fails the delete. Only a missing child table is passed over as having no dependents.
