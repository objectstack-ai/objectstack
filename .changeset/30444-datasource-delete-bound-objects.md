---
'@objectstack/service-datasource': patch
---

fix(service-datasource): the refusal to delete a datasource that objects still use names its reason and the objects in `error.details`

Clause-②: yes (widening)
Metadata-protocol: none

- `DELETE /api/v1/datasources/:name` on a runtime datasource that objects are still bound to keeps answering `400` `DATASOURCE_ADMIN_ERROR` with the same English message, and now also carries `error.details`: `{ reason: 'objects_bound', count, objects }`. `reason` tells this refusal apart from every other 400 of the datasource admin routes, `count` is the number in the message, and `objects` lists the bound objects' names, sorted, so a client can name them in its own language without reading object metadata. The names come from the same read as the count, so the two cannot disagree.
- `DatasourceAdminServiceConfig.countBoundObjectsDiagnosed` may now return `objects` (the names it counted); the shipped plugin wiring does. A host whose read reports only a number keeps working, and its refusal carries `count` without `objects`.
- Every other 400 of these routes answers exactly as before, with no `details`. The degraded-read refusal (`503` `SERVICE_UNAVAILABLE`) is unchanged.
