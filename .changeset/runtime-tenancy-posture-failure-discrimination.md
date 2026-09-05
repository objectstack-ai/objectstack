---
"@objectstack/runtime": patch
---

The runtime dispatcher door no longer admits a request on a tenancy posture it could not read.

`resolveExecutionContext` reads the effective tenancy posture from the kernel's `tenancy` service, and both posture-conditional API-key refusals (`organization_required`, `organization_membership_ended`) run only when that posture is present. The read used to swallow every failure into "no posture", so a `tenancy` service that was **registered and failed to build** answered exactly like a deployment with no tenancy at all: the wall was skipped, and an API key stamped with an organization its owner had left — or carrying no organization — was admitted with full grants.

The seam now carries the same discrimination the REST door already applies (#13906 decision 1, option A), by the registry's own brand rather than by message text:

- **never registered** — the supported no-tenancy composition. Absorbed as before: no posture, no posture-conditional refusal, nothing changes for single-organization embedders.
- **registered and failed to build** — re-raised as `AuthzStoreUnavailableError`, so the door answers `503 SERVICE_UNAVAILABLE` ("the authorization store could not be read"), which is an existing member of the closed error vocabulary. A posture that could not be read is not a posture that is absent.

Two nets between the resolver and the transport envelope are told the same thing, in the one shape `@objectstack/core` already prescribes for such seams (`rethrowAuthzStoreUnavailable`): the dispatcher's service facade hands the resolver the classified rejection for `tenancy` instead of collapsing it to `undefined`, and the identity step's catch re-raises only the branded outage while every other fault still degrades to an anonymous request. A consequence worth knowing: an authorization-store read failure (`AuthzStoreUnavailableError` from the permission tables) now also reaches this door as 503 instead of being served as an anonymous request.
