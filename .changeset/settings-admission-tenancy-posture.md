---
'@objectstack/service-settings': patch
---

Fix: the settings REST doors now supply the effective tenancy posture to the shared authorization resolver, so both posture-conditional API-key refusals apply here — and the tenant this seam hands onward is a vetted one.

Under a wall-enforcing posture (`isolated`), an API key stamped with an organization its owner has left is refused, as is a key carrying no organization at all. Previously neither guard ran at this door, because both are conditional on a posture the caller supplies and this seam supplied none — the key's tenant was its own stored `active_organization_id`, never checked against current membership. This gate does not merely admit the principal: it returns that tenant onward as the resolved settings tenant, so an unvetted claim became the verdict the read/write path acted on. A browser session whose stored active organization is no longer backed by a membership now has that claim dropped here too, rather than passed through.

The posture is read from the kernel's `tenancy` service, so it is the posture in force rather than the one requested through `OS_TENANCY_POSTURE`. A deployment that registers no `tenancy` service is unchanged: there is no wall there, and no posture-conditional refusal applies. A `tenancy` service that is registered and fails to build is an outage rather than a quiet admission.
