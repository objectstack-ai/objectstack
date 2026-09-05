---
"@objectstack/mcp": patch
---

The MCP stdio transport now vets an API key's organization against the deployment's tenancy posture, instead of trusting the key's own stored claim.

`resolveStdioExecutionContext` — the whole of this transport's authorization, since every caller on it is an API key by construction and there is no session path — built its own header map and called `resolveAuthzContext` with no `tenancyPosture`. Both posture-conditional API-key refusals are gated on the caller supplying one (`organization_required` at admission, `organization_membership_ended` after grants), so a door that supplied none ran neither: the key's `sys_api_key.active_organization_id`, never re-checked against current membership, became the request's tenant. Under a wall-enforcing posture a key stamped with an organization its owner had left read and wrote that organization's rows through this door.

The posture is now derived in the plugin's `start()`, where the kernel is reachable, and threaded into the resolver. What changes for a deployment:

- Under `isolated` or `group`, a stdio transport configured with a key whose owner is no longer a member of the organization the key names refuses to start, and a key already live is refused on its next call. Under `isolated`, an organization-less key is refused the same way. Both refusals are logged server-side naming the key, principal, organization and reason; nothing about them reaches the caller.
- A kernel that registers no `tenancy` service is unaffected: no organization wall exists there, so no posture-conditional refusal is made. That is the supported composition, not a degraded one.
- A `tenancy` service that is registered and **fails to build** now raises `SERVICE_UNAVAILABLE` (503) rather than reading as "no posture". A posture that could not be read is not a posture that is absent, and admitting on one is the permissive-on-failure shape this repair exists to avoid.

The posture is re-read per call, on the same schedule as the identity beside it (ADR-0101 D1), so a wall that comes up or a membership that ends mid-session takes effect on the next call rather than at the next restart.
