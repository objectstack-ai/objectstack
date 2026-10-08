---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a default boot no longer warns that no "security" service is registered; the warning moves to the first query that finds none

Clause-②: no

- **What changed.** `AnalyticsServicePlugin` used to log a WARN at init, `[Analytics] No admitObjectRead configured and no "security" service registered at init …`, on every default boot. `@objectstack/plugin-security` registers the `security` service in its `start()`, after every plugin's `init()`, and the object-level read bridge resolves that service per query. So the warning described a consequence that did not apply to the running app. Init now logs the same situation at `info`, as the sibling row-scope bridge already did: `[Analytics] admitObjectRead bridged to the "security" service; that service is not registered yet at init and will be resolved per query`.
- **Where the warning went.** When an analytics query needs the object-level gate and the plugin context returns no `security` service, the bridge logs one WARN: `[Analytics] No admitObjectRead configured and no "security" service registered when an analytics query needed one (first: "OBJECT") …`. It is logged once per plugin instance, not once per query.
- **Unchanged.** What the bridge enforces. When the plugin context answers a lookup for `security` with nothing, the query is admitted, as before. A lookup that throws, or a service that answers neither `canReadObject` nor `explain`, still denies the query fail-closed and logs an `error`, as before. The in-repo kernels (`ObjectKernel`, `LiteKernel`) throw on a lookup for a service nobody registered, so on those kernels a query with no security service ever registered is still denied, with an `error` per query, as before. A deployment that supplies `admitObjectRead` sees no change.
