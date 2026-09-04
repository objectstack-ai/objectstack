---
'@objectstack/cloud-connection': patch
---

Fix: the marketplace install-local routes now supply the effective tenancy posture to the shared authorization resolver, so both posture-conditional API-key refusals apply at these doors.

Under a wall-enforcing posture (`isolated`), an API key stamped with an organization its owner has left is refused, as is a key carrying no organization at all. Previously neither guard ran here, because both are conditional on a posture the caller supplies and this seam supplied none — the key's tenant was its own stored `active_organization_id`, never checked against current membership.

The posture is read from the kernel's `tenancy` service, so it is the posture in force rather than the one requested through `OS_TENANCY_POSTURE`. A deployment that registers no `tenancy` service is unchanged: there is no wall there, and no posture-conditional refusal applies. A `tenancy` service that is registered and fails to build is an outage and answers 503 rather than admitting the caller.
