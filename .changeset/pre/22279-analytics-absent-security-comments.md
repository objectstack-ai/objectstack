---
'@objectstack/service-analytics': patch
---

docs(service-analytics): the shipped API docs no longer say a deployment with no security service keeps analytics reads open

Clause-②: no

The doc comments on `AnalyticsServiceConfig.admitObjectRead` and `AnalyticsServiceConfig.getReadableFields`, and on the service's read gates, said that a missing hook means "the deployment has no security service" and that such a deployment keeps its analytics behaviour. Both parts were wrong. `AnalyticsServicePlugin` always wires both hooks. On `ObjectKernel` and `LiteKernel`, looking up a `security` service that was never registered throws, so the bridges refuse the query, fail-closed: `PERMISSION_DENIED` / 403 naming the object, plus an `error` line. The docs now say so. A missing hook now means only a host that constructs `AnalyticsService` itself without one.

Only comments change. No behaviour, export or type moves. The text changes in the published `dist/index.d.ts` and `dist/index.d.cts`, and in the JSDoc kept in `dist/index.js` and `dist/index.cjs`.
