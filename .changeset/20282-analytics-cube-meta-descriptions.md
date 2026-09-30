---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
---

`GET /api/v1/analytics/meta` now publishes an analytics cube's `description`, each measure's and dimension's `description`, and each measure's `format`, when the cube definition declares them (#20282).

Clause-②: yes (widening)

- `CubeMeta` (`@objectstack/spec/contracts`) gains an optional `description` on the cube and on each measure and dimension, and an optional `format` on each measure. `AnalyticsMetadataResponseSchema` declares the same members. A definition that declares none of them is published exactly as before.
- `AnalyticsService.getMeta` copies what the definition declares and fills in nothing. A cube compiled from a dataset carries each dataset measure's `format` and no `description`.
- The liveness ledger rows `analytics_cube.description`, `measures.description` and `dimensions.description` move from `dead` to `live`.

This supersedes one sentence of this release's note on an authored cube's measure `format` and `granularities`: it says `GET /api/v1/analytics/meta` is unchanged and keeps `name`, `type` and `title`. With this change `/meta` also publishes each measure's declared `format`. A client that formats a result column still reads `format` off the query result's `fields[]`.
