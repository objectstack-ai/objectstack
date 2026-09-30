---
'@objectstack/runtime': patch
---

fix(runtime): `POST /api/v1/automation/:name/clone` is served over HTTP

Clause-②: no

Cloning a flow under a new machine name (ADR-0126 §7.1) is how an admin customizes a packaged
flow whose base is locked. The runtime implemented the clone, but the dispatcher never mounted
its route, so every clone answered `404 ENDPOINT_NOT_FOUND` before the request reached it: from
the API, and from the Clone dialog on Setup's packaged-automation page, for every caller and
every body.

The route is now mounted beside `POST /automation/:name/toggle`, at `/api/v1/automation/:name/clone`
and, when environment scoping is enabled, at `/api/v1/environments/:environmentId/automation/:name/clone`.
It answers what the clone implementation already answered: `200 { flow, notice }` for a legal
clone, `400` for a missing or illegal `name` or `label`, `404` for an unknown source flow,
`409 RESOURCE_CONFLICT` for a name already in use, `401` for an anonymous caller and `403` for a
caller without `manage_metadata`. No request or response shape changed.
