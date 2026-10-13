---
'@objectstack/runtime': patch
---

A stack's declared `apis` endpoints are served on a config boot whose metadata service has an endpoint matcher, as they already were on an artifact boot

Clause-②: no

The endpoint matcher reads only the metadata service's own `api` items. The artifact door registers them there. A config boot (`os serve objectstack.config.ts` with no compiled artifact) handed them to the engine registry alone, so every declared path answered `404 ENDPOINT_NOT_FOUND`. The built artifact of the same stack matched the same path and answered `401 UNAUTHENTICATED` to a caller with no session. Measured on a stack with no plugin instances that declares one `authRequired` endpoint: `GET` of its path answered 404 from source and 401 after `os build`.

`AppPlugin` now registers each declared `api` item into the metadata service's in-memory registry. It uses the route and the package stamp (`_packageId` / `_packageVersion` / `_provenance`) the code-defined datasources already take, and it takes the items from the boot's one forward-converted copy. The same boot now answers 401 from source. The stored item equals the artifact door's copy of it. On a boot that runs the artifact door (`os dev`, an artifact boot), the door stays the only registrar, so each item is registered once.

One case is unchanged: a composition whose metadata service is the kernel's in-memory fallback has no endpoint matcher. A config whose `plugins` holds plugin instances, booted with `os serve`, is that composition. It now lists the items and still serves none.
