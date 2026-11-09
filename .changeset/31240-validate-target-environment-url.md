---
'@objectstack/cli': patch
---

feat(cli): `os validate --target <environment URL>` fetches the target environment's restriction profile

Clause-②: no
Metadata-protocol: none

`os validate --target` now also takes an environment's `http://` or `https://` URL. The command fetches `GET /api/v1/discovery/restriction-profile` at that URL's origin (the route a hosted environment publishes its profile at), reads the `{ success, data }` body and parses `data` with `RestrictionProfileSchema`, the same parse the file form uses, so a fetched profile judges the stack exactly as the same profile saved to a file.

Every failure is refused and names the URL fetched: an environment that cannot be reached or does not answer within 15 seconds, any non-2xx answer (a `404 RESOURCE_NOT_FOUND` means no environment is served at that host), a body that is not JSON or not the `{ success: true, data }` envelope, and a profile the schema rejects. None of them is ever judged as "no restriction". A URL with any other scheme is refused before anything is fetched. The file form is unchanged.
