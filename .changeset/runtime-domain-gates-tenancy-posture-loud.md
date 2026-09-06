---
'@objectstack/runtime': patch
---

The `/keys` mint gate and the install-wide activation-write gate classify a tenancy resolution failure instead of reading it as "no wall"

Both gates derived the effective tenancy posture through `DomainHandlerDeps.resolveService`, the dispatcher's capability **probe**: every step of its fallback chain absorbs every rejection and answers `undefined`. So a `tenancy` service that was registered and **failed to build** arrived at both gates as the same value a deployment that never registered one produces, and both read that as "there is no wall". Measured on the pre-fix tree against a real kernel whose `tenancy` is registered through a throwing factory: `POST /keys` answered **201** and minted an organization-less key, echoing the raw secret once, where a walled posture refuses one; and an organization administrator's install-wide activation write answered **200** and wrote the row, where ADR-0126 §5 requires the platform operator.

The identity step already read this fact through the classified lookup, so one failure made the same deployment answer 503 at the identity step while admitting at these two gates — "is this deployment walled" had two answers at once. The gates now read the same classification, taken from the registry's own brand and never from message text: a service that was **never registered** stays quiet and behaves exactly as before (an org-less key is still minted, and a single-organization deployment's own admin can still flip an install-wide switch — with no tenancy service, install-level and org-level are one scope under ADR-0093 D4/D5), while a service that is **registered and unable to answer** raises `AuthzStoreUnavailableError` — 503 `SERVICE_UNAVAILABLE` — instead of degrading to "no posture". Nothing is minted and nothing is permitted on a posture that was never read.

`resolveService` keeps its probe contract for every other name and every other domain; the classified read is a second, opted-into dependency the two named gates call, so no gate that was not named here changes behaviour. Patch rather than minor: no accept set widens, and a declared guard returns to enforced.
