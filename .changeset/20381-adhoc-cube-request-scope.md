---
"@objectstack/service-analytics": patch
---

`AnalyticsService.query()` and `generateSql()` no longer write the service-wide cube registry before the object-level read admission has admitted the request, and never write a caller-named measure into a registered cube (#20381).

Clause-②: no

- **What changes**: both ad-hoc doors — `query()` (`POST /api/v1/analytics/query`) and `generateSql()` (`POST /api/v1/analytics/sql`) — resolved the query's cube and recorded what `ensureCube` minted straight into the shared registry, ahead of the admission check. A request refused `PERMISSION_DENIED` still left the cube it inferred for the refused object in the registry, and a suffix measure a caller named on a registered cube (`<field>_sum`, `<field>_count_distinct`, …) was appended to that cube for every later reader, whether the request was refused or admitted. Both doors now run in the same request-local scope `queryDataset` runs in: what `ensureCube` mints stays with the call, and the admission, read scope and strategy all read it from there.
- **What does not change**: every request is served as before, with the same admission, read scope, refusals, codes and statuses, and a caller-named suffix measure is still served to the caller who named it. A cube inferred for an ADMITTED ad-hoc query is no longer registered either; the separate #20381 entry that retires inferred-cube registration describes that change. Configured cubes and datasets registered at construction (`AnalyticsServiceConfig.cubes` / `datasets`) are untouched.
- **What `getMeta()` lists, the one observable difference**: `getMeta()` and `GET /api/v1/analytics/meta` no longer list a cube inferred for a refused request, and no longer list a suffix measure some caller named on a registered cube — a registered cube is listed as it was registered.
