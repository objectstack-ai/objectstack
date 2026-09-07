---
'@objectstack/service-storage': patch
---

The storage download door derives the tenancy posture before resolving the caller

`buildFileReadAuthorizer` resolved every gated download with `resolveAuthzContext({ ql: engine, headers, getSession })` and supplied no `tenancyPosture`. Both posture-conditional API-key refusals are gated on the caller supplying one — `organization_required` and `organization_membership_ended` — so neither ran at this door. Its headers come from the real request, so `x-api-key` is accepted, and an API key's tenant is `sys_api_key.active_organization_id` copied verbatim: the caller's own stored claim, never vetted against current membership. Under a wall-enforcing posture a key stamped with an organization its owner had left therefore authenticated for downloads and was judged by the ownership and record-reachability checks — checks evaluated for a principal the wall should have refused at the door.

The posture is now read off the kernel's `tenancy` service, per download, and classified rather than swallowed: a service that was never registered stays quiet (`undefined` — the supported no-tenancy composition, unchanged behaviour), while one that was registered and failed to build raises `AuthzStoreUnavailableError` instead of degrading to "no posture". Under `isolated` and `group` an ex-member's stamped key is now refused and no download capability is minted; an organization-less key is refused under `isolated` and stays admitted under `group`, whose union scope makes it legitimate. Under `single` nothing changes. Patch rather than minor: no accept set widens, and a declared guard returns to enforced.
