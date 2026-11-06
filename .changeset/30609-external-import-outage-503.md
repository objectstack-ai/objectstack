---
'@objectstack/rest': patch
---

fix(rest): the external-datasource routes relay a declared service outage as `503 SERVICE_UNAVAILABLE`

Clause-②: no
Metadata-protocol: none

`POST /api/v1/datasources/:name/external/tables/:remote/import` answered a `tenancy` service outage as `400 EXTERNAL_IMPORT_ERROR`, telling the caller the request was malformed. The import reads the effective tenancy posture to decide where the imported object lands, and a registered `tenancy` service that cannot answer throws the `503` / `SERVICE_UNAVAILABLE` envelope there. The route now relays that envelope, as the datasource admin routes and the MCP `import_object` tool already do, so the caller is told to retry. Nothing was saved before and nothing is saved now. The other routes under `/datasources/:name/external/*` share the same catch and relay a declared outage the same way; every other refusal keeps its `400` and code.
