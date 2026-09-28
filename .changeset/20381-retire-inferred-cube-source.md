---
"@objectstack/service-analytics": patch
---

A cube `AnalyticsService` infers for an ad-hoc `query()` or `generateSql()` request is no longer registered in the service-wide cube registry, even when the request is admitted, so `getMeta()` and `GET /api/v1/analytics/meta` list configured cubes only (#20381).

Clause-②: no

- **What changes**: an ad-hoc request naming an object that no cube is configured over (`POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql`) is still served from a minimal cube inferred from that request's own members. That cube now lives only in the request that inferred it, like a suffix measure a caller appends to a configured cube. Before, an admitted request left it in the shared registry, so `getMeta()` listed it to every caller, including callers who may not read the object, together with the member names the first caller used. Its contents depended on who had queried what since boot, and it was lost on restart.
- **What does not change**: every request is served as before, with the same answer, admission, read scope, refusals, codes and statuses. A repeat request for the same object infers the cube again, through the same existence and source-field checks, and gets the same answer. Configured cubes (`AnalyticsServiceConfig.cubes`) and datasets registered through `registerDataset` (the constructor's `datasets`, or an embedder) are registered and listed as before, and they are now the registry's only writers.
- **What to do**: nothing, unless something reads `getMeta()` / `GET /api/v1/analytics/meta` expecting to find a cube that only an ad-hoc query inferred. No consumer in this repository does. Author that cube explicitly (`defineCube`, or the analytics service's `cubes` config) so that it is listed, and listed the same way after a restart.
