---
"@objectstack/rest": minor
---

External Datasource Federation (ADR-0015) — REST surface.

Adds `registerExternalDatasourceRoutes`, mounting `/api/v1/datasources/:name/
external/*` — `GET tables`, `POST tables/:remote/draft`, `POST refresh-catalog`,
`POST validate` — served by the `external-datasource` service and wired into the
REST API plugin. Routes return `503 external_service_unavailable` when the
service is not registered, so they are safe to mount unconditionally.
